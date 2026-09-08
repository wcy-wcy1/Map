import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LibraryIndexSnapshot, Visit } from '../src/domain/models'
import { toVisitSummary } from '../src/domain/visit-summary'
import { yunnanBoundary } from '../src/domain/provinces'
const geographyLoader = vi.hoisted(() => vi.fn())
const mapActions = vi.hoisted(() => ({ fitProvince: vi.fn(), fitPlaces: vi.fn(), selectPlace: vi.fn() }))
vi.mock('../src/services/geography-service', async importOriginal => {
  const original = await importOriginal<typeof import('../src/services/geography-service')>()
  return { ...original, createGeographyService: () => original.createGeographyService({ loadYunnan: geographyLoader }) }
})

const repository = vi.hoisted(() => ({ load: vi.fn(), loadDraft: vi.fn(), loadIndex: vi.fn(), readVisit: vi.fn(), hasDraft: vi.fn(), close: vi.fn(),
  setMapCover: vi.fn(), deleteVisit: vi.fn(), restoreVisit: vi.fn() }))
vi.mock('../src/services/travel-services', async importOriginal => ({
  ...await importOriginal<typeof import('../src/services/travel-services')>(),
  createTravelServices: (options: { catalogue: unknown }) => ({ ...options, repository, backup: {}, restores: {} })
}))
import App from '../src/App.vue'

const visit: Visit = { id: 'app-test', createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '写入后最新的回忆',
  photos: [{ id: 'a', name: '一.jpg', url: 'data:image/jpeg;base64,/9j/4AAAAAA=' }, { id: 'b', name: '二.jpg', url: 'data:image/jpeg;base64,/9j/4AAAAAE=' }], coverId: 'a' }
const empty = (): LibraryIndexSnapshot => ({ visits: [], covers: [], revision: 0 })
const saved = (): LibraryIndexSnapshot => ({ visits: [toVisitSummary(visit)], covers: [], revision: 1 })
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
const mapStub = defineComponent({ name: 'FootprintMap', props: ['recordIndex', 'covers', 'revision', 'query', 'geography', 'provinceId'], emits: ['province', 'pick', 'reset'], setup(_, { expose }) {
  expose(mapActions); return () => null
} })
const editorStub = defineComponent({ name: 'MemoryEditor', props: ['open', 'visit', 'provinceId'], emits: ['saved', 'close', 'pick-location', 'location-error'], setup(_, { expose }) {
  expose({ cancelLocationPick() {}, acceptLocation() { return true } }); return () => null
} })
// The loader/IntersectionObserver has its own real tests. At this boundary we
// assert photo references, not fabricate payload-bearing summary records.
const thumbnailStub = defineComponent({ name: 'PhotoThumbnail', props: ['photoId', 'revision'], template: '<span :data-photo-id="photoId" :data-revision="revision" />' })
const photoStub = defineComponent({ name: 'PhotoViewer', props: ['visit', 'index', 'busy', 'status'], emits: ['cover', 'close', 'share'], template: '<div />' })
const cardStub = defineComponent({ name: 'MemoryCard', props: ['visit', 'placeName', 'selectedPhotoId', 'renderCard'], emits: ['close'], template: '<div />' })
let wrapper: ReturnType<typeof mount> | undefined
const start = async () => {
  wrapper = mount(App, { attachTo: document.body, global: { stubs: { FootprintMap: mapStub,
    MemoryEditor: editorStub, PhotoViewer: photoStub, MemoryCard: cardStub, PhotoThumbnail: thumbnailStub, BackupPanel: true } } })
  await flushPromises(); return wrapper
}
const button = (name: string) => wrapper!.findAll('button').find(node => node.text() === name)!
beforeEach(() => {
  Object.values(repository).forEach(mock => mock.mockReset())
  geographyLoader.mockReset().mockResolvedValue(yunnanBoundary)
  Object.values(mapActions).forEach(mock => mock.mockReset())
  repository.load.mockRejectedValue(new Error('Full load is forbidden on ordinary UI paths'))
  repository.loadDraft.mockRejectedValue(new Error('Startup must only count drafts'))
  repository.hasDraft.mockResolvedValue(false); repository.close.mockResolvedValue(undefined)
  repository.readVisit.mockResolvedValue(structuredClone(visit))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})

