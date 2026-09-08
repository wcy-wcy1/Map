import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, toRaw } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCatalogue } from '../src/domain/catalogue'
import { toVisitSummary } from '../src/domain/visit-summary'
import type { LibraryIndexSnapshot, Visit } from '../src/domain/models'
import type { LocalRepository } from '../src/services/contracts'
import type { TravelServices } from '../src/services/travel-services'

const localFactory = vi.hoisted(() => vi.fn())
vi.mock('../src/services/travel-services', async original => ({
  ...await original<typeof import('../src/services/travel-services')>(), createTravelServices: localFactory,
}))
vi.mock('../src/services/geography-service', () => ({ createGeographyService: () => ({
  base: () => ({ type: 'FeatureCollection', features: [] }),
  load: async () => ({ type: 'FeatureCollection', features: [] }), close: vi.fn(),
}) }))
import App from '../src/App.vue'

const visit: Visit = { id: 'account-visit', createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '账号中的合成回忆',
  photos: [{ id: 'photo-one', name: '合成.jpg', url: 'data:image/jpeg;base64,/9j/4AAAAAA=' }], coverId: 'photo-one' }
const empty = (): LibraryIndexSnapshot => ({ visits: [], covers: [], revision: 0 })
const saved = (): LibraryIndexSnapshot => ({ visits: [toVisitSummary(visit)], covers: [], revision: 1 })
function harness(index = empty()) {
  const repository = {
    loadIndex: vi.fn().mockResolvedValue(index), hasDraft: vi.fn().mockResolvedValue(false), close: vi.fn().mockResolvedValue(undefined),
    readVisit: vi.fn().mockResolvedValue(structuredClone(visit)), load: vi.fn(), loadDraft: vi.fn(),
    deleteVisit: vi.fn().mockResolvedValue({ visit, covers: [] }), restoreVisit: vi.fn().mockResolvedValue({ visit, covers: [], coversKept: 0 }),
  }
  const catalogue = createCatalogue()
  // Only App's repository boundary is stubbed; no HTTP, database or photo decode claim.
  const services = { catalogue, repository: repository as unknown as LocalRepository } as TravelServices
  return { repository, services, catalogue }
}
const mapStub = defineComponent({ name: 'FootprintMap', props: ['recordIndex'], setup(_, { expose }) {
  expose({ fitProvince() {}, fitPlaces() {}, selectPlace() {} }); return () => null
} })
const editorStub = defineComponent({ name: 'MemoryEditor', props: ['open', 'visit', 'repository', 'catalogue', 'accountMode'], emits: ['close', 'saved', 'busy', 'pick-location'], setup(_, { expose }) {
  expose({ cancelLocationPick() {}, acceptLocation() { return true } }); return () => null
} })
const photoStub = defineComponent({ name: 'PhotoViewer', props: ['visit'], emits: ['close'], template: '<span />' })
const cardStub = defineComponent({ name: 'MemoryCard', props: ['visit'], emits: ['close'], template: '<span />' })
const backupStub = defineComponent({ name: 'BackupPanel', props: ['services'], template: '<div data-backup-panel />' })
const thumbnailStub = defineComponent({ name: 'PhotoThumbnail', template: '<span />' })
const wrappers: VueWrapper[] = []
async function start(props: { services?: TravelServices; mode?: 'account' | 'local' } = {}) {
  const wrapper = mount(App, { attachTo: document.body, props, global: { stubs: {
    FootprintMap: mapStub, MemoryEditor: editorStub, PhotoViewer: photoStub, MemoryCard: cardStub, BackupPanel: backupStub, PhotoThumbnail: thumbnailStub,
  } } })
  wrappers.push(wrapper); await flushPromises(); return wrapper
}
function button(wrapper: VueWrapper, text: string) { const found = wrapper.findAll('button').find(node => node.text() === text); expect(found, `button ${text}`).toBeDefined(); return found! }
const lastInteraction = (wrapper: VueWrapper) => wrapper.emitted('interaction')?.at(-1)?.[0]
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
beforeEach(() => {
  localFactory.mockReset().mockImplementation(() => harness().services)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = ''; vi.unstubAllGlobals() })

