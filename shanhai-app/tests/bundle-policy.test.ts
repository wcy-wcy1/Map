// @vitest-environment node
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { productionChunkName } from '../vite.config'
// @ts-expect-error Standalone server constants have no declaration file.
import { LANDMARK_PROVINCES } from '../scripts/serve.mjs'

const measurementScript = fileURLToPath(new URL('../scripts/measure-bundle.mjs', import.meta.url))
const fixtures: string[] = []
afterEach(() => { for (const directory of fixtures.splice(0)) rmSync(directory, { recursive: true, force: true }) })

function bundleFixture(options: { omitGeography?: boolean, dataImportsEntry?: boolean, staticGeography?: boolean, orphan?: boolean, eagerArtwork?: boolean, missingArtwork?: boolean, meeting?: boolean } = {}) {
  const directory = mkdtempSync(resolve(tmpdir(), 'shanhai-bundle-policy-'))
  fixtures.push(directory)
  mkdirSync(resolve(directory, '.vite'))
  mkdirSync(resolve(directory, 'assets'))
  mkdirSync(resolve(directory, 'data'))
  const content = 'export const value = 1;\n'
  const manifest: Record<string, object> = {
    'index.html': { file: 'assets/index-12345678.js', name: 'index', isEntry: true, imports: ['_vendor', '_places', '_regions', ...(options.staticGeography ? ['_geography'] : []), ...(options.eagerArtwork ? ['_landmark-beijing'] : [])], dynamicImports: [...LANDMARK_PROVINCES.filter((province: string) => !options.missingArtwork || province !== 'beijing').map((province: string) => '_landmark-' + province), ...(options.meeting ? ['_meeting'] : [])], css: ['assets/index-12345678.css'] },
    _vendor: { file: 'assets/vendor-12345678.js', name: 'vendor', imports: ['_places'] },
    _places: { file: 'assets/places-12345678.js', name: 'places', imports: options.dataImportsEntry ? ['index.html'] : [] },
    _regions: { file: 'assets/regions-12345678.js', name: 'regions' },
    ...(options.staticGeography || options.orphan ? { _geography: { file: 'assets/geography-12345678.js', name: 'geography' } } : {}),
    ...Object.fromEntries(LANDMARK_PROVINCES.filter((province: string) => !options.missingArtwork || province !== 'beijing').map((province: string) => ['_landmark-' + province, { file:`assets/landmark-${province}-12345678.js`, name:'landmark-' + province }])),
    ...(options.meeting ? { _meeting: { file:'assets/MeetingApp-12345678.js', name:'MeetingApp' } } : {}),
  }
  for (const chunk of Object.values(manifest) as { file: string }[]) writeFileSync(resolve(directory, chunk.file), content)
  writeFileSync(resolve(directory, 'assets/index-12345678.css'), 'body{}')
  writeFileSync(resolve(directory, '.vite/manifest.json'), JSON.stringify(manifest))
  if (!options.omitGeography) writeFileSync(resolve(directory, 'data/yunnan-geography.geojson'), '{"type":"FeatureCollection","features":[]}')
  return { directory, content }
}

describe('production asset cache boundaries', () => {
  it('routes only public source JSON and third-party JavaScript into stable groups on both OS path styles', () => {
    expect(productionChunkName('/project/src/data/geography.json')).toBe('geography')
    expect(productionChunkName('/project/src/data/province-boundaries.json')).toBe('regions')
    expect(productionChunkName('C:\\project\\src\\data\\yunnan-boundary.json')).toBe('regions')
    expect(productionChunkName('C:\\project\\src\\data\\places.json?commonjs-proxy')).toBe('places')
    expect(productionChunkName('/project/src/data/national-places.json')).toBe('places')
    expect(productionChunkName('/project/src/map/landmarks/beijing.ts')).toBe('landmark-beijing')
    expect(productionChunkName('C:\\project\\src\\map\\landmarks\\shapes.ts')).toBe('landmark-shapes')
    expect(productionChunkName('/project/src/map/landmarks/unreviewed.ts')).toBeNull()
    expect(productionChunkName('/project/node_modules/vue/dist/vue.runtime.esm-bundler.js')).toBe('vendor')
    expect(productionChunkName('C:\\project\\node_modules\\leaflet\\dist\\leaflet-src.js')).toBe('vendor')
    expect(productionChunkName('/project/node_modules/example/src/data/geography.json')).toBe('vendor')
    for (const moduleId of ['/project/src/domain/catalogue.ts', '/project/src/data/private.json', '/project/src/App.vue', '/project/src/data/geography.json.bak', '/project/node_modules/leaflet/dist/leaflet.css']) {
      expect(productionChunkName(moduleId)).toBeNull()
    }
  })

  it('counts every static dependency exactly once and reports first-load gzip separately from the entry', () => {
    const { directory, content } = bundleFixture()
    const report = JSON.parse(execFileSync(process.execPath, [measurementScript, directory], { encoding: 'utf8' }))
    expect(report.policy.passed).toBe(true)
    expect(report.staticDependencies).toHaveLength(3)
    expect(report.entry.bytes).toBe(Buffer.byteLength(content))
    expect(report.initialJavaScript).toEqual({ files: 4, bytes: 4 * Buffer.byteLength(content), gzipBytes: 4 * gzipSync(content).byteLength })
    expect(report.initialCss.bytes).toBe(6)
    expect(report.deferredJavaScript).toHaveLength(33)
    expect(report.deferredGeography.file).toBe('data/yunnan-geography.geojson')
  })

  it.each([{ omitGeography: true }, { dataImportsEntry: true }, { staticGeography: true }, { orphan: true }, { eagerArtwork: true }, { missingArtwork: true }, { meeting: true }])('fails the measurement guard when cache separation regresses: %j', options => {
    const { directory } = bundleFixture(options)
    const result = spawnSync(process.execPath, [measurementScript, directory], { encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(JSON.parse(result.stdout).policy.passed).toBe(false)
  })
})
