import { spawnSync } from 'node:child_process'
import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sourceSnapshot, distributionSnapshot } from './release-utils.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const evidence = resolve(root, 'qa/current')
await mkdir(evidence, { recursive: true })
const reportPath = resolve(evidence, 'report.json')
// A failed or interrupted run must not leave a previous passing report usable.
await writeFile(reportPath, JSON.stringify({ checkedAt: new Date().toISOString(), passed: false, state: 'running' }, null, 2) + '\n')
const tasks = [
  ['kernel-freshness', 'scripts/sync-legacy-kernels.mjs', '--check'],
  ['geography-freshness', 'scripts/build-national-geography.mjs', '--check'],
  ['typecheck', 'node_modules/vue-tsc/bin/vue-tsc.js', '--noEmit'],
  ['tests', 'node_modules/vitest/vitest.mjs', 'run'],
  ['build', 'node_modules/vite/bin/vite.js', 'build'],
]
const checks = []
let sourcesAtStart = [], sources = [], artifacts = [], changedDuringRun = []
let failure
try {
sourcesAtStart = await sourceSnapshot(root)
for (const [name, script, ...args] of tasks) {
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  await writeFile(resolve(evidence, `${name}.log`), result.stdout + result.stderr)
  checks.push({ name, passed: result.status === 0, exitCode: result.status, error: result.error?.message })
  console.log(`${result.status === 0 ? 'PASS' : 'FAIL'} ${name}`)
  if (result.status !== 0) break
}
if (checks.length === tasks.length && checks.every(check => check.passed)) {
  artifacts = await distributionSnapshot(root)
}
sources = await sourceSnapshot(root)
const before = new Map(sourcesAtStart.map(source => [source.path, source.sha256]))
const after = new Map(sources.map(source => [source.path, source.sha256]))
changedDuringRun = [...new Set([...before.keys(), ...after.keys()])].filter(path => before.get(path) !== after.get(path))
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
  console.error(failure)
}
const passed = !failure && checks.length === tasks.length && checks.every(check => check.passed) && changedDuringRun.length === 0
await writeFile(reportPath, JSON.stringify({ checkedAt: new Date().toISOString(), node: process.version, passed, checks, artifacts, sources, sourcesAtStart, changedDuringRun, failure,
  scope: 'Vue catalogue/map/retrieval, storage and backup kernels, editor/photo/backup/card components, old-store compatibility, build chunk policy and local distribution tooling. Sources include all scripts and public resources; distribution dependency closure and allowlist are checked. Unit platform adapters are controlled. Native same-origin migration/browser evidence is recorded separately; phone/user testing and real share delivery are not certified by this report.' }, null, 2) + '\n')
if (!passed) process.exitCode = 1
