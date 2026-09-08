import { describe, expect, it } from 'vitest'
import { layoutMapCovers, type CoverMarker, type Rect } from '../src/map/cover-layout'

const marker = (id: string, overrides: Partial<CoverMarker> = {}): CoverMarker => ({ id, x: 120, y: 100, width: 54, height: 54, anchorX: 147, anchorY: 154, hasCover: true, ...overrides })
const viewport = { width: 600, height: 400 }
const gap = (a: Rect, b: Rect) => a.x + a.width + 4 <= b.x || b.x + b.width + 4 <= a.x || a.y + a.height + 4 <= b.y || b.y + b.height + 4 <= a.y
function expectSafe(markers: readonly CoverMarker[], size = viewport, obstacles: Rect[] = []) {
  const placements = [...layoutMapCovers(markers, size, obstacles).values()]
  for (const placed of placements) {
    expect(placed.width).toBeGreaterThanOrEqual(44); expect(placed.width).toBeLessThanOrEqual(52)
    expect(placed.height).toBe(48); expect(placed.x).toBeGreaterThanOrEqual(8); expect(placed.y).toBeGreaterThanOrEqual(8)
    expect(placed.x + placed.width).toBeLessThanOrEqual(size.width - 8)
    expect(placed.y + placed.height).toBeLessThanOrEqual(size.height - 8)
    for (const obstacle of [...markers, ...obstacles]) expect(gap(placed, obstacle)).toBe(true)
  }
  for (let i = 0; i < placements.length; i++) for (let j = i + 1; j < placements.length; j++) expect(gap(placements[i]!, placements[j]!)).toBe(true)
  return placements
}

