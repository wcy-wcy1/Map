// @vitest-environment node
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import type { Geometry, Polygon } from 'geojson'
import oldGeography from '../src/data/geography.json'
import oldPlaces from '../src/data/places.json'
import provinceData from '../src/data/province-boundaries.json'
import { getProvince, nationalGeography, provinces, withinGeometry, withinProvince, yunnanBoundary } from '../src/domain/provinces'
import type { Coordinates, Geography } from '../src/domain/models'

const evidence = new URL('../qa/national-map-20260907/data/', import.meta.url)
const sourceBytes = readFileSync(new URL('geoBoundaries-CHN-ADM1.geojson', evidence))
const source = JSON.parse(sourceBytes.toString('utf8')) as Geography

describe('national province catalogue and source integrity', () => {
  it('has exactly 34 unique stable province ids and six-digit codes', () => {
    expect(provinces).toHaveLength(34)
    expect(new Set(provinces.map(province => province.id)).size).toBe(34)
    expect(new Set(provinces.map(province => province.code)).size).toBe(34)
    expect(nationalGeography.features).toHaveLength(34)
    for (const province of provinces) {
      expect(province.code).toMatch(/^\d{2}0000$/)
      expect(province.id).toBe(province.code === '530000' ? 'yunnan' : `cn-${province.code.slice(0, 2)}`)
      expect(getProvince(province.id)).toEqual(province)
      const feature = nationalGeography.features.find(feature => feature.properties.provinceId === province.id)!
      expect(feature.properties.kind).toBe('province')
      expect(feature.id).toBe(province.id)
      expect(feature.properties.name).toBe(province.name)
      expect(feature.properties.sourceUrl).toContain('9469f09592ced973a3448cf66b6100b741b64c0d')
    }
    expect(getProvince('unknown')).toBeUndefined()
    expect(provinces.filter(province => ['cn-71', 'cn-81', 'cn-82'].includes(province.id))).toHaveLength(3)
  })

  it('retains every fixed-source geometry with honest attribution and source-name corrections', () => {
    expect(sourceBytes.byteLength).toBe(270578)
    expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe('3a00467a0db9b4136facb5f2f3d0edbfd96adb15651cfdf63991da9281030e85')
    for (const feature of nationalGeography.features) {
      const original = source.features.find(original => original.properties.shapeID === feature.properties.sourceShapeId)!
      expect(original, feature.properties.name).toBeDefined()
      expect(feature.geometry).toEqual(original.geometry)
      expect(feature.properties.sourceName).toBe(original.properties.shapeName)
    }
    expect(provinceData.attribution.license).toBe('Public Domain')
    expect(provinceData.attribution.yearRepresented).toBe('2019')
    expect(provinceData.attribution.limitations).toContain('并非官方标准地图')
    expect(provinceData.attribution.upstreamLicenseCaveat).toContain('缺少具体文件名')
    const guangdong = nationalGeography.features.find(feature => feature.properties.provinceId === 'cn-44')!
    expect(guangdong.properties).toMatchObject({ name: '广东省', divisionCode: '440000', sourceName: 'Guangzhou Province' })
  })

  it('preserves the complete legacy Yunnan feature and every existing seed acceptance', () => {
    const original = oldGeography.features.filter(feature => feature.properties.kind === 'province')
    expect(yunnanBoundary.features).toEqual(original)
    const geometry = yunnanBoundary.features[0]!.geometry as Polygon
    expect(geometry.coordinates[0]).toHaveLength(8335)
    // Baseline established independently with the pre-migration catalogue code
    // in qa/national-map-20260907/data/check-legacy-containment.mjs.
    expect(oldPlaces.filter(place => !withinProvince(place.coordinates as Coordinates)).map(place => place.id)).toEqual(['lugu-lake'])
    expect(withinProvince(geometry.coordinates[0]![0]! as Coordinates)).toBe(true)
    expect(withinProvince([100.233, 26.872])).toBe(true)
    expect(withinProvince([97.46, 21.06])).toBe(false)
    expect(withinProvince([116.4, 39.9])).toBe(false)
  })
})

