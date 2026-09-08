import { mount, flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhotoViewer from '../src/components/PhotoViewer.vue'
import PlaceList from '../src/components/PlaceList.vue'
import { publicPlaces } from '../src/domain/catalogue'
import { indexVisits } from '../src/domain/map-layout'
import type { Visit, VisitSummary } from '../src/domain/models'
import { createPhotoLoader, PHOTO_LOADER_KEY } from '../src/services/photo-loader'

const first: Visit = { id: 'first', createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '热豆浆',
  photos: [{ id: 'a', name: '一.jpg', url: 'data:image/jpeg;base64,/9j/4AAAAAA=' }, { id: 'b', name: '二.jpg', url: 'data:image/jpeg;base64,/9j/4AAAAAE=' }], coverId: 'a' }
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.setAttribute('open', '') }) })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: vi.fn(function(this: HTMLDialogElement) { this.removeAttribute('open') }) })
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('Vue photo viewer and place covers (dialog platform stub, not image decode)', () => {
  it('opens at the chosen photo, advances by keyboard and emits the exact cover photo', async () => {
    const wrapper = mount(PhotoViewer, { props: { visit: first, index: 1 } })
    await flushPromises()
    expect(wrapper.get('dialog').attributes('open')).toBe('')
    expect(wrapper.get('img').attributes('alt')).toBe('二.jpg')
    await wrapper.get('dialog').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.get('img').attributes('alt')).toBe('一.jpg')
    await wrapper.findAll('button').find(button => button.text() === '用作地点封面')!.trigger('click')
    expect(wrapper.emitted('cover')).toEqual([['a']])
    wrapper.unmount()
  })
  it('keeps current photo and dialog while a cover transaction is unresolved', async () => {
    const wrapper = mount(PhotoViewer, { props: { visit: first, index: 0, busy: true } })
    await flushPromises()
    await wrapper.get('dialog').trigger('cancel')
    await wrapper.get('dialog').trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.get('img').attributes('alt')).toBe('一.jpg')
    await wrapper.setProps({ busy: false }); await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toHaveLength(1)
    wrapper.unmount()
  })
  it('shows image failure without deleting data and disables choosing an unreadable cover', async () => {
    const wrapper = mount(PhotoViewer, { props: { visit: first, index: 0 } })
    await wrapper.get('img').trigger('error')
    expect(wrapper.get('[role="alert"]').text()).toContain('回忆没有被删除')
    expect(wrapper.findAll('button').find(button => button.text() === '用作地点封面')!.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').find(button => button.text() === '用这张制作回忆卡')!.attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })
  it('shares the current photo identity and leaves the visit unchanged', async () => {
    const wrapper = mount(PhotoViewer, { props: { visit: first, index: 1 } })
    const original = structuredClone(first)
    await flushPromises()
    await wrapper.findAll('button').find(button => button.text() === '用这张制作回忆卡')!.trigger('click')
    expect(wrapper.emitted('share')).toEqual([['b']])
    expect(first).toEqual(original)
    wrapper.unmount()
  })
  it('uses the selected place cover except when a search matches a different memory', async () => {
    const second: Visit = { ...first, id: 'second', date: '2025-01-02', note: '雪山合照', photos: [{ id: 'c', name: '三.jpg', url: 'data:image/jpeg;base64,/9j/4AAAAAI=' }], coverId: 'c' }
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private callback: IntersectionObserverCallback) {}
      observe(target: Element) { queueMicrotask(() => this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)) }
      disconnect() {}
    })
    const summary = (visit: Visit): VisitSummary => ({ ...visit, photos: visit.photos.map(({ id, name }) => ({ id, name })) })
    const readVisit = vi.fn(async (id: string) => [first, second].find(visit => visit.id === id) ?? null)
    const loader = createPhotoLoader({ readVisit })
    const wrapper = mount(PlaceList, { props: { places: [publicPlaces.find(place => place.id === 'yulong')!],
      recordIndex: indexVisits([summary(first), summary(second)]), covers: [{ placeId: 'yulong', visitId: 'first', photoId: 'b' }], revision: 1,
      query: '', limit: 12, hasFilters: false, visitedOnly: true }, global: { provide: { [PHOTO_LOADER_KEY as symbol]: loader } } })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe(first.photos[1]!.url)
    expect(readVisit).toHaveBeenCalledWith('first', { expectedRevision: 1, signal: expect.any(AbortSignal) })
    await wrapper.setProps({ query: '雪山合照' })
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe(second.photos[0]!.url)
    expect(readVisit).toHaveBeenCalledWith('second', { expectedRevision: 1, signal: expect.any(AbortSignal) })
    expect(readVisit).toHaveBeenCalledTimes(2)
    wrapper.unmount(); loader.close()
  })
})
