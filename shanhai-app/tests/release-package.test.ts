// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, rename, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { request } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import { inflateRawSync } from 'node:zlib'
// These standalone Node tools are JavaScript; this test exercises their public API.
// @ts-expect-error No declaration file for the standalone release CLI.
import { createZip, packageRelease, sourceSnapshot, distributionSnapshot } from '../scripts/package.mjs'
// @ts-expect-error No declaration file for the standalone server CLI.
import { createReleaseServer, loadRelease, parsePort, sha256, safeFileNames } from '../scripts/serve.mjs'

type Snapshot = { path: string; sha256: string; bytes?: number }
type Report = { checkedAt: string; passed: boolean; checks: { name: string; passed: boolean; exitCode: number }[]; changedDuringRun: string[]; sources: Snapshot[]; sourcesAtStart: Snapshot[]; artifacts: Snapshot[] }
const fixtures: string[] = []
const servers: Server[] = []
const now = new Date('2026-09-07T00:00:00.000Z')
const entryJs = 'assets/index-AbCd1234.js', entryCss = 'assets/index-EfGh5678.css'

async function put(root: string, name: string, content: string | Buffer) {
  const target = path.join(root, ...name.split('/'))
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content)
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'shanhai-release-test-'))
  fixtures.push(root)
  for (const name of ['index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'src/main.ts', 'tests/example.test.ts', 'scripts/verify.mjs', 'scripts/sync-legacy-kernels.mjs', 'scripts/build-national-geography.mjs']) await put(root, name, '{}\n')
  for (const name of ['serve.mjs', 'package.mjs', 'release-utils.mjs']) await put(root, `scripts/${name}`, await readFile(fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))))
  for (const [name, content] of Object.entries({ 'data/SOURCES.md': 'Public geographic sources', 'data/yunnan-geography.geojson': '{"type":"FeatureCollection","features":[]}', 'data/china-provinces.geojson': '{"type":"FeatureCollection","features":[]}', 'licenses/Leaflet.txt': 'Leaflet license' })) {
    await put(root, `public/${name}`, content)
    await put(root, `dist/${name}`, content)
  }
  await put(root, 'dist/index.html', `<script type="module" src="/${entryJs}"></script><link rel="stylesheet" href="/${entryCss}"><div id="app"></div>`)
  await put(root, `dist/${entryJs}`, 'console.log("public trial");\n')
  await put(root, `dist/${entryCss}`, 'body{color:#222}\n')
  await put(root, 'dist/.vite/manifest.json', JSON.stringify({ 'index.html': { file: entryJs, isEntry: true, css: [entryCss] } }))
  const sources = await sourceSnapshot(root), artifacts = await distributionSnapshot(root)
  const report: Report = { checkedAt: now.toISOString(), passed: true, checks: ['kernel-freshness', 'geography-freshness', 'typecheck', 'tests', 'build'].map(name => ({ name, passed: true, exitCode: 0 })), changedDuringRun: [], sources, sourcesAtStart: sources, artifacts }
  await put(root, 'qa/current/report.json', JSON.stringify(report))
  return { root, report }
}

afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve, reject) => {
    server.closeAllConnections()
    server.close(error => error ? reject(error) : resolve())
  })
  for (const folder of fixtures.splice(0)) {
    // Only remove directories returned by our own mkdtemp under the OS temp root.
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(folder))
    if (relative.includes(path.sep) || !relative.startsWith('shanhai-release-test-') || (await lstat(folder)).isSymbolicLink()) throw new Error('Refusing unsafe test cleanup')
    await rm(folder, { recursive: true })
  }
})

