import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import PhotoThumbnail from '../src/components/PhotoThumbnail.vue'
import { PHOTO_LOADER_KEY, type PhotoLoader } from '../src/services/photo-loader'
import type { Photo } from '../src/domain/models'

class Observer {
  static instances: Observer[] = []
  targets = new Set<Element>()
  disconnect = vi.fn(() => this.targets.clear())
  observe = vi.fn((target: Element) => this.targets.add(target))
  constructor(private readonly callback: IntersectionObserverCallback, readonly options: IntersectionObserverInit) { Observer.instances.push(this) }
  visible(value: boolean) { this.callback([...this.targets].map(target => ({ target, isIntersecting: value }) as IntersectionObserverEntry), this as unknown as IntersectionObserver) }
  crossings(values: boolean[]) { this.callback([...this.targets].flatMap(target => values.map(isIntersecting => ({ target, isIntersecting }) as IntersectionObserverEntry)), this as unknown as IntersectionObserver) }
}
const photo: Photo = { id: 'photo-one', name: '本地照片.jpg', url: 'data:image/jpeg;base64,AA==' }
const wrappers: VueWrapper[] = []
function harness(load: PhotoLoader['load'] = async () => photo) {
  const loader: PhotoLoader = { load: vi.fn(load), clear: vi.fn(), close: vi.fn() }
  const wrapper = mount(PhotoThumbnail, { props: { visitId: 'one', photoId: photo.id, revision: 4, alt: '雪山的回忆封面' }, global: { provide: { [PHOTO_LOADER_KEY as symbol]: loader } } })
  wrappers.push(wrapper)
  return { wrapper, loader, observer: Observer.instances.at(-1)! }
}
beforeEach(() => { Observer.instances.length = 0; vi.stubGlobal('IntersectionObserver', Observer) })
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('visible-only photo frame', () => {
  it('does not load offscreen photos; shows a stable placeholder until the actual image decodes', async () => {
    const { wrapper, loader, observer } = harness()
    expect(loader.load).not.toHaveBeenCalled(); expect(wrapper.find('img').exists()).toBe(false)
    expect(observer.options).toEqual({ rootMargin: '0px', threshold: 0 })
    observer.visible(true); await flushPromises()
    expect(loader.load).toHaveBeenCalledExactlyOnceWith('one', photo.id, 4, expect.any(AbortSignal))
    expect(wrapper.attributes('aria-busy')).toBe('true')
    expect(wrapper.text()).toBe('照片加载中')
    expect(wrapper.get('img').attributes()).toMatchObject({ src: photo.url, alt: '雪山的回忆封面', decoding: 'async' })
    await wrapper.get('img').trigger('load')
    expect(wrapper.attributes('aria-busy')).toBeUndefined(); expect(wrapper.text()).toBe('')
  })
  it('releases the DOM image on leaving the viewport and asks the bounded loader on re-entry', async () => {
    const { wrapper, loader, observer } = harness()
    observer.visible(true); await flushPromises(); await wrapper.get('img').trigger('load')
    observer.visible(false); await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.attributes('data-state')).toBe('idle')
    observer.visible(true); await flushPromises()
    expect(loader.load).toHaveBeenCalledTimes(2)
    expect(loader.clear).not.toHaveBeenCalled() // shared cache belongs to App
  })
  it('aborts an invisible pending read and ignores a late result', async () => {
    let resolve!: (photo: Photo) => void
    const { wrapper, loader, observer } = harness(() => new Promise<Photo>(yes => { resolve = yes }))
    observer.visible(true); await flushPromises()
    const signal = vi.mocked(loader.load).mock.calls[0]![3]!
    observer.visible(false); await flushPromises()
    expect(signal.aborted).toBe(true)
    resolve(photo); await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.attributes('data-state')).toBe('idle')
  })
  it('reloads a changed photo identity or revision and prevents an older response replacing it', async () => {
    let old!: (photo: Photo) => void
    const { wrapper, loader, observer } = harness((visitId, photoId) => visitId === 'one' ? new Promise<Photo>(yes => { old = yes }) : Promise.resolve({ ...photo, id: photoId, url: 'data:image/jpeg;base64,BB==' }))
    observer.visible(true); await flushPromises()
    const signal = vi.mocked(loader.load).mock.calls[0]![3]!
    await wrapper.setProps({ visitId: 'two', photoId: 'two-photo', revision: 5 }); await flushPromises()
    expect(signal.aborted).toBe(true)
    expect(loader.load).toHaveBeenLastCalledWith('two', 'two-photo', 5, expect.any(AbortSignal))
    old(photo); await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe('data:image/jpeg;base64,BB==')
    await wrapper.setProps({ revision: 6 }); await flushPromises()
    expect(loader.load).toHaveBeenLastCalledWith('two', 'two-photo', 6, expect.any(AbortSignal))
  })
  it('uses the final visibility crossing when the observer delivers multiple entries together', async () => {
    const { wrapper, loader, observer } = harness()
    observer.crossings([false, true]); await flushPromises()
    expect(loader.load).toHaveBeenCalledOnce(); expect(wrapper.find('img').exists()).toBe(true)
    observer.crossings([true, false]); await flushPromises()
    expect(wrapper.find('img').exists()).toBe(false)
  })
  it('does not let a detached image with the same URL change the replacement image state', async () => {
    const { wrapper, observer } = harness()
    observer.visible(true); await flushPromises()
    const oldImage = wrapper.get('img').element
    observer.visible(false); await flushPromises()
    observer.visible(true); await flushPromises()
    expect(wrapper.get('img').element).not.toBe(oldImage)
    oldImage.dispatchEvent(new Event('error'))
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe(photo.url)
    oldImage.dispatchEvent(new Event('load'))
    await flushPromises()
    expect(wrapper.attributes('data-state')).toBe('loading')
    await wrapper.get('img').trigger('load')
    expect(wrapper.attributes('data-state')).toBe('ready')
  })
  it('shows actionable failure text for repository or browser decode failures', async () => {
    const readFailure = harness(async () => { throw new Error('read failed') })
    readFailure.observer.visible(true); await flushPromises()
    expect(readFailure.wrapper.text()).toBe('照片未载入，点开重试')
    expect(readFailure.wrapper.attributes('aria-busy')).toBeUndefined()
    const decodeFailure = harness()
    decodeFailure.observer.visible(true); await flushPromises(); await decodeFailure.wrapper.get('img').trigger('error')
    expect(decodeFailure.wrapper.text()).toBe('照片未载入，点开重试')
    expect(decodeFailure.wrapper.find('img').exists()).toBe(false)
    expect(decodeFailure.wrapper.find('button').exists()).toBe(false) // no nested interactive element
  })
  it('disconnects the observer, cancels outstanding work and ignores settlement after unmount', async () => {
    let resolve!: (photo: Photo) => void
    const { wrapper, loader, observer } = harness(() => new Promise<Photo>(yes => { resolve = yes }))
    observer.visible(true); await flushPromises()
    const signal = vi.mocked(loader.load).mock.calls[0]![3]!
    wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(observer.disconnect).toHaveBeenCalledOnce(); expect(signal.aborted).toBe(true)
    resolve(photo); await flushPromises()
    expect(loader.close).not.toHaveBeenCalled()
  })
  it('keeps a readable fallback when visibility observation or loader is unavailable', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    const { wrapper, loader } = harness()
    await wrapper.setProps({ compact: true })
    expect(wrapper.text()).toBe('点开查看'); expect(loader.load).not.toHaveBeenCalled()
    expect(wrapper.get('.yn-photo-placeholder').attributes('title')).toContain('照片未载入')
    await wrapper.setProps({ revision: 7 })
    expect(wrapper.text()).toBe('点开查看'); expect(loader.load).not.toHaveBeenCalled()
    vi.stubGlobal('IntersectionObserver', Observer)
    const missing = mount(PhotoThumbnail, { props: { visitId: 'one', photoId: photo.id, revision: 1, alt: '本地照片' } }); wrappers.push(missing)
    Observer.instances.at(-1)!.visible(true); await flushPromises()
    expect(missing.text()).toBe('照片未载入，点开重试')
  })
})
