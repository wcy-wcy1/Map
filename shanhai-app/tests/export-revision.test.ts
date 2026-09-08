// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange, IDBObjectStore, IDBTransaction as FakeTransaction, IDBDatabase as FakeDatabase } from 'fake-indexeddb'
import { webcrypto } from 'node:crypto'
import { createCatalogue } from '../src/domain/catalogue'
import { createBackupKernel } from '../src/generated/backup-kernel.js'
import { createLocalStoreKernel } from '../src/generated/local-store-kernel.js'
import type { LocalStoreKernel, TravelPlatform } from '../src/services/contracts'
import type { Visit } from '../src/domain/models'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const row = (id = 'one'): Visit => ({ id, createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '雪山 🌄',
  photos: [{ id: 'photo-one', name: '雪山.png', url: png }], coverId: 'photo-one' })
let serial = 0
const opened: LocalStoreKernel[] = []
function identity() { return { indexedDB: new IDBFactory(), dbName: `export-fence-${++serial}` } }
type Identity = ReturnType<typeof identity>
function harness(id = identity()) {
  const catalogue = createCatalogue(), platform: TravelPlatform = { ...id, IDBKeyRange, crypto: webcrypto as unknown as Crypto, Blob, TextEncoder,
    setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }
  const backup = createBackupKernel({ catalogue, platform }), store = createLocalStoreKernel({ catalogue, backup, platform }, { dbName: id.dbName })
  opened.push(store)
  return { ...id, store }
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(opened.splice(0).map(store => store.close())) })
function request<T>(req: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) }) }
async function dump(id: Identity) {
  const db = await request(id.indexedDB.open(id.dbName))
  try {
    const names = [...db.objectStoreNames], tx = db.transaction(names)
    return { version: db.version, rows: Object.fromEntries(await Promise.all(names.map(async name => [name, await request(tx.objectStore(name).getAll())]))) }
  } finally { db.close() }
}
async function metadata(id: Identity, value: unknown) {
  const db = await request(id.indexedDB.open(id.dbName))
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('libraryMeta', 'readwrite')
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
      if (value === undefined) tx.objectStore('libraryMeta').delete('library')
      else tx.objectStore('libraryMeta').put(value)
    })
  } finally { db.close() }
}

