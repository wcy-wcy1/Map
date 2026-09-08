import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMapPhotoCover } from '../src/map/photo-cover'
import type { Photo } from '../src/domain/models'
import type { PhotoLoader } from '../src/services/photo-loader'

const observers: TestObserver[] = []
class TestObserver {
  target!: Element
  disconnected = false
  constructor(readonly callback: IntersectionObserverCallback) { observers.push(this) }
  observe(target: Element) { this.target = target }
  disconnect() { this.disconnected = true }
  cross(...visible: boolean[]) {
    this.callback(visible.map(isIntersecting => ({ target: this.target, isIntersecting } as IntersectionObserverEntry)), this as unknown as IntersectionObserver)
  }
}
const reference = { visitId: 'visit', photoId: 'chosen', photoCount: 3 }
const photo: Photo = { id: 'chosen', name: '封面.jpg', url: 'data:image/jpeg;base64,AA==' }
const views: ReturnType<typeof createMapPhotoCover>[] = []
let loader: PhotoLoader
function render(count = 3, revision = 2) {
  const view = createMapPhotoCover({ ...reference, photoCount: count }, revision, loader)
  views.push(view); document.body.append(view.element); return view
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
const settle = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => {
  observers.length = 0
  vi.stubGlobal('IntersectionObserver', TestObserver)
  loader = { load: vi.fn().mockResolvedValue(photo), clear: vi.fn(), close: vi.fn() }
})
afterEach(() => { views.splice(0).forEach(view => view.dispose()); document.body.replaceChildren(); vi.unstubAllGlobals() })

describe('map cover borrowed-photo lifecycle', () => {
  it('reads only a visible cover by its selected reference/revision, with no eager image bytes', async () => {
    const { element } = render()
    expect(loader.load).not.toHaveBeenCalled(); expect(element.querySelector('img')).toBeNull()
    observers[0]!.cross(true); await settle()
    expect(loader.load).toHaveBeenCalledExactlyOnceWith('visit', 'chosen', 2, expect.any(AbortSignal))
    const image = element.querySelector('img')!
    expect(image.src).toBe(photo.url)
    expect(element.dataset.state).toBe('loading')
    image.dispatchEvent(new Event('load'))
    expect(element.dataset.state).toBe('ready')
    expect(image.alt).toBe(''); expect(element.getAttribute('aria-hidden')).toBe('true')
  })
  it('releases image sources offscreen and reuses the shared loader when visible again', async () => {
    const { element } = render()
    observers[0]!.cross(true); await settle()
    const image = element.querySelector('img')!
    observers[0]!.cross(false)
    expect(image.getAttribute('src')).toBeNull(); expect(element.querySelector('img')).toBeNull()
    expect(element.dataset.state).toBe('idle')
    observers[0]!.cross(true); await settle()
    expect(loader.load).toHaveBeenCalledTimes(2)
    expect(loader.clear).not.toHaveBeenCalled(); expect(loader.close).not.toHaveBeenCalled()
  })
  it('aborts a pending read on leaving the viewport and ignores its late success', async () => {
    const pending = deferred<Photo>(); vi.mocked(loader.load).mockReturnValue(pending.promise)
    const { element } = render()
    observers[0]!.cross(true)
    const signal = vi.mocked(loader.load).mock.calls[0]![3]!
    observers[0]!.cross(false)
    expect(signal.aborted).toBe(true)
    pending.resolve(photo); await settle()
    expect(element.querySelector('img')).toBeNull(); expect(element.dataset.state).toBe('idle')
  })
  it('uses the last visibility crossing, not an earlier intersecting event', async () => {
    render(); observers[0]!.cross(true, false); await settle()
    expect(loader.load).not.toHaveBeenCalled()
    observers[0]!.cross(false, true); await settle()
    expect(loader.load).toHaveBeenCalledTimes(1)
  })
  it('ignores a replaced request when a newer visibility request is already ready', async () => {
    const old = deferred<Photo>(); vi.mocked(loader.load).mockReturnValueOnce(old.promise)
    const { element } = render()
    observers[0]!.cross(true); observers[0]!.cross(false); observers[0]!.cross(true); await settle()
    old.resolve({ ...photo, url: 'data:image/jpeg;base64,OLD=' }); await settle()
    expect(element.querySelector('img')?.src).toBe(photo.url)
  })
  it('shows a non-blocking fallback on read failure without removing the parent marker', async () => {
    vi.mocked(loader.load).mockRejectedValue(new Error('stale revision'))
    const { element } = render(); observers[0]!.cross(true); await settle()
    expect(element.dataset.state).toBe('error'); expect(element.title).toContain('点击地标查看回忆')
    expect(element.querySelector('img')).toBeNull()
  })
  it('releases a broken image and ignores late load events from the detached element', async () => {
    const { element } = render(); observers[0]!.cross(true); await settle()
    const image = element.querySelector('img')!
    image.dispatchEvent(new Event('error')); image.dispatchEvent(new Event('load'))
    expect(element.dataset.state).toBe('error'); expect(image.getAttribute('src')).toBeNull()
    expect(element.querySelector('img')).toBeNull()
  })
  it('does not falsely stack one photo, caps paper layers and remains text safe', () => {
    expect(render(1).element.dataset.layers).toBe('1')
    expect(render(2).element.dataset.layers).toBe('2')
    expect(render(999).element.dataset.layers).toBe('3')
    expect(render().element.innerHTML).not.toContain('src=')
  })
  it('does not eagerly load when visibility support is absent or revision is invalid', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    expect(render().element.dataset.state).toBe('error')
    vi.stubGlobal('IntersectionObserver', TestObserver)
    const invalid = render(1, -1); observers[0]!.cross(true); await settle()
    expect(invalid.element.dataset.state).toBe('error'); expect(loader.load).not.toHaveBeenCalled()
  })
  it('disconnects, aborts and ignores both late observer notifications and late read success after dispose', async () => {
    const pending = deferred<Photo>(); vi.mocked(loader.load).mockReturnValue(pending.promise)
    const view = render(); observers[0]!.cross(true)
    const signal = vi.mocked(loader.load).mock.calls[0]![3]!
    view.dispose(); pending.resolve(photo); observers[0]!.cross(true); await settle()
    expect(observers[0]!.disconnected).toBe(true); expect(signal.aborted).toBe(true)
    expect(view.element.querySelector('img')).toBeNull(); expect(loader.load).toHaveBeenCalledTimes(1)
  })
})
