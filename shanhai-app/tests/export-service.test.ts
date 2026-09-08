// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { webcrypto } from 'node:crypto'
import { createTravelServices, type TravelServices } from '../src/services/travel-services'
import { createExportStore } from '../src/services/export-store'
import { createBackupExportService } from '../src/services/export-service'
import type { BackupCodec, TravelPlatform } from '../src/services/contracts'
import type { Visit } from '../src/domain/models'
import type { BackupExportService, ExportStore } from '../src/services/export-types'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const visit = (id: string, extra: Partial<Visit> = {}): Visit => ({ id, createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '山海🌄雪山',
  photos: [{ id: `photo-${id}`, name: '照片.png', url: png }], coverId: `photo-${id}`, ...extra })
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { vi.restoreAllMocks(); for (const close of cleanup.splice(0).reverse()) await close() })
function harness() {
  const platform: TravelPlatform = { indexedDB: new IDBFactory(), IDBKeyRange, crypto: webcrypto as unknown as Crypto, Blob, TextEncoder,
    setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }
  const services = createTravelServices({ platform, dbName: 'export-test' })
  cleanup.push(() => services.repository.close())
  return { platform, ...services }
}
function custom(h: ReturnType<typeof harness>, transform: (store: ExportStore) => ExportStore, codec: Partial<BackupCodec> = {}): { service: BackupExportService; store: ExportStore } {
  const store = createExportStore(h.platform, 'custom-export-spool'), wrapped = transform(store)
  const service = createBackupExportService(h.repository, { ...h.backup, ...codec }, wrapped, h.platform, 'export-test')
  cleanup.push(() => service.close())
  return { service, store }
}
async function fill(h: Pick<TravelServices, 'repository'>) {
  await h.repository.addVisit(visit('one'))
  await h.repository.addVisit(visit('two', { date: '2025-01-02', coverId: 'second', photos: [{ id: 'first', name: 'a.png', url: png }, { id: 'second', name: 'b.png', url: png }] }))
  await h.repository.setMapCover('yulong', { visitId: 'two', photoId: 'second' })
}

