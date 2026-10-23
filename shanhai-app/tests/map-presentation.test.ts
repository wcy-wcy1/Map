import { describe, expect, it } from 'vitest'
import { group } from '../src/domain/map-layout'
import type { ProjectedPlace } from '../src/domain/map-layout'
import { clusterZoom, focusAnchor, markerDimensions, markerLabel, overviewPlaces, stableGroups } from '../src/map/presentation'

const place = (id: string, x = 0, y = 0): ProjectedPlace => ({
  id, name: id, x, y, coordinates: [100 + x / 1e6, 25 + y / 1e6],
  aliases: [], regionId: 'lijiang', regionName: '丽江市', city: '丽江', category: '自然',
  iconKey: 'snow-mountain', coordinateSystem: 'WGS84', coordinateSource: { type: 'test' },
  anchorNote: '', text: '', highlights: [], priority: 1,
})

describe('landmark positioning and accessible groups', () => {
  it.each([5, 7.5, 8, 10.5, 11, 18])('keeps the SVG geographic point at the marker anchor at zoom %s', zoom => {
    const size = markerDimensions(zoom)
    expect(size.width).toBeGreaterThanOrEqual(44)
    expect(size.height).toBeGreaterThanOrEqual(44)
    expect(size.anchorX).toBeCloseTo(size.width * 40 / 80)
    expect(size.anchorY).toBeCloseTo(size.height * 68 / 72)
  })
  it('uses 54, 58, then 64 pixel symbols; does not scale photos on the map', () => {
    expect([markerDimensions(5).width, markerDimensions(8).width, markerDimensions(11).width]).toEqual([54, 58, 64])
  })
  it('retains an actual member coordinate rather than moving the landmark to a centroid', () => {
    const a = place('a'), b = place('b', 30), c = place('c', 200)
    const groups = group([a, b, c])
    expect(groups).toHaveLength(2)
    expect(groups[0]?.anchor.coordinates).toEqual(a.coordinates)
    expect(groups[0]?.members.map(p => p.id)).toEqual(['a', 'b'])
  })
  it('preserves keyboard focus when the former anchor is regrouped beneath a selected marker', () => {
    const groups = group([place('a'), place('b', 30)], { selectedId: 'b' })
    expect(focusAnchor(groups, 'a')).toBe('b')
    expect(focusAnchor(groups, 'b')).toBe('b')
    expect(focusAnchor(groups, 'not-visible')).toBeUndefined()
  })
  it('announces grouped count and saved-memory status, while picker labels describe picking', () => {
    const item = group([place('a'), place('b', 30)])[0]!
    expect(markerLabel(item, new Set(['b']), false)).toBe('a附近 2 个景点，点击展开，其中 1 处已记录')
    expect(markerLabel(item, new Set(), true)).toBe('将a的位置用于我的地点')
    const single = group([place('a')])[0]!
    expect(markerLabel(single, new Set(['a']), false)).toBe('查看a，已记录')
  })
})


describe('overview and stable grouping', () => {
  it('limits cluster drill-downs to two levels and uses the list for coincident or maximum-detail groups', () => {
    expect(clusterZoom(9, 16, 1000)).toBe(11)
    expect(clusterZoom(9, 9.5, 1000)).toBe(10)
    expect(clusterZoom(15.25, 18, 1000)).toBe(16)
    expect(clusterZoom(9, Infinity, 0)).toBe(9)
    expect(clusterZoom(16, 18, 1000)).toBe(16)
    expect(clusterZoom(17, 18, 1000)).toBe(17)
  })
  it('prefers the authored province portrait while keeping selection, memories and filters authoritative', () => {
    const jiuzhaigou = { ...place('sichuan-jiuzhaigou'), mapId: 'cn-51' }
    const dujiangyan = { ...place('sichuan-dujiangyan'), mapId: 'cn-51', priority: 2 }
    expect(overviewPlaces([jiuzhaigou, dujiangyan], [], null, 12)[0]?.id).toBe(dujiangyan.id)
    expect(overviewPlaces([jiuzhaigou, dujiangyan], [jiuzhaigou.id], null, 12)[0]?.id).toBe(jiuzhaigou.id)
    expect(overviewPlaces([jiuzhaigou, dujiangyan], [], jiuzhaigou.id, 12)[0]?.id).toBe(jiuzhaigou.id)
    expect(overviewPlaces([jiuzhaigou], [], null, 12)).toEqual([jiuzhaigou])
  })
  it('selects at most one representative per province within desktop and mobile budgets', () => {
    const places = Array.from({ length: 1000 }, (_, i) => ({ ...place(`p${i}`, i * 20), mapId: `province${i % 34}` }))
    const desktop = overviewPlaces(places, ['p22'], 'p99', 12)
    expect(desktop).toHaveLength(12)
    expect(desktop[0]?.id).toBe('p99')
    expect(desktop[1]?.id).toBe('p22')
    expect(new Set(desktop.map(p => p.mapId)).size).toBe(12)
    expect(overviewPlaces(places, [], null, 6)).toHaveLength(6)
    expect(places).toHaveLength(1000)
  })
  it('spreads the national budget west and northeast instead of filling it alphabetically', () => {
    const east = Array.from({ length: 15 }, (_, i) => ({ ...place(`a${i}`), coordinates: [118 + i / 10, 30] as [number, number], mapId: `east${i}` }))
    const west = { ...place('z-west'), coordinates: [85, 43] as [number, number], mapId: 'west' }
    const northeast = { ...place('z-northeast'), coordinates: [128, 48] as [number, number], mapId: 'northeast' }
    const picked = overviewPlaces([...east, west, northeast], [], null, 4)
    expect(picked.map(p => p.id)).toContain('z-west')
    expect(picked.map(p => p.id)).toContain('z-northeast')
    expect(west.coordinates).toEqual([85, 43])
  })
  it('keeps a cluster within the hysteresis band and splits once it crosses the buffer', () => {
    const initial = stableGroups([place('a'), place('b', 65)], [], { radius: 70, selectedId: null })
    expect(initial).toHaveLength(1)
    const retained = stableGroups([place('a'), place('b', 75)], initial, { radius: 70, selectedId: null })
    expect(retained).toHaveLength(1)
    expect(stableGroups([place('a'), place('b', 79)], retained, { radius: 70, selectedId: null })).toHaveLength(2)
    expect(stableGroups([place('a'), place('b', 75)], [], { radius: 70, selectedId: null })).toHaveLength(2)
    expect(stableGroups([place('a'), place('b', 65)], initial, { radius: 70, selectedId: 'b' })[0]?.anchor.id).toBe('b')
  })
})