describe('small map cover collision layout', () => {
  it('prefers a regular right-side stack, leaving a four-pixel landmark gap', () => {
    const source = marker('snow')
    expect(layoutMapCovers([source], viewport).get('snow')).toEqual({ x: 178, y: 103, width: 52, height: 48, compact: false })
    expectSafe([source])
  })
  it('tries left before below, then avoids the name/control obstacles below', () => {
    const source = marker('snow'), right = { x: 178, y: 90, width: 55, height: 75 }, left = { x: 55, y: 90, width: 62, height: 75 }
    expect(layoutMapCovers([source], viewport, [right]).get('snow')?.x).toBe(64)
    expect(layoutMapCovers([source], viewport, [right, left]).get('snow')).toEqual({ x: 121, y: 158, width: 52, height: 48, compact: false })
    const label = { x: 115, y: 157, width: 64, height: 24 }
    expect(layoutMapCovers([source], viewport, [right, left, label]).has('snow')).toBe(false)
    expectSafe([source], viewport, [right, left])
  })
  it('uses compact size only after regular candidates fail on a narrow gap', () => {
    const source = marker('snow', { x: 484, y: 100, width: 54, anchorX: 511, anchorY: 154 })
    const edgeViewport = { width: 598, height: 220 }
    const left = { x: 400, y: 85, width: 80, height: 82 }, below = { x: 475, y: 157, width: 66, height: 45 }
    expect(layoutMapCovers([source], edgeViewport, [left, below]).get('snow')).toEqual({ x: 542, y: 103, width: 48, height: 48, compact: true })
    expectSafe([source], edgeViewport, [left, below])
  })
  it('starts compact at mobile widths including the exact 400px boundary', () => {
    expect(layoutMapCovers([marker('snow')], { width: 400, height: 400 }).get('snow')?.width).toBe(48)
    expect(layoutMapCovers([marker('snow')], { width: 401, height: 400 }).get('snow')?.width).toBe(52)
    expectSafe([marker('snow')], { width: 320, height: 390 })
  })
  it('keeps covers inside edge margins without moving landmarks or geographic anchors', () => {
    const markers = [marker('top-left', { x: 8, y: 0, anchorX: 35, anchorY: 54 }), marker('bottom-right', { x: 538, y: 343, anchorX: 565, anchorY: 397 })]
    const before = structuredClone(markers)
    const placements = layoutMapCovers(markers, viewport)
    expect(placements.get('top-left')?.y).toBe(8)
    expect(placements.get('bottom-right')?.x).toBe(482)
    expect(placements.get('bottom-right')?.y).toBe(344)
    expect(markers).toEqual(before); expectSafe(markers)
  })
  it('treats every landmark as an obstacle even when it has no photo or valid anchor', () => {
    const source = marker('snow'), noPhoto = marker('other', { x: 177, y: 100, hasCover: false })
    expect(layoutMapCovers([source, noPhoto], viewport).get('snow')?.x).toBe(64)
    expect(layoutMapCovers([source, { ...noPhoto, anchorX: NaN }], viewport).get('snow')?.x).toBe(64)
    expect(layoutMapCovers([source, noPhoto], viewport).has('other')).toBe(false)
  })
  it('gives selected markers priority, otherwise uses stable ids independent of input order', () => {
    const a = marker('a'), b = marker('b', { x: 286, anchorX: 313 })
    const walls = [{ x: 55, y: 85, width: 62, height: 85 }, { x: 110, y: 157, width: 74, height: 54 }, { x: 344, y: 85, width: 66, height: 85 }, { x: 276, y: 157, width: 74, height: 54 }]
    // Both regular candidates target neighbouring slots; preserving 4px spacing
    // can hide a lower-priority cover but must not depend on input iteration.
    expect([...layoutMapCovers([b, a], viewport, walls)]).toEqual([...layoutMapCovers([a, b], viewport, walls)])
    expect([...layoutMapCovers([a, { ...b, selected: true }], viewport, walls).keys()][0]).toBe('b')
    expectSafe([a, b], viewport, walls)
  })
  it('reserves the only available slot for the selected landmark without hiding or moving the others', () => {
    const a = marker('a'), b = marker('b')
    const walls = [{ x: 55, y: 90, width: 62, height: 75 }, { x: 115, y: 157, width: 64, height: 60 }]
    expect([...layoutMapCovers([b, a], viewport, walls).keys()]).toEqual(['a'])
    expect([...layoutMapCovers([a, { ...b, selected: true }], viewport, walls).keys()]).toEqual(['b'])
    expect([a.x, b.x, a.anchorY, b.anchorY]).toEqual([120, 120, 154, 154])
    expectSafe([a, b], viewport, walls)
  })
  it('collapses unplaceable dense covers instead of shrinking below the tap target', () => {
    const markers = Array.from({ length: 30 }, (_, i) => marker(String(i), { x: 8 + i % 6 * 54, y: 8 + Math.floor(i / 6) * 54, anchorX: 35 + i % 6 * 54, anchorY: 62 + Math.floor(i / 6) * 54 }))
    const result = layoutMapCovers(markers, { width: 340, height: 286 })
    expect(result.size).toBeLessThan(markers.length)
    expectSafe(markers, { width: 340, height: 286 })
    expect(layoutMapCovers([marker('one')], viewport, [{ x: 0, y: 0, width: 600, height: 400 }]).size).toBe(0)
  })
  it('does not place invalid markers, accepts valid offscreen obstacles, and rejects invalid viewports', () => {
    for (const value of [NaN, Infinity, -Infinity]) {
      expect(layoutMapCovers([marker('bad', { x: value })], viewport).size).toBe(0)
      expect(layoutMapCovers([marker('bad', { anchorY: value })], viewport).size).toBe(0)
      expect(layoutMapCovers([marker('one')], { width: value, height: 400 }).size).toBe(0)
    }
    for (const width of [0, -1, 63]) expect(layoutMapCovers([marker('one')], { width, height: 400 }).size).toBe(0)
    expect(layoutMapCovers([marker('bad', { width: 0 })], viewport).size).toBe(0)
    expect(layoutMapCovers([marker('one')], viewport, [{ x: NaN, y: 0, width: 20, height: 20 }]).size).toBe(1)
    expect(layoutMapCovers([marker('one')], viewport, [{ x: -10, y: 0, width: 188, height: 400 }]).size).toBe(0)
  })
  it('never pulls a photo into view when its geographic anchor has left the map', () => {
    for (const anchors of [{ anchorX: -1 }, { anchorX: 601 }, { anchorY: -1 }, { anchorY: 401 }]) {
      expect(layoutMapCovers([marker('outside', anchors)], viewport).has('outside')).toBe(false)
    }
    // Padded Leaflet markers can still block nearby covers without displaying
    // their own photo disconnected from the offscreen landmark.
    const outside = marker('above', { x: 178, y: -40, anchorX: 205, anchorY: -2, height: 180 })
    const result = layoutMapCovers([marker('inside'), outside], viewport)
    expect(result.has('above')).toBe(false)
    expect(result.get('inside')?.x).toBe(64)
  })
  it('is immutable, deterministic under obstacle order, and skips ambiguous duplicate identities', () => {
    const source = Object.freeze(marker('snow')), label = Object.freeze({ x: 118, y: 158, width: 58, height: 24 })
    const markers = Object.freeze([source]), obstacles = Object.freeze([label, { x: 540, y: 0, width: 60, height: 60 }])
    const original = JSON.stringify([markers, obstacles, viewport])
    const result = layoutMapCovers(markers, viewport, obstacles)
    expect([...result]).toEqual([...layoutMapCovers(markers, viewport, [...obstacles].reverse())])
    expect(JSON.stringify([markers, obstacles, viewport])).toBe(original)
    result.get('snow')!.x = 0
    expect(source.x).toBe(120)
    expect(layoutMapCovers([source, { ...source, x: 400 }], viewport).size).toBe(0)
  })
})