describe('incremental backup export coordinator', () => {
  it('exports serially without load/prepareExport and round-trips through the existing v2 consumer', async () => {
    const h = harness(); await fill(h)
    const expected = await h.repository.load(), initial = await h.repository.loadIndex()
    vi.spyOn(h.repository, 'load').mockRejectedValue(new Error('Forbidden full collector'))
    const forbidden = vi.fn(async () => { throw new Error('Forbidden compatibility export') })
    const { service } = custom(h, store => store, { prepareExport: forbidden })
    let inFlight = 0, maximum = 0
    const read = h.repository.readVisit.bind(h.repository)
    vi.spyOn(h.repository, 'readVisit').mockImplementation(async (...args) => {
      maximum = Math.max(maximum, ++inFlight)
      try { return await read(...args) } finally { inFlight-- }
    })
    const progress = vi.fn(), ready = await service.prepare({ volumeChars: 1024, onProgress: progress })
    expect(ready.files.length).toBeGreaterThan(1); expect(maximum).toBe(1)
    expect(h.repository.load).not.toHaveBeenCalled(); expect(forbidden).not.toHaveBeenCalled()
    expect(ready.sourceRevision).toBe(initial.revision)
    expect(JSON.stringify(ready)).not.toContain('data:image')
    const files: Blob[] = [] // Test-only collector for the pre-existing restore API.
    for (const file of ready.files) files.push((await service.readPart(ready.id, file.part)).blob)
    const descriptor = await h.backup.preflightFiles(files)
    expect(descriptor.format).toBe('volume-v2')
    if (descriptor.format !== 'volume-v2') throw new Error('Expected volumes')
    const restored = { visits: [] as Visit[], covers: [] as typeof expected.covers }
    await h.backup.consumeVolumes(descriptor, { onVisit: async row => { restored.visits.push(row) }, onCover: async cover => { restored.covers.push(cover) }, decodePhoto: async () => {} })
    expect(restored).toEqual(expected)
    expect(await h.repository.loadIndex()).toEqual(initial)
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ phase: 'read', records: 2, totalRecords: 2 }))
  })
  it('empty libraries do not create temporary sessions', async () => {
    const h = harness(); await expect(h.exports.prepare()).rejects.toMatchObject({ code: 'empty' })
    expect(await h.exports.listSessions()).toEqual([])
  })
  it.each(['before-first', 'between', 'fence'] as const)('rejects a source change at %s and cleans only its incomplete export', async at => {
    const h = harness(); await fill(h)
    const previous = await h.exports.prepare()
    if (at === 'fence') {
      const assert = h.repository.assertRevision.bind(h.repository)
      vi.spyOn(h.repository, 'assertRevision').mockImplementation(async (...args) => {
        await h.repository.setMapCover('yulong', { visitId: 'one', photoId: 'photo-one' })
        return assert(...args)
      })
    } else {
      let reads = 0; const read = h.repository.readVisit.bind(h.repository)
      vi.spyOn(h.repository, 'readVisit').mockImplementation(async (...args) => {
        if (++reads === (at === 'before-first' ? 1 : 2)) await h.repository.addVisit(visit('new'))
        return read(...args)
      })
    }
    await expect(h.exports.prepare({ volumeChars: 1024 })).rejects.toMatchObject({ code: 'stale' })
    expect((await h.exports.listSessions()).map(row => row.id)).toEqual([previous.id])
  })
  it('rejects missing or index-mismatched rows instead of silently skipping', async () => {
    const h = harness(); await fill(h)
    vi.spyOn(h.repository, 'readVisit').mockResolvedValueOnce(null)
    await expect(h.exports.prepare()).rejects.toMatchObject({ code: 'stale' })
    vi.spyOn(h.repository, 'readVisit').mockResolvedValueOnce(visit('one', { note: 'different' }))
    await expect(h.exports.prepare()).rejects.toMatchObject({ code: 'stale' })
    expect(await h.exports.listSessions()).toEqual([])
  })
  it('permits a valid old snapshot after the final fence and repeats identical downloads', async () => {
    const h = harness(); await fill(h)
    const assert = h.repository.assertRevision.bind(h.repository)
    vi.spyOn(h.repository, 'assertRevision').mockImplementation(async (...args) => { await assert(...args); await h.repository.addVisit(visit('later')) })
    const ready = await h.exports.prepare()
    expect(ready.summary.visits).toBe(2); expect((await h.repository.loadIndex()).visits).toHaveLength(3)
    const a = await h.exports.readPart(ready.id, 1), b = await h.exports.readPart(ready.id, 1)
    expect(a.filename).toBe(b.filename); expect(await a.blob.text()).toBe(await b.blob.text())
    expect(await h.exports.resumeReady(ready.id)).toEqual(ready)
  })
  it('holds the operation lock until a non-abortable read settles, then cleans and allows retry', async () => {
    const h = harness(); await fill(h)
    const gate = deferred<void>(), entered = deferred<void>(), read = h.repository.readVisit.bind(h.repository)
    vi.spyOn(h.repository, 'readVisit').mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return read(...args) })
    const controller = new AbortController(), operation = h.exports.prepare({ signal: controller.signal })
    const rejection = expect(operation).rejects.toMatchObject({ code: 'aborted' })
    await entered.promise; controller.abort()
    await expect(h.exports.prepare()).rejects.toMatchObject({ code: 'busy' })
    let settled = false; void operation.catch(() => { settled = true })
    await Promise.resolve(); expect(settled).toBe(false)
    gate.resolve(); await rejection
    expect(await h.exports.listSessions()).toEqual([])
    expect((await h.exports.prepare()).status).toBe('ready')
  })
  it('waits for a sink write and cleanup before cancellation completes', async () => {
    const h = harness(); await fill(h)
    const gate = deferred<void>(), entered = deferred<void>()
    const { service, store } = custom(h, store => ({ ...store, appendPart: async (...args) => { entered.resolve(); await gate.promise; return store.appendPart(...args) } }))
    const controller = new AbortController(), result = service.prepare({ signal: controller.signal, volumeChars: 1024 })
    const rejected = expect(result).rejects.toMatchObject({ code: 'aborted' })
    await entered.promise; controller.abort()
    await expect(service.prepare()).rejects.toMatchObject({ code: 'busy' })
    gate.resolve(); await rejected
    expect(await store.list()).toEqual([])
  })
  it('quota failure never falls back to RAM and retains the original library', async () => {
    const h = harness(); await fill(h)
    const before = await h.repository.loadIndex()
    const { service, store } = custom(h, store => ({ ...store, appendPart: async () => { throw Object.assign(new Error('quota'), { code: 'quota' }) } }))
    vi.spyOn(h.repository, 'load').mockRejectedValue(new Error('Forbidden collector'))
    await expect(service.prepare()).rejects.toMatchObject({ code: 'quota' })
    expect(await store.list()).toEqual([]); expect(await h.repository.loadIndex()).toEqual(before)
    expect(h.repository.load).not.toHaveBeenCalled()
  })
  it('cleanup failures expose an exact retry id without publishing ready', async () => {
    const h = harness(); await fill(h)
    let failCleanup = true
    const { service, store } = custom(h, store => ({ ...store,
      appendPart: async () => { throw new Error('stage failed') },
      discard: async id => { if (failCleanup) throw new Error('cleanup failed'); return store.discard(id) },
    }))
    let id = ''
    await service.prepare().catch(error => { expect(error).toMatchObject({ cleanupPending: true, code: 'cleanup-pending' }); id = error.sessionId })
    expect(id).toBeTruthy(); expect((await store.get(id))?.status).toBe('building')
    failCleanup = false; await service.discard(id); expect(await store.get(id)).toBeNull()
  })
  it('ready sessions survive service recreation, incomplete ones cannot resume', async () => {
    const h = harness(); await fill(h)
    const session = await h.exports.prepare()
    await h.exports.close()
    const reopened = createTravelServices({ platform: h.platform, dbName: 'export-test' }); cleanup.push(() => reopened.repository.close())
    expect((await reopened.exports.resumeReady(session.id)).archive).toEqual(session.archive)
    const { service, store } = custom(h, value => value)
    await store.begin({ id: 'incomplete', sourceDbName: 'export-test', sourceRevision: 1, summary: session.summary, createdAt: session.createdAt }, 'token')
    await expect(service.resumeReady('incomplete')).rejects.toMatchObject({ code: 'export-state' })
  })
  it('read detects missing/corrupted parts and cannot reconstruct them from current records', async () => {
    const h = harness(); await fill(h)
    const { service, store } = custom(h, value => value)
    const session = await service.prepare()
    await store.discard(session.id)
    await expect(service.readPart(session.id, 1)).rejects.toMatchObject({ code: 'export-state' })
    expect(await service.listSessions()).toEqual([])
  })
  it('an allocated id collision cannot clean another completed export', async () => {
    const h = harness(); await fill(h)
    const saved = await h.exports.prepare()
    h.platform.crypto = { getRandomValues: (webcrypto as unknown as Crypto).getRandomValues.bind(webcrypto as unknown as Crypto),
      randomUUID: vi.fn().mockReturnValueOnce(saved.id).mockReturnValueOnce('new-writer-token') }
    await expect(h.exports.prepare()).rejects.toMatchObject({ code: 'export-state' })
    expect((await h.exports.listSessions()).map(row => row.id)).toEqual([saved.id])
    expect((await h.exports.readPart(saved.id, 1)).bytes).toBe(saved.files[0]!.bytes)
  })
  it('corrupt ready metadata remains visible and can be explicitly cleaned without blocking healthy sessions', async () => {
    const h = harness(); await fill(h)
    const bad = await h.exports.prepare(), good = await h.exports.prepare()
    const request = h.platform.indexedDB!.open('export-test-exports-v1')
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('sessions', 'readwrite'), store = tx.objectStore('sessions'), read = store.get(bad.id)
      read.onsuccess = () => store.put({ ...read.result, totalBytes: bad.totalBytes + 1 })
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
    }); db.close()
    expect((await h.exports.listSessions()).find(row => row.id === bad.id)?.status).toBe('damaged')
    await expect(h.exports.resumeReady(bad.id)).rejects.toMatchObject({ code: 'export-state' })
    await h.exports.discard(bad.id)
    expect((await h.exports.listSessions()).map(row => row.id)).toEqual([good.id])
  })
  it('close aborts and joins active work before closing the store, leaving no late ready', async () => {
    const h = harness(); await fill(h)
    const entered = deferred<void>(), gate = deferred<void>(), read = h.repository.readVisit.bind(h.repository)
    vi.spyOn(h.repository, 'readVisit').mockImplementationOnce(async (...args) => { entered.resolve(); await gate.promise; return read(...args) })
    const result = h.exports.prepare(), rejection = expect(result).rejects.toMatchObject({ code: 'aborted' })
    await entered.promise
    let closed = false; const closing = h.exports.close().then(() => { closed = true })
    await Promise.resolve(); expect(closed).toBe(false)
    gate.resolve(); await rejection; await closing
    await expect(h.exports.prepare()).rejects.toMatchObject({ code: 'closed' })
  })
})
