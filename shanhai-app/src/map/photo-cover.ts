import type { PhotoLoader } from '../services/photo-loader'

export interface MapCoverReference { visitId: string; photoId: string; photoCount: number }

/** A Leaflet-owned DOM view. It borrows the app's shared loader, never a full
 * library/visit, and releases its image and subscription whenever it leaves view. */
export function createMapPhotoCover(reference: MapCoverReference, revision: number, loader: PhotoLoader | null) {
  const element = document.createElement('span'), face = document.createElement('span'), placeholder = document.createElement('span')
  element.className = 'yn-map-photo'
  element.dataset.visitId = reference.visitId
  element.dataset.photoId = reference.photoId
  element.dataset.revision = String(revision)
  element.dataset.layers = String(Math.min(3, Math.max(1, reference.photoCount)))
  element.setAttribute('aria-hidden', 'true')
  face.className = 'yn-map-photo-face'
  placeholder.className = 'yn-map-photo-placeholder'
  face.append(placeholder); element.append(face)
  let observer: IntersectionObserver | undefined, controller: AbortController | undefined, image: HTMLImageElement | undefined
  let visible = false, disposed = false, request = 0

  function state(value: 'idle' | 'loading' | 'ready' | 'error') {
    element.dataset.state = value
    placeholder.textContent = value === 'error' ? '查看' : '照片'
    element.title = value === 'error' ? '封面未载入，点击地标查看回忆' : `地点封面，共 ${reference.photoCount} 张照片`
  }
  function releaseImage() {
    if (!image) return
    image.onload = null; image.onerror = null
    image.removeAttribute('src'); image.remove(); image = undefined
  }
  function release() {
    request++; controller?.abort(); controller = undefined
    releaseImage(); state('idle')
  }
  async function load() {
    if (!visible || disposed || controller || image) return
    if (!loader || !Number.isSafeInteger(revision) || revision < 0) { state('error'); return }
    const pending = new AbortController(), token = ++request
    controller = pending; state('loading')
    const current = () => !disposed && visible && request === token && !pending.signal.aborted
    try {
      const photo = await loader.load(reference.visitId, reference.photoId, revision, pending.signal)
      if (!current()) return
      const next = document.createElement('img')
      next.alt = ''; next.decoding = 'async'; next.draggable = false
      next.onload = () => { if (current() && image === next) state('ready') }
      next.onerror = () => { if (current() && image === next) { releaseImage(); state('error') } }
      image = next; face.prepend(next); next.src = photo.url
    } catch {
      if (current()) state('error')
    } finally { if (controller === pending) controller = undefined }
  }
  state('idle')
  if (typeof IntersectionObserver === 'function') {
    observer = new IntersectionObserver(entries => {
      const entry = entries.filter(item => item.target === element).at(-1)
      if (!entry || disposed) return
      visible = entry.isIntersecting
      if (visible) void load(); else release()
    }, { rootMargin: '0px', threshold: 0 })
    observer.observe(element)
  } else state('error')
  return { element, dispose() { disposed = true; observer?.disconnect(); release() } }
}