describe('national map scope and asynchronous geography boundaries', () => {
  const choose = async (id: string) => { await wrapper!.get('select[aria-label="选择省份或地区"]').setValue(id); await flushPromises() }
  it('starts with all 34 boundaries and loads detailed Yunnan only on entering that province', async () => {
    repository.loadIndex.mockResolvedValue(empty()); await start()
    expect(wrapper!.findComponent(mapStub).props('geography').features).toHaveLength(34)
    expect(geographyLoader).not.toHaveBeenCalled()
    await choose('cn-51')
    expect(wrapper!.findComponent(mapStub).props('provinceId')).toBe('cn-51')
    expect(wrapper!.text()).toContain('四川的公共景点目录尚在整理')
    expect(geographyLoader).not.toHaveBeenCalled()
    await choose('yunnan')
    expect(geographyLoader).toHaveBeenCalledTimes(1)
    expect(wrapper!.get('select[aria-label="按州市筛选"]').findAll('option')).toHaveLength(17)
  })
  it('does not replace a new province with a delayed result from the previous scope', async () => {
    repository.loadIndex.mockResolvedValue(empty())
    const delayed = deferred<typeof yunnanBoundary>(); geographyLoader.mockReturnValue(delayed.promise)
    await start(); await choose('yunnan'); await choose('cn-11')
    delayed.resolve(yunnanBoundary); await flushPromises()
    const current = wrapper!.findComponent(mapStub).props('geography')
    expect(current.features).toHaveLength(1)
    expect(current.features[0].properties.provinceId).toBe('cn-11')
    expect(wrapper!.text()).not.toContain('正在加载云南')
  })
  it('keeps the chosen boundary and shows retry when the detailed layer fails', async () => {
    repository.loadIndex.mockResolvedValue(empty()); geographyLoader.mockRejectedValueOnce(new Error('unavailable'))
    await start(); await choose('yunnan')
    expect(wrapper!.findComponent(mapStub).props('geography')).toEqual(yunnanBoundary)
    expect(wrapper!.text()).toContain('云南细节暂时无法加载')
    await button('重试地图细节').trigger('click'); await flushPromises()
    expect(geographyLoader).toHaveBeenCalledTimes(2)
    expect(wrapper!.text()).not.toContain('云南细节暂时无法加载')
  })
  it('selects a saved external-province record, and all footprints returns to a cross-province list', async () => {
    const external: Visit = { ...visit, id: 'beijing-memory', placeId: 'custom-beijing', note: '北京手记',
      customPlace: { id: 'custom-beijing', name: '北京庭院', regionId: 'cn-11', coordinates: [116.4, 39.9] } }
    repository.loadIndex.mockResolvedValue({ visits: [toVisitSummary(external), toVisitSummary(visit)], covers: [], revision: 2 })
    await start()
    expect(wrapper!.findAll('.yn-place-row')).toHaveLength(2)
    await wrapper!.get('[aria-label="查看北京庭院，有我的回忆"]').trigger('click'); await flushPromises()
    expect(wrapper!.findComponent(mapStub).props('provinceId')).toBe('cn-11')
    expect(wrapper!.get('.yn-memory-note').text()).toBe('北京手记')
    const selectedOrder = mapActions.selectPlace.mock.invocationCallOrder.at(-1)!
    expect(selectedOrder).toBeGreaterThan(Math.max(0, ...mapActions.fitProvince.mock.invocationCallOrder, ...mapActions.fitPlaces.mock.invocationCallOrder))
    await wrapper!.findAll('.yn-header button').find(node => node.text().startsWith('我的足迹'))!.trigger('click'); await flushPromises()
    expect(wrapper!.findComponent(mapStub).props('provinceId')).toBe('')
    expect(wrapper!.findAll('.yn-place-row')).toHaveLength(2)
    expect(repository.readVisit).not.toHaveBeenCalled()
  })
  it('locks outer geography while picking and exposes a rejected point error above the map', async () => {
    repository.loadIndex.mockResolvedValue(empty()); await start()
    await button('记一下').trigger('click')
    wrapper!.findComponent(editorStub).vm.$emit('pick-location', { id: 'custom-place', name: '测试点', regionId: 'cn-11', coordinates: null })
    await flushPromises()
    expect(wrapper!.findComponent(mapStub).props('provinceId')).toBe('cn-11')
    expect(wrapper!.get('select[aria-label="选择省份或地区"]').attributes('disabled')).toBeDefined()
    wrapper!.findComponent(editorStub).vm.$emit('location-error', '请选择北京轮廓内的位置。'); await flushPromises()
    expect(wrapper!.get('.yn-location-banner [role="alert"]').text()).toBe('请选择北京轮廓内的位置。')
    await button('返回填写').trigger('click'); await flushPromises()
    expect(wrapper!.find('.yn-location-banner').exists()).toBe(false)
    expect(wrapper!.get('select[aria-label="选择省份或地区"]').attributes('disabled')).toBeUndefined()
  })
})
afterEach(() => { wrapper?.unmount(); wrapper = undefined; document.body.innerHTML = ''; vi.unstubAllGlobals() })

