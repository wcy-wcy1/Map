import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { landmarkDataUrl, landmarkKeys, svg } from '../src/map/landmarks'

const variants = [
  ['snow-mountain', 'meili', 'meili-snow-mountain'],
  ['pagoda', 'golden-pagoda', 'menghuan-golden-pagoda'],
  ['temple', 'golden-monastery', 'songzanlin-monastery'],
  ['stone-forest', 'earth-forest', 'yuanmou-earth-forest'],
  ['terraces', 'yuanyang', 'yuanyang-terraces'],
  ['old-town', 'old-town-water', 'lijiang-old-town'],
  ['garden', 'forest-mountain', 'western-hills'],
  ['cave', 'rock-art', 'cangyuan-rock-art'],
] as const

describe('typed authored landmarks', () => {
  it('keeps all 20 base icons distinct, with a documented coordinate anchor', () => {
    expect(landmarkKeys).toHaveLength(20)
    expect(Object.isFrozen(landmarkKeys)).toBe(true)
    expect(new Set(landmarkKeys.map(key => svg(key))).size).toBe(20)
    for (const key of landmarkKeys) {
      const document = new DOMParser().parseFromString(svg(key), 'image/svg+xml')
      expect(document.querySelector('parsererror')).toBeNull()
      expect(document.documentElement.getAttribute('viewBox')).toBe('0 0 80 72')
      expect(document.documentElement.getAttribute('data-anchor-x')).toBe('40')
      expect(document.documentElement.getAttribute('data-anchor-y')).toBe('68')
      expect(document.querySelector('script,style,foreignObject,image,use,a,text')).toBeNull()
      expect(svg(key)).not.toMatch(/\bon[a-z]+\s*=|(?:href|src)\s*=|url\s*\(|javascript:|data:/i)
    }
  })
  it.each(variants)('preserves the authored %s variant %s and alias %s', (key, variant, alias) => {
    expect(svg(key, { variant })).not.toBe(svg(key))
    expect(svg(key, { variant: alias })).toBe(svg(key, { variant }))
  })
  it('does not execute accessors, coerce supplied keys, or render user-supplied markup', () => {
    const malicious = '<image href="https://example.invalid/private" onload="alert(1)"/>'
    const fallback = svg('unknown')
    for (const key of ['__proto__', 'constructor', 'toString', malicious, null, Symbol('key'), { toString() { throw Error('Must not coerce') } }]) {
      expect(svg(key)).toBe(fallback)
    }
    for (const key of landmarkKeys) {
      expect(svg(key, { variant: malicious })).toBe(svg(key))
      expect(svg(key, { get variant() { throw Error('Must not execute') } })).toBe(svg(key))
      expect(svg(key, new Proxy({}, { getOwnPropertyDescriptor() { throw Error('Bad options') } }))).toBe(svg(key))
    }
  })
  it('encodes a data URL that contains exactly the safe authored drawing', () => {
    const url = landmarkDataUrl('snow-mountain', { variant: 'meili' })
    expect(url.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(url.slice(url.indexOf(',') + 1))).toBe(svg('snow-mountain', { variant: 'meili' }))
  })
  it('preserves every migrated drawing against a pre-migration artwork checksum', () => {
    // Captured from the original landmark-icons.js; insignificant SVG whitespace removed.
    // This baseline keeps the new project tests independent of the old output directory.
    const drawings = [...landmarkKeys.map(key => svg(key)), ...variants.map(([key, variant]) => svg(key, { variant }))]
    const checksum = createHash('sha256').update(drawings.map(value => value.replace(/>\s+</g, '><')).join('\n')).digest('hex')
    expect(checksum).toBe('28cafb6a557fdd63043b7e566d645756578bd3286196be25b94572837fb9b2df')
  })
})
