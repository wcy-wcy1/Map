import { describe, expect, it } from 'vitest'
import otherA from '../src/data/other-province-places-a.json'
import otherB from '../src/data/other-province-places-b.json'
import { ensureLandmarks, landmarkProvince, nationalLandmarkId, nationalLandmarkSvg, svg } from '../src/map/landmarks'

describe('all remaining province artwork', () => {
  it('gives all 100 places distinct safe geometry and a correctly named national representative', async () => {
    const places = [...otherA, ...otherB]
    const provinces = [...new Set(places.map(p => p.mapId))]
    expect(places).toHaveLength(100)
    expect(provinces).toHaveLength(25)
    await Promise.all(provinces.map(ensureLandmarks))
    const geometry = new Set<string>()
    for (const p of places) {
      expect(landmarkProvince(p.id)).toBe(p.mapId)
      const full = svg(p.iconKey, { variant: p.id })
      const simple = svg(p.iconKey, { variant: p.id, detail: 'simple' })
      expect(full, p.id).not.toBe(svg(p.iconKey))
      expect(simple, p.id).not.toBe(full)
      for (const markup of [simple, full]) {
        const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
        expect(doc.querySelector('parsererror'), p.id).toBeNull()
        expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 80 72')
        expect(doc.documentElement.getAttribute('data-anchor-y')).toBe('68')
        expect(doc.querySelector('script,style,foreignObject,image,use,a,text')).toBeNull()
        expect(markup).not.toMatch(/\bon[a-z]+\s*=|(?:href|src)\s*=|url\s*\(|javascript:|data:/i)
      }
      geometry.add(simple.replace(/(?:fill|stroke)="[^"]*"/g, ''))
      const representative = nationalLandmarkId(p.mapId)
      expect(places.some(item => item.id === representative && item.mapId === p.mapId)).toBe(true)
      const national = nationalLandmarkSvg(p.mapId, p.id)
      if (representative === p.id) expect(national).toBe(simple)
      else expect(national).toBeUndefined()
    }
    expect(geometry.size).toBe(100)
  })

  it('does not label province representatives as a different named place', () => {
    expect(nationalLandmarkSvg('cn-62', 'gansu-mogao')).toBeUndefined()
    expect(nationalLandmarkSvg('cn-35', 'fujian-gulangyu')).toBeUndefined()
    expect(nationalLandmarkSvg('cn-51', 'sichuan-jiuzhaigou')).toBeUndefined()
    expect(nationalLandmarkSvg('cn-62', 'gansu-zhangye-danxia')).toContain('<svg')
    expect(nationalLandmarkSvg('cn-35', 'fujian-tianluokeng')).toContain('<svg')
    expect(nationalLandmarkSvg('cn-51', 'sichuan-dujiangyan')).toContain('<svg')
    expect(nationalLandmarkId('__proto__')).toBeUndefined()
    expect(nationalLandmarkSvg('cn-11')).toBeUndefined()
  })
})