describe('province containment', () => {
  const cityChecks: [string, Coordinates, string][] = [
    ['北京', [116.4074, 39.9042], 'cn-11'],
    ['成都', [104.0665, 30.5723], 'cn-51'],
    ['杭州', [120.1551, 30.2741], 'cn-33'],
    ['广州', [113.2644, 23.1291], 'cn-44'],
    ['香港九龙', [114.1694, 22.3193], 'cn-81'],
    ['澳门半岛', [113.5439, 22.1987], 'cn-82'],
    ['台北', [121.5654, 25.033], 'cn-71'],
  ]
  it.each(cityChecks)('accepts the fixed city check %s without relocating its coordinate', (_name, point, id) => {
    expect(withinProvince(point, id)).toBe(true)
    expect(withinProvince(point, 'yunnan')).toBe(false)
  })

  it('records the Macau source as four distinct vertices, not precise coverage', () => {
    const feature = nationalGeography.features.find(feature => feature.properties.provinceId === 'cn-82')!
    const ring = (feature.geometry as Polygon).coordinates[0]!
    expect(ring).toHaveLength(5)
    expect(new Set(ring.map(point => JSON.stringify(point))).size).toBe(4)
    expect(provinceData.attribution.limitations).toContain('点位可能被误判')
  })

  it('rejects wrong-province, unknown, bounding-box-only, non-finite and out-of-world points', () => {
    expect(withinProvince([116.4074, 39.9042], 'cn-51')).toBe(false)
    expect(withinProvince([104.0665, 30.5723], 'cn-11')).toBe(false)
    expect(withinProvince([116.4074, 39.9042], 'unknown')).toBe(false)
    expect(withinProvince([0, 0], 'cn-11')).toBe(false)
    for (const point of [[NaN, 25], [102, Infinity], [Infinity, 25], [-Infinity, 25], [181, 25], [102, 91], [102, -91]] as Coordinates[]) {
      expect(withinProvince(point)).toBe(false)
      expect(withinProvince(point, 'cn-11')).toBe(false)
    }
  })

  const holed: Polygon = {
    type: 'Polygon',
    coordinates: [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[3, 3], [3, 7], [7, 7], [7, 3], [3, 3]],
    ],
  }
  it('includes exterior edges/vertices and excludes holes including their edges/vertices', () => {
    for (const point of [[1, 1], [0, 5], [10, 10], [0, 0]] as Coordinates[]) expect(withinGeometry(point, holed)).toBe(true)
    for (const point of [[5, 5], [3, 5], [3, 3], [-1, 5], [11, 1]] as Coordinates[]) expect(withinGeometry(point, holed)).toBe(false)
    const reversed = { ...holed, coordinates: holed.coordinates.map(ring => [...ring].reverse()) }
    expect(withinGeometry([1, 1], reversed)).toBe(true)
    expect(withinGeometry([5, 5], reversed)).toBe(false)
  })

  it('handles multiple islands without accepting the empty space between them', () => {
    const geometry: Geometry = { type: 'MultiPolygon', coordinates: [holed.coordinates, [[[20, 0], [25, 0], [25, 5], [20, 5], [20, 0]]]] }
    expect(withinGeometry([22, 2], geometry)).toBe(true)
    expect(withinGeometry([1, 1], geometry)).toBe(true)
    expect(withinGeometry([15, 2], geometry)).toBe(false)
    expect(withinGeometry([5, 5], geometry)).toBe(false)
  })

  it('rejects non-finite vertices, invalid holes, unsupported geometry and unclosed rings', () => {
    expect(withinGeometry([1, 1], { type: 'Point', coordinates: [1, 1] })).toBe(false)
    expect(withinGeometry([NaN, 1], holed)).toBe(false)
    expect(withinGeometry([1, 1], { type: 'Polygon', coordinates: [] })).toBe(false)
    expect(withinGeometry([1, 1], { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [NaN, 10], [0, 10], [0, 0]]] })).toBe(false)
    expect(withinGeometry([1, 1], { type: 'Polygon', coordinates: [holed.coordinates[0]!, [[3, 3], [3, 7], [NaN, 7], [3, 3]]] })).toBe(false)
    expect(withinGeometry([1, 1], { type: 'Polygon', coordinates: [holed.coordinates[0]!.slice(0, -1)] })).toBe(false)
    expect(withinGeometry([1, 1], { type: 'Polygon', coordinates: [holed.coordinates[0]!, holed.coordinates[1]!.slice(0, -1)] })).toBe(false)
  })
})
