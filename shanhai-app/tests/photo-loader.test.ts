import { describe, expect, it, vi } from 'vitest'
import type { Photo, Visit } from '../src/domain/models'
import type { LocalRepository } from '../src/services/contracts'
import { createPhotoLoader, PHOTO_CACHE_LIMIT, PHOTO_READ_CONCURRENCY } from '../src/services/photo-loader'

const photo = (id: string): Photo => ({ id, name: `${id}.jpg`, url: `data:image/jpeg;base64,${id}` })
const visit = (id: string): Visit => ({ id, createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '仅本机', coverId: 'chosen', photos: [photo('first'), photo('chosen'), photo('last')] })
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (cause: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const tick = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }
const harness = (read?: LocalRepository['readVisit']) => {
  const readVisit = vi.fn<LocalRepository['readVisit']>(read ?? (async id => visit(id)))
  return { loader: createPhotoLoader({ readVisit }), readVisit }
}

describe('bounded local photo loader', () => {
  it('reads exactly one visit with the revision and retains only a copy of the specified photo', async () => {
    const row = visit('one'), { loader, readVisit } = harness(async () => row)
    const result = await loader.load('one', 'chosen', 7)
    expect(readVisit).toHaveBeenCalledExactlyOnceWith('one', { expectedRevision: 7, signal: expect.any(AbortSignal) })
    expect(result).toEqual(photo('chosen')); expect(result).not.toBe(row.photos[1])
    expect(Object.keys(result).sort()).toEqual(['id', 'name', 'url'])
    result.name = 'do not corrupt cache'; row.photos[1]!.url = 'changed source'
    expect(await loader.load('one', 'chosen', 7)).toEqual(photo('chosen'))
    expect(readVisit).toHaveBeenCalledTimes(1)
    loader.close()
  })
  it('deduplicates shared requests and allows one subscriber to cancel without cancelling another', async () => {
    const pending = deferred<Visit | null>(), { loader, readVisit } = harness(() => pending.promise)
    const cancelled = new AbortController(), kept = new AbortController()
    const first = loader.load('one', 'chosen', 1, cancelled.signal), second = loader.load('one', 'chosen', 1, kept.signal)
    const firstFailure = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    cancelled.abort(); await firstFailure
    expect(readVisit).toHaveBeenCalledTimes(1)
    expect(readVisit.mock.calls[0]![1]!.signal!.aborted).toBe(false)
    pending.resolve(visit('one')); expect(await second).toEqual(photo('chosen'))
    loader.close()
  })
  it('runs at most two reads, queues in order, and does not read cancelled queued photos', async () => {
    const active: ReturnType<typeof deferred<Visit | null>>[] = []
    const { loader, readVisit } = harness(() => { const pending = deferred<Visit | null>(); active.push(pending); return pending.promise })
    const first = loader.load('one', 'chosen', 1), second = loader.load('two', 'chosen', 1)
    const controller = new AbortController(), cancelled = loader.load('cancelled', 'chosen', 1, controller.signal), fourth = loader.load('four', 'chosen', 1)
    const failed = expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
    expect(readVisit).toHaveBeenCalledTimes(PHOTO_READ_CONCURRENCY)
    controller.abort(); await failed
    active[0]!.resolve(visit('one')); await first; await tick()
    expect(readVisit.mock.calls.map(call => call[0])).toEqual(['one', 'two', 'four'])
    active[1]!.resolve(visit('two')); active[2]!.resolve(visit('four'))
    await Promise.all([second, fourth]); loader.close()
  })
  it('holds a cancelled in-flight slot until its repository settles, avoiding scroll-induced overcommit', async () => {
    const active: ReturnType<typeof deferred<Visit | null>>[] = []
    const { loader, readVisit } = harness(() => { const pending = deferred<Visit | null>(); active.push(pending); return pending.promise })
    const controller = new AbortController(), abandoned = loader.load('first', 'chosen', 1, controller.signal)
    const stillReading = loader.load('second', 'chosen', 1), next = loader.load('third', 'chosen', 1)
    const failure = expect(abandoned).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort(); await failure; await tick()
    expect(readVisit.mock.calls[0]![1]!.signal!.aborted).toBe(true)
    expect(readVisit).toHaveBeenCalledTimes(2)
    active[0]!.resolve(visit('first')); await tick()
    expect(readVisit).toHaveBeenCalledTimes(3)
    active[1]!.resolve(visit('second')); active[2]!.resolve(visit('third'))
    await Promise.all([stillReading, next]); loader.close()
  })
  it('bounds the LRU to twelve individual photos and isolates visit, photo and revision identities', async () => {
    const { loader, readVisit } = harness()
    for (let i = 0; i < PHOTO_CACHE_LIMIT; i++) await loader.load(String(i), 'chosen', 1)
    expect(readVisit).toHaveBeenCalledTimes(12)
    await loader.load('0', 'chosen', 1) // promote oldest entry
    await loader.load('12', 'chosen', 1)
    await loader.load('0', 'chosen', 1)
    expect(readVisit).toHaveBeenCalledTimes(13)
    await loader.load('1', 'chosen', 1) // evicted
    await loader.load('1', 'first', 1)
    await loader.load('1', 'chosen', 2)
    expect(readVisit).toHaveBeenCalledTimes(16)
    loader.close()
  })
  it('does not accumulate scrolling requests or cancelled results in cache', async () => {
    const { loader, readVisit } = harness()
    for (let i = 0; i < 80; i++) { await loader.load(String(i), 'chosen', 1); await tick() }
    await loader.load('0', 'chosen', 1)
    expect(readVisit).toHaveBeenCalledTimes(81)
    const block = deferred<Visit | null>()
    readVisit.mockImplementationOnce(() => block.promise)
    const controller = new AbortController(), late = loader.load('late', 'chosen', 1, controller.signal)
    const failed = expect(late).rejects.toMatchObject({ name: 'AbortError' }); controller.abort(); await failed
    block.resolve(visit('late')); await tick()
    await loader.load('late', 'chosen', 1)
    expect(readVisit).toHaveBeenCalledTimes(83)
    loader.close()
  })
  it('clear aborts pending requests and invalidates cache; close permanently rejects new work', async () => {
    const { loader, readVisit } = harness()
    await loader.load('cached', 'chosen', 1); await tick()
    const block = deferred<Visit | null>()
    readVisit.mockImplementationOnce(() => block.promise)
    const pending = loader.load('pending', 'chosen', 1), rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    loader.clear(); await rejected
    expect(readVisit.mock.calls[1]![1]!.signal!.aborted).toBe(true)
    await loader.load('cached', 'chosen', 1)
    expect(readVisit).toHaveBeenCalledTimes(3)
    block.resolve(visit('pending')); await tick()
    await loader.load('pending', 'chosen', 1)
    expect(readVisit).toHaveBeenCalledTimes(4)
    loader.close()
    await expect(loader.load('new', 'chosen', 1)).rejects.toMatchObject({ name: 'AbortError' })
    expect(readVisit).toHaveBeenCalledTimes(4)
  })
  it('clear rejects active and queued subscribers while preserving slots until old reads settle', async () => {
    const active: ReturnType<typeof deferred<Visit | null>>[] = []
    const { loader, readVisit } = harness(() => { const pending = deferred<Visit | null>(); active.push(pending); return pending.promise })
    const old = [loader.load('one', 'chosen', 1), loader.load('two', 'chosen', 1), loader.load('queued', 'chosen', 1)]
    const failures = old.map(promise => expect(promise).rejects.toMatchObject({ name: 'AbortError' }))
    loader.clear(); await Promise.all(failures)
    expect(readVisit.mock.calls.every(call => call[1]?.signal?.aborted)).toBe(true)
    const next = loader.load('one', 'chosen', 1)
    expect(readVisit).toHaveBeenCalledTimes(2)
    active[0]!.resolve(visit('one')); await tick()
    expect(readVisit.mock.calls.map(call => call[0])).toEqual(['one', 'two', 'one'])
    // The old same-key request must neither satisfy nor remove this new job.
    const shared = loader.load('one', 'chosen', 1)
    expect(readVisit).toHaveBeenCalledTimes(3)
    active[2]!.resolve({ ...visit('one'), photos: [{ ...photo('chosen'), name: 'fresh.jpg' }] })
    expect((await next).name).toBe('fresh.jpg'); expect((await shared).name).toBe('fresh.jpg')
    active[1]!.resolve(visit('two')); await tick()
    expect((await loader.load('one', 'chosen', 1)).name).toBe('fresh.jpg')
    expect(readVisit).toHaveBeenCalledTimes(3)
    loader.close()
  })
  it('removes subscriber abort listeners after settlement and does not invalidate successful cache on a late abort', async () => {
    const { loader, readVisit } = harness(), controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    await loader.load('one', 'chosen', 1, controller.signal)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    controller.abort(); await tick()
    expect(await loader.load('one', 'chosen', 1)).toEqual(photo('chosen'))
    expect(readVisit).toHaveBeenCalledTimes(1)
    loader.close()
  })
  it('rejects missing, unreadable and non-local photos without caching a failure', async () => {
    const { loader, readVisit } = harness()
    readVisit.mockResolvedValueOnce(null)
    await expect(loader.load('missing', 'chosen', 1)).rejects.toThrow('照片未载入')
    await expect(loader.load('missing-photo', 'absent', 1)).rejects.toThrow('照片未载入')
    readVisit.mockRejectedValueOnce(new Error('stale revision'))
    await expect(loader.load('failed', 'chosen', 1)).rejects.toThrow('stale revision')
    readVisit.mockResolvedValueOnce({ ...visit('external'), photos: [{ ...photo('chosen'), url: 'https://example.invalid/private.jpg' }] })
    await expect(loader.load('external', 'chosen', 1)).rejects.toThrow('照片未载入')
    expect(await loader.load('external', 'chosen', 1)).toEqual(photo('chosen'))
    loader.close()
  })
  it('rejects an already aborted request and invalid identities before any read', async () => {
    const { loader, readVisit } = harness(), controller = new AbortController(); controller.abort()
    await expect(loader.load('one', 'chosen', 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    for (const revision of [-1, NaN, Infinity, 1.2]) await expect(loader.load('one', 'chosen', revision)).rejects.toThrow('照片未载入')
    await expect(loader.load('', 'chosen', 1)).rejects.toThrow('照片未载入')
    expect(readVisit).not.toHaveBeenCalled(); loader.close()
  })
})
