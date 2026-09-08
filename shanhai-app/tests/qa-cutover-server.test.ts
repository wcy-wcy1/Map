// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rename, symlink, lstat, realpath, rm } from 'node:fs/promises'
import { request } from 'node:http'
import type { IncomingHttpHeaders, Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
// @ts-expect-error The standalone QA server intentionally has no generated declaration file.
import { createCutoverServer } from '../scripts/qa-cutover.mjs'

/** HTTP/file boundary tests only. These synthetic builds never execute browser
 * JavaScript or access IndexedDB. All writes are beneath mkdtemp-owned roots;
 * the preserved old HTML is read once, then copied into the isolated fixtures. */
const legacyHash = 'bfa10f4a3ef5f5d8e492c7744e239e0657016e7847f124815f1e18e88510565e'
const fixturePrefix = 'shanhai-cutover-server-test-'
const roots: string[] = [], servers: Server[] = []
const entryJs = 'assets/index-AbCd1234.js', entryCss = 'assets/index-AbCd1234.css'
const vendorJs = 'assets/vendor-ZzYy9988.js'
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex')
let oldHtml: Buffer
type EvidenceFile = { path: string; sha256: string; bytes: number }
type Lab = { server: Server; address: string; evidence: { legacySha256: string; files: EvidenceFile[] } }

beforeAll(async () => {
  oldHtml = await readFile(new URL('../../output/shanhai-yunnan/index.html', import.meta.url))
  expect(hash(oldHtml)).toBe(legacyHash)
})

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }
  for (const folder of roots.splice(0)) {
    // Every deletion target is the exact root returned by this test's mkdtemp;
    // never follow a replaced root or recurse over a project/user directory.
    const relative = path.relative(path.resolve(tmpdir()), path.resolve(folder))
    if (relative.includes(path.sep) || !relative.startsWith(fixturePrefix)
      || (await lstat(folder)).isSymbolicLink() || path.relative(folder, await realpath(folder)) !== '') {
      throw new Error('Refusing unsafe cutover-test cleanup')
    }
    await rm(folder, { recursive: true })
  }
})

async function put(root: string, name: string, bytes: string | Buffer) {
  const target = path.resolve(root, ...name.split('/'))
  if (path.relative(root, target).startsWith('..')) throw new Error('Test fixture path escaped root')
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, bytes)
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), fixturePrefix))
  roots.push(root)
  const projectRoot = path.join(root, 'shanhai-app')
  const manifest = {
    'index.html': { file: entryJs, isEntry: true, css: [entryCss], imports: ['_vendor'] },
    _vendor: { file: vendorJs },
  }
  await put(root, 'output/shanhai-yunnan/index.html', oldHtml)
  await put(root, 'output/shanhai-yunnan/fixtures/memory-qa/valid.jpg', Buffer.from([255, 216, 255, 217]))
  for (const [name, content] of Object.entries({
    'dist/index.html': `<script type="module" src="/${entryJs}"></script><link rel="stylesheet" href="/${entryCss}"><div id="app">合成构建</div>`,
    'dist/.vite/manifest.json': JSON.stringify(manifest),
    [`dist/${entryJs}`]: `import '/${vendorJs}'; console.log('synthetic app');`,
    [`dist/${entryCss}`]: 'body{color:#234}',
    [`dist/${vendorJs}`]: 'export const fixture = true;',
    'dist/data/SOURCES.md': 'Authored QA geography source notice',
    'dist/data/yunnan-geography.geojson': '{"type":"FeatureCollection","features":[]}',
    'dist/data/china-provinces.geojson': '{"type":"FeatureCollection","features":[]}',
    'dist/licenses/Leaflet.txt': 'Authored QA license fixture',
    'scripts/qa-cutover-ui.mjs': 'document.title = "synthetic cutover controls";',
    'src/private.ts': 'synthetic private source marker',
    'qa/report.json': '{"privateFixture":true}',
  })) await put(projectRoot, name, content)
  for (const name of ['data/SOURCES.md', 'data/yunnan-geography.geojson', 'data/china-provinces.geojson', 'licenses/Leaflet.txt']) {
    await put(projectRoot, `public/${name}`, await readFile(path.join(projectRoot, 'dist', name)))
  }
  return { root, projectRoot, manifest }
}

