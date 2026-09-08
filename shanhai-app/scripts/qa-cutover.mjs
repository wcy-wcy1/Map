/** Explicit, loopback-only migration lab. Never copied into a public package. */
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { safeRoot, readSafeFile as safeRead, sha256 as sha } from './serve.mjs'
import { distributionSnapshot } from './release-utils.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const oldHash = 'bfa10f4a3ef5f5d8e492c7744e239e0657016e7847f124815f1e18e88510565e'
const mime = name => name.endsWith('.js') || name.endsWith('.mjs') ? 'text/javascript; charset=utf-8'
  : name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.json') || name.endsWith('.geojson') ? 'application/json; charset=utf-8'
  : name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.jpg') ? 'image/jpeg' : 'text/plain; charset=utf-8'
const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>山海集 · 同源升级实验室</title>
<style>body{font:16px/1.6 system-ui;max-width:900px;margin:32px auto;padding:0 20px}button,a{margin:8px 12px 8px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:16px}button{padding:8px}</style>
<h1>同源旧库升级实验室</h1><p>只用于此隔离来源的合成记录。不要导入私人备份。旧页面和新版在相同主机、端口下访问同一个数据库；这不是清库或新端口空库测试。</p>
<p><a href="/legacy">打开保留的旧版（schema 2）</a><a href="/app">打开本次 Vue 构建（schema 4）</a></p>
<button id="inspect" type="button">检查本隔离来源的数据</button><button id="seed" type="button">建立 schema 1 合成库（仅空来源）</button>
<p role="status" id="status">未读取或修改数据库。</p><pre id="result" aria-label="数据库检查结果"></pre>
<p>检查只输出元数据、测试手记和照片摘要，不输出照片 data URL。不能将这里的结果当作手机或真实用户验收。</p>
<script type="module" src="/qa-cutover-ui.mjs"></script></html>`

export async function createCutoverServer({ port = 5175, projectRoot = root } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port')
  const project = await safeRoot(projectRoot)
  const dist = await safeRoot(resolve(project, 'dist'))
  const legacy = await safeRead(await safeRoot(resolve(project, '../output/shanhai-yunnan')), 'index.html')
  if (sha(legacy) !== oldHash) throw new Error('Preserved legacy baseline changed; refuse ambiguous migration test')
  const names = (await distributionSnapshot(project)).map(item => item.path.slice('dist/'.length))
  const routes = new Map()
  for (const name of names) routes.set('/' + name, { bytes: await safeRead(dist, name), type: mime(name) })
  routes.set('/legacy', { bytes: legacy, type: mime('index.html') })
  routes.set('/qa', { bytes: Buffer.from(page), type: mime('index.html') })
  routes.set('/qa-cutover-ui.mjs', { bytes: await safeRead(project, 'scripts/qa-cutover-ui.mjs'), type: mime('qa.mjs') })
  routes.set('/fixture.jpg', { bytes: await safeRead(await safeRoot(resolve(project, '../output/shanhai-yunnan/fixtures/memory-qa')), 'valid.jpg'), type: mime('image.jpg') })
  routes.set('/app', routes.get('/index.html'))
  routes.set('/', routes.get('/qa'))
  const server = createServer((request, response) => {
    const host = request.headers.host
    const actualPort = server.address().port
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('Referrer-Policy', 'no-referrer')
    if (!['127.0.0.1:' + actualPort, 'localhost:' + actualPort].includes(host)) { response.writeHead(421); response.end(); return }
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return }
    // Do not URL-normalise away traversal or encoded delimiters.
    const pathname = (request.url ?? '').split('?')[0]
    if (!pathname.startsWith('/') || /%|\\|\.\./.test(pathname)) { response.writeHead(404); response.end(); return }
    const route = routes.get(pathname)
    if (!route) { response.writeHead(404); response.end(); return }
    response.writeHead(200, { 'Content-Type': route.type, 'Content-Length': route.bytes.length })
    response.end(request.method === 'HEAD' ? undefined : route.bytes)
  })
  await new Promise((yes, no) => { server.once('error', no); server.listen(port, '127.0.0.1', yes) })
  return { server, address: `http://127.0.0.1:${server.address().port}`,
    evidence: { legacySha256: oldHash, files: [...routes].filter(([name]) => !['/', '/app'].includes(name)).map(([path, item]) => ({ path, sha256: sha(item.bytes), bytes: item.bytes.length })) } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args[0] && !/^\d{1,5}$/.test(args[0]))) throw new Error('Usage: node scripts/qa-cutover.mjs [port]')
  const port = args[0] ? Number(args[0]) : 5175
  if (![5175, 5177].includes(port)) throw new Error('Migration lab is restricted to test ports 5175 and 5177')
  const lab = await createCutoverServer({ port })
  console.log(JSON.stringify({ url: lab.address + '/qa', ...lab.evidence }, null, 2))
}
