// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange, IDBObjectStore, IDBCursor, IDBDatabase as FakeDatabase, forceCloseDatabase } from 'fake-indexeddb'
import { createHash } from 'node:crypto'
import { createExportStore } from '../src/services/export-store'
import type { TravelPlatform } from '../src/services/contracts'
import type { ExportCompletion, ExportPayload, ExportSessionBase, ExportStore } from '../src/services/export-types'

let sequence = 0
const tracked: ExportStore[] = []
const at = '2026-09-07T01:02:03.000Z'
const base = (id = 'one'): ExportSessionBase => ({ id, sourceDbName: 'formal-library', sourceRevision: 17, createdAt: at,
  summary: { visits: 1, photos: 1, places: 1, from: '2026-01-01', to: '2026-01-01' } })
function part(index = 1, value = '一段测试内容 🏔️\n'): ExportPayload {
  const blob = new Blob([value])
  return { part: index, bytes: blob.size, blob, sha256: createHash('sha256').update(value).digest('hex') }
}
function complete(parts: ExportPayload[] = [part()]): ExportCompletion {
  const files = parts.map(p => ({ filename: `archive-part-${p.part}.json`, bytes: p.bytes + 500, part: p.part }))
  return { archive: { format: 'volume-v2', archiveId: 'archive-test', exportedAt: at, archiveSha256: 'a'.repeat(64),
    manifest: { encoding: 'shanhai-ndjson-v1', summary: base().summary, covers: 1, records: 4,
      parts: parts.map(p => ({ bytes: p.bytes, sha256: p.sha256 })) } }, files, totalBytes: files.reduce((n, p) => n + p.bytes, 0) }
}
function harness(indexedDB = new IDBFactory(), dbName = `export-store-${++sequence}`, extra: Partial<TravelPlatform> = {}) {
  const platform: TravelPlatform = { indexedDB, IDBKeyRange, Blob, TextEncoder,
    setTimeout: (callback, delay) => setTimeout(callback, delay), clearTimeout: value => clearTimeout(value as ReturnType<typeof setTimeout>), ...extra }
  const store = createExportStore(platform, dbName)
  tracked.push(store)
  return { store, platform, indexedDB, dbName }
}
type Harness = ReturnType<typeof harness>
function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error) }) }
async function raw(h: Harness, action: (tx: IDBTransaction) => void) {
  const db = await request(h.indexedDB.open(h.dbName))
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['sessions', 'parts'], 'readwrite')
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
    action(tx)
  }) } finally { db.close() }
}
async function edit(h: Harness, store: string, key: IDBValidKey, transform: (value: Record<string, unknown>) => unknown) {
  return raw(h, tx => {
    const table = tx.objectStore(store), get = table.get(key)
    get.onsuccess = () => { table.put(transform(get.result)) }
  })
}
async function staged(h: Harness, id = 'one', parts = [part()]) {
  await h.store.begin(base(id), `token-${id}`)
  for (const p of parts) await h.store.appendPart(id, `token-${id}`, p)
}
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(tracked.splice(0).map(store => store.close())) })