function independentCrc32(bytes: Buffer) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** Reads the central directory, local header and compressed payload independently. */
function inspectZip(bytes: Buffer) {
  const end = bytes.length - 22
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50)
  expect(bytes.readUInt16LE(end + 20)).toBe(0)
  const count = bytes.readUInt16LE(end + 10), centralSize = bytes.readUInt32LE(end + 12)
  let cursor = bytes.readUInt32LE(end + 16)
  expect(cursor + centralSize).toBe(end)
  const files = new Map<string, Buffer>()
  for (let index = 0; index < count; index++) {
    expect(bytes.readUInt32LE(cursor)).toBe(0x02014b50)
    expect(bytes.readUInt16LE(cursor + 10)).toBe(8)
    const compressedSize = bytes.readUInt32LE(cursor + 20), size = bytes.readUInt32LE(cursor + 24)
    const nameLength = bytes.readUInt16LE(cursor + 28), extra = bytes.readUInt16LE(cursor + 30), comment = bytes.readUInt16LE(cursor + 32)
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    const local = bytes.readUInt32LE(cursor + 42)
    expect(bytes.readUInt32LE(local)).toBe(0x04034b50)
    expect(bytes.readUInt16LE(local + 6) & 0x800).toBe(0x800)
    const localNameLength = bytes.readUInt16LE(local + 26), localExtra = bytes.readUInt16LE(local + 28)
    expect(bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8')).toBe(name)
    const start = local + 30 + localNameLength + localExtra
    const content = inflateRawSync(bytes.subarray(start, start + compressedSize))
    expect(content.length).toBe(size)
    expect(independentCrc32(content)).toBe(bytes.readUInt32LE(cursor + 16))
    expect(files.has(name)).toBe(false)
    files.set(name, content)
    cursor += 46 + nameLength + extra + comment
  }
  expect(cursor).toBe(end)
  return files
}

