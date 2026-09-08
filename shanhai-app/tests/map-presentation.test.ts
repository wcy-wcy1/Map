import { describe, expect, it } from 'vitest'
import { group } from '../src/domain/map-layout'
import type { ProjectedPlace } from '../src/domain/map-layout'
import { focusAnchor, markerDimensions, markerLabel } from '../src/map/presentation'

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
