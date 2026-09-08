import { readFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export async function measureBundle(directory = resolve(projectRoot, 'dist')) {
  const root = resolve(directory)
  const manifest = JSON.parse(await readFile(resolve(root, '.vite/manifest.json'), 'utf8'))
  const entry = manifest['index.html']
  if (!entry?.isEntry || !entry.file?.endsWith('.js')) throw new Error('Missing index.html JavaScript entry in Vite manifest.')

  function staticClosure(key, seen = new Set()) {
    if (seen.has(key)) return seen
    const chunk = manifest[key]
    if (!chunk) throw new Error(`Missing static dependency in Vite manifest: ${key}`)
    seen.add(key)
    for (const dependency of chunk.imports ?? []) staticClosure(dependency, seen)
    return seen
  }

  const initialKeys = staticClosure('index.html')
  function completeClosure(key, seen = new Set()) {
    if (seen.has(key)) return seen
    const chunk = manifest[key]
    if (!chunk) throw new Error(`Missing build dependency: ${key}`)
    seen.add(key)
    for (const dependency of [...chunk.imports ?? [], ...chunk.dynamicImports ?? []]) completeClosure(dependency, seen)
    return seen
  }
  const reachable = completeClosure('index.html')
  const issues = []
  if (reachable.size !== Object.keys(manifest).length) issues.push('Every build chunk must be reachable; orphan assets are forbidden.')
  if (Object.values(manifest).some(chunk => chunk.name === 'geography')) issues.push('Detailed geography belongs in the on-demand JSON resource, not in the JavaScript graph.')
  for (const name of ['regions', 'places', 'vendor']) {
    const matches = Object.entries(manifest).filter(([, chunk]) => chunk.name === name)
    if (matches.length !== 1) {
      issues.push(`Expected exactly one independently cached ${name} chunk.`)
      continue
    }
    const [key, chunk] = matches[0]
    if (!new RegExp(`^assets/${name}-[A-Za-z0-9_-]{8}\\.js$`).test(chunk.file)) issues.push(`Expected a content-hashed ${name} filename.`)
    if (chunk.file === entry.file || chunk.isEntry) issues.push(`${name} must be separate from the application entry.`)
    if (!initialKeys.has(key)) issues.push(`${name} must remain a static dependency for synchronous catalogue startup.`)
    if (staticClosure(key).has('index.html')) issues.push(`${name} must not import the application entry.`)
  }

  const measured = new Map()
  async function asset(file) {
    if (measured.has(file)) return measured.get(file)
    const path = resolve(root, file)
    if (!path.startsWith(root + sep)) throw new Error(`Asset must stay inside the build directory: ${file}`)
    const content = await readFile(path)
    const result = { file, bytes: content.byteLength, gzipBytes: gzipSync(content, { level: 6 }).byteLength }
    measured.set(file, result)
    return result
  }
  const entryAsset = await asset(entry.file)
  const initialJsFiles = [...new Set([...initialKeys].map(key => manifest[key].file).filter(file => file.endsWith('.js')))]
  const initialCssFiles = [...new Set([...initialKeys].flatMap(key => manifest[key].css ?? []))]
  const allJsFiles = [...new Set(Object.values(manifest).map(chunk => chunk.file).filter(file => file.endsWith('.js')))]
  const initialJavaScript = await Promise.all(initialJsFiles.map(asset))
  const stylesheets = await Promise.all(initialCssFiles.map(asset))
  const allJavaScript = await Promise.all(allJsFiles.map(asset))
  let deferredGeography
  try { deferredGeography = await asset('data/yunnan-geography.geojson') }
  catch { issues.push('The on-demand Yunnan JSON resource is missing or unreadable.') }
  const total = assets => assets.reduce((sum, item) => ({ files: sum.files + 1, bytes: sum.bytes + item.bytes, gzipBytes: sum.gzipBytes + item.gzipBytes }), { files: 0, bytes: 0, gzipBytes: 0 })
  return {
    schemaVersion: 1,
    compression: { algorithm: 'gzip', implementation: 'node:zlib', level: 6, independentFiles: true },
    scope: 'Independent gzip measurements of generated JS/CSS files. Boundaries, places and vendor are first-load dependencies. Detailed Yunnan geography is a separate same-origin JSON request measured in deferredGeography; browser evidence must confirm request timing. HTML, other public assets, HTTP overhead and actual browser timings are outside the JavaScript totals.',
    policy: { passed: issues.length === 0, issues },
    entry: entryAsset,
    staticDependencies: initialJavaScript.filter(item => item.file !== entry.file),
    deferredJavaScript: allJavaScript.filter(item => !initialJsFiles.includes(item.file)),
    deferredGeography,
    initialJavaScript: total(initialJavaScript),
    stylesheets,
    initialCss: total(stylesheets),
    allJavaScript: total(allJavaScript),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const report = await measureBundle(process.argv[2] ?? resolve(projectRoot, 'dist'))
    process.stdout.write(JSON.stringify(report, null, 2) + '\n')
    if (!report.policy.passed) process.exitCode = 1
  } catch (error) {
    process.stderr.write(`Bundle measurement failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
