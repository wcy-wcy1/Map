import type { BackupSummary, OperationOptions, TravelPlatform, TravelServiceError } from './contracts'
import type { ExportCompletion, ExportPayload, ExportSession, ExportSessionBase, ExportStore, IncompleteExportSession, ReadyExportSession } from './export-types'

const MAX_FILE_BYTES = 100 * 1024 * 1024
const messages = {
  unavailable: '无法打开备份临时存储，请检查浏览器存储权限后重新加载。',
  blocked: '备份临时存储被其他页面占用或打开超时，请关闭其他山海集页面后重试。',
  quota: '本机临时空间不足，备份尚未生成。请保留原有回忆和备份文件，释放空间后重试。',
  aborted: '已取消备份操作，原有回忆没有更改。',
  'export-state': '这份临时副本已被清理或状态发生变化，请重新生成备份。',
  integrity: '这份临时副本不完整或已损坏，请清理后重新生成备份。',
  failed: '备份临时存储操作未完成，请重试；原有回忆没有更改。',
} as const
type ErrorCode = keyof typeof messages
function failure(cause?: unknown, code?: ErrorCode): TravelServiceError {
  if (cause instanceof Error && cause.name === 'ShanhaiExportStoreError') return cause
  const name = cause instanceof Error ? cause.name : ''
  code ??= name === 'QuotaExceededError' ? 'quota'
    : ['SecurityError', 'NotAllowedError', 'NotSupportedError', 'VersionError', 'InvalidStateError'].includes(name) ? 'unavailable'
      : name === 'ConstraintError' ? 'export-state' : 'failed'
  // Do not attach arbitrary request errors or caller values: they can contain photos.
  return Object.assign(new Error(messages[code]), { name: 'ShanhaiExportStoreError', code, friendlyMessage: messages[code] })
}
function ensure(value: unknown, code: ErrorCode = 'integrity'): asserts value { if (!value) throw failure(undefined, code) }
function object(value: unknown): Record<string, unknown> { ensure(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown> }
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0 }
function count(value: unknown): value is number { return Number.isSafeInteger(value) && (value as number) >= 0 }
function timestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value }
function date(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value }
function hash(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) }
function summary(value: unknown): BackupSummary {
  const v = object(value)
  ensure(count(v.visits) && count(v.photos) && count(v.places) && v.places <= v.visits && v.photos <= v.visits * 9)
  ensure(v.visits === 0 ? v.from === null && v.to === null : v.places > 0 && date(v.from) && date(v.to) && v.from <= v.to)
  return { visits: v.visits, photos: v.photos, places: v.places, from: v.from as string | null, to: v.to as string | null }
}
function base(value: unknown): ExportSessionBase {
  const v = object(value)
  ensure(text(v.id) && text(v.sourceDbName) && count(v.sourceRevision) && timestamp(v.createdAt))
  return { id: v.id, sourceDbName: v.sourceDbName, sourceRevision: v.sourceRevision, createdAt: v.createdAt, summary: summary(v.summary) }
}
function completion(value: unknown, expected?: BackupSummary): ExportCompletion {
  const v = object(value), a = object(v.archive), m = object(a.manifest)
  ensure(a.format === 'volume-v2' && text(a.archiveId) && timestamp(a.exportedAt) && hash(a.archiveSha256))
  const actual = summary(m.summary)
  if (expected) ensure(JSON.stringify(actual) === JSON.stringify(expected))
  ensure(m.encoding === 'shanhai-ndjson-v1' && count(m.covers) && m.covers <= actual.places && m.covers <= actual.photos)
  ensure(count(m.records) && m.records === 1 + actual.visits + actual.photos + m.covers)
  ensure(Array.isArray(m.parts) && m.parts.length > 0 && Array.isArray(v.files) && v.files.length === m.parts.length)
  const parts = m.parts.map(value => {
    const p = object(value)
    ensure(count(p.bytes) && p.bytes > 0 && p.bytes <= MAX_FILE_BYTES && hash(p.sha256))
    return { bytes: p.bytes, sha256: p.sha256 }
  })
  const names = new Set<string>()
  let totalBytes = 0
  const files = v.files.map((value, index) => {
    const f = object(value)
    ensure(f.part === index + 1 && text(f.filename) && f.filename.trim() && !/[\\/\u0000]/.test(f.filename) && !names.has(f.filename))
    ensure(count(f.bytes) && f.bytes > parts[index]!.bytes && f.bytes <= MAX_FILE_BYTES)
    names.add(f.filename)
    totalBytes += f.bytes
    ensure(count(totalBytes))
    return { filename: f.filename, bytes: f.bytes, part: index + 1 }
  })
  ensure(v.totalBytes === totalBytes)
  return { archive: { format: 'volume-v2', archiveId: a.archiveId, exportedAt: a.exportedAt, archiveSha256: a.archiveSha256,
    manifest: { encoding: 'shanhai-ndjson-v1', summary: actual, covers: m.covers, records: m.records, parts } }, files, totalBytes }
}
function session(value: unknown): IncompleteExportSession | ReadyExportSession {
  const v = object(value), b = base(v)
  if (v.status === 'ready') return { ...b, status: 'ready', ...completion(v, b.summary) }
  ensure(v.status === 'building' || v.status === 'deleting')
  return { ...b, status: v.status }
}
function recoverableSession(value: unknown): ExportSession {
  const v = object(value)
  // A corrupt archive must remain visible and cleanable, but source identity
  // must still be trustworthy before the service offers scoped cleanup.
  ensure(text(v.id) && text(v.sourceDbName))
  try { return session(v) } catch {
    let checkedSummary: BackupSummary | null = null
    try { checkedSummary = summary(v.summary) } catch { /* Keep other sessions discoverable. */ }
    return { id: v.id, sourceDbName: v.sourceDbName, status: 'damaged',
      sourceRevision: count(v.sourceRevision) ? v.sourceRevision : null,
      createdAt: timestamp(v.createdAt) ? v.createdAt : null, summary: checkedSummary }
  }
}