describe('independent export spool transactions', () => {
  it('is lazy, explicit, schema 1, platform-local, and exposes only safe session metadata', async () => {
    const factory = new IDBFactory(), open = vi.spyOn(factory, 'open'), h = harness(factory)
    expect(open).not.toHaveBeenCalled()
    await staged(h)
    expect(open).toHaveBeenCalledWith(h.dbName, 1)
    expect(await h.store.get('one')).toEqual({ ...base(), status: 'building' })
    expect(await h.store.list()).toEqual([{ ...base(), status: 'building' }])
    const db = await request(factory.open(h.dbName))
    expect(db.version).toBe(1)
    expect([...db.objectStoreNames]).toEqual(['parts', 'sessions'])
    expect(db.transaction('parts').objectStore('parts').keyPath).toEqual(['sessionId', 'part'])
    db.close()
    const other = harness(new IDBFactory(), h.dbName)
    expect(await other.store.list()).toEqual([])
    expect(await h.store.get('absent')).toBeNull()
  })

  it('requires the writer on building reads and makes committed ready payloads readable without exposing it', async () => {
    const h = harness(), p = part()
    await staged(h)
    await expect(h.store.readPart('one', 1)).rejects.toMatchObject({ code: 'export-state' })
    await expect(h.store.readPart('one', 1, { writerToken: 'wrong' })).rejects.toMatchObject({ code: 'export-state' })
    expect(await (await h.store.readPart('one', 1, { writerToken: 'token-one' })).blob.text()).toBe(await p.blob.text())
    const ready = await h.store.complete('one', 'token-one', complete())
    expect(ready).toEqual({ ...base(), status: 'ready', ...complete() })
    expect(await h.store.get('one')).toEqual(ready)
    expect(await h.store.list()).toEqual([ready])
    expect((await h.store.readPart('one', 1)).sha256).toBe(p.sha256)
    await expect(h.store.readPart('one', 2)).rejects.toMatchObject({ code: 'integrity' })
    await expect(h.store.appendPart('one', 'token-one', part(2))).rejects.toMatchObject({ code: 'export-state' })
    await expect(h.store.complete('one', 'token-one', complete())).rejects.toMatchObject({ code: 'export-state' })
  })

  it('does not overwrite sessions or parts, accept gaps, or allow a foreign writer', async () => {
    const h = harness()
    await staged(h)
    await expect(h.store.begin(base(), 'second')).rejects.toMatchObject({ code: 'export-state' })
    await expect(h.store.appendPart('one', 'wrong', part(2))).rejects.toMatchObject({ code: 'export-state' })
    await expect(h.store.complete('one', 'wrong', complete())).rejects.toMatchObject({ code: 'export-state' })
    await expect(h.store.appendPart('one', 'token-one', part(1, 'replacement'))).rejects.toMatchObject({ code: 'integrity' })
    await expect(h.store.appendPart('one', 'token-one', part(3))).rejects.toMatchObject({ code: 'integrity' })
    await expect(h.store.appendPart('absent', 'token-one', part())).rejects.toMatchObject({ code: 'export-state' })
    expect(await (await h.store.readPart('one', 1, { writerToken: 'token-one' })).blob.text()).toBe(await part().blob.text())
    // Even a damaged nextPart counter cannot turn add into an overwrite.
    await edit(h, 'sessions', 'one', v => ({ ...v, nextPart: 1 }))
    await expect(h.store.appendPart('one', 'token-one', part())).rejects.toMatchObject({ code: 'export-state' })
  })

  it('scans parts with a cursor and never builds a Blob array using getAll', async () => {
    const h = harness(), parts = [part(1, '前半\n'), part(2, '后半\n')]
    await staged(h, 'one', parts)
    const getAll = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(() => { throw Error('getAll forbidden') })
    const cursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
    await h.store.complete('one', 'token-one', complete(parts))
    await h.store.list()
    await h.store.readPart('one', 2)
    expect(getAll).not.toHaveBeenCalled()
    expect(cursor.mock.contexts.some(v => (v as IDBObjectStore).name === 'parts')).toBe(true)
  })

  it('copies caller metadata before waiting and drops arbitrary fields from returned metadata', async () => {
    const h = harness(), b = { ...base(), opaquePhoto: 'data:image/private' }
    const begun = h.store.begin(b, 'token-one')
    b.summary.photos = 0
    await begun
    await h.store.appendPart('one', 'token-one', part())
    const c = complete(), finishing = h.store.complete('one', 'token-one', c)
    c.files[0]!.filename = 'mutated.json'
    const ready = await finishing
    expect(ready.files[0]!.filename).toBe('archive-part-1.json')
    await edit(h, 'sessions', 'one', v => ({ ...v, writerToken: 'private', opaquePhoto: 'data:image/private' }))
    expect(JSON.stringify(await h.store.list())).not.toMatch(/private|opaquePhoto|writerToken|nextPart/)
  })

  for (const [label, transform] of [
    ['wrong Blob size', (v: Record<string, unknown>) => ({ ...v, blob: new Blob(['bad']) })],
    ['wrong hash', (v: Record<string, unknown>) => ({ ...v, sha256: 'b'.repeat(64) })],
    ['invalid hash', (v: Record<string, unknown>) => ({ ...v, sha256: 'not-a-hash' })],
    ['wrong byte metadata', (v: Record<string, unknown>) => ({ ...v, bytes: 9 })],
    ['non Blob', (v: Record<string, unknown>) => ({ ...v, blob: { size: part().bytes } })],
  ] as const) it(`rejects completion with ${label}`, async () => {
    const h = harness()
    await staged(h)
    await edit(h, 'parts', ['one', 1], transform)
    await expect(h.store.complete('one', 'token-one', complete())).rejects.toMatchObject({ code: 'integrity' })
    expect((await h.store.get('one'))?.status).toBe('building')
  })

  for (const extra of [0, -1, 2, 'broken', ['broken']] as IDBValidKey[]) it(`rejects an extra or invalid persisted part key ${JSON.stringify(extra)}`, async () => {
    const h = harness()
    await staged(h)
    await raw(h, tx => { tx.objectStore('parts').add({ ...part(), sessionId: 'one', part: extra }) })
    await expect(h.store.complete('one', 'token-one', complete())).rejects.toMatchObject({ code: 'integrity' })
  })

  it('rejects missing parts, gaps, and corrupt progress even when the advertised manifest looks valid', async () => {
    const h = harness(), parts = [part(1), part(2)]
    await staged(h, 'one', parts)
    await raw(h, tx => { tx.objectStore('parts').delete(['one', 1]) })
    await expect(h.store.complete('one', 'token-one', complete(parts))).rejects.toMatchObject({ code: 'integrity' })
    await raw(h, tx => { tx.objectStore('parts').add({ ...part(), sessionId: 'one' }) })
    await edit(h, 'sessions', 'one', v => ({ ...v, nextPart: 200 }))
    await expect(h.store.complete('one', 'token-one', complete(parts))).rejects.toMatchObject({ code: 'integrity' })
  })

  for (const [label, mutate] of [
    ['summary', (c: ExportCompletion) => { c.archive.manifest.summary.photos = 2; c.archive.manifest.records = 5 }],
    ['record total', (c: ExportCompletion) => { c.archive.manifest.records++ }],
    ['file ordering', (c: ExportCompletion) => { c.files[0]!.part = 2 }],
    ['file count', (c: ExportCompletion) => { c.files = [] }],
    ['file total', (c: ExportCompletion) => { c.totalBytes++ }],
    ['file size limit', (c: ExportCompletion) => { c.files[0]!.bytes = 100 * 1024 * 1024 + 1; c.totalBytes = c.files[0]!.bytes }],
    ['file name', (c: ExportCompletion) => { c.files[0]!.filename = '../bad.json' }],
    ['archive version', (c: ExportCompletion) => { (c.archive as { format: string }).format = 'future-v3' }],
  ] as const) it(`rejects inconsistent completion ${label}`, async () => {
    const h = harness()
    await staged(h)
    const c = complete(); mutate(c)
    await expect(h.store.complete('one', 'token-one', c)).rejects.toMatchObject({ code: 'integrity' })
    expect((await h.store.get('one'))?.status).toBe('building')
  })

  it('checks size and manifest metadata again on ready reads and rejects invalid session versions', async () => {
    const h = harness()
    await staged(h)
    await h.store.complete('one', 'token-one', complete())
    await edit(h, 'parts', ['one', 1], v => ({ ...v, sha256: 'b'.repeat(64) }))
    await expect(h.store.readPart('one', 1)).rejects.toMatchObject({ code: 'integrity' })
    await edit(h, 'parts', ['one', 1], v => ({ ...v, sha256: part().sha256, blob: new Blob(['short']) }))
    await expect(h.store.readPart('one', 1)).rejects.toMatchObject({ code: 'integrity' })
    await edit(h, 'sessions', 'one', v => ({ ...v, status: 'future-state' }))
    expect((await h.store.get('one'))?.status).toBe('damaged')
    expect((await h.store.list())[0]?.status).toBe('damaged')
    await expect(h.store.readPart('one', 1)).rejects.toMatchObject({ code: 'integrity' })
  })

  it('invalidates writers before cleanup, rejects concurrent append/complete, and leaves adjacent IDs and source DBs intact', async () => {
    const h = harness(), other = harness(h.indexedDB, h.dbName)
    await staged(h)
    await staged(h, 'one-more')
    await staged(h, 'two')
    const formalRequest = h.indexedDB.open('formal-library', 4)
    formalRequest.onupgradeneeded = () => { formalRequest.result.createObjectStore('visits'); formalRequest.result.createObjectStore('backupImportSessions') }
    const formal = await request(formalRequest)
    await new Promise<void>((resolve, reject) => {
      const tx = formal.transaction(['visits', 'backupImportSessions'], 'readwrite')
      tx.objectStore('visits').put('private original', 'one')
      tx.objectStore('backupImportSessions').put('pending import', 'one')
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error)
    })
    await other.store.list()
    const outcomes = await Promise.allSettled([
      other.store.discard('one'), h.store.appendPart('one', 'token-one', part(2)), h.store.complete('one', 'token-one', complete()),
    ])
    expect(outcomes[0]!.status).toBe('fulfilled')
    expect(outcomes[1]).toMatchObject({ status: 'rejected', reason: { code: 'export-state' } })
    expect(outcomes[2]).toMatchObject({ status: 'rejected', reason: { code: 'export-state' } })
    expect(await h.store.get('one')).toBeNull()
    expect((await h.store.list()).map(v => v.id)).toEqual(['one-more', 'two'])
    expect((await h.store.readPart('one-more', 1, { writerToken: 'token-one-more' })).bytes).toBe(part().bytes)
    expect(await request(formal.transaction('visits').objectStore('visits').get('one'))).toBe('private original')
    expect(await request(formal.transaction('backupImportSessions').objectStore('backupImportSessions').get('one'))).toBe('pending import')
    formal.close()
    await h.store.discard('one')
    await h.store.discard('absent')
  })

  it('retains deleting metadata on interrupted cleanup, denies reads/writes, and retries only its exact rows', async () => {
    const h = harness()
    await staged(h)
    await staged(h, 'one-more')
    const remove = vi.spyOn(IDBCursor.prototype, 'delete').mockImplementationOnce(() => { throw new DOMException('synthetic', 'UnknownError') })
    await expect(h.store.discard('one')).rejects.toMatchObject({ cleanupPending: true, sessionId: 'one' })
    expect(await h.store.get('one')).toEqual({ ...base(), status: 'deleting' })
    expect((await h.store.list()).find(v => v.id === 'one')?.status).toBe('deleting')
    await expect(h.store.readPart('one', 1, { writerToken: 'token-one' })).rejects.toMatchObject({ code: 'export-state' })
    await expect(h.store.appendPart('one', 'token-one', part(2))).rejects.toMatchObject({ code: 'export-state' })
    await expect(h.store.complete('one', 'token-one', complete())).rejects.toMatchObject({ code: 'export-state' })
    remove.mockRestore()
    await h.store.discard('one')
    expect(await h.store.get('one')).toBeNull()
    expect((await h.store.get('one-more'))?.status).toBe('building')
  })

  it('waits for actual commit rather than request success for append and completion', async () => {
    const h = harness()
    await h.store.begin(base(), 'token-one')
    const committed: string[] = [], originalAdd = IDBObjectStore.prototype.add, originalPut = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'parts') this.transaction.addEventListener('complete', () => committed.push('part'))
      return originalAdd.apply(this, args)
    })
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'sessions' && args[0].status === 'ready') this.transaction.addEventListener('complete', () => committed.push('ready'))
      return originalPut.apply(this, args)
    })
    await h.store.appendPart('one', 'token-one', part())
    expect(committed).toEqual(['part'])
    await h.store.complete('one', 'token-one', complete())
    expect(committed).toEqual(['part', 'ready'])
  })

  it('does not resolve cancellation before the real append abort, and leaves no committed part', async () => {
    const h = harness(), controller = new AbortController()
    await h.store.begin(base(), 'token-one')
    let aborted = false
    const original = IDBObjectStore.prototype.add
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
      const r = original.apply(this, args)
      if (this.name === 'parts') {
        this.transaction.addEventListener('abort', () => { aborted = true })
        r.addEventListener('success', () => controller.abort())
      }
      return r
    })
    await expect(h.store.appendPart('one', 'token-one', part(), { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(aborted).toBe(true)
    await expect(h.store.readPart('one', 1, { writerToken: 'token-one' })).rejects.toMatchObject({ code: 'integrity' })
    await h.store.appendPart('one', 'token-one', part())
  })

  it('rolls back ready when cancelled at its final request', async () => {
    const h = harness(), controller = new AbortController()
    await staged(h)
    let aborted = false
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      const r = original.apply(this, args)
      if (this.name === 'sessions' && args[0].status === 'ready') {
        this.transaction.addEventListener('abort', () => { aborted = true })
        r.addEventListener('success', () => controller.abort())
      }
      return r
    })
    await expect(h.store.complete('one', 'token-one', complete(), { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(aborted).toBe(true)
    expect((await h.store.get('one'))?.status).toBe('building')
  })

  it('handles quota failure without retaining error payloads or advancing its write counter', async () => {
    const h = harness()
    await h.store.begin(base(), 'token-one')
    const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementationOnce(() => { throw new DOMException('data:image/private', 'QuotaExceededError') })
    const error = await h.store.appendPart('one', 'token-one', part()).catch(error => error)
    expect(error).toMatchObject({ code: 'quota' })
    expect(error.cause).toBeUndefined()
    expect(error.message).not.toContain('data:image')
    add.mockRestore()
    await h.store.appendPart('one', 'token-one', part())
  })

  it('pre-abort never opens a database and unavailable storage can be retried after permission recovery', async () => {
    const h = harness(), open = vi.spyOn(h.indexedDB, 'open'), controller = new AbortController()
    controller.abort()
    await expect(h.store.begin(base(), 'token', { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(open).not.toHaveBeenCalled()
    const denied = harness(undefined, undefined, { indexedDB: undefined })
    await expect(denied.store.list()).rejects.toMatchObject({ code: 'unavailable' })
    denied.platform.indexedDB = denied.indexedDB
    expect(await denied.store.list()).toEqual([])
  })

  it('close aborts and settles active work, rejects future work, and preserves rows for another instance', async () => {
    const h = harness()
    await h.store.begin(base(), 'token-one')
    let aborted = false, closing: Promise<void> | undefined
    const original = IDBObjectStore.prototype.add
    vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
      const r = original.apply(this, args)
      if (this.name === 'parts') {
        this.transaction.addEventListener('abort', () => { aborted = true })
        r.addEventListener('success', () => { closing = h.store.close() })
      }
      return r
    })
    await expect(h.store.appendPart('one', 'token-one', part())).rejects.toMatchObject({ code: 'unavailable' })
    await closing
    expect(aborted).toBe(true)
    await expect(h.store.list()).rejects.toMatchObject({ code: 'unavailable' })
    const next = harness(h.indexedDB, h.dbName)
    expect((await next.store.get('one'))?.status).toBe('building')
    await expect(next.store.readPart('one', 1, { writerToken: 'token-one' })).rejects.toMatchObject({ code: 'integrity' })
  })

  it('handles abnormal closure and versionchange without silently reopening an old connection', async () => {
    const h = harness(), transaction = vi.spyOn(FakeDatabase.prototype, 'transaction')
    await staged(h)
    const db = transaction.mock.contexts.find(db => (db as IDBDatabase).name === h.dbName) as IDBDatabase
    forceCloseDatabase(db as unknown as Parameters<typeof forceCloseDatabase>[0])
    await new Promise<void>(resolve => setImmediate(resolve))
    await expect(h.store.list()).rejects.toMatchObject({ code: 'unavailable' })
    const next = harness(h.indexedDB, h.dbName)
    await next.store.list()
    const upgraded = await request(h.indexedDB.open(h.dbName, 2))
    upgraded.close()
    await expect(next.store.list()).rejects.toMatchObject({ code: 'unavailable' })
    const future = harness(h.indexedDB, h.dbName)
    await expect(future.store.list()).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('closes a late open after timeout and can retry without a stale promise', async () => {
    let deadline!: () => void
    const h = harness(undefined, undefined, { setTimeout: callback => { deadline = callback; return 1 }, clearTimeout: () => undefined })
    const pending = h.store.begin(base(), 'token-one')
    deadline()
    await expect(pending).rejects.toMatchObject({ code: 'blocked' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await h.store.begin(base(), 'token-one')
    expect((await h.store.get('one'))?.status).toBe('building')
  })

  it('cancels an open waiter without allowing a late begin, and close prevents late upgrades', async () => {
    const h = harness(), controller = new AbortController()
    const opening = h.store.begin(base(), 'token-one', { signal: controller.signal })
    controller.abort()
    await expect(opening).rejects.toMatchObject({ code: 'aborted' })
    expect(await h.store.get('one')).toBeNull()
    const closing = harness(), pending = closing.store.begin(base(), 'token')
    const closed = closing.store.close()
    await expect(pending).rejects.toMatchObject({ code: 'unavailable' })
    await closed
    await new Promise<void>(resolve => setImmediate(resolve))
    const next = harness(closing.indexedDB, closing.dbName)
    expect(await next.store.list()).toEqual([])
  })

  it('rejects an existing wrong schema without touching its stores', async () => {
    const h = harness(), opening = h.indexedDB.open(h.dbName, 1)
    opening.onupgradeneeded = () => { opening.result.createObjectStore('visits') }
    const db = await request(opening)
    await expect(h.store.list()).rejects.toMatchObject({ code: 'unavailable' })
    expect([...db.objectStoreNames]).toEqual(['visits'])
    db.close()
  })

  it('rejects invalid input with safe messages before opening payload transactions', async () => {
    const h = harness()
    await expect(h.store.begin({ ...base(), sourceRevision: -1 }, 'writer')).rejects.toMatchObject({ code: 'integrity' })
    await expect(h.store.begin(base(), '')).rejects.toMatchObject({ code: 'export-state' })
    await expect(h.store.appendPart('one', 'writer', null as unknown as ExportPayload)).rejects.toMatchObject({ code: 'integrity' })
    await expect(h.store.complete('one', 'writer', null as unknown as ExportCompletion)).rejects.toMatchObject({ code: 'integrity' })
    await h.store.begin(base(), 'token-one')
    await expect(h.store.appendPart('one', 'token-one', { ...part(), bytes: 100 * 1024 * 1024 + 1 })).rejects.toMatchObject({ code: 'integrity' })
    await raw(h, tx => { tx.objectStore('parts').add({ ...part(), sessionId: 'orphan' }) })
    await expect(h.store.begin(base('orphan'), 'writer')).rejects.toMatchObject({ code: 'integrity' })
    expect(await h.store.get('orphan')).toBeNull()
  })

  it('rolls back a spontaneous transaction abort and keeps the next part retryable', async () => {
    const h = harness()
    await h.store.begin(base(), 'token-one')
    let aborted = false
    const original = IDBObjectStore.prototype.add
    const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args) {
      const r = original.apply(this, args)
      if (this.name === 'parts') {
        this.transaction.addEventListener('abort', () => { aborted = true })
        r.addEventListener('success', () => this.transaction.abort())
      }
      return r
    })
    await expect(h.store.appendPart('one', 'token-one', part())).rejects.toMatchObject({ code: 'failed' })
    expect(aborted).toBe(true)
    add.mockRestore()
    await h.store.appendPart('one', 'token-one', part())
  })

  it('waits for a cancelled read transaction before releasing its promise', async () => {
    const h = harness(), controller = new AbortController()
    await staged(h)
    await h.store.complete('one', 'token-one', complete())
    const original = IDBObjectStore.prototype.get
    let aborted = false
    vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, ...args) {
      const r = original.apply(this, args)
      if (this.name === 'parts') {
        this.transaction.addEventListener('abort', () => { aborted = true })
        r.addEventListener('success', () => controller.abort())
      }
      return r
    })
    await expect(h.store.readPart('one', 1, { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    expect(aborted).toBe(true)
  })

  it('keeps ready snapshots persistent across close and discards them idempotently from two instances', async () => {
    const h = harness()
    await staged(h)
    const ready = await h.store.complete('one', 'token-one', complete())
    await h.store.close()
    const a = harness(h.indexedDB, h.dbName), b = harness(h.indexedDB, h.dbName)
    expect(await a.store.get('one')).toEqual(ready)
    await b.store.list()
    await Promise.all([a.store.discard('one'), b.store.discard('one')])
    expect(await a.store.list()).toEqual([])
    await expect(a.store.readPart('one', 1)).rejects.toMatchObject({ code: 'export-state' })
  })

  for (const action of ['timeout', 'close'] as const) it(`waits for an in-flight schema upgrade to abort on ${action}`, async () => {
    let deadline!: () => void, aborted = false, closed: Promise<void> | undefined
    const h = harness(undefined, undefined, { setTimeout: callback => { deadline = callback; return 1 }, clearTimeout: () => undefined })
    const original = FakeDatabase.prototype.createObjectStore
    const create = vi.spyOn(FakeDatabase.prototype, 'createObjectStore').mockImplementation(function (this: IDBDatabase, ...args) {
      const table = original.apply(this, args)
      if (args[0] === 'parts') {
        table.transaction.addEventListener('abort', () => { aborted = true })
        if (action === 'timeout') deadline()
        else closed = h.store.close()
      }
      return table
    })
    await expect(h.store.begin(base(), 'token')).rejects.toMatchObject({ code: action === 'timeout' ? 'blocked' : 'unavailable' })
    await closed
    expect(aborted).toBe(true)
    create.mockRestore()
    const next = harness(h.indexedDB, h.dbName)
    expect(await next.store.list()).toEqual([])
  })

  it('does not claim rollback if the opening deadline arrives after the upgrade committed', async () => {
    let deadline!: () => void
    const h = harness(undefined, undefined, { setTimeout: callback => { deadline = callback; return 1 }, clearTimeout: () => undefined })
    const original = FakeDatabase.prototype.createObjectStore
    vi.spyOn(FakeDatabase.prototype, 'createObjectStore').mockImplementation(function (this: IDBDatabase, ...args) {
      const table = original.apply(this, args)
      if (args[0] === 'parts') table.transaction.addEventListener('complete', () => deadline())
      return table
    })
    await h.store.begin(base(), 'token')
    expect((await h.store.get('one'))?.status).toBe('building')
  })

  it('closes a committed upgrade before exposing a connection when close races its success event', async () => {
    const h = harness()
    let closed: Promise<void> | undefined
    const original = FakeDatabase.prototype.createObjectStore
    vi.spyOn(FakeDatabase.prototype, 'createObjectStore').mockImplementation(function (this: IDBDatabase, ...args) {
      const table = original.apply(this, args)
      if (args[0] === 'parts') table.transaction.addEventListener('complete', () => { closed = h.store.close() })
      return table
    })
    await expect(h.store.begin(base(), 'token')).rejects.toMatchObject({ code: 'unavailable' })
    await closed
    const next = harness(h.indexedDB, h.dbName)
    expect(await next.store.list()).toEqual([])
  })

  it('handles the blocked event and aborts its late upgrade before permitting a fresh retry', async () => {
    const h = harness()
    let opening!: IDBOpenDBRequest
    const original = h.indexedDB.open.bind(h.indexedDB)
    vi.spyOn(h.indexedDB, 'open').mockImplementation((...args) => { opening = original(...args); return opening })
    const pending = h.store.begin(base(), 'token')
    opening.onblocked?.call(opening, {} as IDBVersionChangeEvent)
    await expect(pending).rejects.toMatchObject({ code: 'blocked' })
    await new Promise<void>(resolve => setImmediate(resolve))
    await h.store.begin(base(), 'token')
    expect((await h.store.get('one'))?.status).toBe('building')
  })

  for (const [label, corrupt] of [
    ['manifest', (v: Record<string, unknown>) => ({ ...v, archive: { manifest: 'private damaged content' } })],
    ['files', (v: Record<string, unknown>) => ({ ...v, files: [{ blob: new Blob(['private']) }] })],
    ['base summary', (v: Record<string, unknown>) => ({ ...v, summary: { photos: 'private' }, sourceRevision: -1, createdAt: 'bad time' })],
  ] as const) it(`keeps corrupt ${label} discoverable and cleanable without affecting healthy sessions`, async () => {
    const h = harness()
    await staged(h)
    await h.store.complete('one', 'token-one', complete())
    await staged(h, 'healthy')
    await edit(h, 'sessions', 'one', v => ({ ...corrupt(v), opaque: 'private', writerToken: 'private' }))
    const damaged = await h.store.get('one')
    expect(damaged).toMatchObject({ id: 'one', sourceDbName: 'formal-library', status: 'damaged' })
    expect(JSON.stringify(damaged)).not.toMatch(/private|blob|writerToken|opaque|archive|files/)
    if (label === 'base summary') expect(damaged).toMatchObject({ summary: null, sourceRevision: null, createdAt: null })
    expect((await h.store.list()).map(v => [v.id, v.status])).toEqual([['healthy', 'building'], ['one', 'damaged']])
    await expect(h.store.readPart('one', 1)).rejects.toMatchObject({ code: 'integrity' })
    await h.store.discard('one')
    expect(await h.store.get('one')).toBeNull()
    expect((await h.store.get('healthy'))?.status).toBe('building')
    expect((await h.store.readPart('healthy', 1, { writerToken: 'token-healthy' })).bytes).toBe(part().bytes)
  })

  it('fails closed if a damaged row no longer has a trustworthy source identity', async () => {
    const h = harness()
    await staged(h)
    await edit(h, 'sessions', 'one', v => ({ ...v, sourceDbName: null }))
    await expect(h.store.get('one')).rejects.toMatchObject({ code: 'integrity' })
    await expect(h.store.list()).rejects.toMatchObject({ code: 'integrity' })
    await expect(h.store.discard('one')).rejects.toMatchObject({ code: 'integrity', cleanupPending: true })
    await edit(h, 'sessions', 'one', v => { expect(v.status).toBe('building'); return { ...v, sourceDbName: 'formal-library' } })
    expect((await h.store.readPart('one', 1, { writerToken: 'token-one' })).bytes).toBe(part().bytes)
  })

  it('does not clean an existing session after a colliding begin or a foreign writer cleanup', async () => {
    const h = harness()
    await staged(h)
    await expect(h.store.begin(base(), 'colliding-writer')).rejects.toMatchObject({ code: 'export-state' })
    await h.store.discard('one', 'colliding-writer')
    await h.store.discard('one', '')
    expect((await h.store.get('one'))?.status).toBe('building')
    expect((await h.store.readPart('one', 1, { writerToken: 'token-one' })).bytes).toBe(part().bytes)
    await h.store.discard('one', 'token-one')
    expect(await h.store.get('one')).toBeNull()
  })

  it('retains private ownership on ready so only the matching automatic cleanup can remove it', async () => {
    const h = harness()
    await staged(h)
    const ready = await h.store.complete('one', 'token-one', complete())
    expect(JSON.stringify(ready)).not.toContain('token-one')
    expect(JSON.stringify(await h.store.list())).not.toContain('token-one')
    await h.store.discard('one', 'foreign')
    expect(await h.store.get('one')).toEqual(ready)
    expect((await h.store.readPart('one', 1)).bytes).toBe(part().bytes)
    await h.store.discard('one', 'token-one')
    expect(await h.store.get('one')).toBeNull()
  })

  it('keeps owner-guarded cleanup retryable after invalidating a deleting session', async () => {
    const h = harness()
    await staged(h)
    const remove = vi.spyOn(IDBCursor.prototype, 'delete').mockImplementationOnce(() => { throw new DOMException('synthetic', 'UnknownError') })
    await expect(h.store.discard('one', 'token-one')).rejects.toMatchObject({ cleanupPending: true })
    expect(JSON.stringify(await h.store.get('one'))).not.toMatch(/cleanupToken|writerToken|token-one/)
    remove.mockRestore()
    await h.store.discard('one', 'foreign')
    expect((await h.store.get('one'))?.status).toBe('deleting')
    await h.store.discard('one', 'token-one')
    expect(await h.store.get('one')).toBeNull()
  })
})
