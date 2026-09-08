import { remoteError } from './api'
export interface CachedVisit { id: string; clientId: string; clientCreatedAt: number; place: { kind: 'public' | 'custom'; id: string }; date: string; note: string; photos: { id: string; position: number }[]; coverPhotoId: string | null; version: string }
export interface CachedPlace { id: string; clientId: string; name: string; regionId: string; coordinates: [number, number]; version: string }
export interface CachedPhoto { id: string; name: string; state: string; bytes: number; sha256: string; inputSha256: string; storedSha256: string; version: string }
export interface CachedCover { id: string; placeKey: string; visitId: string; photoId: string; version: string }
export interface RemoteCache { cursor: string | null; sequence: string; revision: number; visits: Record<string, CachedVisit>; places: Record<string, CachedPlace>; photos: Record<string, CachedPhoto>; covers: Record<string, CachedCover> }
export interface Outbox { id: string; digest: string; target: string; kind: 'create' | 'update' | 'delete' | 'cover'; status: 'pending' | 'conflict' | 'done' | 'discarded'; createdAt: number; payload?: any; expected?: any; steps: Record<string, any>; result?: any; error?: string }
export const emptyCache = (): RemoteCache => ({ cursor: null, sequence: '0', revision: 0, visits: {}, places: {}, photos: {}, covers: {} })
function projection(entity: string, value: any) {
  const allowed: Record<string, string[]> = {
    visit: ['id', 'clientId', 'clientCreatedAt', 'place', 'date', 'note', 'photos', 'coverPhotoId', 'version'],
    customPlace: ['id', 'clientId', 'name', 'regionId', 'coordinates', 'validationVersion', 'version'],
    photo: ['id', 'name', 'state', 'bytes', 'mime', 'width', 'height', 'sha256', 'inputSha256', 'storedSha256', 'version'],
    mapCover: ['id', 'placeKey', 'visitId', 'photoId', 'version'],
  }
  if (Object.keys(value).some(key => !allowed[entity]?.includes(key))) throw remoteError('invalid-sync', '同步摘要含未知字段；没有写入账号缓存。')
  if (entity === 'visit' && (!Array.isArray(value.photos) || value.photos.some((photo: any) => Object.keys(photo).some(key => !['id', 'position'].includes(key))) || !value.place || Object.keys(value.place).some(key => !['kind', 'id', 'catalogueVersion'].includes(key)))) throw remoteError('invalid-sync', '照片和地点引用必须是无字节摘要。')
  return value
}
export const accountDatabaseName = (accountId: string) => {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(accountId)) throw remoteError('invalid-account', '无效账号命名空间。')
  return `shanhai-account-v1-${accountId}`
}
const result = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
export class AccountStore {
  private connection?: IDBDatabase
  private opening?: Promise<IDBDatabase>
  constructor(private factory: IDBFactory, readonly name: string, private check: () => void) {}
  private open() {
    this.check()
    if (!this.opening) {
      const opening = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory.open(this.name, 1); let failed = false
        request.onupgradeneeded = () => { for (const name of ['cache', 'outbox', 'draft']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name) }
        request.onsuccess = () => {
          if (failed) { request.result.close(); return }
          try { this.check(); this.connection = request.result; this.connection.onversionchange = () => this.close(); resolve(request.result) }
          catch (cause) { request.result.close(); reject(cause) }
        }
        request.onerror = () => { failed = true; reject(request.error) }
        request.onblocked = () => { failed = true; reject(remoteError('db-blocked', '账号库被其他页面占用，请关闭旧页后重试。')) }
      })
      this.opening = opening
      void opening.catch(() => { if (this.opening === opening) this.opening = undefined })
    }
    return this.opening
  }
  async transaction<T>(names: string[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<T> {
    const database = await this.open(); this.check()
    const tx = database.transaction(names, mode)
    const completion = new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || remoteError('transaction-aborted', '账号本机事务未提交。')); tx.onerror = () => {} })
    try { const value = await work(tx); this.check(); await completion; this.check(); return value }
    catch (cause) { try { tx.abort() } catch { /* Already settled. */ } await completion.catch(() => undefined); throw cause }
  }
  read<T>(store: string, key: IDBValidKey) { return this.transaction([store], 'readonly', tx => result(tx.objectStore(store).get(key)) as Promise<T | undefined>) }
  write<T>(store: string, key: IDBValidKey, value: T) { return this.transaction([store], 'readwrite', async tx => { this.check(); await result(tx.objectStore(store).put(value, key)) }) }
  all<T>(store: string) { return this.transaction([store], 'readonly', tx => result(tx.objectStore(store).getAll()) as Promise<T[]>) }
  cache() { return this.read<RemoteCache>('cache', 'current').then(value => value || emptyCache()) }
  async apply(page: any, expectedCursor: string | null) {
    if (!page || typeof page.nextCursor !== 'string' || !Array.isArray(page.commits) || typeof page.hasMore !== 'boolean') throw remoteError('invalid-sync', '同步响应格式无效。')
    return this.transaction(['cache'], 'readwrite', async tx => {
      const store = tx.objectStore('cache'), cache: RemoteCache = await result(store.get('current')) || emptyCache()
      if (cache.cursor !== expectedCursor) return false
      for (const commit of page.commits) {
        if (!/^\d+$/.test(commit.sequence) || BigInt(commit.sequence) !== BigInt(cache.sequence) + 1n || !Array.isArray(commit.changes)) throw remoteError('invalid-sync', '提交序列不连续；缓存和游标未更改。')
        for (const change of commit.changes) {
          const table = ({ visit: cache.visits, photo: cache.photos, customPlace: cache.places, mapCover: cache.covers } as Record<string, Record<string, any>>)[change.entity]
          if (!table || typeof change.id !== 'string' || !/^\d+$/.test(change.version)) throw remoteError('invalid-sync', '未知同步实体；整组提交未应用。')
          if (change.operation === 'delete') delete table[change.id]
          else if (change.operation === 'upsert' && change.value?.id === change.id && change.value?.version === change.version) {
            table[change.id] = projection(change.entity, change.value)
          } else throw remoteError('invalid-sync', '无效变更操作。')
        }
        cache.sequence = commit.sequence; cache.revision++
      }
      cache.cursor = page.nextCursor
      this.check(); await result(store.put(cache, 'current')); return true
    })
  }
  async enqueue(candidate: Outbox) {
    return this.transaction(['outbox'], 'readwrite', async tx => {
      const store = tx.objectStore('outbox'), rows: Outbox[] = await result(store.getAll())
      const same = rows.find(row => row.status !== 'discarded' && row.digest === candidate.digest && row.kind === candidate.kind && row.target === candidate.target)
      if (same) return same
      for (const prior of rows.filter(row => row.target === candidate.target && row.status === 'conflict' && row.kind === candidate.kind)) {
        // A newly confirmed user action against a freshly read version may replace
        // a terminal CAS failure; never retry or upgrade the old action silently.
        const refreshedBaseline = candidate.kind === 'cover'
          ? (candidate.expected?.version ?? null) !== (prior.expected?.version ?? null)
            || (Number.isSafeInteger(candidate.expected?.scopeRevision) && Number.isSafeInteger(prior.expected?.scopeRevision)
              && candidate.expected.scopeRevision > prior.expected.scopeRevision)
          : !!candidate.expected?.version && candidate.expected.version !== prior.expected?.version
        if (refreshedBaseline && ['update', 'delete', 'cover'].includes(candidate.kind)) {
          prior.status = 'discarded'; delete prior.payload; delete prior.expected; await result(store.put(prior, prior.id))
        }
      }
      if (rows.some(row => row.target === candidate.target && ['pending', 'conflict'].includes(row.status))) throw remoteError('pending-conflict', '这条回忆已有未完成操作；请先重试原操作，草稿仍保留。')
      this.check(); await result(store.put(candidate, candidate.id)); return candidate
    })
  }
  async draftWrite(value: any, expectedVersion: string | null) {
    return this.transaction(['draft', 'outbox'], 'readwrite', async tx => {
      const store = tx.objectStore('draft'), prior = await result(store.get('current'))
      if ((prior?.version || null) !== expectedVersion) throw remoteError('draft-conflict', '另一页已修改账号草稿；当前内容未覆盖。')
      if (prior && prior.id === value.id && prior.visitId !== value.visitId) {
        // An explicit save-as-new decision supersedes only this same draft's
        // terminal failures. Commit the new identity and archival atomically.
        const operations = tx.objectStore('outbox'), rows: Outbox[] = await result(operations.getAll())
        const previousTarget = rows.filter(row => row.target === prior.visitId)
        if (previousTarget.some(row => row.status === 'pending')) throw remoteError('pending-conflict', '原回忆的保存结果尚未确认，不能更换草稿身份。请先点“重试待保存”核对；文字、照片和原操作全部保留。')
        for (const row of previousTarget.filter(row => row.status === 'conflict')) {
          row.status = 'discarded'; delete row.payload; delete row.expected; await result(operations.put(row, row.id))
        }
      }
      const next = { ...value, version: String(BigInt(prior?.version || '0') + 1n) }
      this.check(); await result(store.put(next, 'current')); return next
    })
  }
  async draftClear(id: string, expectedVersion: string | null) {
    return this.transaction(['draft', 'outbox'], 'readwrite', async tx => {
      const store = tx.objectStore('draft'), prior = await result(store.get('current'))
      if (!prior) return false
      if (prior.id !== id || (prior.version || null) !== expectedVersion) throw remoteError('draft-conflict', '另一页已修改账号草稿；没有清除。')
      const operations = tx.objectStore('outbox'), rows: Outbox[] = await result(operations.getAll())
      if (rows.some(row => row.target === prior.visitId && row.status === 'pending')) throw remoteError('pending-conflict', '这份草稿还有结果未确认的待发送操作。请先点“重试待保存”确认结果；现在没有丢弃或偷偷继续发送。')
      for (const row of rows.filter(row => row.target === prior.visitId && row.status === 'conflict')) {
        row.status = 'discarded'; delete row.payload; delete row.expected; await result(operations.put(row, row.id))
      }
      this.check(); await result(store.delete('current')); return true
    })
  }
  close() { this.connection?.close(); this.connection = undefined; this.opening = undefined }
}