/** Independent schema-1 spool. No main-library access and no ambient platform state. */
export function createExportStore(platform: TravelPlatform, dbName: string): ExportStore {
  ensure(text(dbName), 'unavailable')
  let database: IDBDatabase | null = null
  let opening: Promise<IDBDatabase> | null = null
  let terminal: TravelServiceError | null = null
  let cancelOpening: ((error: TravelServiceError) => void) | null = null
  const active = new Set<{ abort(error: TravelServiceError): void; settled: Promise<void> }>()

  function connect(): Promise<IDBDatabase> {
    if (terminal) return Promise.reject(terminal)
    if (database) return Promise.resolve(database)
    if (opening) return opening
    opening = new Promise<IDBDatabase>((resolve, reject) => {
      let settled = false, timer: unknown
      let upgrade: IDBTransaction | null = null, upgradeFinished = false, upgradeFailure: unknown
      const fail = (error: unknown) => {
        if (settled) return
        settled = true
        platform.clearTimeout(timer)
        cancelOpening = null
        reject(failure(error))
      }
      const cancel = (error: TravelServiceError) => {
        if (settled) return
        platform.clearTimeout(timer)
        if (upgrade) {
          // A versionchange is a real transaction too. Its terminal request
          // confirms rollback; a deadline cannot invent a rollback after commit.
          if (upgradeFinished) return
          upgradeFailure ??= error
          try { upgrade.abort() } catch { /* Commit/abort already started: await the open event. */ }
        } else fail(error)
      }
      cancelOpening = cancel
      let request: IDBOpenDBRequest
      try {
        ensure(platform.indexedDB, 'unavailable')
        request = platform.indexedDB.open(dbName, 1)
      } catch (error) { fail(error); return }
      timer = platform.setTimeout(() => cancel(failure(undefined, 'blocked')), 8000)
      request.onblocked = () => fail(failure(undefined, 'blocked'))
      request.onerror = () => fail(upgradeFailure ?? request.error)
      request.onupgradeneeded = () => {
        upgrade = request.transaction!
        if (settled || terminal) { upgrade.abort(); return }
        upgrade.oncomplete = () => { upgradeFinished = true; platform.clearTimeout(timer) }
        upgrade.onabort = () => { upgradeFinished = true }
        upgrade.onerror = event => { upgradeFailure ??= (event.target as IDBRequest).error ?? upgrade?.error }
        try {
          request.result.createObjectStore('sessions', { keyPath: 'id' })
          request.result.createObjectStore('parts', { keyPath: ['sessionId', 'part'] })
        } catch (error) { upgradeFailure = error; upgrade.abort() }
      }
      request.onsuccess = () => {
        const db = request.result
        if (settled || terminal) { db.close(); if (!settled) fail(terminal); return }
        try {
          ensure(db.objectStoreNames.length === 2 && db.objectStoreNames.contains('sessions') && db.objectStoreNames.contains('parts'), 'unavailable')
          const tx = db.transaction(['sessions', 'parts'])
          ensure(tx.objectStore('sessions').keyPath === 'id' && JSON.stringify(tx.objectStore('parts').keyPath) === '["sessionId","part"]', 'unavailable')
        } catch (error) { db.close(); fail(error); return }
        settled = true
        platform.clearTimeout(timer)
        cancelOpening = null
        database = db
        db.onversionchange = () => { terminal = failure(undefined, 'unavailable'); database = null; db.close() }
        db.onclose = () => { terminal ??= failure(undefined, 'unavailable'); database = null }
        resolve(db)
      }
    }).catch(error => { opening = null; throw error })
    return opening
  }

  type Watch = <T>(request: IDBRequest<T>, success?: (value: T) => void) => void
  async function transact<T>(stores: string[], mode: IDBTransactionMode,
    action: (tx: IDBTransaction, watch: Watch, publish: (value: T) => void) => void, { signal }: OperationOptions = {}): Promise<T> {
    if (signal?.aborted) throw failure(undefined, 'aborted')
    const connection = connect()
    // An open request cannot be cancelled, and has no payload transaction yet.
    // Detach the waiter; late opens must never run a cancelled operation.
    const db = await (signal ? new Promise<IDBDatabase>((resolve, reject) => {
      const cancelled = () => { signal.removeEventListener('abort', cancelled); reject(failure(undefined, 'aborted')) }
      signal.addEventListener('abort', cancelled, { once: true })
      connection.then(value => { signal.removeEventListener('abort', cancelled); resolve(value) }, error => { signal.removeEventListener('abort', cancelled); reject(error) })
      if (signal.aborted) cancelled()
    }) : connection)
    if (terminal) throw terminal
    if (signal?.aborted) throw failure(undefined, 'aborted')
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction
      try { tx = db.transaction(stores, mode) } catch (error) { reject(failure(error)); return }
      let result: T, error: unknown, finish!: () => void
      const handle = { abort, settled: new Promise<void>(resolve => { finish = resolve }) }
      active.add(handle)
      const detach = () => { signal?.removeEventListener('abort', cancelled); active.delete(handle); finish() }
      tx.oncomplete = () => { detach(); resolve(result) }
      tx.onabort = () => { detach(); reject(failure(error ?? tx.error)) }
      tx.onerror = event => { error ??= (event.target as IDBRequest).error ?? tx.error }
      function abort(reason: TravelServiceError) {
        error ??= reason
        try { tx.abort() } catch { /* Already settling: only a terminal event reports its real outcome. */ }
      }
      function cancelled() { abort(failure(undefined, 'aborted')) }
      const watch: Watch = (request, success) => {
        request.onerror = () => { error ??= request.error }
        request.onsuccess = () => {
          if (signal?.aborted) { cancelled(); return }
          try { success?.(request.result) } catch (reason) { abort(failure(reason)) }
        }
      }
      signal?.addEventListener('abort', cancelled, { once: true })
      try {
        if (signal?.aborted) cancelled()
        else action(tx, watch, value => { result = value })
      } catch (reason) { abort(failure(reason)) }
    })
  }
  // This prefix range includes corrupt secondary keys as well as legal integers.
  // It never traverses another session, including IDs which share this prefix.
  const range = (id: string) => platform.IDBKeyRange.bound([id], [id + '\u0000'], false, true)
  const writer = (value: unknown, id: string, token: string) => {
    const v = object(value)
    ensure(v.id === id && v.status === 'building' && text(token) && v.writerToken === token, 'export-state')
    base(v)
    ensure(count(v.nextPart) && v.nextPart > 0)
    return v as Record<string, unknown> & { nextPart: number }
  }
  function payload(value: unknown, part: unknown): ExportPayload {
    const p = object(value)
    ensure(count(part) && part > 0 && p.part === part && p.blob instanceof platform.Blob)
    ensure(count(p.bytes) && p.bytes > 0 && p.bytes <= MAX_FILE_BYTES && p.blob.size === p.bytes && hash(p.sha256))
    return { part, blob: p.blob, bytes: p.bytes, sha256: p.sha256 }
  }

  return {
    async begin(value, writerToken, options) {
      const clean = base(value)
      ensure(text(writerToken), 'export-state')
      await transact<void>(['sessions', 'parts'], 'readwrite', (tx, watch) => {
        const sessions = tx.objectStore('sessions')
        watch(sessions.get(clean.id), existing => {
          ensure(!existing, 'export-state')
          watch(tx.objectStore('parts').openKeyCursor(range(clean.id)), cursor => {
            ensure(!cursor, 'integrity')
            watch(sessions.add({ ...clean, status: 'building', writerToken, nextPart: 1 }))
          })
        })
      }, options)
    },
    async appendPart(id, writerToken, value, options) {
      ensure(text(id), 'export-state')
      const clean = payload(value, object(value).part)
      await transact<void>(['sessions', 'parts'], 'readwrite', (tx, watch) => {
        const sessions = tx.objectStore('sessions')
        watch(sessions.get(id), value => {
          ensure(value, 'export-state')
          const current = writer(value, id, writerToken)
          ensure(clean.part === current.nextPart && count(current.nextPart + 1))
          watch(tx.objectStore('parts').add({ ...clean, sessionId: id }))
          watch(sessions.put({ ...current, nextPart: current.nextPart + 1 }))
        })
      }, options)
    },
    async readPart(id, part, options = {}) {
      ensure(text(id) && count(part) && part > 0)
      return transact<ExportPayload>(['sessions', 'parts'], 'readonly', (tx, watch, publish) => {
        watch(tx.objectStore('sessions').get(id), value => {
          ensure(value, 'export-state')
          const current = session(value)
          ensure(current.id === id && current.status !== 'deleting', 'export-state')
          if (current.status === 'building') ensure(part < writer(value, id, options.writerToken ?? '').nextPart)
          watch(tx.objectStore('parts').get([id, part]), value => {
            ensure(value && value.sessionId === id)
            const clean = payload(value, part)
            if (current.status === 'ready') {
              const expected = current.archive.manifest.parts[part - 1]
              ensure(expected && expected.bytes === clean.bytes && expected.sha256 === clean.sha256)
            }
            publish(clean)
          })
        })
      }, options)
    },
    async complete(id, writerToken, value, options) {
      ensure(text(id), 'export-state')
      // Copy only light metadata before the first await; callers cannot mutate
      // the manifest while a transaction waits for a connection or write lock.
      const clean = completion(value)
      return transact<ReadyExportSession>(['sessions', 'parts'], 'readwrite', (tx, watch, publish) => {
        const sessions = tx.objectStore('sessions')
        watch(sessions.get(id), value => {
          ensure(value, 'export-state')
          const current = writer(value, id, writerToken), b = base(current)
          ensure(JSON.stringify(b.summary) === JSON.stringify(clean.archive.manifest.summary))
          const expected = clean.archive.manifest.parts
          ensure(current.nextPart === expected.length + 1)
          let index = 0
          watch(tx.objectStore('parts').openCursor(range(id)), cursor => {
            if (cursor) {
              const part = index + 1, key = cursor.primaryKey
              ensure(Array.isArray(key) && key.length === 2 && key[0] === id && key[1] === part && cursor.value.sessionId === id)
              const p = payload(cursor.value, part), checksum = expected[index]
              ensure(checksum && p.bytes === checksum.bytes && p.sha256 === checksum.sha256)
              index++
              cursor.continue()
            } else {
              ensure(index === expected.length)
              const ready: ReadyExportSession = { ...b, status: 'ready', ...clean }
              // Keep ownership private for cancellation cleanup after commit;
              // ready status fences all further append/complete operations.
              watch(sessions.put({ ...ready, writerToken }), () => publish(ready))
            }
          })
        })
      }, options)
    },
    async get(id, options) {
      ensure(text(id), 'export-state')
      return transact<ExportSession | null>(['sessions'], 'readonly', (tx, watch, publish) => {
        watch(tx.objectStore('sessions').get(id), value => {
          if (!value) { publish(null); return }
          const clean = recoverableSession(value)
          ensure(clean.id === id)
          publish(clean)
        })
      }, options)
    },
    async list(options) {
      return transact<ExportSession[]>(['sessions'], 'readonly', (tx, watch, publish) => {
        const result: ExportSession[] = []
        watch(tx.objectStore('sessions').openCursor(), cursor => {
          if (!cursor) { publish(result); return }
          const clean = recoverableSession(cursor.value)
          ensure(clean.id === cursor.primaryKey)
          result.push(clean)
          cursor.continue()
        })
      }, options)
    },
    async discard(id, writerToken) {
      ensure(text(id), 'export-state')
      try {
        const exists = await transact<boolean>(['sessions'], 'readwrite', (tx, watch, publish) => {
          const sessions = tx.objectStore('sessions')
          watch(sessions.get(id), value => {
            if (!value) { publish(false); return }
            ensure(value.id === id && text(value.sourceDbName))
            const owner = value.status === 'deleting' ? value.cleanupToken : value.writerToken
            if (writerToken !== undefined && (!text(writerToken) || owner !== writerToken)) { publish(false); return }
            watch(sessions.put({ ...value, status: 'deleting', writerToken: null, cleanupToken: owner }), () => publish(true))
          })
        })
        if (!exists) return
        await transact<void>(['sessions', 'parts'], 'readwrite', (tx, watch) => {
          const sessions = tx.objectStore('sessions')
          watch(sessions.get(id), value => {
            if (!value) return // A concurrent discard already finished.
            if (writerToken !== undefined && value.cleanupToken !== writerToken) return
            ensure(value.status === 'deleting', 'export-state')
            watch(tx.objectStore('parts').openCursor(range(id)), cursor => {
              if (cursor) { watch(cursor.delete()); cursor.continue() }
              else watch(sessions.delete(id))
            })
          })
        })
      } catch (error) {
        throw Object.assign(failure(error), { cleanupPending: true, sessionId: id })
      }
    },
    async close() {
      terminal ??= failure(undefined, 'unavailable')
      cancelOpening?.(terminal)
      const pending = [...active]
      for (const operation of pending) operation.abort(terminal)
      database?.close()
      database = null
      await Promise.all(pending.map(operation => operation.settled))
      // If an upgrade is aborting, wait for its terminal request as well.
      if (opening) await opening.catch(() => undefined)
    },
  }
}