describe('App state commit/refresh barriers (repository boundary stub)', () => {
  it('does a new read after a pending pre-save background read; old data is never called refreshed', async () => {
    const old = deferred<LibraryIndexSnapshot>()
    repository.loadIndex.mockResolvedValueOnce(empty()).mockReturnValueOnce(old.promise).mockResolvedValueOnce(saved())
    await start()
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(repository.loadIndex).toHaveBeenCalledTimes(2)
    await button('记一下').trigger('click')
    wrapper!.findComponent(editorStub).vm.$emit('saved', visit, { edited: false })
    await flushPromises()
    expect(wrapper!.get('.yn-storage').text()).not.toContain('回忆已保存')
    old.resolve(empty()); await flushPromises()
    expect(repository.loadIndex).toHaveBeenCalledTimes(3)
    expect(repository.load).not.toHaveBeenCalled()
    expect(wrapper!.get('.yn-memory-note').text()).toBe(visit.note)
    expect(wrapper!.get('.yn-storage').text()).toContain('回忆已保存')
  })
  it('a place-cover save waits for the older read so its result cannot be overwritten by it', async () => {
    const old = deferred<LibraryIndexSnapshot>()
    const cover = { placeId: visit.placeId, visitId: visit.id, photoId: 'b' }
    repository.loadIndex.mockResolvedValueOnce(saved()).mockReturnValueOnce(old.promise).mockResolvedValueOnce({ ...saved(), covers: [cover], revision: 2 })
    repository.setMapCover.mockResolvedValue(cover)
    await start()
    window.dispatchEvent(new Event('focus')); await flushPromises()
    await wrapper!.get('.yn-place-row').trigger('click')
    await wrapper!.get('.yn-memory-cover').trigger('click'); await flushPromises()
    wrapper!.findComponent(photoStub).vm.$emit('cover', 'b'); await flushPromises()
    expect(repository.setMapCover).not.toHaveBeenCalled()
    old.resolve(saved()); await flushPromises()
    expect(repository.setMapCover).toHaveBeenCalledWith('yulong', { visitId: visit.id, photoId: 'b' })
    wrapper!.findComponent(photoStub).vm.$emit('close')
    await button('返回景点列表').trigger('click')
    expect(wrapper!.get('.yn-row-photo [data-photo-id]').attributes('data-photo-id')).toBe('b')
    expect(wrapper!.get('.yn-row-photo [data-revision]').attributes('data-revision')).toBe('2')
    expect(wrapper!.findComponent(mapStub).props('covers')).toEqual([cover])
    expect(wrapper!.findComponent(mapStub).props('revision')).toBe(2)
    expect(wrapper!.findComponent(mapStub).props('recordIndex').get('yulong')[0].photos).toEqual([{ id: 'a', name: '一.jpg' }, { id: 'b', name: '二.jpg' }])
    expect(repository.loadIndex).toHaveBeenCalledTimes(3)
  })
  it('undo uses the actual restored covers when the post-commit reload fails', async () => {
    repository.loadIndex.mockResolvedValueOnce(saved()).mockResolvedValueOnce(empty()).mockRejectedValueOnce(new Error('read failed'))
    const cover = { placeId: visit.placeId, visitId: visit.id, photoId: 'b' }
    repository.deleteVisit.mockResolvedValue({ visit, covers: [cover] })
    repository.restoreVisit.mockResolvedValue({ visit, covers: [cover], coversKept: 0 })
    await start(); await wrapper!.get('.yn-place-row').trigger('click')
    await button('删除').trigger('click'); await flushPromises(); await button('确认删除').trigger('click'); await flushPromises()
    await button('撤销删除').trigger('click'); await flushPromises()
    expect(wrapper!.get('.yn-storage').text()).toContain('回忆已恢复，其他记录暂时无法刷新')
    await button('返回景点列表').trigger('click')
    expect(wrapper!.get('.yn-row-photo [data-photo-id]').attributes('data-photo-id')).toBe('b')
    expect(wrapper!.get('.yn-row-photo [data-revision]').attributes('data-revision')).toBe('-1')
    expect(button('记一下').attributes('disabled')).toBeDefined()
  })
  it('opens a card from the exact visit and defers background reload while selecting public content', async () => {
    repository.loadIndex.mockResolvedValue(saved())
    await start(); await wrapper!.get('.yn-place-row').trigger('click')
    await button('制作回忆卡').trigger('click'); await flushPromises()
    const card = wrapper!.findComponent(cardStub)
    expect(card.props('visit')).toEqual(visit)
    expect(card.props('placeName')).toBe('玉龙雪山')
    expect(card.props('renderCard')).toBeTypeOf('function')
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(repository.loadIndex).toHaveBeenCalledTimes(1)
    card.vm.$emit('close'); await flushPromises()
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(repository.loadIndex).toHaveBeenCalledTimes(2)
  })
  it('closes the photo viewer and passes the currently viewed photo to the card picker', async () => {
    repository.loadIndex.mockResolvedValue(saved())
    await start(); await wrapper!.get('.yn-place-row').trigger('click')
    await wrapper!.get('.yn-memory-cover').trigger('click'); await flushPromises()
    wrapper!.findComponent(photoStub).vm.$emit('share', 'b'); await flushPromises()
    expect(wrapper!.findComponent(photoStub).props('visit')).toBeNull()
    expect(wrapper!.findComponent(cardStub).props('selectedPhotoId')).toBe('b')
    expect(wrapper!.findComponent(cardStub).props('visit')).toEqual(visit)
    expect(repository.readVisit).toHaveBeenCalledTimes(1)
  })
  it('cannot start another editor while an editor is open for map picking', async () => {
    repository.loadIndex.mockResolvedValue(empty())
    await start(); await button('记一下').trigger('click')
    expect(wrapper!.findComponent(editorStub).props('open')).toBe(true)
    expect(button('记一下').attributes('disabled')).toBeDefined()
    expect(button('没有这个地点？自己记一个').attributes('disabled')).toBeDefined()
  })
  it('startup/search/background refresh read only summaries and draft existence, then editing reads one full record', async () => {
    repository.loadIndex.mockResolvedValue(saved()); repository.hasDraft.mockResolvedValue(true)
    await start()
    expect(button('继续草稿')).toBeDefined()
    expect(repository.readVisit).not.toHaveBeenCalled()
    window.dispatchEvent(new Event('focus')); await flushPromises()
    await wrapper!.get('.yn-place-row').trigger('click')
    expect(repository.readVisit).not.toHaveBeenCalled()
    await button('编辑').trigger('click'); await flushPromises()
    expect(repository.readVisit).toHaveBeenCalledExactlyOnceWith(visit.id, { expectedRevision: 1, signal: expect.any(AbortSignal) })
    expect(wrapper!.findComponent(editorStub).props('visit')).toEqual(visit)
    expect(repository.load).not.toHaveBeenCalled(); expect(repository.loadDraft).not.toHaveBeenCalled()
    wrapper!.findComponent(editorStub).vm.$emit('close'); await flushPromises()
    expect(wrapper!.findComponent(editorStub).props('visit')).toBeNull()
  })
  it.each(['cancel', 'back', 'filter', 'unmount'])('ignores a delayed photo open after %s and aborts the read', async mode => {
    repository.loadIndex.mockResolvedValue(saved())
    const pending = deferred<Visit | null>(); repository.readVisit.mockReturnValue(pending.promise)
    await start(); await wrapper!.get('.yn-place-row').trigger('click')
    await wrapper!.get('.yn-memory-cover').trigger('click'); await flushPromises()
    const signal = repository.readVisit.mock.calls[0]![1].signal as AbortSignal
    expect(wrapper!.text()).toContain('正在打开这次回忆')
    window.dispatchEvent(new Event('focus')); await flushPromises()
    expect(repository.loadIndex).toHaveBeenCalledTimes(1)
    if (mode === 'cancel') await button('取消打开').trigger('click')
    if (mode === 'back') await button('返回景点列表').trigger('click')
    if (mode === 'filter') { wrapper!.findComponent({ name: 'SearchToolbar' }).vm.$emit('update:query', '别的回忆'); await flushPromises() }
    if (mode === 'unmount') { wrapper!.unmount(); wrapper = undefined }
    expect(signal.aborted).toBe(true)
    pending.resolve(visit); await flushPromises()
    if (wrapper) expect(wrapper.findComponent(photoStub).props('visit')).toBeNull()
  })
  it.each(['missing', 'stale', 'failed'])('preserves metadata and requires refresh instead of opening a %s record', async failure => {
    repository.loadIndex.mockResolvedValue(saved())
    if (failure === 'missing') repository.readVisit.mockResolvedValue(null)
    else repository.readVisit.mockRejectedValue(Object.assign(new Error('read failed'), { code: failure }))
    await start(); await wrapper!.get('.yn-place-row').trigger('click')
    await button('编辑').trigger('click'); await flushPromises()
    expect(wrapper!.findComponent(editorStub).props('open')).toBe(false)
    expect(wrapper!.get('.yn-memory-note').text()).toBe(visit.note)
    expect(wrapper!.get('.yn-storage').text()).toContain('重新读取')
    expect(button('编辑').attributes('disabled')).toBeDefined()
    repository.readVisit.mockResolvedValue(visit)
    await button('重新读取').trigger('click'); await flushPromises()
    await button('编辑').trigger('click'); await flushPromises()
    expect(wrapper!.findComponent(editorStub).props('visit')).toEqual(visit)
  })
  it('fallback after a successful save keeps only whitelisted summary fields, then can reload safely', async () => {
    repository.loadIndex.mockResolvedValueOnce(empty()).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(saved())
    const raw = { ...visit, extension: { privatePhoto: visit.photos[0]!.url } }
    await start(); await button('记一下').trigger('click')
    wrapper!.findComponent(editorStub).vm.$emit('saved', raw, { edited: false }); await flushPromises()
    const rows = wrapper!.findComponent({ name: 'PlaceDetail' }).props('visits')
    expect(rows).toEqual([toVisitSummary(visit)])
    expect(JSON.stringify(rows)).not.toContain('data:image')
    expect(button('编辑').attributes('disabled')).toBeDefined()
    await button('重新读取').trigger('click'); await flushPromises()
    expect(button('编辑').attributes('disabled')).toBeUndefined()
  })
})
