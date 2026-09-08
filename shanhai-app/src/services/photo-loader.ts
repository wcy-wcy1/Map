import type { InjectionKey } from 'vue'
import type { Photo } from '../domain/models'
import type { LocalRepository } from './contracts'

export interface PhotoLoader {
  load(visitId: string, photoId: string, revision: number, signal?: AbortSignal): Promise<Photo>
  clear(): void
  close(): void
}
export const PHOTO_LOADER_KEY: InjectionKey<PhotoLoader> = Symbol('local-photo-loader')
export const PHOTO_READ_CONCURRENCY = 2
export const PHOTO_CACHE_LIMIT = 12

type Subscriber = { resolve(photo: Photo): void; reject(cause: unknown): void; cleanup(): void }
type Job = {
  key: string; visitId: string; photoId: string; revision: number
  controller: AbortController; subscribers: Set<Subscriber>
}
const cancelled = () => new DOMException('照片读取已取消。', 'AbortError')
const unavailable = () => new Error('照片未载入，请点开回忆重试。')

/** Loads one stored visit at a time, then immediately drops all but the requested
 * photo. The cache contains at most 12 individual original photos, not complete
 * visits or generated thumbnails. Native decode remains the image element's job.
 * Aborted reads retain their concurrency slot until the repository settles. */
export function createPhotoLoader(repository: Pick<LocalRepository, 'readVisit'>): PhotoLoader {
  const cache = new Map<string, Photo>(), jobs = new Map<string, Job>(), queue: Job[] = []
  let running = 0, closed = false

  function abandon(job: Job) {
    if (jobs.get(job.key) === job) jobs.delete(job.key)
    const queued = queue.indexOf(job)
    if (queued >= 0) queue.splice(queued, 1)
    job.controller.abort()
  }
  function settle(job: Job, photo?: Photo, cause?: unknown) {
    for (const subscriber of job.subscribers) {
      subscriber.cleanup()
      if (photo) subscriber.resolve({ ...photo }); else subscriber.reject(cause ?? unavailable())
    }
    job.subscribers.clear()
  }
  async function readPhoto(job: Job): Promise<Photo> {
    const visit = await repository.readVisit(job.visitId, { signal: job.controller.signal, expectedRevision: job.revision })
    if (job.controller.signal.aborted) throw cancelled()
    const photo = visit?.photos.find(item => item.id === job.photoId)
    if (!photo || !/^data:image\/(?:jpeg|png|webp);base64,/.test(photo.url)) throw unavailable()
    // Never let the cache retain an object that points back to a visit/array.
    return { id: photo.id, name: photo.name, url: photo.url }
  }
  function pump() {
    while (!closed && running < PHOTO_READ_CONCURRENCY && queue.length) {
      const job = queue.shift()!
      if (!job.subscribers.size || job.controller.signal.aborted) continue
      running++
      void readPhoto(job).then(photo => {
        if (job.controller.signal.aborted || !job.subscribers.size) return
        cache.delete(job.key); cache.set(job.key, photo)
        while (cache.size > PHOTO_CACHE_LIMIT) cache.delete(cache.keys().next().value!)
        settle(job, photo)
      }, cause => settle(job, undefined, cause)).finally(() => {
        if (jobs.get(job.key) === job) jobs.delete(job.key)
        running--; pump()
      })
    }
  }
  function clear() {
    cache.clear()
    for (const job of jobs.values()) {
      settle(job, undefined, cancelled())
      abandon(job)
    }
    queue.length = 0
  }
  return {
    load(visitId, photoId, revision, signal) {
      if (closed || signal?.aborted) return Promise.reject(cancelled())
      if (!visitId || !photoId || !Number.isSafeInteger(revision) || revision < 0) return Promise.reject(unavailable())
      const key = JSON.stringify([revision, visitId, photoId]), cached = cache.get(key)
      if (cached) {
        cache.delete(key); cache.set(key, cached)
        return Promise.resolve({ ...cached })
      }
      let job = jobs.get(key)
      if (!job) {
        job = { key, visitId, photoId, revision, controller: new AbortController(), subscribers: new Set() }
        jobs.set(key, job); queue.push(job)
      }
      const current = job
      const result = new Promise<Photo>((resolve, reject) => {
        const subscriber: Subscriber = { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) }
        function abort() {
          subscriber.cleanup(); current.subscribers.delete(subscriber); reject(cancelled())
          if (!current.subscribers.size) abandon(current)
        }
        current.subscribers.add(subscriber)
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
      })
      pump()
      return result
    },
    clear,
    close() { closed = true; clear() },
  }
}