describe('App account integration at the injected repository boundary', () => {
  it('uses the injected repository and catalogue without opening anonymous services', async () => {
    const h = harness(saved()), wrapper = await start({ services: h.services, mode: 'account' })
    expect(localFactory).not.toHaveBeenCalled()
    expect(h.repository.loadIndex).toHaveBeenCalledOnce(); expect(h.repository.hasDraft).toHaveBeenCalledOnce()
    expect(h.repository.load).not.toHaveBeenCalled(); expect(h.repository.loadDraft).not.toHaveBeenCalled()
    expect(toRaw(wrapper.findComponent(editorStub).props('repository'))).toBe(h.services.repository)
    expect(toRaw(wrapper.findComponent(editorStub).props('catalogue'))).toBe(h.catalogue)
    expect(wrapper.findComponent(editorStub).props('accountMode')).toBe(true)
    expect(wrapper.get('.yn-storage').text()).toContain('账号资料 · 已找回 1 条记录')
    expect(wrapper.text()).toContain('保存时会上传照片副本和手记')
    expect(wrapper.text()).not.toContain('照片和手记不上传')
    expect(wrapper.findComponent(backupStub).exists()).toBe(false)
    expect(wrapper.get('nav').findAll('button').some(node => node.text() === '备份')).toBe(false)
  })
  it('deletes through the account repository without advertising or invoking local undo', async () => {
    const h = harness(saved())
    h.repository.loadIndex.mockResolvedValueOnce(saved()).mockResolvedValue(empty())
    const wrapper = await start({ services: h.services, mode: 'account' })
    await wrapper.get('.yn-place-row').trigger('click'); await button(wrapper, '删除').trigger('click'); await flushPromises()
    expect(wrapper.get('[aria-labelledby="yn-delete-title"]').text()).toContain('账号模式暂不支持撤销')
    expect(lastInteraction(wrapper)).toBe(true)
    await button(wrapper, '确认删除').trigger('click'); await flushPromises()
    expect(h.repository.deleteVisit).toHaveBeenCalledExactlyOnceWith(visit.id, { expectedVisit: visit })
    expect(wrapper.get('.yn-storage').text()).toContain('账号中的回忆已删除')
    expect(wrapper.find('.yn-undo').exists()).toBe(false)
    expect(wrapper.findAll('button').some(node => node.text() === '撤销删除')).toBe(false)
    expect(h.repository.restoreVisit).not.toHaveBeenCalled(); expect(lastInteraction(wrapper)).toBe(false)
    expect(localFactory).not.toHaveBeenCalled()
  })
  it('keeps the default local entry, backup panel, non-upload copy and undo', async () => {
    const h = harness(saved()); localFactory.mockReturnValue(h.services)
    h.repository.loadIndex.mockResolvedValueOnce(saved()).mockResolvedValueOnce(empty()).mockResolvedValue(saved())
    const wrapper = await start()
    expect(localFactory).toHaveBeenCalledOnce()
    expect(wrapper.findComponent(backupStub).exists()).toBe(true)
    expect(wrapper.findComponent(editorStub).props('accountMode')).toBe(false)
    expect(wrapper.get('.yn-storage').text()).toContain('本机保存')
    await wrapper.get('.yn-place-row').trigger('click'); await button(wrapper, '删除').trigger('click'); await flushPromises()
    await button(wrapper, '确认删除').trigger('click'); await flushPromises()
    expect(wrapper.get('.yn-storage').text()).toContain('可撤销最近一次删除')
    await button(wrapper, '撤销删除').trigger('click'); await flushPromises()
    expect(h.repository.restoreVisit).toHaveBeenCalledOnce()
    expect(wrapper.get('.yn-storage').text()).toContain('已恢复这次回忆')
  })
  it('keeps the empty default local non-upload promise', async () => {
    const wrapper = await start()
    expect(wrapper.get('.yn-storage').text()).toContain('本机保存 · 照片和手记不上传')
    expect(button(wrapper, '备份')).toBeDefined()
  })
  it('signals editor, photo, card and pending read interaction and exposes explicit refresh', async () => {
    const h = harness(saved()), wrapper = await start({ services: h.services, mode: 'account' })
    expect(lastInteraction(wrapper)).toBe(false)
    await button(wrapper, '记一下').trigger('click'); expect(lastInteraction(wrapper)).toBe(true)
    wrapper.findComponent(editorStub).vm.$emit('close'); await flushPromises(); expect(lastInteraction(wrapper)).toBe(false)
    await wrapper.get('.yn-place-row').trigger('click')
    let release!: (value: Visit) => void
    h.repository.readVisit.mockReturnValueOnce(new Promise<Visit>(resolve => { release = resolve }))
    await wrapper.get('.yn-memory-cover').trigger('click'); await flushPromises(); expect(lastInteraction(wrapper)).toBe(true)
    release(visit); await flushPromises(); expect(wrapper.findComponent(photoStub).props('visit')).toEqual(visit)
    wrapper.findComponent(photoStub).vm.$emit('close'); await flushPromises(); expect(lastInteraction(wrapper)).toBe(false)
    await button(wrapper, '制作回忆卡').trigger('click'); await flushPromises(); expect(lastInteraction(wrapper)).toBe(true)
    wrapper.findComponent(cardStub).vm.$emit('close'); await flushPromises(); expect(lastInteraction(wrapper)).toBe(false)
    const before = h.repository.loadIndex.mock.calls.length
    const exposed = wrapper.vm as unknown as { refresh(): Promise<boolean> }
    expect(await exposed.refresh()).toBe(true); expect(h.repository.loadIndex).toHaveBeenCalledTimes(before + 1)
  })
  it.each(['account', 'local'] as const)('refreshes %s summaries after user closes a retained draft, removing externally deleted records', async mode => {
    const h = harness(saved()), pending = deferred<LibraryIndexSnapshot>()
    const wrapper = await start({ services: h.services, mode })
    await wrapper.get('.yn-place-row').trigger('click'); await button(wrapper, '编辑').trigger('click'); await flushPromises()
    expect(wrapper.findComponent(editorStub).props('open')).toBe(true)
    h.repository.loadIndex.mockReturnValueOnce(pending.promise); h.repository.hasDraft.mockResolvedValue(true)
    wrapper.findComponent(editorStub).vm.$emit('close'); await flushPromises()
    expect(h.repository.loadIndex).toHaveBeenCalledTimes(2)
    expect(wrapper.findComponent(editorStub).props('open')).toBe(false)
    expect(wrapper.get('.yn-storage').text()).toContain('正在重新读取')
    expect(button(wrapper, '记一下').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '编辑').attributes('disabled')).toBeDefined()
    pending.resolve({ ...empty(), revision: 2 }); await flushPromises()
    expect((wrapper.findComponent(mapStub).props('recordIndex') as Map<string, unknown>).size).toBe(0)
    expect(wrapper.text()).not.toContain(visit.note)
    expect(wrapper.findAll('button').some(node => node.text() === '编辑')).toBe(false)
    expect(button(wrapper, '继续草稿').attributes('disabled')).toBeUndefined()
    expect(h.repository.deleteVisit).not.toHaveBeenCalled()
    expect(localFactory).not.toHaveBeenCalled()
  })
  it('keeps stale record actions disabled when the close refresh fails and permits an explicit read retry', async () => {
    const h = harness(saved()), wrapper = await start({ services: h.services, mode: 'account' })
    await wrapper.get('.yn-place-row').trigger('click'); await button(wrapper, '编辑').trigger('click'); await flushPromises()
    h.repository.loadIndex.mockRejectedValueOnce(new Error('synthetic close refresh failure'))
    wrapper.findComponent(editorStub).vm.$emit('close'); await flushPromises()
    expect(wrapper.get('.yn-storage').attributes('data-error')).toBe('true')
    expect(wrapper.get('.yn-storage').text()).toContain('请重新读取')
    expect(button(wrapper, '记一下').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '编辑').attributes('disabled')).toBeDefined()
    expect(button(wrapper, '删除').attributes('disabled')).toBeDefined()
    const reads = h.repository.readVisit.mock.calls.length
    await button(wrapper, '编辑').trigger('click'); await flushPromises()
    expect(h.repository.readVisit).toHaveBeenCalledTimes(reads)
    h.repository.loadIndex.mockResolvedValueOnce({ ...empty(), revision: 2 })
    await button(wrapper, '重新读取').trigger('click'); await flushPromises()
    expect(wrapper.text()).not.toContain(visit.note)
    expect(button(wrapper, '记一下').attributes('disabled')).toBeUndefined()
  })
  it('does not apply a delayed close refresh after the account tree is unmounted', async () => {
    const h = harness(saved()), wrapper = await start({ services: h.services, mode: 'account' }), pending = deferred<LibraryIndexSnapshot>()
    const replace = vi.spyOn(h.catalogue, 'replaceCustomPlaces')
    await button(wrapper, '记一下').trigger('click')
    h.repository.loadIndex.mockReturnValueOnce(pending.promise)
    wrapper.findComponent(editorStub).vm.$emit('close'); await flushPromises()
    expect(h.repository.loadIndex).toHaveBeenCalledTimes(2)
    const draftReads = h.repository.hasDraft.mock.calls.length
    wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1)
    pending.resolve({ ...empty(), revision: 2 }); await flushPromises()
    expect(replace).not.toHaveBeenCalled()
    expect(h.repository.hasDraft).toHaveBeenCalledTimes(draftReads)
    expect(h.repository.close).toHaveBeenCalledOnce()
  })
  it('refreshes once when a successful save immediately emits the editor close event', async () => {
    const h = harness(), wrapper = await start({ services: h.services, mode: 'account' }), pending = deferred<LibraryIndexSnapshot>()
    await button(wrapper, '记一下').trigger('click')
    h.repository.loadIndex.mockReturnValueOnce(pending.promise)
    const editor = wrapper.findComponent(editorStub)
    editor.vm.$emit('saved', visit, { edited: false }); editor.vm.$emit('close'); await flushPromises()
    expect(h.repository.loadIndex).toHaveBeenCalledTimes(2)
    pending.resolve(saved()); await flushPromises()
    expect(h.repository.loadIndex).toHaveBeenCalledTimes(2)
    expect(wrapper.get('.yn-storage').text()).toContain('回忆已保存，可以从这个地点再次找回')
  })
})
