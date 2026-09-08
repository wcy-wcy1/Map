/** Standalone, local-only release server. Uses only bytes approved at startup. */
import { createServer } from 'node:http'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

export const PUBLIC_FILES = Object.freeze(['index.html', '.vite/manifest.json', 'data/SOURCES.md', 'data/yunnan-geography.geojson', 'data/china-provinces.geojson', 'licenses/Leaflet.txt'])
export const ASSET_PATTERN = /^assets\/(?:index|RemoteApp|geography|regions|places|vendor|rolldown-runtime)-[A-Za-z0-9_-]{8}\.(?:js|css)$/
export const MANIFEST_FORMAT = 'shanhai-vue-local-trial'
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

export function assertSafeName(name) {
  if (typeof name !== 'string' || !name || name.includes('\\') || name.includes(':') || /[%?#\x00-\x1f\x7f]/.test(name) || name.split('/').some(part => !part || part === '.' || part === '..') || path.isAbsolute(name)) throw new Error(`Unsafe relative path: ${String(name)}`)
  return name
}

export async function safeRoot(folder) {
  const absolute = path.resolve(folder)
  const stat = await lstat(absolute)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`Root must be a regular directory: ${absolute}`)
  const resolved = await realpath(absolute)
  if (path.relative(absolute, resolved) !== '') throw new Error(`Root may not resolve through a link: ${absolute}`)
  return absolute
}

async function safeTarget(root, name, directory = false) {
  assertSafeName(name)
  let target = root
  const parts = name.split('/')
  for (let i = 0; i < parts.length; i++) {
    target = path.join(target, parts[i])
    const stat = await lstat(target)
    if (stat.isSymbolicLink()) throw new Error(`Symbolic links are forbidden: ${name}`)
    if (i < parts.length - 1 || directory) {
      if (!stat.isDirectory()) throw new Error(`Expected directory: ${name}`)
    } else if (!stat.isFile()) throw new Error(`Expected regular file: ${name}`)
  }
  const resolved = await realpath(target)
  if (path.relative(root, resolved) !== name.split('/').join(path.sep)) throw new Error(`Path escapes approved root: ${name}`)
  return target
}

export async function readSafeFile(root, name) {
  const target = await safeTarget(root, name)
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    if (!(await handle.stat()).isFile()) throw new Error(`Expected regular file: ${name}`)
    await safeTarget(root, name)
    return await handle.readFile()
  } finally { await handle.close() }
}

