import { describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import LandmarkIcon from '../src/components/LandmarkIcon.vue'
import { ensureLandmarks, getLandmarkRevision, landmarkProvince, nationalLandmarkSvg, subscribeLandmarks, svg } from '../src/map/landmarks'

const fixtures = [
  ['cn-11', 'museum', 'beijing-forbidden-city'], ['cn-11', 'temple', 'beijing-temple-of-heaven'],
  ['cn-11', 'temple', 'beijing-white-pagoda'], ['cn-11', 'temple', 'beijing-tanzhe-temple'],
  ['cn-51', 'lake', 'sichuan-jiuzhaigou'], ['cn-51', 'museum', 'sichuan-dujiangyan'],
  ['cn-51', 'old-town', 'sichuan-shangli'], ['cn-51', 'village', 'sichuan-taoping'],
  ['cn-33', 'lake', 'zhejiang-west-lake'], ['cn-33', 'old-town', 'zhejiang-wuzhen'],
  ['cn-33', 'village', 'zhejiang-guyan-huaxiang'], ['cn-33', 'village', 'zhejiang-chenjiapu'],
  ['cn-35', 'old-town', 'fujian-gulangyu'], ['cn-35', 'village', 'fujian-tianluokeng'],
  ['cn-35', 'village', 'fujian-qida'], ['cn-35', 'village', 'fujian-beigang'],
  ['cn-45', 'canyon', 'guangxi-li-river'], ['cn-45', 'terraces', 'guangxi-longji'],
  ['cn-45', 'old-town', 'guangxi-huangyao'], ['cn-45', 'village', 'guangxi-chengyang'],
  ['cn-62', 'cave', 'gansu-mogao'], ['cn-62', 'stone-forest', 'gansu-zhangye-danxia'],
  ['cn-62', 'canyon', 'gansu-guanegou'], ['cn-62', 'snow-mountain', 'gansu-zhagana'],
  ['cn-52', 'waterfall', 'guizhou-huangguoshu'], ['cn-52', 'bridge', 'guizhou-xiaoqikong'],
  ['cn-52', 'village', 'guizhou-tangan'], ['cn-52', 'old-town', 'guizhou-zhenyuan'],
  ['cn-65', 'lake', 'xinjiang-tianchi'], ['cn-65', 'lake', 'xinjiang-kanas'],
  ['cn-65', 'museum', 'xinjiang-jiaohe'], ['cn-65', 'terraces', 'xinjiang-jiangbulake'],
] as const

describe('province artwork loading and rendering', () => {
  it('renders the national list without loading all province artwork', async () => {
    const before = getLandmarkRevision()
    const wrappers = fixtures.filter((_, index) => index % 4 === 0).map(([, iconKey, variant]) =>
      mount(LandmarkIcon, { props: { iconKey, variant, simple: true } }))
    await flushPromises()
    expect(getLandmarkRevision()).toBe(before)
    for (const wrapper of wrappers) {
      expect(wrapper.find('img').attributes('src')).toMatch(/^data:image\/svg\+xml/)
      wrapper.unmount()
    }
  })

  it('deduplicates concurrent imports, notifies once and leaves other provinces unloaded', async () => {
    const before = getLandmarkRevision()
    const changed = vi.fn()
    const unsubscribe = subscribeLandmarks(changed)
    expect(svg('temple', { variant: 'beijing-temple-of-heaven' })).toBe(svg('temple'))
    const first = ensureLandmarks('cn-11')
    expect(ensureLandmarks('cn-11')).toBe(first)
    await first
    expect(changed).toHaveBeenCalledTimes(1)
    expect(getLandmarkRevision()).toBe(before + 1)
    expect(svg('temple', { variant: 'beijing-temple-of-heaven' })).not.toBe(svg('temple'))
    expect(svg('lake', { variant: 'sichuan-jiuzhaigou' })).toBe(svg('lake'))
    unsubscribe()
    await ensureLandmarks('cn-11')
    expect(changed).toHaveBeenCalledTimes(1)
  })

  it('updates a mounted simple icon after entering its province', async () => {
    const wrapper = mount(LandmarkIcon, { props: { iconKey: 'lake', variant: 'sichuan-jiuzhaigou', simple: true } })
    const simpleSource = wrapper.find('img').attributes('src')
    await wrapper.setProps({ simple: false })
    await ensureLandmarks('cn-51')
    await flushPromises()
    expect(wrapper.find('img').attributes('src')).not.toBe(simpleSource)
    expect(decodeURIComponent(wrapper.find('img').attributes('src')!.split(',')[1]!)).toBe(svg('lake', { variant: 'sichuan-jiuzhaigou' }))
    wrapper.unmount()
  })

  it('ships 32 distinct safe portraits and simplified silhouettes with preserved anchors', async () => {
    await Promise.all([...new Set(fixtures.map(([province]) => province))].map(ensureLandmarks))
    const silhouettes: string[] = []
    for (const [province, key, variant] of fixtures) {
      expect(landmarkProvince(variant)).toBe(province)
      const full = svg(key, { variant })
      const simple = svg(key, { variant, detail: 'simple' })
      expect(full).not.toBe(svg(key))
      expect(full).not.toBe(simple)
      for (const markup of [full, simple]) {
        const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
        expect(doc.querySelector('parsererror')).toBeNull()
        expect(doc.documentElement.getAttribute('viewBox')).toBe('0 0 80 72')
        expect(doc.documentElement.getAttribute('data-anchor-x')).toBe('40')
        expect(doc.documentElement.getAttribute('data-anchor-y')).toBe('68')
        expect(doc.querySelector('script,style,foreignObject,image,use,a,text')).toBeNull()
        expect(markup).not.toMatch(/\bon[a-z]+\s*=|(?:href|src)\s*=|url\s*\(|javascript:|data:/i)
      }
      // Distinct geometry must survive removal of paint attributes.
      silhouettes.push(simple.replace(/(?:fill|stroke)="[^"]*"/g, ''))
    }
    expect(new Set(silhouettes).size).toBe(32)
  })

  it('never turns untrusted registry keys/options into markup or executable input', async () => {
    const before = getLandmarkRevision()
    for (const bad of ['__proto__', 'constructor', '../../private', '<svg onload="alert(1)">', null, { toString() { throw Error('coercion') } }]) {
      await ensureLandmarks(bad)
      expect(nationalLandmarkSvg(bad)).toBeUndefined()
      expect(landmarkProvince(bad)).toBeUndefined()
    }
    expect(getLandmarkRevision()).toBe(before)
    const read = vi.fn(() => { throw Error('accessor') })
    const options = Object.defineProperties({}, { variant: { get: read }, detail: { get: read } })
    expect(svg('temple', options)).toBe(svg('temple'))
    expect(read).not.toHaveBeenCalled()
    expect(svg('invalid', { variant: 'beijing-temple-of-heaven' })).toBe(svg('invalid'))
  })
})
