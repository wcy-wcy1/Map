import { describe, expect, it } from 'vitest'
import { createCatalogue, normalizeCustomPlace, publicPlaces, regions, yunnanRegions, withinProvince } from '../src/domain/catalogue'
import geographyData from '../src/data/geography.json'
import type { Geography, Visit } from '../src/domain/models'
const geography = geographyData as unknown as Geography

const visit = (id: string, name = '雪山下的庭院'): Visit => ({ id, createdAt: 100, placeId: 'custom-courtyard', date: '2025-01-01', note: '试验用手记', photos: [], coverId: null, customPlace: { id: 'custom-courtyard', name, regionId: 'lijiang', coordinates: [100.233, 26.872] } })

describe('source catalogue and local places', () => {
  it('preserves all 43 source places, their distinct ids and 16 regions', () => {
    expect(publicPlaces).toHaveLength(43)
    expect(new Set(publicPlaces.map(p => p.id)).size).toBe(43)
    expect(yunnanRegions).toHaveLength(16)
    expect(regions).toHaveLength(49)
    expect(regions.flatMap(r => r.placeIds).sort()).toEqual(publicPlaces.map(p => p.id).sort())
    for (const place of publicPlaces) {
      expect(place.coordinateSystem).toBe('WGS84')
      expect(place.source).toMatch(/^https:\/\//)
      expect(place.coordinateSource.url).toMatch(/^https:\/\//)
    }
    expect(publicPlaces.find(p => p.id === 'yulong')?.iconKey).toBe('snow-mountain')
  })
  it('retains the complete source geometry kinds', () => {
    const counts = Object.fromEntries(['province', 'region', 'water', 'river'].map(kind => [kind, geography.features.filter(f => f.properties.kind === kind).length]))
    expect(counts).toEqual({ province: 1, region: 16, water: 5, river: 3 })
  })
  it('accepts known in-province points, rejects bounding-box-only and nonfinite points', () => {
    expect(withinProvince([100.233, 26.872])).toBe(true)
    expect(withinProvince([116.4, 39.9])).toBe(false)
    expect(withinProvince([97.46, 21.06])).toBe(false)
    expect(() => normalizeCustomPlace({ ...visit('one').customPlace, coordinates: [NaN, 26.8] })).toThrow()
    expect(() => normalizeCustomPlace({ ...visit('one').customPlace, regionId: 'beijing' })).toThrow()
    expect(() => normalizeCustomPlace({ ...visit('one').customPlace, name: ' ' })).toThrow()
  })
  it('derives and removes custom places from saved visits, without changing source rows', () => {
    const catalogue = createCatalogue(), source = JSON.stringify(publicPlaces)
    catalogue.replaceCustomPlaces([visit('one'), visit('two')])
    expect(catalogue.all).toHaveLength(44)
    expect(catalogue.get('custom-courtyard')?.isCustom).toBe(true)
    catalogue.replaceCustomPlaces([])
    expect(catalogue.has('custom-courtyard')).toBe(false)
    expect(JSON.stringify(publicPlaces)).toBe(source)
  })
  it('rejects conflicting custom metadata without partially publishing', () => {
    const catalogue = createCatalogue()
    catalogue.replaceCustomPlaces([visit('one')])
    const before = JSON.stringify(catalogue.all)
    expect(() => catalogue.replaceCustomPlaces([visit('one'), visit('two', '不同名称')])).toThrow()
    expect(JSON.stringify(catalogue.all)).toBe(before)
    const mismatched = { ...visit('three'), placeId: 'custom-other' }
    expect(() => catalogue.replaceCustomPlaces([mismatched])).toThrow()
    expect(JSON.stringify(catalogue.all)).toBe(before)
  })
})