async function running(root: string) {
  const { server } = await createReleaseServer({ root }) as { server: Server }
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected loopback TCP server')
  expect(address.address).toBe('127.0.0.1')
  return (pathname: string, method = 'GET', host = `127.0.0.1:${address.port}`) => new Promise<{ status: number | undefined; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: address.port, path: pathname, method, headers: { host, connection: 'close' } }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('verified standalone trial packaging', () => {
  it('writes exact approved bytes, a independently readable ZIP, manifest and matching receipt without overwriting past output', async () => {
    const { root } = await fixture()
    const result = await packageRelease({ root, now })
    const archive = await readFile(result.archivePath), files = inspectZip(archive)
    expect(result.receipt.archiveSha256).toBe(sha256(archive))
    expect(result.receipt.archiveBytes).toBe(archive.length)
    expect(result.receipt.manifestSha256).toBe(sha256(await readFile(path.join(result.bundleRoot, 'manifest.json'))))
    expect(result.receipt.verificationReportSha256).toBe(sha256(await readFile(path.join(root, 'qa/current/report.json'))))
    expect(result.manifest.files.map((file: Snapshot) => file.path)).not.toContain('qa/current/report.json')
    const names = await safeFileNames(result.bundleRoot)
    expect(files.size).toBe(result.receipt.fileCount)
    expect([...files.keys()].sort()).toEqual(names.map((name: string) => `${path.basename(result.bundleRoot)}/${name}`).sort())
    for (const name of names) expect(files.get(`${path.basename(result.bundleRoot)}/${name}`)).toEqual(await readFile(path.join(result.bundleRoot, name)))
    await expect(loadRelease(result.bundleRoot)).resolves.toHaveProperty('cache')
    const second = await packageRelease({ root, now })
    expect(second.bundleRoot).not.toBe(result.bundleRoot)
    expect(await readFile(result.archivePath)).toEqual(archive)
  })

  it.each(['failed', 'check-failed', 'missing-check', 'duplicate-check', 'extra-failed-check', 'changed-during-run', 'expired', 'future', 'source', 'new-source', 'artifact', 'missing-artifact', 'missing-source'] as const)('refuses %s verification or modified inputs', async mode => {
    const { root, report } = await fixture()
    if (mode === 'failed') report.passed = false
    if (mode === 'check-failed') report.checks[0]!.passed = false
    if (mode === 'missing-check') report.checks.pop()
    if (mode === 'duplicate-check') report.checks.push({ ...report.checks[0]! })
    if (mode === 'extra-failed-check') report.checks.push({ name: 'bundle-policy', passed: false, exitCode: 1 })
    if (mode === 'changed-during-run') report.changedDuringRun.push('src/main.ts')
    if (mode === 'expired') report.checkedAt = '2026-09-01T00:00:00Z'
    if (mode === 'future') report.checkedAt = '2026-09-08T00:00:00Z'
    if (mode === 'source') await put(root, 'src/main.ts', 'changed')
    if (mode === 'new-source') await put(root, 'tests/unreviewed.test.ts', 'changed')
    if (mode === 'artifact') await put(root, `dist/${entryJs}`, 'changed')
    if (mode === 'missing-artifact') report.artifacts.pop()
    if (mode === 'missing-source') report.sources = report.sources.slice(1)
    await put(root, 'qa/current/report.json', JSON.stringify(report))
    await expect(packageRelease({ root, now })).rejects.toThrow()
    await expect(lstat(path.join(root, 'release'))).rejects.toHaveProperty('code', 'ENOENT')
  })

  it('accepts the complete split Vite dependency graph and additional passing verification checks', async () => {
    const { root, report } = await fixture()
    const graph: Record<string, { file: string; isEntry?: boolean; imports?: string[]; dynamicImports?: string[]; css?: string[] }> = {
      'index.html': { file: entryJs, isEntry: true, css: [entryCss], imports: ['_regions.js', '_places.js', '_vendor.js', '_rolldown-runtime.js'], dynamicImports: ['_geography.js'] },
    }
    for (const name of ['geography', 'regions', 'places', 'vendor', 'rolldown-runtime']) {
      const file = `assets/${name}-AbCd1234.js`
      await put(root, `dist/${file}`, `export const chunk = ${JSON.stringify(name)};`)
      graph[`_${name}.js`] = { file, imports: name === 'rolldown-runtime' ? [] : ['_rolldown-runtime.js'] }
    }
    await put(root, 'dist/.vite/manifest.json', JSON.stringify(graph))
    report.artifacts = await distributionSnapshot(root)
    report.checks.push({ name: 'bundle-policy', passed: true, exitCode: 0 })
    await put(root, 'qa/current/report.json', JSON.stringify(report))
    const release = await packageRelease({ root, now })
    expect(release.manifest.publicFiles).toContain('assets/rolldown-runtime-AbCd1234.js')
    expect(release.manifest.verification.checks).toContainEqual({ name: 'bundle-policy', passed: true, exitCode: 0 })
    expect(release.manifest.publicFiles).toContain('data/china-provinces.geojson')
    expect(release.manifest.publicFiles).toContain('assets/regions-AbCd1234.js')
    expect(release.manifest.publicFiles).toHaveLength(13)
  })

  it('rejects unsafe and duplicate ZIP entry names before encoding an archive', () => {
    for (const name of ['../private.json', 'folder/../../private.json', '/absolute.txt', 'C:/absolute.txt', 'folder\\escape.txt', 'folder/%2e%2e.txt']) expect(() => createZip([{ name, bytes: Buffer.from('fixture') }], now)).toThrow(/Unsafe/)
    expect(() => createZip([{ name: 'same.txt', bytes: Buffer.from('one') }, { name: 'same.txt', bytes: Buffer.from('two') }], now)).toThrow(/Duplicate/)
  })

  it.each(['dist/private.json', 'dist/photo.png', 'dist/assets/index-AbCd1234.js.map', 'dist/.env', 'dist/qa/report.json', 'src/data/private.json', 'public/data/backup.json', 'scripts/credentials.json'])('refuses unlisted or private-shaped input %s', async name => {
    const { root } = await fixture()
    await put(root, name, 'must never enter archive')
    await expect(packageRelease({ root, now })).rejects.toThrow(/Unlisted/)
  })

  it('rejects orphan assets, unsafe manifest references, and duplicate stale asset families', async () => {
    const { root } = await fixture()
    await put(root, 'dist/assets/geography-ZzYy9988.js', 'extra')
    await expect(distributionSnapshot(root)).rejects.toThrow(/Unreferenced/)
    await rm(path.join(root, 'dist/assets/geography-ZzYy9988.js'))
    await put(root, 'dist/.vite/manifest.json', JSON.stringify({ 'index.html': { file: entryJs, isEntry: true, css: [entryCss], imports: ['../../private.json'] } }))
    await expect(distributionSnapshot(root)).rejects.toThrow(/Missing Vite dependency/)
    await put(root, 'dist/assets/index-XxYy9988.js', 'stale')
    await expect(distributionSnapshot(root)).rejects.toThrow(/Duplicate asset family/)
  })

  it.each(['src', 'dist', 'qa', 'release'] as const)('refuses a junction/symlink at %s without following or writing into it', async name => {
    const { root } = await fixture()
    const outside = await mkdtemp(path.join(tmpdir(), 'shanhai-release-test-'))
    fixtures.push(outside)
    await put(outside, 'private.json', 'untouched')
    if (name !== 'release') await rename(path.join(root, name), path.join(root, `${name}-original`))
    await symlink(outside, path.join(root, name), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(packageRelease({ root, now })).rejects.toThrow(/link|Root/)
    expect(await safeFileNames(outside)).toEqual(['private.json'])
    expect(await readFile(path.join(outside, 'private.json'), 'utf8')).toBe('untouched')
  })
})

describe('local manifest-only static server', () => {
  it('serves GET/HEAD routes with strict MIME, CSP and asset cache headers', async () => {
    const { root } = await fixture(), release = await packageRelease({ root, now })
    const get = await running(release.bundleRoot)
    const index = await get('/app')
    expect(index.status).toBe(200)
    expect(index.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(index.headers['cache-control']).toBe('no-store')
    expect(index.headers['x-content-type-options']).toBe('nosniff')
    expect(index.headers['content-security-policy']).toContain("style-src 'self' 'unsafe-inline'")
    expect(index.headers['content-security-policy']).toContain("img-src 'self' data: blob:")
    expect((await get('/')).body).toEqual(index.body)
    expect((await get('/app/')).body).toEqual(index.body)
    const head = await get('/index.html', 'HEAD')
    expect(head.status).toBe(200)
    expect(head.body.length).toBe(0)
    expect(Number(head.headers['content-length'])).toBe(index.body.length)
    for (const [name, mime] of [[entryJs, 'text/javascript'], [entryCss, 'text/css'], ['data/yunnan-geography.geojson', 'application/geo+json'], ['data/SOURCES.md', 'text/plain'], ['licenses/Leaflet.txt', 'text/plain'], ['.vite/manifest.json', 'application/json']]) {
      const response = await get(`/${name}?v=1`)
      expect(response.status).toBe(200)
      expect(response.headers['content-type']).toContain(mime)
      expect(response.headers['cache-control']).toBe(name!.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-store')
    }
  })

  it('returns 404/405 for private, traversal, directory and write requests, and rejects nonlocal Host', async () => {
    const { root } = await fixture(), release = await packageRelease({ root, now })
    const get = await running(release.bundleRoot)
    for (const name of ['/qa/report.json', '/backup.json', '/serve.mjs', '/README.md', '/manifest.json', '/assets/', '/data', '/app/private.json', '/../index.html', '/assets/../index.html', '/%2e%2e/index.html', '/%252e%252e/index.html', '/assets%2findex-AbCd1234.js', '/assets\\..\\index.html', '//index.html', '/index.html/']) expect((await get(name)).status).toBe(404)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await get('/index.html', method)
      expect(response.status).toBe(405)
      expect(response.headers.allow).toBe('GET, HEAD')
    }
    expect((await get('/', 'GET', 'attacker.example')).status).toBe(403)
  })

  it('keeps approved bytes after startup instead of reading subsequent file changes or new private files', async () => {
    const { root } = await fixture(), release = await packageRelease({ root, now })
    const get = await running(release.bundleRoot)
    const approved = (await get('/')).body
    await put(release.bundleRoot, 'index.html', 'unexpected replacement')
    await put(release.bundleRoot, 'private.json', 'private backup must stay private')
    expect((await get('/')).body).toEqual(approved)
    expect((await get('/private.json')).status).toBe(404)
    await expect(loadRelease(release.bundleRoot)).rejects.toThrow(/unlisted/)
  })

  it.each(['missing-manifest', 'modified-byte', 'manifest-escape', 'extra-file', 'symlink'] as const)('refuses startup with %s', async mode => {
    const { root } = await fixture(), release = await packageRelease({ root, now })
    if (mode === 'missing-manifest') await rm(path.join(release.bundleRoot, 'manifest.json'))
    if (mode === 'modified-byte') await put(release.bundleRoot, entryJs, 'tampered')
    if (mode === 'manifest-escape') {
      release.manifest.files[0].path = '../private.json'
      await put(release.bundleRoot, 'manifest.json', JSON.stringify(release.manifest))
    }
    if (mode === 'extra-file') await put(release.bundleRoot, 'photos/private.jpg', 'private')
    if (mode === 'symlink') {
      await rename(path.join(release.bundleRoot, 'assets'), path.join(root, 'old-assets'))
      await symlink(path.join(root, 'old-assets'), path.join(release.bundleRoot, 'assets'), process.platform === 'win32' ? 'junction' : 'dir')
    }
    await expect(createReleaseServer({ root: release.bundleRoot })).rejects.toThrow()
  })

  it('accepts only a numeric CLI port and defaults to the stable local origin', () => {
    expect(parsePort()).toBe(5176)
    expect(parsePort(['5177'])).toBe(5177)
    for (const args of [['0'], ['65536'], ['-1'], ['1.5'], ['5176junk'], ['--host', '0.0.0.0'], ['5176', '5177'], ['http://localhost'], [' 5176']]) expect(() => parsePort(args)).toThrow()
  })
})