describe('export revision fence', () => {
  it('reads only libraryMeta in a readonly transaction and preserves every schema-4 store and revision', async () => {
    const h = harness(); await h.store.addVisit(row())
    const before = await dump(h), revision = (await h.store.loadIndex()).revision
    const get = vi.spyOn(IDBObjectStore.prototype, 'get'), getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll'), cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
    const transaction = vi.spyOn(FakeDatabase.prototype, 'transaction')
    const forbidden = vi.spyOn(h.store, 'load').mockRejectedValue(new Error('No full snapshot allowed'))
    const index = vi.spyOn(h.store, 'loadIndex').mockRejectedValue(new Error('No index reread allowed'))
    expect(await h.store.assertRevision(revision)).toBeUndefined()
    expect(get.mock.contexts.map(store => (store as IDBObjectStore).name)).toEqual(['libraryMeta'])
    expect(get.mock.calls).toEqual([['library']])
    expect(transaction.mock.calls).toEqual([[['libraryMeta'], 'readonly']])
    expect(getAll).not.toHaveBeenCalled(); expect(cursor).not.toHaveBeenCalled()
    expect(forbidden).not.toHaveBeenCalled(); expect(index).not.toHaveBeenCalled()
    vi.restoreAllMocks()
    expect(await dump(h)).toEqual(before)
    expect(before.version).toBe(4)
  })

  for (const change of ['add', 'edit', 'delete', 'cover'] as const) {
    it(`detects a second page's ${change} after the final source read`, async () => {
      const h = harness(), other = harness(h), visit = row()
      await h.store.addVisit(visit)
      const revision = (await h.store.loadIndex()).revision
      await h.store.readVisit(visit.id, { expectedRevision: revision })
      if (change === 'add') await other.store.addVisit(row('two'))
      if (change === 'edit') await other.store.updateVisit({ ...visit, note: '另一页修改' }, { expectedVisit: visit })
      if (change === 'delete') await other.store.deleteVisit(visit.id, { expectedVisit: visit })
      if (change === 'cover') await other.store.setMapCover(visit.placeId, { visitId: visit.id, photoId: visit.coverId! })
      const before = await dump(h)
      await expect(h.store.assertRevision(revision)).rejects.toMatchObject({ code: 'stale' })
      expect(await dump(h)).toEqual(before)
      await h.store.assertRevision((await h.store.loadIndex()).revision)
    })
  }

  it.each([undefined, -1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, '1'])('rejects invalid expected revision %s before any database access', async revision => {
    const h = harness(), open = vi.spyOn(h.indexedDB, 'open')
    await expect(h.store.assertRevision(revision as number)).rejects.toMatchObject({ code: 'invalid' })
    expect(open).not.toHaveBeenCalled()
  })

  it.each([undefined, { id: 'library', revision: -1 }, { id: 'library', revision: 0.5 },
    { id: 'library', revision: Number.MAX_SAFE_INTEGER + 1 }, { id: 'library', revision: 0, extra: true }])('rejects malformed persisted metadata without repairing it: %j', async value => {
    const h = harness(); await h.store.loadIndex(); await metadata(h, value)
    const before = await dump(h)
    await expect(h.store.assertRevision(0)).rejects.toMatchObject({ code: 'index-invalid' })
    expect(await dump(h)).toEqual(before)
  })

  it('accepts the highest safe revision because it does not increment or mutate metadata', async () => {
    const h = harness(); await h.store.loadIndex()
    await metadata(h, { id: 'library', revision: Number.MAX_SAFE_INTEGER })
    const before = await dump(h)
    await h.store.assertRevision(Number.MAX_SAFE_INTEGER)
    expect(await dump(h)).toEqual(before)
  })

  it('waits for abort transaction settlement and never reports success after cancelling a metadata read', async () => {
    const h = harness(); await h.store.addVisit(row())
    const before = await dump(h), controller = new AbortController(), trace: string[] = []
    const original = IDBObjectStore.prototype.get
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      const req = original.call(this, key)
      if (this.name === 'libraryMeta') {
        this.transaction.addEventListener('abort', () => { trace.push('transaction-aborted') })
        req.addEventListener('success', () => { trace.push('cancel'); controller.abort() })
      }
      return req
    })
    const pending = h.store.assertRevision(1, { signal: controller.signal }).catch(error => { trace.push('rejected'); throw error })
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(trace).toEqual(['cancel', 'transaction-aborted', 'rejected'])
    vi.restoreAllMocks()
    expect(await dump(h)).toEqual(before)
    await h.store.assertRevision(1)
  })

  for (const operation of ['assertRevision', 'readVisit', 'loadIndex'] as const) {
    it(`${operation} waits for an actually withheld complete event after an internal commit makes abort invalid`, async () => {
      const h = harness(); await h.store.addVisit(row())
      const before = await dump(h), controller = new AbortController(), original = FakeTransaction.prototype.dispatchEvent
      const startTransaction = FakeDatabase.prototype.transaction
      let target: IDBTransaction | undefined
      vi.spyOn(FakeDatabase.prototype, 'transaction').mockImplementation(function (this: IDBDatabase, names, mode, options) {
        target = startTransaction.call(this, names, mode, options)
        return target
      })
      let entered!: () => void, release!: () => void, finished = false
      const held = new Promise<void>(resolve => { entered = resolve })
      vi.spyOn(FakeTransaction.prototype, 'dispatchEvent').mockImplementation(function (this: IDBTransaction, event) {
        if (event.type === 'complete' && this === target) {
          // fake-indexeddb already set the transaction to finished. Hold only
          // event delivery, so native abort throws InvalidStateError.
          release = () => { original.call(this, event) }
          entered()
          return true
        }
        return original.call(this, event)
      })
      const options = { signal: controller.signal }
      const pending = operation === 'assertRevision' ? h.store.assertRevision(1, options)
        : operation === 'readVisit' ? h.store.readVisit('one', { ...options, expectedRevision: 1 }) : h.store.loadIndex(options)
      const rejection = expect(pending).rejects.toMatchObject({ code: 'aborted' })
      void pending.then(() => { finished = true }, () => { finished = true })
      await held
      controller.abort()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(finished).toBe(false)
      release()
      await rejection
      vi.restoreAllMocks()
      expect(await dump(h)).toEqual(before)
    })
  }

  it('rejects pre-aborted signals without opening, and closed connections without resurrecting them', async () => {
    const h = harness(), controller = new AbortController(), open = vi.spyOn(h.indexedDB, 'open')
    controller.abort()
    await expect(h.store.assertRevision(0, { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(open).not.toHaveBeenCalled()
    await h.store.loadIndex(); await h.store.close(); open.mockClear()
    await expect(h.store.assertRevision(0)).rejects.toMatchObject({ code: 'unavailable' })
    expect(open).not.toHaveBeenCalled()
  })
})
