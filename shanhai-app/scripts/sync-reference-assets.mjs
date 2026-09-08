import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const legacy = resolve(root, '../output/shanhai-yunnan')
// Fixed source-data allowlist. Never copy the legacy page, private uploads,
// local backups, QA fixtures or the complete output directory into this app.
const assets = [
  ['places.json', 'src/data/places.json'],
  ['geography/data.json', 'src/data/geography.json'],
  // public/data/SOURCES.md is now maintained by this app: it also documents
  // the separately licensed national layer and must not revert to Yunnan only.
  ['geography/data.json', 'public/data/yunnan-geography.geojson'],
  ['vendor/LICENSE-Leaflet.txt', 'public/licenses/Leaflet.txt'],
  ['app.css', 'src/styles/journal.css'],
]
const receipts = []
for (const [source, target] of assets) {
  const bytes = await readFile(resolve(legacy, source))
  const destination = resolve(root, target)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, bytes)
  receipts.push({ source: `output/shanhai-yunnan/${source}`, target, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') })
}
await mkdir(resolve(root, 'reference'), { recursive: true })
await writeFile(resolve(root, 'reference/asset-manifest.json'), JSON.stringify({ assets: receipts }, null, 2) + '\n')
console.log(JSON.stringify({ copied: receipts.length, bytes: receipts.reduce((n, item) => n + item.bytes, 0) }))
