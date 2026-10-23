/** Shared verification/package snapshots. No browser or private-data inputs. */
import { ASSET_PATTERN, readSafeFile, safeFileNames, safeRoot, sha256, validatePublicNames } from './serve.mjs'
import { MAP_PUBLIC_SOURCES, mapPublicNames } from './map-public.mjs'

export const REQUIRED_CHECKS = Object.freeze(['kernel-freshness', 'geography-freshness', 'catalogue-data-freshness', 'catalogue-freshness', 'typecheck', 'tests', 'build', 'bundle-policy'])
export const MAX_REPORT_AGE_MS = 24 * 60 * 60 * 1000
const ROOT_FILES = Object.freeze(['index.html', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.map.json', 'vite.config.ts'])
const PUBLIC_SOURCES = MAP_PUBLIC_SOURCES
const REQUIRED_SCRIPTS = Object.freeze(['scripts/package.mjs', 'scripts/release-utils.mjs', 'scripts/serve.mjs', 'scripts/verify.mjs', 'scripts/map-public.mjs', 'scripts/map-release-plugin.mjs', 'scripts/measure-bundle.mjs', 'scripts/sync-legacy-kernels.mjs', 'scripts/build-national-geography.mjs'])
const DEVELOPMENT_ONLY = new Set(['src/dev.ts', 'src/MeetingApp.vue', 'src/styles/meeting.css', 'src/styles/meeting-polish.css', 'scripts/meeting-bridge.mjs', 'scripts/meeting-roles.mjs', 'scripts/meeting-turns.mjs', 'scripts/meeting-turns.test.mjs', 'scripts/MEETING.md', 'scripts/prepare-character-portrait.py'])
// Exact, versioned public-source inputs. Never traverse the research/QA archive.
export const CATALOGUE_REFERENCE_FILES = Object.freeze([
  'README.md',
  'first-batch/evidence.json', 'first-batch/selections.json',
  'legacy/place-candidates.json', 'legacy/wikidata-Q125445-r2529958570.json', 'legacy/wikidata-Q80290-r2519129582.json', 'legacy/wikidata-sichuan-entities.json',
  'expansion/other-candidates.json', 'expansion/other-resolved.json',
  'expansion/other-wikidata-01.json', 'expansion/other-wikidata-02.json', 'expansion/other-wikidata-03.json', 'expansion/other-wikidata-04.json', 'expansion/other-wikidata-05.json',
  'expansion/other-wikidata-a-anchor.json', 'expansion/other-wikidata-a-fixes.json', 'expansion/other-wikipedia-a-anchor-check.json', 'expansion/other-wikipedia-a-fixes.json',
  'expansion/b-wikidata-extra.json', 'expansion/b-nominatim.json', 'expansion/b-osm-asihatu-way.json', 'expansion/b-osm-gongtan.json', 'expansion/b-osm-sand-lake.json', 'expansion/b-osm-yudai.json',
].map(name => `reference/catalogue/${name}`))
const sourceAllowed = name => ROOT_FILES.includes(name) || PUBLIC_SOURCES.includes(name)
  || CATALOGUE_REFERENCE_FILES.includes(name)
  || /^src\/.+\.(?:ts|js|vue|css)$/.test(name)
  || /^src\/data\/(?:geography|places|national-places|other-province-places-[ab]|catalogue-manifest|catalogue-releases|province-boundaries|yunnan-boundary)\.json$/.test(name)
  || /^tests\/.+\.test\.ts$/.test(name)
  || /^tests\/fixtures\/cutover\/[A-Za-z0-9_-]+\.json$/.test(name)
  || /^scripts\/[A-Za-z0-9-]+\.mjs$/.test(name)
  || name === 'scripts/build-other-provinces-a.py'
  || name === 'scripts/research-other-provinces.ps1'

export async function sourceSnapshot(folder) {
  const root = await safeRoot(folder)
  const names = [...ROOT_FILES]
  for (const prefix of ['src', 'tests', 'scripts']) {
    names.push(...(await safeFileNames(root, prefix)).filter(name => !DEVELOPMENT_ONLY.has(name)))
  }
  names.push(...await mapPublicNames(root))
  names.push(...await safeFileNames(root, 'reference/catalogue', name => ['reference/catalogue/first-batch', 'reference/catalogue/legacy', 'reference/catalogue/expansion'].includes(name)))
  for (const name of [...PUBLIC_SOURCES, ...REQUIRED_SCRIPTS, ...CATALOGUE_REFERENCE_FILES]) if (!names.includes(name)) throw new Error(`Missing required source: ${name}`)
  const result = []
  for (const name of names.sort()) {
    if (!sourceAllowed(name)) throw new Error(`Unlisted verification source: ${name}`)
    const bytes = await readSafeFile(root, name)
    result.push({ path: name, sha256: sha256(bytes) })
  }
  return result
}

export async function distributionSnapshot(folder) {
  const root = await safeRoot(folder)
  const names = await safeFileNames(root, 'dist', name => ['dist/assets', 'dist/data', 'dist/licenses', 'dist/.vite'].includes(name))
  validatePublicNames(names.map(name => name.slice('dist/'.length)))
  const artifacts = []
  for (const name of names) {
    const bytes = await readSafeFile(root, name)
    artifacts.push({ path: name, bytes: bytes.length, sha256: sha256(bytes) })
  }
  await validateBuildGraph(root, names.map(name => name.slice(5)))
  return artifacts
}

/** Require the Vite entry's entire dependency closure, with no orphan assets. */
export async function validateBuildGraph(root, publicNames) {
  const graph = JSON.parse((await readSafeFile(root, 'dist/.vite/manifest.json')).toString('utf8'))
  if (!graph || typeof graph !== 'object' || Array.isArray(graph) || !graph['index.html']?.isEntry) throw new Error('Missing Vite index entry')
  const visited = new Set(), referenced = new Set()
  function asset(name) {
    if (typeof name !== 'string' || !ASSET_PATTERN.test(name) || !publicNames.includes(name)) throw new Error(`Unlisted Vite asset: ${String(name)}`)
    referenced.add(name)
  }
  function visit(key) {
    if (typeof key !== 'string' || !Object.hasOwn(graph, key)) throw new Error(`Missing Vite dependency: ${String(key)}`)
    if (visited.has(key)) return
    visited.add(key)
    const chunk = graph[key]
    if (!chunk || typeof chunk !== 'object' || Array.isArray(chunk)) throw new Error('Invalid Vite chunk')
    asset(chunk.file)
    for (const field of ['css', 'assets']) {
      if (chunk[field] !== undefined && !Array.isArray(chunk[field])) throw new Error(`Invalid Vite ${field}`)
      for (const name of chunk[field] || []) asset(name)
    }
    for (const field of ['imports', 'dynamicImports']) {
      if (chunk[field] !== undefined && !Array.isArray(chunk[field])) throw new Error(`Invalid Vite ${field}`)
      for (const dependency of chunk[field] || []) visit(dependency)
    }
  }
  visit('index.html')
  if (visited.size !== Object.keys(graph).length || publicNames.filter(name => ASSET_PATTERN.test(name)).some(name => !referenced.has(name))) throw new Error('Unreferenced or stale Vite assets')
  const html = (await readSafeFile(root, 'dist/index.html')).toString('utf8')
  const resourceNames = [...html.matchAll(/<(?:script|link)\b[^>]*\b(?:src|href)\s*=\s*["']([^"']+)["'][^>]*>/gi)].map(match => match[1])
  for (const resource of resourceNames) {
    if (resource === '/favicon.svg' && publicNames.includes('favicon.svg')) continue
    if (!resource.startsWith('/assets/') && !resource.startsWith('./assets/')) throw new Error(`Nonlocal HTML resource: ${resource}`)
    asset(resource.replace(/^\.?\//, ''))
  }
  if (!resourceNames.some(name => name.replace(/^\.?\//, '') === graph['index.html'].file)) throw new Error('HTML does not reference the Vite entry')
}

function normalizedSnapshot(snapshot, byteLengths) {
  if (!Array.isArray(snapshot)) throw new Error('Missing verification snapshot')
  const seen = new Set()
  return snapshot.map(entry => {
    if (!entry || typeof entry.path !== 'string' || seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256) || (byteLengths && (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0))) throw new Error('Invalid verification snapshot')
    seen.add(entry.path)
    return byteLengths ? { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 } : { path: entry.path, sha256: entry.sha256 }
  }).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}

export function assertSnapshotEqual(actual, expected, label, byteLengths = false) {
  if (JSON.stringify(normalizedSnapshot(actual, byteLengths)) !== JSON.stringify(normalizedSnapshot(expected, byteLengths))) throw new Error(`${label} changed or verification report is stale; run npm run verify again`)
}

export async function validateVerification(folder, { now = new Date() } = {}) {
  const root = await safeRoot(folder)
  const reportBytes = await readSafeFile(root, 'qa/current/report.json')
  const report = JSON.parse(reportBytes.toString('utf8'))
  if (report.passed !== true || !Array.isArray(report.checks)
    || report.checks.some(check => !check || typeof check.name !== 'string' || !check.name || check.passed !== true || check.exitCode !== 0)
    || new Set(report.checks.map(check => check.name)).size !== report.checks.length
    || REQUIRED_CHECKS.some(name => !report.checks.some(check => check.name === name))) throw new Error('A complete passing current verification report is required')
  if (!Array.isArray(report.changedDuringRun) || report.changedDuringRun.length) throw new Error('Verification sources changed during the run')
  const checkedAt = Date.parse(report.checkedAt)
  const age = new Date(now).getTime() - checkedAt
  if (!Number.isFinite(age) || age < -5 * 60 * 1000 || age > MAX_REPORT_AGE_MS) throw new Error('Verification report is expired or has an invalid timestamp; run npm run verify again')
  const sources = await sourceSnapshot(root)
  assertSnapshotEqual(sources, report.sources, 'Sources')
  assertSnapshotEqual(sources, report.sourcesAtStart, 'Sources at verification start')
  const artifacts = await distributionSnapshot(root)
  assertSnapshotEqual(artifacts, report.artifacts, 'Distribution artifacts', true)
  return { root, report, reportBytes, reportSha256: sha256(reportBytes), sources, artifacts }
}

export { sha256 }
