import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import SearchToolbar from '../src/components/SearchToolbar.vue'
import { provinces } from '../src/domain/provinces'

const initial = { query: '', regionId: '', visitedOnly: false, regions: [], placeCount: 43 }

describe('national geography controls', () => {
  it('offers all 34 regions with an explicit national overview and describes actual public coverage', async () => {
    const wrapper = mount(SearchToolbar, { props: initial })
    const select = wrapper.get<HTMLSelectElement>('[aria-label="选择省份或地区"]')
    expect(select.findAll('option')).toHaveLength(35)
    expect(select.findAll('option').slice(1).map(option => option.attributes('value'))).toEqual(provinces.map(province => province.id))
    expect(wrapper.get('h1').text()).toBe('全国')
    expect(wrapper.text()).toContain('43 个公共地点，目前整理于云南')
    expect(wrapper.text()).not.toContain('16 个州市')
    expect(wrapper.find('[aria-label="按州市筛选"]').exists()).toBe(false)
    await select.setValue('cn-51')
    expect(wrapper.emitted('update:provinceId')).toEqual([['cn-51']])
    wrapper.unmount()
  })
  it('shows Yunnan subregions, keeps search and visit controls, and avoids repeating a province as its own subregion', async () => {
    const wrapper = mount(SearchToolbar, { props: { ...initial, provinceId: 'yunnan', regions: [{ id: 'lijiang', name: '丽江市', placeIds: [] }] } })
    expect(wrapper.get('h1').text()).toBe('云南')
    await wrapper.get('[aria-label="按州市筛选"]').setValue('lijiang')
    expect(wrapper.emitted('update:regionId')).toEqual([['lijiang']])
    await wrapper.get('input[type="search"]').setValue('茶馆')
    expect(wrapper.emitted('update:query')).toEqual([['茶馆']])
    await wrapper.findAll('.yn-visit-filters button')[1]!.trigger('click')
    expect(wrapper.emitted('update:visitedOnly')).toEqual([[true]])
    await wrapper.setProps({ provinceId: 'cn-51', placeCount: 0, regions: [{ id: 'cn-51', name: '四川省', placeIds: [] }] })
    expect(wrapper.get('h1').text()).toBe('四川')
    expect(wrapper.text()).toContain('0 个公共地点，可添加我的地点')
    expect(wrapper.find('[aria-label="按州市筛选"]').exists()).toBe(false)
    wrapper.unmount()
  })
  it('disables all filters while the editor is choosing its location on the map', () => {
    const wrapper = mount(SearchToolbar, { props: { ...initial, provinceId: 'yunnan', query: '茶馆', disabled: true,
      regions: [{ id: 'lijiang', name: '丽江市', placeIds: [] }] } })
    const controls = wrapper.findAll('input,select,button')
    expect(controls.length).toBeGreaterThanOrEqual(6)
    expect(controls.every(control => control.attributes('disabled') !== undefined)).toBe(true)
    wrapper.unmount()
  })
})
