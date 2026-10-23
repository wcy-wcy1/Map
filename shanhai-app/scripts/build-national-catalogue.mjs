// Offline, reproducible build from the reviewed evidence snapshots; no geocoding at runtime.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { buildOtherCatalogueA } from './build-other-catalogue-a.mjs'
import { buildOtherCatalogueB } from './build-other-catalogue-b.mjs'
const root = new URL('../', import.meta.url)
const read = async path => JSON.parse((await readFile(new URL(path, root), 'utf8')).replace(/^\uFEFF/, ''))
const evidencePath = 'reference/catalogue/first-batch/evidence.json'
const evidence = await read(evidencePath)
const evidenceSha256 = createHash('sha256').update(await readFile(new URL(evidencePath, root))).digest('hex')
const proposals = await read('reference/catalogue/first-batch/selections.json')
const provinces = (await read('src/data/province-boundaries.json')).features
const legacy = (await read('reference/catalogue/legacy/place-candidates.json')).places
const firstBatch = proposals.map(row => {
  const [id, name, provinceId, city, iconKey, discoveryTier, sourceKey, description, anchor] = row
  const province = provinces.find(p => p.properties.provinceId === provinceId).properties
  const old = legacy.find(p => p.id === id)
  const item = evidence.sources[sourceKey]
  if (!item && !old) throw new Error(`Missing reviewed coordinate: ${id}`)
  return { id, name, aliases: item?.aliases ?? old?.aliases ?? [], mapId: provinceId, regionId: provinceId, regionName: province.name, city, category: iconKey, iconKey,
    coordinates: item?.coordinates ?? old.coordinates, coordinateSystem: 'WGS84', coordinateSource: item ? { ...item.coordinateSource, evidenceFile: evidencePath, evidenceSha256, evidenceKey: sourceKey } : old.coordinateSource,
    anchorNote: `${anchor}；仅作回忆地图代表点，不是导航入口，不代表到访。`, source: item?.identityUrl ?? old.source,
    text: description, highlights: description.replace(/[。！]$/, '').split('，').slice(0, 2), priority: discoveryTier === 'classic' ? 1 : 2, discoveryTier }
})
const a = await buildOtherCatalogueA(), b = await buildOtherCatalogueB()
for (const [path, rows] of [['src/data/other-province-places-a.json', a], ['src/data/other-province-places-b.json', b]]) {
  const text = JSON.stringify(rows, null, 2) + '\n'
  if (process.argv.includes('--check')) { if (await readFile(new URL(path, root), 'utf8') !== text) throw new Error(`Stale province catalogue: ${path}`) }
  else await writeFile(new URL(path, root), text)
}
const rows = [...firstBatch, ...a, ...b]
if (new Set(rows.map(p => p.id)).size !== rows.length) throw new Error('Duplicate national identity')
const text = JSON.stringify(rows, null, 2) + '\n'
for (const path of ['src/data/national-places.json', 'public/data/national-places.json']) {
  if (process.argv.includes('--check')) { if (await readFile(new URL(path, root), 'utf8') !== text) throw new Error(`Stale national catalogue: ${path}`) }
  else await writeFile(new URL(path, root), text)
}
console.log(`Built ${rows.length} reviewed national places`)
