// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange, IDBObjectStore, IDBDatabase as FakeDatabase } from 'fake-indexeddb'
import { createHash, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import type { LocalRepository, StageMeta } from '../src/services/contracts'
import type { Visit } from '../src/domain/models'

// Exercise the authoritative kernel independently of the generated Vue bridge.
// Every row is synthetic; old schema 3 is written by its SHA-pinned real kernel.
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const row = (id = 'one', extra: Partial<Visit> = {}): Visit => ({ id, createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '雪山 🏔️',
  photos: [{ id: 'photo-one', name: '照片.png', url: png }], coverId: 'photo-one', ...extra })
type Summary = Omit<Visit, 'photos'> & { photos: { id: string; name: string }[] }
type IndexStore = LocalRepository & {
  loadIndex(options?: { signal?: AbortSignal }): Promise<{ visits: Summary[]; covers: unknown[]; revision: number }>
  readVisit(id: string, options?: { signal?: AbortSignal; expectedRevision?: number }): Promise<Visit | null>
  hasDraft(options?: { signal?: AbortSignal }): Promise<boolean>
}
let kernel = '', previousKernel = '', catalogue = '', codec = '', data: unknown, serial = 0
const tracked: IndexStore[] = []
beforeAll(async () => {
  const bytes = await readFile(new URL('../../output/shanhai-yunnan/qa/incremental-20260907/bundle/index.html', import.meta.url))
  expect(createHash('sha256').update(bytes).digest('hex')).toBe('58a528d096740a4a3ae862dd70414a7d9ffe895daa3b50781a94e20f710fb9a9')
  const scripts = Array.from(bytes.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), match => match[1]!)
  const one = (marker: string) => { const selected = scripts.filter(script => script.includes(marker)); expect(selected).toHaveLength(1); return selected[0]! }
  previousKernel = one('root.createShanhaiLocalStore = function createShanhaiLocalStore')
  expect(previousKernel).toContain('root.indexedDB.open(dbName, 3)')
  catalogue = one('root.ShanhaiPlaces=Object.freeze')
  codec = one('root.ShanhaiBackup = Object.freeze')
  data = JSON.parse(one('globalThis.ShanhaiYunnanData=').replace(/^globalThis\.ShanhaiYunnanData=/, '').replace(/;\s*$/, ''))
  kernel = await readFile(new URL('../../output/shanhai-lijiang-records/local-store.js', import.meta.url), 'utf8')
})
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(tracked.splice(0).map(store => store.close())) })
function identity() { return { indexedDB: new IDBFactory(), dbName: `index-isolated-${++serial}` } }
type Identity = ReturnType<typeof identity>
function harness(id = identity(), old = false, observeTimeout?: (callback: () => void) => void) {
  const context = createContext({ ...id, IDBKeyRange, crypto: webcrypto, Blob, TextEncoder,
    setTimeout: (callback: () => void, delay: number) => { observeTimeout?.(callback); return setTimeout(callback, delay) },
    clearTimeout, ShanhaiYunnanData: data })
  for (const [name, source] of [['catalogue', catalogue], ['codec', codec], ['store', old ? previousKernel : kernel]]) {
    runInContext(source!, context, { timeout: 1000, filename: `${old ? 'preserved-v3' : 'authoritative-v4'}-${name}.js` })
  }
  const store = context.createShanhaiLocalStore({ dbName: id.dbName }) as IndexStore
  tracked.push(store)
  return { ...id, store }
}
function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error) }) }
function open(id: Identity): Promise<IDBDatabase> { return request(id.indexedDB.open(id.dbName)) }
async function dump(id: Identity) {
  const db = await open(id)
  try {
    const names = [...db.objectStoreNames], tx = db.transaction(names)
    return { version: db.version, rows: Object.fromEntries(await Promise.all(names.map(async name => [name, await request(tx.objectStore(name).getAll())]))) }
  } finally { db.close() }
}
async function rawWrite(id: Identity, name: string, value: unknown, method: 'put' | 'delete' = 'put') {
  const db = await open(id)
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite'); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
    if (method === 'delete') tx.objectStore(name).delete(value as IDBValidKey)
    else tx.objectStore(name).put(value)
  }) } finally { db.close() }
}
function summary(visit: Visit): Summary {
  return { id: visit.id, createdAt: visit.createdAt, placeId: visit.placeId, date: visit.date, note: visit.note,
    photos: visit.photos.map(photo => ({ id: photo.id, name: photo.name })), coverId: visit.coverId,
    ...(visit.customPlace ? { customPlace: visit.customPlace } : {}) }
}
function storeNames(contexts: readonly unknown[]): string[] {
  return contexts.map(value => { expect(value).toBeInstanceOf(IDBObjectStore); return (value as IDBObjectStore).name })
}
async function stage(store: IndexStore, incoming = row()) {
  const meta: StageMeta = { archiveId: 'test-index-archive', exportedAt: '2026-09-01T00:00:00.000Z', archiveSha256: 'a'.repeat(64), covers: 1,
    summary: { visits: 1, photos: 1, places: 1, from: incoming.date, to: incoming.date } }
  const value = await store.beginImportStage(meta)
  await store.stageImportVisit(value.id, incoming)
  await store.stageImportCover(value.id, { placeId: incoming.placeId, visitId: incoming.id, photoId: incoming.photos[0]!.id })
  return store.finishImportStage(value.id)
}

