import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
// @ts-expect-error Standalone release tooling is exercised by its Node tests.
import { mapReleasePlugin } from './scripts/map-release-plugin.mjs'
// @ts-expect-error The server also owns the explicit, standalone asset allowlist.
import { LANDMARK_PROVINCES } from './scripts/serve.mjs'

// Synchronous boundaries support validation; the detailed Yunnan geography is
// fetched as same-origin JSON only on entering Yunnan. Keep cache families separate.
export function productionChunkName(moduleId: string): string | null {
  const path = moduleId.replaceAll('\\', '/').split('?')[0]!
  if (path.includes('/node_modules/')) return /\.(?:css|less|sass|scss|styl)$/.test(path) ? null : 'vendor'
  if (path.endsWith('/src/data/geography.json')) return 'geography'
  if (/\/src\/data\/(?:province-boundaries|yunnan-boundary)\.json$/.test(path)) return 'regions'
  if (/\/src\/data\/(?:places|national-places)\.json$/.test(path)) return 'places'
  const pack = path.match(/\/src\/map\/landmarks\/([a-z-]+)\.ts$/)?.[1]
  if (pack && (LANDMARK_PROVINCES.includes(pack) || pack === 'shapes')) return `landmark-${pack}`
  return null
}

export default defineConfig(({ command }) => ({
  plugins: [vue(), mapReleasePlugin()],
  publicDir: command === 'serve' ? 'public' : false,
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        // Do not pull shared initial-render helpers into the first province pack.
        codeSplitting: { groups: [{ name: productionChunkName, includeDependenciesRecursively: false }] },
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5174, strictPort: true },
  // These suites include real loopback HTTP and filesystem verification. Bound
  // workers on desktop hosts so parallel DOM environments cannot starve the
  // HTTP fixtures; keep the per-test timeout and all assertions unchanged.
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], restoreMocks: true, maxWorkers: 4 },
}))