async function start(projectRoot: string) {
  const lab = await createCutoverServer({ projectRoot, port: 0 }) as Lab
  // Track even an unexpectedly successful start so a failing test cannot leak
  // a listening socket into subsequent cases.
  servers.push(lab.server)
  return lab
}

function get(lab: Lab, target: string, method = 'GET', host?: string | null) {
  return new Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const address = new URL(lab.address)
    const headers: Record<string, string> = {}
    if (host !== null) headers.Host = host ?? address.host
    // node:http preserves the raw target: URL/fetch would normalize traversal
    // before it reached the code being tested.
    const outgoing = request({ hostname: '127.0.0.1', port: Number(address.port), path: target, method,
      headers, setHost: false, agent: false }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.from(chunk)))
      response.on('error', reject)
      response.on('end', () => resolve({ status: response.statusCode!, headers: response.headers, body: Buffer.concat(chunks) }))
    })
    outgoing.on('error', reject)
    outgoing.setTimeout(3000, () => outgoing.destroy(new Error('Test HTTP request timed out')))
    outgoing.end()
  })
}

describe('isolated cutover lab HTTP and approved file boundary', () => {
  it('binds only loopback and serves exact approved GET/HEAD bytes with evidence hashes and MIME', async () => {
    const { projectRoot } = await fixture(), lab = await start(projectRoot)
    expect(lab.server.address()).toMatchObject({ address: '127.0.0.1' })
    expect(lab.evidence.legacySha256).toBe(legacyHash)
    expect(new Set(lab.evidence.files.map(file => file.path)).size).toBe(lab.evidence.files.length)
    for (const file of lab.evidence.files) {
      const response = await get(lab, file.path)
      expect(response.status, file.path).toBe(200)
      expect(hash(response.body), file.path).toBe(file.sha256)
      expect(response.body.length).toBe(file.bytes)
      expect(Number(response.headers['content-length'])).toBe(file.bytes)
      expect(response.headers['cache-control']).toBe('no-store')
      expect(response.headers['x-content-type-options']).toBe('nosniff')
      expect(response.headers['referrer-policy']).toBe('no-referrer')
      const head = await get(lab, file.path, 'HEAD')
      expect(head.status).toBe(200)
      expect(head.body.length).toBe(0)
      expect(Number(head.headers['content-length'])).toBe(file.bytes)
      expect(head.headers['content-type']).toBe(response.headers['content-type'])
    }
    for (const [name, type] of [['/legacy', 'text/html'], ['/qa', 'text/html'], ['/qa-cutover-ui.mjs', 'text/javascript'],
      [`/${entryJs}`, 'text/javascript'], [`/${entryCss}`, 'text/css'], ['/fixture.jpg', 'image/jpeg'],
      ['/.vite/manifest.json', 'application/json'], ['/data/yunnan-geography.geojson', 'application/json'], ['/data/china-provinces.geojson', 'application/json'], ['/licenses/Leaflet.txt', 'text/plain']]) {
      expect((await get(lab, name!)).headers['content-type']).toContain(type)
    }
    expect((await get(lab, '/legacy')).body).toEqual(oldHtml)
    expect((await get(lab, '/')).body).toEqual((await get(lab, '/qa')).body)
    expect((await get(lab, '/app')).body).toEqual((await get(lab, '/index.html')).body)
    expect((await get(lab, '/app?v=%2f..')).body).toEqual((await get(lab, '/app')).body)
    expect((await get(lab, '/qa')).body.toString()).toContain('不要导入私人备份')
  })

  it('rejects private paths, raw/encoded traversal, backslashes, directories and absolute-form targets', async () => {
    const { projectRoot } = await fixture(), lab = await start(projectRoot)
    for (const target of ['/src/private.ts', '/qa/report.json', '/private-backup.json', '/assets/unlisted-Secret123.js', '/scripts/qa-cutover.mjs',
      '/package.json', '/.env', '/assets/', '/data', '/legacy/', '/app/private-backup.json', '/index.html/', '//index.html',
      '/../index.html', '/assets/../index.html', '/assets\\..\\index.html', '/%2e%2e/index.html', '/%252e%252e/index.html',
      '/assets%2findex-AbCd1234.js', '/assets%5cindex-AbCd1234.js', '/%69ndex.html', '/index.html%00', '/index.html:stream',
      'http://127.0.0.1/app', '*']) {
      const response = await get(lab, target)
      expect(response.status, target).toBe(404)
      expect(response.body.toString()).not.toContain('privateFixture')
      expect(response.headers['cache-control']).toBe('no-store')
    }
  })

  it('accepts only the actual loopback Host/port and GET or HEAD methods', async () => {
    const { projectRoot } = await fixture(), lab = await start(projectRoot), port = new URL(lab.address).port
    expect((await get(lab, '/app', 'GET', `localhost:${port}`)).status).toBe(200)
    for (const host of ['attacker.example', `attacker.example:${port}`, '127.0.0.1:1', 'localhost', '127.0.0.1',
      `127.0.0.1.evil.example:${port}`, `localhost.evil.example:${port}`, `[::1]:${port}`, '0.0.0.0:' + port]) {
      expect((await get(lab, '/legacy', 'GET', host)).status, host).toBe(421)
    }
    // Node itself rejects a missing Host on HTTP/1.1 before the handler.
    expect([400, 421]).toContain((await get(lab, '/app', 'GET', null)).status)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']) {
      const response = await get(lab, '/legacy', method)
      expect(response.status, method).toBe(405)
      expect(response.headers.allow).toBe('GET, HEAD')
      expect(response.body.length).toBe(0)
    }
  })

  it('continues serving only cached approved bytes after source files change or disappear', async () => {
    const { root, projectRoot } = await fixture(), lab = await start(projectRoot)
    const paths = ['/legacy', '/app', `/${entryJs}`, '/qa-cutover-ui.mjs', '/fixture.jpg']
    const before = await Promise.all(paths.map(target => get(lab, target)))
    await put(root, 'output/shanhai-yunnan/index.html', 'replaced old build')
    await put(root, 'output/shanhai-yunnan/fixtures/memory-qa/valid.jpg', 'replaced image')
    await put(projectRoot, 'dist/index.html', 'replaced app')
    await put(projectRoot, 'scripts/qa-cutover-ui.mjs', 'replaced script')
    await rename(path.join(projectRoot, 'dist', entryJs), path.join(projectRoot, 'dist/assets/removed-entry.js'))
    await put(projectRoot, 'dist/new-private.json', 'must stay private')
    for (const [index, target] of paths.entries()) expect((await get(lab, target)).body).toEqual(before[index]!.body)
    expect((await get(lab, '/new-private.json')).status).toBe(404)
    expect((await get(lab, '/assets/removed-entry.js')).status).toBe(404)
    await expect(start(projectRoot)).rejects.toThrow()
  })

  it.each(['modified', 'missing'] as const)('refuses a %s old baseline before starting a listener', async mode => {
    const { root, projectRoot } = await fixture()
    const oldPath = path.join(root, 'output/shanhai-yunnan/index.html')
    if (mode === 'modified') await put(root, 'output/shanhai-yunnan/index.html', Buffer.concat([oldHtml, Buffer.from('\n')]))
    else await rename(oldPath, oldPath + '.preserved')
    if (mode === 'modified') await expect(start(projectRoot)).rejects.toThrow(/legacy baseline changed/i)
    else await expect(start(projectRoot)).rejects.toThrow()
    expect(servers).toHaveLength(0)
  })

  it.each(['../private.js', '/assets/index-AbCd1234.js', 'assets/../../private.js', 'assets\\private.js',
    'assets/photo.jpg', 'assets/private.json', 'assets/index-AbCd1234.js.map', 'https://example.com/a.js', 'assets/%2e%2e.js'])('refuses unapproved build asset %s', async resource => {
    const { projectRoot, manifest } = await fixture()
    manifest['index.html'].file = resource
    await put(projectRoot, 'dist/.vite/manifest.json', JSON.stringify(manifest))
    await expect(start(projectRoot)).rejects.toThrow()
    expect(servers).toHaveLength(0)
  })

  it.each(['css', 'assets'] as const)('validates %s references with the same resource whitelist', async field => {
    const { projectRoot, manifest } = await fixture()
    await put(projectRoot, 'dist/.vite/manifest.json', JSON.stringify({ ...manifest,
      'index.html': { ...manifest['index.html'], [field]: ['../private.json'] } }))
    await expect(start(projectRoot)).rejects.toThrow()
  })

  it.each(['private-backup.json', 'assets/unlisted-Secret123.js', 'assets/index-AbCd1234.js.map', 'qa/report.json'])('refuses unlisted distribution input %s', async name => {
    const { projectRoot } = await fixture()
    await put(projectRoot, `dist/${name}`, 'synthetic private input must not be exposed')
    await expect(start(projectRoot)).rejects.toThrow()
    expect(servers).toHaveLength(0)
  })

  it.each(['missing-asset', 'directory-asset', 'nested-link'] as const)('refuses %s in the approved file list', async mode => {
    const { projectRoot } = await fixture(), assets = path.join(projectRoot, 'dist/assets')
    if (mode === 'missing-asset') await rename(path.join(projectRoot, 'dist', entryJs), path.join(assets, 'gone.js'))
    if (mode === 'directory-asset') {
      await rename(path.join(projectRoot, 'dist', entryJs), path.join(assets, 'gone.js'))
      await mkdir(path.join(projectRoot, 'dist', entryJs))
    }
    if (mode === 'nested-link') {
      await rename(assets, assets + '-original')
      await symlink(assets + '-original', assets, process.platform === 'win32' ? 'junction' : 'dir')
    }
    await expect(start(projectRoot)).rejects.toThrow()
    expect(servers).toHaveLength(0)
  })

  it.each(['dist', 'legacy', 'fixture', 'project'] as const)('refuses a junction/symlink as the %s input root', async mode => {
    const { root, projectRoot } = await fixture()
    const target = mode === 'dist' ? path.join(projectRoot, 'dist') : mode === 'legacy' ? path.join(root, 'output/shanhai-yunnan')
      : mode === 'fixture' ? path.join(root, 'output/shanhai-yunnan/fixtures/memory-qa') : projectRoot
    await rename(target, target + '-original')
    await symlink(target + '-original', target, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(start(projectRoot)).rejects.toThrow(/link|root|unsafe/i)
  })

  it.each([
    { label: 'empty object', manifest: {} },
    { label: 'array', manifest: [] },
    { label: 'null entry', manifest: { 'index.html': null } },
    { label: 'non-array CSS', manifest: { 'index.html': { file: entryJs, isEntry: true, css: '' } } },
  ])('rejects a malformed or entryless Vite manifest: $label', async ({ manifest }) => {
    const { projectRoot } = await fixture()
    await put(projectRoot, 'dist/.vite/manifest.json', JSON.stringify(manifest))
    await expect(start(projectRoot)).rejects.toThrow()
    expect(servers).toHaveLength(0)
  })

  it('rejects invalid numeric ports before loading any inputs', async () => {
    for (const port of [-1, 65536, 1.5, NaN, Infinity, '5175', null]) {
      await expect(createCutoverServer({ port, projectRoot: '/intentionally-nonexistent-cutover-fixture' })).rejects.toThrow('Invalid port')
    }
  })
})