describe('schema 4 photo-free catalogue and demand reads', () => {
  it('opens an empty schema 4 with a checked zero revision and no accidental draft creation', async () => {
    const h = harness()
    expect(await h.store.loadIndex()).toEqual({ visits: [], covers: [], revision: 0 })
    expect(await h.store.hasDraft()).toBe(false)
    expect(await h.store.readVisit('missing', { expectedRevision: 0 })).toBeNull()
    const raw = await dump(h)
    expect(raw.version).toBe(4)
    expect(raw.rows.libraryMeta).toEqual([{ id: 'library', revision: 0 }])
    expect(raw.rows.visitIndex).toEqual([])
  })

  it('migrates real v3 writer rows, unfinished draft, staged import and committed receipt without rewriting any old store', async () => {
    const id = identity(), old = harness(id, true)
    const original = { ...row(), opaque: { futurePhoto: png }, photos: [{ ...row().photos[0]!, futurePhoto: png }] }
    await old.store.addVisit(original)
    await old.store.setMapCover(original.placeId, { visitId: original.id, photoId: original.coverId! })
    const draft = await old.store.saveDraft({ ...row('draft'), visitId: 'unfinished', date: '', updatedAt: 1 }, { expectedVersion: null })
    const waiting = await stage(old.store, row('waiting'))
    const completed = await stage(old.store, row('committed'))
    await old.store.commitStagedImport(completed.id)
    await old.store.discardImportStage(completed.id)
    await old.store.close()
    const before = await dump(id), h = harness(id)
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll')
    expect(await h.store.loadIndex()).toEqual({ visits: [summary(row('committed')), summary(original)], covers: [{ placeId: 'yulong', visitId: 'one', photoId: 'photo-one' }], revision: 0 })
    expect(storeNames(getAll.mock.contexts).some(name => name === 'visits' || name === 'drafts')).toBe(false)
    getAll.mockRestore()
    const after = await dump(id)
    expect(after.version).toBe(4)
    for (const [name, values] of Object.entries(before.rows)) expect(after.rows[name]).toEqual(values)
    expect(await h.store.readVisit(original.id)).toEqual(original)
    expect(await h.store.loadDraft()).toEqual(draft)
    expect(await h.store.listImportStages()).toMatchObject([{ id: waiting.id, status: 'ready' }])
    expect(await h.store.commitStagedImport(completed.id)).toMatchObject({ replayed: true })
    expect(JSON.stringify((await h.store.loadIndex()).visits)).not.toContain('data:image')
  })

  it('does not clone full visit/draft values on catalogue reads and fetches only the requested photo-bearing row', async () => {
    const h = harness()
    for (let index = 0; index < 40; index++) await h.store.addVisit(row(`memory-${index}`, { createdAt: index }))
    await h.store.saveDraft({ ...row('draft'), visitId: 'unfinished', updatedAt: 1 }, { expectedVersion: null })
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll'), cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor'), get = vi.spyOn(IDBObjectStore.prototype, 'get'), count = vi.spyOn(IDBObjectStore.prototype, 'count')
    const index = await h.store.loadIndex()
    expect(index.visits).toHaveLength(40)
    expect(await h.store.hasDraft()).toBe(true)
    expect(storeNames(getAll.mock.contexts).sort()).toEqual(['covers', 'visitIndex'])
    expect(cursor).not.toHaveBeenCalled()
    expect(storeNames(get.mock.contexts)).toEqual(['libraryMeta'])
    expect(storeNames(count.mock.contexts)).toEqual(['visits', 'drafts'])
    const full = await h.store.readVisit('memory-17', { expectedRevision: index.revision })
    expect(full).toEqual(row('memory-17', { createdAt: 17 }))
    expect(storeNames(get.mock.contexts)).toEqual(['libraryMeta', 'libraryMeta', 'visits'])
    expect(get.mock.calls.at(-1)).toEqual(['memory-17'])
    expect(JSON.stringify(index).length).toBeLessThan(JSON.stringify({ visits: Array.from({ length: 40 }, (_, i) => row(`memory-${i}`, { createdAt: i })) }).length)
  })

  it('keeps add/edit/cover/delete/undo indexes and monotonic revisions in the same commit', async () => {
    const h = harness(), original = { ...row(), opaque: { retained: png } }
    const saving = h.store.addVisit(original)
    original.note = 'caller changed'
    await saving
    expect((await h.store.loadIndex()).visits).toEqual([summary(row())])
    const saved = (await h.store.readVisit('one'))!
    expect(saved).toHaveProperty('opaque', { retained: png })
    expect((await h.store.loadIndex()).revision).toBe(1)
    await h.store.setMapCover('yulong', { visitId: 'one', photoId: 'photo-one' })
    expect((await h.store.loadIndex()).revision).toBe(2)
    const edited = await h.store.updateVisit({ ...saved, note: 'Edited' }, { expectedVisit: saved })
    expect(await h.store.loadIndex()).toEqual({ visits: [summary(edited)], covers: [{ placeId: 'yulong', visitId: 'one', photoId: 'photo-one' }], revision: 3 })
    const undo = await h.store.deleteVisit('one', { expectedVisit: edited })
    expect(await h.store.loadIndex()).toEqual({ visits: [], covers: [], revision: 4 })
    await h.store.restoreVisit(undo)
    expect((await h.store.loadIndex()).visits).toEqual([summary(edited)])
    expect((await h.store.loadIndex()).revision).toBe(5)
    expect(await h.store.readVisit('one')).toEqual(edited)
  })

  it('updates v1 and staged imports atomically while pure staging, drafts and reads leave revision unchanged', async () => {
    const h = harness()
    await h.store.importSnapshot({ visits: [row('v1')], covers: [] })
    expect((await h.store.loadIndex()).revision).toBe(1)
    const pending = await stage(h.store, row('v2'))
    await h.store.planStagedImport(pending.id)
    const draft = await h.store.saveDraft({ ...row('draft'), visitId: 'unfinished', updatedAt: 1 }, { expectedVersion: null })
    await h.store.hasDraft(); await h.store.loadDraft(); await h.store.clearDraft(draft.id, { expectedVersion: draft.version! })
    expect((await h.store.loadIndex()).revision).toBe(1)
    await h.store.commitStagedImport(pending.id)
    expect(await h.store.loadIndex()).toEqual({ visits: [summary(row('v1')), summary(row('v2'))], covers: [{ placeId: 'yulong', visitId: 'v2', photoId: 'photo-one' }], revision: 2 })
    await h.store.discardImportStage(pending.id)
    expect((await h.store.loadIndex()).revision).toBe(2)
  })

  it('rejects a stale revision before issuing any full visit read after another page commits', async () => {
    const h = harness(), other = harness(h)
    await h.store.addVisit(row())
    const index = await h.store.loadIndex()
    await other.store.addVisit(row('other'))
    const get = vi.spyOn(IDBObjectStore.prototype, 'get')
    await expect(h.store.readVisit('one', { expectedRevision: index.revision })).rejects.toMatchObject({ code: 'stale' })
    expect(storeNames(get.mock.contexts)).toEqual(['libraryMeta'])
    expect(await h.store.readVisit('one', { expectedRevision: 2 })).toEqual(row())
  })

  for (const invalid of [null, [], '', { expectedRevision: -1 }, { expectedRevision: 1.5 }, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }, { extra: true }, { signal: {} }]) {
    it(`rejects invalid read options without opening storage: ${JSON.stringify(invalid)}`, async () => {
      const h = harness(), opening = vi.spyOn(h.indexedDB, 'open')
      await expect(h.store.readVisit('one', invalid as never)).rejects.toMatchObject({ code: 'invalid' })
      expect(opening).not.toHaveBeenCalled()
    })
  }
  for (const invalid of ['', '../one', 7, null, 'x'.repeat(101)]) {
    it(`rejects an invalid read id: ${JSON.stringify(invalid)}`, async () => {
      const h = harness(), opening = vi.spyOn(h.indexedDB, 'open')
      await expect(h.store.readVisit(invalid as never)).rejects.toMatchObject({ code: 'invalid' })
      expect(opening).not.toHaveBeenCalled()
    })
  }
  it('validates catalogue/draft options and honours pre-abort without touching IDB', async () => {
    const h = harness(), opening = vi.spyOn(h.indexedDB, 'open'), controller = new AbortController()
    for (const invalid of [null, [], { expectedRevision: 0 }, { signal: {} }]) {
      await expect(h.store.loadIndex(invalid as never)).rejects.toMatchObject({ code: 'invalid' })
      await expect(h.store.hasDraft(invalid as never)).rejects.toMatchObject({ code: 'invalid' })
    }
    controller.abort()
    for (const operation of [() => h.store.loadIndex({ signal: controller.signal }), () => h.store.hasDraft({ signal: controller.signal }), () => h.store.readVisit('one', { signal: controller.signal })]) {
      await expect(operation()).rejects.toMatchObject({ code: 'aborted' })
    }
    expect(opening).not.toHaveBeenCalled()
  })

  for (const corruption of ['missing-index', 'dirty-photo', 'missing-meta', 'bad-revision', 'orphan-cover'] as const) {
    it(`refuses ${corruption} without silently displaying an empty library or repairing persisted rows`, async () => {
      const h = harness(); await h.store.addVisit(row())
      if (corruption === 'missing-index') await rawWrite(h, 'visitIndex', 'one', 'delete')
      if (corruption === 'dirty-photo') await rawWrite(h, 'visitIndex', { ...summary(row()), photos: row().photos })
      if (corruption === 'missing-meta') await rawWrite(h, 'libraryMeta', 'library', 'delete')
      if (corruption === 'bad-revision') await rawWrite(h, 'libraryMeta', { id: 'library', revision: -1 })
      if (corruption === 'orphan-cover') await rawWrite(h, 'covers', { placeId: 'yulong', visitId: 'missing', photoId: 'photo-one' })
      const before = await dump(h)
      await expect(h.store.loadIndex()).rejects.toMatchObject({ code: 'index-invalid' })
      expect(await dump(h)).toEqual(before)
    })
  }

  it('aborts every v3 migration change when a later old row is malformed, then succeeds after an explicit test-only repair', async () => {
    const id = identity(), old = harness(id, true)
    await old.store.addVisit(row('a-good'))
    await old.store.addVisit({ id: 'z-bad', note: 'Do not drop me' } as Visit)
    await old.store.close()
    const before = await dump(id), h = harness(id)
    await expect(h.store.loadIndex()).rejects.toMatchObject({ code: 'invalid' })
    await h.store.close()
    expect(await dump(id)).toEqual(before)
    // Explicit fixture repair, never application self-repair or user data.
    await rawWrite(id, 'visits', row('z-bad'))
    expect((await harness(id).store.loadIndex()).visits).toHaveLength(2)
  })

  for (const failureAt of ['libraryMeta', 'visitIndex'] as const) {
    it(`rolls back formal rows, covers, revision and import receipt on ${failureAt} write failure`, async () => {
      const h = harness(); await h.store.addVisit(row('existing'))
      const pending = await stage(h.store, row('incoming')), before = await dump(h)
      const original = failureAt === 'libraryMeta' ? IDBObjectStore.prototype.put : IDBObjectStore.prototype.add
      const method = failureAt === 'libraryMeta' ? 'put' : 'add'
      const spy = vi.spyOn(IDBObjectStore.prototype, method).mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (this.name === failureAt) throw new DOMException('Injected quota exhaustion', 'QuotaExceededError')
        return original.call(this, value, key)
      })
      await expect(h.store.commitStagedImport(pending.id)).rejects.toMatchObject({ code: 'quota' })
      spy.mockRestore()
      expect(await dump(h)).toEqual(before)
      await h.store.commitStagedImport(pending.id)
      expect((await h.store.loadIndex()).visits.map(value => value.id)).toEqual(['existing', 'incoming'])
    })
  }
  it('rolls back a late visit write after index/revision requests have already succeeded', async () => {
    const h = harness(); await h.store.loadIndex(); const before = await dump(h)
    const original = IDBObjectStore.prototype.add
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'visits') throw new DOMException('Injected formal row failure', 'QuotaExceededError')
      return original.call(this, value, key)
    })
    await expect(h.store.addVisit(row())).rejects.toMatchObject({ code: 'quota' })
    spy.mockRestore()
    expect(await dump(h)).toEqual(before)
  })
  it('rolls back the entire migration when creating its last derived store fails', async () => {
    const id = identity(), old = harness(id, true); await old.store.addVisit(row()); await old.store.close()
    const before = await dump(id), original = FakeDatabase.prototype.createObjectStore
    const spy = vi.spyOn(FakeDatabase.prototype, 'createObjectStore').mockImplementation(function (this: IDBDatabase, name: string, options?: IDBObjectStoreParameters) {
      if (name === 'libraryMeta') throw new DOMException('Injected migration failure', 'QuotaExceededError')
      return original.call(this, name, options)
    })
    const h = harness(id); await expect(h.store.loadIndex()).rejects.toMatchObject({ code: 'quota' })
    spy.mockRestore(); await h.store.close()
    expect(await dump(id)).toEqual(before)
  })
  it('preserves an asynchronous upgrade request error instead of hiding it behind the final open AbortError', async () => {
    const id = identity(), old = harness(id, true); await old.store.addVisit(row()); await old.store.close()
    const before = await dump(id), original = IDBObjectStore.prototype.add
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const result = original.call(this, value, key)
      // Two valid queued add requests: the second fails asynchronously with
      // ConstraintError, exactly through the IndexedDB request/transaction path.
      // No synthetic thrown exception or fake event stands in for the failure.
      if (this.name === 'visitIndex' && this.transaction.mode === 'versionchange') original.call(this, value, key)
      return result
    })
    const h = harness(id)
    await expect(h.store.loadIndex()).rejects.toMatchObject({ code: 'conflict', cause: { name: 'ConstraintError' } })
    spy.mockRestore(); await h.store.close()
    expect(await dump(id)).toEqual(before)
    expect((await harness(id).store.loadIndex()).visits).toEqual([summary(row())])
  })
  it('cancels an in-flight demand read before exposing the row and leaves all stores unchanged', async () => {
    const h = harness(); await h.store.addVisit(row()); const before = await dump(h)
    const controller = new AbortController(), original = IDBObjectStore.prototype.get
    const spy = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      const result = original.call(this, key)
      if (this.name === 'libraryMeta') result.addEventListener('success', () => controller.abort(), { once: true })
      return result
    })
    await expect(h.store.readVisit('one', { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(storeNames(spy.mock.contexts)).toEqual(['libraryMeta'])
    spy.mockRestore()
    expect(await dump(h)).toEqual(before)
    expect(await h.store.readVisit('one')).toEqual(row())
  })
  for (const cancellation of ['timeout', 'close'] as const) {
    it(`rolls back an already-started migration on ${cancellation}, including successful earlier index writes`, async () => {
      const id = identity(), old = harness(id, true)
      await old.store.addVisit(row('a-first')); await old.store.addVisit(row('z-later'))
      const savedDraft = await old.store.saveDraft({ ...row('draft'), visitId: 'unfinished', date: '', updatedAt: 1 }, { expectedVersion: null })
      await old.store.close()
      const before = await dump(id)
      let expire: () => void = () => { throw new Error('Open deadline was not registered') }
      const h = harness(id, false, callback => { expire = callback })
      const original = IDBObjectStore.prototype.add
      let cancelled = false, projected = 0, closing: Promise<void> | undefined
      const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        const result = original.call(this, value, key)
        if (this.name === 'visitIndex' && this.transaction.mode === 'versionchange') result.addEventListener('success', () => {
          projected++
          if (cancelled) return
          cancelled = true
          if (cancellation === 'timeout') expire()
          else closing = h.store.close()
        }, { once: true })
        return result
      })
      await expect(h.store.loadIndex()).rejects.toMatchObject({ code: cancellation === 'timeout' ? 'blocked' : 'unavailable' })
      await closing
      expect(cancelled).toBe(true)
      expect(projected).toBeGreaterThan(0)
      spy.mockRestore()
      // This queued open waits for versionchange to finish; no timer sleeps or
      // assumptions about when asynchronous rollback becomes visible are used.
      expect(await dump(id)).toEqual(before)
      if (cancellation === 'close') await expect(h.store.loadIndex()).rejects.toMatchObject({ code: 'unavailable' })
      const retry = cancellation === 'timeout' ? h : harness(id)
      expect((await retry.store.loadIndex()).visits).toEqual([summary(row('a-first')), summary(row('z-later'))])
      expect(await retry.store.loadDraft()).toEqual(savedDraft)
    })
  }
  it('does not report a rolled-back timeout when the upgrade already passed its commit point', async () => {
    const id = identity(), old = harness(id, true); await old.store.addVisit(row()); await old.store.close()
    let expire: () => void = () => { throw new Error('Open deadline was not registered') }
    const h = harness(id, false, callback => { expire = callback }), original = id.indexedDB.open.bind(id.indexedDB)
    vi.spyOn(id.indexedDB, 'open').mockImplementation((name, version) => {
      const result = original(name, version)
      result.addEventListener('upgradeneeded', () => {
        // Registered before the kernel's completion handler: simulate a deadline
        // delivered after commit but before connection success publication.
        result.transaction!.addEventListener('complete', () => expire(), { once: true })
      }, { once: true })
      return result
    })
    expect(await h.store.loadIndex()).toEqual({ visits: [summary(row())], covers: [], revision: 0 })
    expect((await dump(id)).version).toBe(4)
  })
  it('rolls back a timed-out first-ever schema creation without leaving a partial database', async () => {
    const id = identity()
    let expire: () => void = () => { throw new Error('Open deadline was not registered') }
    const h = harness(id, false, callback => { expire = callback }), original = IDBObjectStore.prototype.add
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const result = original.call(this, value, key)
      if (this.name === 'libraryMeta' && this.transaction.mode === 'versionchange') result.addEventListener('success', () => expire(), { once: true })
      return result
    })
    await expect(h.store.loadIndex()).rejects.toMatchObject({ code: 'blocked' })
    spy.mockRestore()
    expect(await id.indexedDB.databases()).toEqual([])
    expect(await h.store.loadIndex()).toEqual({ visits: [], covers: [], revision: 0 })
  })
  it('rejects a close delivered after upgrade commit and never publishes or resurrects the closing connection', async () => {
    const id = identity(), old = harness(id, true); await old.store.addVisit(row()); await old.store.close()
    const before = await dump(id), h = harness(id), original = id.indexedDB.open.bind(id.indexedDB)
    let committedDatabase: IDBDatabase | undefined
    const closed = vi.spyOn(FakeDatabase.prototype, 'close')
    const opening = vi.spyOn(id.indexedDB, 'open').mockImplementation((name, version) => {
      const result = original(name, version)
      result.addEventListener('upgradeneeded', () => {
        result.transaction!.addEventListener('complete', () => { committedDatabase = result.result; void h.store.close() }, { once: true })
      }, { once: true })
      return result
    })
    await expect(h.store.loadIndex()).rejects.toMatchObject({ code: 'unavailable' })
    expect(closed.mock.contexts).toContain(committedDatabase)
    await expect(h.store.readVisit('one')).rejects.toMatchObject({ code: 'unavailable' })
    opening.mockRestore(); closed.mockRestore()
    const after = await dump(id)
    // This event is AFTER the irreversible commit point: only the connection
    // is closed, not a fabricated promise of rolling the committed schema back.
    expect(after.version).toBe(4)
    for (const [name, values] of Object.entries(before.rows)) expect(after.rows[name]).toEqual(values)
    expect(await harness(id).store.readVisit('one')).toEqual(row())
  })
  it('closes a late successful open after an earlier deadline and never publishes that connection', async () => {
    const id = identity(), initial = harness(id); await initial.store.addVisit(row()); await initial.store.close()
    const before = await dump(id)
    let expire: () => void = () => { throw new Error('Open deadline was not registered') }
    const h = harness(id, false, callback => { expire = callback }), original = id.indexedDB.open.bind(id.indexedDB)
    let lateDatabase: IDBDatabase | undefined
    const closed = vi.spyOn(FakeDatabase.prototype, 'close')
    const opening = vi.spyOn(id.indexedDB, 'open').mockImplementation((name, version) => {
      const result = original(name, version)
      result.addEventListener('success', () => { lateDatabase = result.result; expire() }, { once: true })
      return result
    })
    await expect(h.store.loadIndex()).rejects.toMatchObject({ code: 'blocked' })
    expect(lateDatabase).toBeDefined()
    expect(closed.mock.contexts).toContain(lateDatabase)
    opening.mockRestore(); closed.mockRestore()
    expect(await dump(id)).toEqual(before)
    expect((await h.store.loadIndex()).visits).toEqual([summary(row())])
  })
  it('rejects revision overflow instead of losing stale-read protection', async () => {
    const h = harness(); await h.store.loadIndex()
    await rawWrite(h, 'libraryMeta', { id: 'library', revision: Number.MAX_SAFE_INTEGER })
    const before = await dump(h)
    await expect(h.store.addVisit(row())).rejects.toMatchObject({ code: 'index-invalid' })
    expect(await dump(h)).toEqual(before)
  })
})
