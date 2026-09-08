import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// Synchronous boundaries support validation; the detailed Yunnan geography is
// fetched as same-origin JSON only on entering Yunnan. Keep cache families separate.
export function productionChunkName(moduleId: string): 'geography' | 'regions' | 'places' | 'vendor' | null {
  const path = moduleId.replaceAll('\\', '/').split('?')[0]!
  if (path.includes('/node_modules/')) return /\.(?:css|less|sass|scss|styl)$/.test(path) ? null : 'vendor'
  if (path.endsWith('/src/data/geography.json')) return 'geography'
  if (/\/src\/data\/(?:province-boundaries|yunnan-boundary)\.json$/.test(path)) return 'regions'
  if (path.endsWith('/src/data/places.json')) return 'places'
  return null
}

export default defineConfig({
  plugins: [vue()],
  build: {
    manifest: true,
    rolldownOptions: {
      output: {
        codeSplitting: { groups: [{ name: productionChunkName }] },
      },
    },
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 5174, strictPort: true },
  // These suites include real loopback HTTP and filesystem verification. Bound
  // workers on desktop hosts so parallel DOM environments cannot starve the
  // HTTP fixtures; keep the per-test timeout and all assertions unchanged.
  test: { environment: 'jsdom', include: ['tests/**/*.test.ts'], restoreMocks: true, maxWorkers: 4 },
})
