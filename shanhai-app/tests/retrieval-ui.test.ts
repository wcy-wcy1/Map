import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SearchToolbar from '../src/components/SearchToolbar.vue'
import PlaceList from '../src/components/PlaceList.vue'
import PlaceDetail from '../src/components/PlaceDetail.vue'
import JourneyPlanner from '../src/components/JourneyPlanner.vue'
import { publicPlaces, regions } from '../src/domain/catalogue'
import { indexVisits } from '../src/domain/map-layout'
import type { VisitSummary } from '../src/domain/models'
import { PHOTO_LOADER_KEY, type PhotoLoader } from '../src/services/photo-loader'

const place = publicPlaces.find(p => p.id === 'yulong')!
const visits: VisitSummary[] = Array.from({ length: 18 }, (_, i) => ({ id: `visit-${i}`, placeId: place.id, createdAt: i, date: `2025-01-${String(i + 1).padStart(2, '0')}`, note: i === 0 ? '热豆浆 <script>bad()</script>' : `合成记录${i}`, photos: [], coverId: null }))
const revisions = { revision: 3 }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('Vue retrieval interactions', () => {
  it('uses labelled input, separate region and visit filters; clear emits query only', async () => {
    const wrapper = mount(SearchToolbar, { props: { query: '雪山', provinceId: 'yunnan', regionId: 'lijiang', visitedOnly: true, regions: regions.filter(region => region.provinceId === 'yunnan'), placeCount: 43 } })
    await wrapper.get('[aria-label="清空搜索"]').trigger('click')
    expect(wrapper.emitted('update:query')).toEqual([['']])
    expect(wrapper.emitted('update:regionId')).toBeUndefined()
    expect(wrapper.emitted('update:provinceId')).toBeUndefined()
    await wrapper.get('#yn-query').setValue('手记')
    expect(wrapper.emitted('update:query')?.at(-1)).toEqual(['手记'])
    await wrapper.get('[aria-label="按州市筛选"]').setValue('kunming')
    expect(wrapper.emitted('update:regionId')).toEqual([['kunming']])
    expect(wrapper.emitted('update:provinceId')).toBeUndefined()
  })
  it('renders a real 12-item page and exposes the load-more event', async () => {
    const wrapper = mount(PlaceList, { props: { ...revisions, places: publicPlaces, recordIndex: new Map(), query: '', limit: 12, hasFilters: false, visitedOnly: false } })
    expect(wrapper.findAll('.yn-place-row')).toHaveLength(12)
    await wrapper.get('.yn-show-more').trigger('click')
    expect(wrapper.emitted('more')).toHaveLength(1)
    await wrapper.setProps({ limit: 24 })
    expect(wrapper.findAll('.yn-place-row')).toHaveLength(24)
    await wrapper.get('.yn-place-row').trigger('click')
    expect(wrapper.emitted('select')?.[0]).toEqual([publicPlaces[0]!.id])
  })
  it('shows matching oldest visit instead of newer unrelated text; renders notes as text', () => {
    const wrapper = mount(PlaceList, { props: { ...revisions, places: [place], recordIndex: indexVisits(visits), query: '热豆浆', limit: 12, hasFilters: true, visitedOnly: false } })
    expect(wrapper.text()).toContain('2025-01-01')
    expect(wrapper.text()).toContain('<script>bad()</script>')
    expect(wrapper.find('script').exists()).toBe(false)
  })
  it('details first show one matching memory, allow all memories and paginate', async () => {
    const wrapper = mount(PlaceDetail, { props: { ...revisions, place, visits: indexVisits(visits).get(place.id)!, query: '热豆浆' } })
    expect(wrapper.findAll('.yn-memory')).toHaveLength(1)
    expect(wrapper.get('.yn-memory').text()).toContain('热豆浆')
    expect(wrapper.find('script').exists()).toBe(false)
    await wrapper.get('.yn-memory-filter button').trigger('click')
    expect(wrapper.findAll('.yn-memory')).toHaveLength(8)
    const more = () => wrapper.findAll('button').find(button => button.text().startsWith('查看更多回忆'))!
    await more().trigger('click'); expect(wrapper.findAll('.yn-memory')).toHaveLength(16)
    await more().trigger('click'); expect(wrapper.findAll('.yn-memory')).toHaveLength(18)
  })
  it('returns explicit empty results and keeps source links safe', async () => {
    const list = mount(PlaceList, { props: { ...revisions, places: [], recordIndex: new Map(), query: '不存在', limit: 12, hasFilters: true, visitedOnly: false } })
    await list.get('.yn-empty button').trigger('click')
    expect(list.emitted('reset')).toHaveLength(1)
    const detail = mount(PlaceDetail, { props: { ...revisions, place: { ...place, source: 'javascript:alert(1)', coordinateSource: { type: 'user-set', url: 'data:text/html,unsafe' } }, visits: [], query: '' } })
    expect(detail.find('a').exists()).toBe(false)
  })
  it('loads an actual photo-free list summary through the injected loader and honours the map cover', async () => {
    const frames = new Map<Element, IntersectionObserverCallback>()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) { frames.set(target, this.callback) }
      disconnect() {}
    })
    const summary: VisitSummary = { ...visits[0]!, coverId: 'first', photos: [{ id: 'first', name: 'first.jpg' }, { id: 'map-choice', name: 'map.jpg' }] }
    const loader: PhotoLoader = { load: vi.fn(async (_id, photoId) => ({ id: photoId, name: 'map.jpg', url: 'data:image/jpeg;base64,AA==' })), clear: vi.fn(), close: vi.fn() }
    const wrapper = mount(PlaceList, { props: { ...revisions, places: [place], recordIndex: indexVisits([summary]), covers: [{ placeId: place.id, visitId: summary.id, photoId: 'map-choice' }], query: '', limit: 12, hasFilters: false, visitedOnly: true }, global: { provide: { [PHOTO_LOADER_KEY as symbol]: loader } } })
    expect(summary.photos.every(photo => !('url' in photo))).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false); expect(loader.load).not.toHaveBeenCalled()
    for (const [target, callback] of frames) callback([{ target, isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await flushPromises()
    expect(loader.load).toHaveBeenCalledExactlyOnceWith(summary.id, 'map-choice', 3, expect.any(AbortSignal))
    expect(wrapper.get('img').attributes('src')).toBe('data:image/jpeg;base64,AA==')
    await wrapper.get('.yn-place-row').trigger('click')
    expect(wrapper.emitted('select')).toEqual([[place.id]])
    wrapper.unmount()
  })
  it('emits summaries and the selected cover index, even when a detail photo could not load', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const summary: VisitSummary = { ...visits[0]!, coverId: 'second', photos: [{ id: 'first', name: 'first.jpg' }, { id: 'second', name: 'second.jpg' }] }
    const wrapper = mount(PlaceDetail, { props: { ...revisions, place, visits: [summary], query: '' } })
    await flushPromises()
    expect(wrapper.text()).toContain('照片未载入，点开重试')
    await wrapper.get('.yn-memory-cover').trigger('click')
    expect(wrapper.emitted('viewPhoto')).toEqual([[summary, 1]])
    for (const [label, event] of [['编辑', 'edit'], ['删除', 'delete'], ['制作回忆卡', 'share']] as const) {
      await wrapper.findAll('button').find(button => button.text() === label)!.trigger('click')
      expect(wrapper.emitted(event)).toEqual([[summary]])
    }
    expect(wrapper.emitted('viewPhoto')?.[0]?.[0]).toEqual(expect.objectContaining({ photos: [{ id: 'first', name: 'first.jpg' }, { id: 'second', name: 'second.jpg' }] }))
    expect(wrapper.get('.yn-memory-cover').find('button').exists()).toBe(false)
    wrapper.unmount()
  })
  it('selects places and previews a lightweight planned journey', async () => {
    const wrapper = mount(JourneyPlanner, { props: { places: publicPlaces.slice(0, 3), selectedIds: [], recordIndex: new Map(), areaLabel: '云南' } })
    await wrapper.get('.yn-planner-place').trigger('click')
    expect(wrapper.emitted('toggle')?.[0]).toEqual([publicPlaces[0]!.id])
    await wrapper.setProps({ selectedIds: [publicPlaces[0]!.id, publicPlaces[1]!.id] })
    await wrapper.get('.yn-primary').trigger('click')
    expect(wrapper.emitted('preview')?.[0]?.[0]).toHaveLength(2)
  })
})