/** Enumerates metadata only; rejects links, special files and unapproved folders. */
export async function safeFileNames(root, prefix = '', allowedDirectory = () => true) {
  const folder = prefix ? await safeTarget(root, prefix, true) : root
  const names = []
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    assertSafeName(name)
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are forbidden: ${name}`)
    if (entry.isDirectory()) {
      if (!allowedDirectory(name)) throw new Error(`Unlisted directory: ${name}`)
      names.push(...await safeFileNames(root, name, allowedDirectory))
    } else if (entry.isFile()) names.push(name)
    else throw new Error(`Expected regular file: ${name}`)
  }
  return names.sort()
}

export function validatePublicNames(names) {
  if (!Array.isArray(names) || new Set(names).size !== names.length) throw new Error('Duplicate or invalid public file list')
  for (const name of names) {
    assertSafeName(name)
    if (!PUBLIC_FILES.includes(name) && !ASSET_PATTERN.test(name)) throw new Error(`Unlisted distribution file: ${name}`)
  }
  for (const name of PUBLIC_FILES) if (!names.includes(name)) throw new Error(`Missing distribution file: ${name}`)
  for (const extension of ['js', 'css']) {
    if (!names.some(name => name.startsWith('assets/index-') && name.endsWith(`.${extension}`))) throw new Error(`Missing entry ${extension} asset`)
  }
  const families = names.filter(name => ASSET_PATTERN.test(name)).map(name => name.replace(/-[A-Za-z0-9_-]{8}\./, '.'))
  if (new Set(families).size !== families.length) throw new Error('Duplicate asset family; stale assets must not be packaged')
  return [...names].sort()
}

export async function loadRelease(folder) {
  const root = await safeRoot(folder)
  const manifestBytes = await readSafeFile(root, 'manifest.json')
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  if (manifest.format !== MANIFEST_FORMAT || manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error('Invalid release manifest')
  const publicNames = validatePublicNames(manifest.publicFiles)
  const expected = [...publicNames, 'README.md', 'serve.mjs'].sort()
  const entries = new Map()
  for (const entry of manifest.files) {
    assertSafeName(entry.path)
    if (entries.has(entry.path) || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid manifest file entry')
    entries.set(entry.path, entry)
  }
  if (JSON.stringify([...entries.keys()].sort()) !== JSON.stringify(expected)) throw new Error('Manifest must list exactly approved public files, README.md and serve.mjs')
  const actual = await safeFileNames(root, '', name => ['assets', 'data', 'licenses', '.vite'].includes(name))
  if (JSON.stringify(actual) !== JSON.stringify([...expected, 'manifest.json'].sort())) throw new Error('Release contains missing or unlisted files')
  const cache = new Map()
  for (const [name, entry] of entries) {
    const bytes = await readSafeFile(root, name)
    if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw new Error(`Release hash mismatch: ${name}`)
    if (publicNames.includes(name)) cache.set(name, bytes)
  }
  return { manifest, cache }
}

const MIME = Object.freeze({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8', '.json': 'application/json; charset=utf-8' })
const HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  // Vue/Leaflet set style attributes, and browser-local photos/cards use data/blob URLs.
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; media-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
})

export function parsePort(args = []) {
  if (args.length > 1 || (args.length === 1 && !/^[0-9]{1,5}$/.test(args[0]))) throw new Error('Usage: node serve.mjs [numeric-port]; host is always 127.0.0.1')
  const port = args.length ? Number(args[0]) : 5176
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535')
  return port
}

function requestName(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//')) return null
  const pathname = raw.split('?')[0]
  // Reject encoded separators/dots as well as double encoding before URL normalization.
  if (/%|\\|[\x00-\x1f\x7f#]/.test(pathname)) return null
  if (pathname === '/' || pathname === '/app' || pathname === '/app/') return 'index.html'
  try { return assertSafeName(pathname.slice(1)) } catch { return null }
}

export async function createReleaseServer({ root = path.dirname(fileURLToPath(import.meta.url)) } = {}) {
  const { cache, manifest } = await loadRelease(root)
  const server = createServer((request, response) => {
    for (const [header, value] of Object.entries(HEADERS)) response.setHeader(header, value)
    response.setHeader('Cache-Control', 'no-store')
    const fail = (status, message) => {
      const body = Buffer.from(`${message}\n`)
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length })
      response.end(request.method === 'HEAD' ? undefined : body)
    }
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.setHeader('Allow', 'GET, HEAD')
      return fail(405, 'Method not allowed')
    }
    // A fixed loopback bind plus Host validation also prevents DNS-rebinding access.
    const host = request.headers.host || ''
    if (!/^(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?$/.test(host)) return fail(403, 'Local host required')
    const name = requestName(request.url)
    const bytes = name && cache.get(name)
    if (!bytes) return fail(404, 'Not found')
    response.setHeader('Content-Type', MIME[path.extname(name)])
    response.setHeader('Content-Length', bytes.length)
    if (ASSET_PATTERN.test(name)) response.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    response.writeHead(200)
    response.end(request.method === 'HEAD' ? undefined : bytes)
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.keepAliveTimeout = 5000
  return { server, manifest }
}

export async function startReleaseServer({ root, port = 5176 } = {}) {
  parsePort([String(port)])
  const { server, manifest } = await createReleaseServer({ root })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  return { server, manifest, url: `http://127.0.0.1:${port}/app` }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { url } = await startReleaseServer({ port: parsePort(process.argv.slice(2)) })
    console.log(`山海集本地试用：${url}\n仅本机可访问。按 Ctrl+C 停止。请保持同一浏览器及端口，以访问原有本地记录。`)
  } catch (error) { console.error(`Cannot start local trial: ${error.message}`); process.exitCode = 1 }
}
