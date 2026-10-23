import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createCatalogue, publicPlaces, provinceForRegion, regions } from '../src/domain/catalogue'
import { filter } from '../src/domain/map-layout'
import additions from '../src/data/national-places.json'
import manifest from '../src/data/catalogue-manifest.json'
import evidence from '../reference/catalogue/first-batch/evidence.json'

describe('reviewed multi-province catalogue', () => {
  it('keeps each region index and search alias tied to its actual province', () => {
    expect(additions).toHaveLength(132)
    expect(new Set(additions.map(p => p.mapId)).size).toBe(33)
    for (const provinceId of new Set(additions.map(p => p.mapId))) {
      const places = filter(publicPlaces, { provinceId })
      expect(places).toHaveLength(4)
      expect(places.filter(p => p.discoveryTier === 'classic')).toHaveLength(2)
      expect(places.filter(p => p.discoveryTier === 'local')).toHaveLength(2)
      expect(regions.find(r => r.id === provinceId)?.placeIds.sort()).toEqual(places.map(p => p.id).sort())
      expect(provinceForRegion(provinceId)?.id).toBe(provinceId)
      expect(places.every(p => !p.aliases.includes('云南'))).toBe(true)
    }
    expect(filter(publicPlaces, { query: '四川' }).every(p => p.mapId === 'cn-51')).toBe(true)
    expect(filter(publicPlaces, { query: '云南' })).toHaveLength(43)
  })
  it('composes editorial filters with visits and excludes personal places', () => {
    const catalogue = createCatalogue()
    catalogue.replaceCustomPlaces([{ placeId: 'custom-beijing', customPlace: { id: 'custom-beijing', name: '我的庭院', regionId: 'cn-11', coordinates: [116.4, 39.9] } }])
    expect(filter(catalogue.all, { provinceId: 'cn-11' })).toHaveLength(5)
    expect(filter(catalogue.all, { provinceId: 'cn-11', discoveryTier: 'local' })).toHaveLength(2)
    expect(filter(catalogue.all, { provinceId: 'cn-11', discoveryTier: 'classic', visitedOnly: true, visitedIds: ['beijing-forbidden-city'] }).map(p => p.id)).toEqual(['beijing-forbidden-city'])
  })
  it('reproduces coordinates from frozen evidence and verifies every controlled file', () => {
    for (const p of additions) {
      expect(p.coordinateSource.evidenceFile.startsWith('reference/catalogue/')).toBe(true)
      const bytes = readFileSync(new URL('../' + p.coordinateSource.evidenceFile, import.meta.url))
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(p.coordinateSource.evidenceSha256)
      if (p.coordinateSource.evidenceFile === 'reference/catalogue/first-batch/evidence.json' && 'evidenceKey' in p.coordinateSource) {
        const item = (evidence.sources as Record<string, { coordinates: number[] }>)[p.coordinateSource.evidenceKey!]
        expect(p.coordinates).toEqual(item?.coordinates)
      }
      if (p.coordinateSource.type === 'wikidata-coordinate' && p.coordinateSource.evidenceFile !== 'reference/catalogue/first-batch/evidence.json') {
        const file = JSON.parse(readFileSync(new URL('../' + p.coordinateSource.evidenceFile, import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
        const claim = file.entities[p.coordinateSource.entityId!].claims.P625.find((c: { id: string }) => c.id === p.coordinateSource.statementId)
        expect(p.coordinates).toEqual([claim.mainsnak.datavalue.value.longitude, claim.mainsnak.datavalue.value.latitude])
      }
      if ('displayPointEvidenceFile' in p.coordinateSource) {
        const bytes = readFileSync(new URL('../' + p.coordinateSource.displayPointEvidenceFile, import.meta.url))
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(p.coordinateSource.displayPointEvidenceSha256)
        const [response] = JSON.parse(bytes.toString())
        const point = response.results.find((r: { osm_id: number }) => r.osm_id === 16906759)
        expect(p.coordinates).toEqual([Number(point.lon), Number(point.lat)])
      }
    }
    for (const [name, expected] of Object.entries(manifest.pins)) {
      const data = JSON.parse(readFileSync(new URL('../src/data/' + name, import.meta.url), 'utf8'))
      expect(createHash('sha256').update(JSON.stringify(data)).digest('hex')).toBe(expected)
    }
  })
})
