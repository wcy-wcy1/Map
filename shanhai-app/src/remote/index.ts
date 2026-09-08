import { createCatalogue } from '../domain/catalogue'
import type { Cover, Draft, LibraryIndexSnapshot, Photo, Visit, VisitSummary } from '../domain/models'
import { createBackupKernel } from '../generated/backup-kernel.js'
import { browserTravelPlatform, normalizeLocalDraft } from '../services/travel-services'
import type { TravelServices } from '../services/travel-services'
import type { LocalRepository, TravelCatalogue } from '../services/contracts'
import { RemoteApi, RemoteError, remoteError, sha256 } from './api'
import type { RemoteOptions, RemoteSession, RemoteCapabilities } from './api'
import { AccountStore, accountDatabaseName } from './store'
import type { CachedVisit, RemoteCache, Outbox } from './store'
export { getSession, testLogin, logout, RemoteError } from './api'
export type { RemoteSession, RemoteOptions } from './api'
export { accountDatabaseName } from './store'

export interface RemoteState { accountId: string; status: 'ready' | 'syncing' | 'offline' | 'conflict' | 'unauthorized' | 'closed'; pending: number; message: string }
export interface RemoteBundle { services: TravelServices; readonly state: RemoteState; capabilities: { backup: false; restore: false; undo: false }; refresh(): Promise<void>; retryPending(): Promise<void>; subscribe(listener: (state: RemoteState) => void): () => void; dispose(): Promise<void> }
type VersionedVisit = Visit & { remoteVersion: string; remoteId: string; remoteAccount: string }
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const disabled = async (): Promise<never> => { throw remoteError('remote-capability-disabled', '账号模式本轮不支持备份导入导出或撤销；没有执行或伪造成功。') }
function bytesFromData(url: string) {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url)
  if (!match || match[2]!.length > Math.ceil(10 * 1024 * 1024 / 3) * 4) throw remoteError('invalid-photo', '照片必须是本机持有的有效图片数据，不能保存临时签名 URL。')
  let binary: string
  try { binary = atob(match[2]!) } catch { throw remoteError('invalid-photo', '照片编码无效。') }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw remoteError('invalid-photo', '照片超过允许大小。')
  return { mime: match[1]!, bytes }
}
function dataFromBytes(bytes: Uint8Array) {
  let binary = ''
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
  return 'data:image/jpeg;base64,' + btoa(binary)
}

/** Own account cache/outbox only. Importing this module never opens the anonymous DB. */
export async function createRemoteServices(session: RemoteSession, options: RemoteOptions & { catalogue?: TravelCatalogue } = {}): Promise<RemoteBundle> {
  let state: RemoteState = { accountId: session.account.id, status: 'syncing', pending: 0, message: '正在读取本机服务中的账号资料…' }
  const listeners = new Set<(state: RemoteState) => void>()
  const emit = (patch: Partial<RemoteState>) => { state = { ...state, ...patch }; for (const listener of listeners) { try { listener({ ...state }) } catch { /* Observers cannot alter persistence. */ } } }
  const api = new RemoteApi(session, options, cause => emit({ status: 'unauthorized', message: cause.message }))
  const guard = (signal?: AbortSignal) => api.check(signal)
  const store = new AccountStore(api.config.indexedDB, accountDatabaseName(session.account.id), guard)
  const catalogue = options.catalogue || createCatalogue(), platform = { ...browserTravelPlatform(), crypto: api.config.crypto, indexedDB: api.config.indexedDB }
  const backup = createBackupKernel({ catalogue, platform })
  const capability = await api.request<RemoteCapabilities>('/capabilities', { public: true })
  if (capability.testIdentityOnly !== true || typeof capability.validationVersion !== 'string' || typeof capability.catalogueVersion !== 'string') { api.close(); throw remoteError('remote-disabled', '当前服务没有明确声明本机测试账号能力。') }
  let syncActive: Promise<void> | null = null, outboxActive: Promise<void> | null = null
  const outcomes = new Map<string, Promise<unknown>>()
  const checked = (visit: Visit) => backup.normalizeSnapshot({ visits: [visit], covers: [] }).visits[0]!
  async function pendingCount() { const rows = await store.all<Outbox>('outbox'); guard(); emit({ pending: rows.filter(row => ['pending', 'conflict'].includes(row.status)).length }) }
  function failed(cause: unknown) {
    if (state.status === 'unauthorized' || state.status === 'closed') return
    const code = (cause as RemoteError)?.code
    emit({ status: ['stale', 'missing', 'pending-conflict'].includes(code || '') || (cause as RemoteError)?.status === 409 ? 'conflict' : 'offline', message: cause instanceof RemoteError ? cause.message : '连接或本机账号存储暂时不可用；草稿和原操作保留，请重试。' })
  }
  async function refresh() {
    guard()
    if (syncActive) return syncActive
    syncActive = (async () => {
      emit({ status: 'syncing', message: '正在按完整提交同步…' })
      for (;;) {
        const before = await store.cache(); guard()
        const page = await api.request<any>('/sync/changes?limit=100' + (before.cursor ? '&cursor=' + encodeURIComponent(before.cursor) : ''))
        guard()
        if (!await store.apply(page, before.cursor)) continue
        if (!page.hasMore) break
      }
      await pendingCount(); guard()
      const conflicted = (await store.all<Outbox>('outbox')).some(row => row.status === 'conflict')
      emit({ status: conflicted ? 'conflict' : 'ready', message: conflicted ? '存在版本冲突，不会自动覆盖；请继续草稿重新读取、另存为新回忆，或放弃冲突草稿。' : '' })
    })().catch(cause => { failed(cause); throw cause }).finally(() => { syncActive = null })
    return syncActive
  }
  function rowFor(cache: RemoteCache, id: string) { return Object.values(cache.visits).find(row => row.clientId === id) }
  function toSummary(row: CachedVisit, cache: RemoteCache): VisitSummary {
    const privatePlace = row.place.kind === 'custom' ? cache.places[row.place.id] : null
    if (row.place.kind === 'custom' && !privatePlace) throw remoteError('invalid-cache', '账号地点摘要缺失，请重新读取。')
    const customPlace = privatePlace ? { id: 'custom-' + privatePlace.id, name: privatePlace.name, regionId: privatePlace.regionId, coordinates: privatePlace.coordinates } : undefined
    return { id: row.clientId, createdAt: row.clientCreatedAt, placeId: customPlace?.id || row.place.id, date: row.date, note: row.note,
      photos: row.photos.map(photo => ({ id: photo.id, name: cache.photos[photo.id]?.name || '旅行照片' })), coverId: row.coverPhotoId, ...(customPlace ? { customPlace } : {}) }
  }
  function covers(cache: RemoteCache): Cover[] {
    return Object.values(cache.covers).flatMap(row => {
      const visit = cache.visits[row.visitId]
      if (!visit || !visit.photos.some(photo => photo.id === row.photoId)) return []
      return [{ placeId: toSummary(visit, cache).placeId, visitId: visit.clientId, photoId: row.photoId }]
    })
  }
  async function readVisit(id: string, readOptions: { expectedRevision?: number; signal?: AbortSignal } = {}): Promise<VersionedVisit | null> {
    guard(readOptions.signal)
    const cache = await store.cache(), row = rowFor(cache, id)
    if (readOptions.expectedRevision !== undefined && cache.revision !== readOptions.expectedRevision) throw remoteError('stale', '回忆列表已变化，请重新读取。')
    if (!row) return null
    const current = await api.request<{ visit: CachedVisit }>('/visits/' + row.id, { signal: readOptions.signal })
    if (current.visit.version !== row.version) throw remoteError('stale', '另一端已更新回忆，请刷新列表后读取。')
    const photos: Photo[] = []
    for (const photo of row.photos) {
      guard(readOptions.signal)
      const grant = await api.request<{ url: string; sha256: string; mime: string; bytes: number }>('/photos/' + photo.id + '/download-url', { method: 'POST', body: {}, signal: readOptions.signal })
      const bytes = await api.capability(grant.url, 'GET', undefined, undefined, readOptions.signal)
      if (grant.mime !== 'image/jpeg' || bytes.length !== grant.bytes || await sha256(api.config.crypto, bytes) !== grant.sha256) throw remoteError('invalid-photo', '照片校验未通过，未保存临时链接。')
      guard(readOptions.signal); photos.push({ id: photo.id, name: cache.photos[photo.id]?.name || '旅行照片', url: dataFromBytes(bytes) })
    }
    guard(readOptions.signal)
    const latest = await api.request<{ visit: CachedVisit }>('/visits/' + row.id, { signal: readOptions.signal })
    if (latest.visit.version !== row.version) throw remoteError('stale', '照片读取期间服务器记录已变化，请重新打开。')
    if ((await store.cache()).revision !== cache.revision) throw remoteError('stale', '照片读取期间回忆已变化，请重新打开。')
    return { ...toSummary(row, cache), photos, remoteVersion: row.version, remoteId: row.id, remoteAccount: session.account.id }
  }
  function expectation(visit: Visit) {
    const value = visit as VersionedVisit
    if (value.remoteAccount !== session.account.id || !/^\d+$/.test(value.remoteVersion || '') || !/^[a-f0-9-]{36}$/.test(value.remoteId || '')) throw remoteError('stale', '缺少原始账号版本；请重新打开回忆，不会用最新版本替你覆盖。')
    return { id: value.remoteId, version: value.remoteVersion }
  }
  async function updateOperation(op: Outbox) { guard(); await store.write('outbox', op.id, op) }
  async function photoReference(op: Outbox, photo: Photo): Promise<string> {
    const { bytes, mime } = bytesFromData(photo.url), digest = await sha256(api.config.crypto, bytes); guard()
    const cache = await store.cache(), existing = cache.photos[photo.id]
    if (existing) {
      if (existing.state !== 'ready' || existing.storedSha256 !== digest) throw remoteError('immutable-photo', '已保存照片不能原地替换，请选择新照片。')
      const attached = Object.values(cache.visits).find(visit => visit.photos.some(item => item.id === existing.id))
      if (!attached || attached.clientId === op.target) return existing.id
      // "Save as new memory" keeps UI photo IDs, but server photos are exclusive
      // to one visit. Upload the held dataURL as a fresh immutable photo instead.
    }
    const key = 'photo:' + photo.id
    const wirePhotoId = (await sha256(api.config.crypto, photo.id)).slice(0, 32)
    let progress = op.steps[key]
    if (!progress) {
      const prior = (await store.all<Outbox>('outbox')).filter(row => row.target === op.target).map(row => row.steps[key]).find(value => value?.inputHash === digest && value?.ready && cache.photos[value.photoId])
      if (prior) return prior.photoId
      progress = op.steps[key] = { inputHash: digest }; await updateOperation(op)
    }
    if (progress.inputHash !== digest) throw remoteError('immutable-photo', '原上传操作的照片内容已变化，不能复用。')
    async function rotate() {
      // Persist the cancellation intent first. A crash after cancel reuses that
      // exact receipt; it never revives the retired server/client photo identity.
      progress.rotating = true; await updateOperation(op)
      const attempt = Number(progress.attempt || 0)
      await api.request('/photos/uploads/' + progress.uploadId, { method: 'DELETE', body: {}, key: op.id + ':cancel:' + wirePhotoId + ':' + attempt })
      progress.attempt = attempt + 1; delete progress.uploadId; delete progress.photoId; delete progress.ready; delete progress.rotating
      await updateOperation(op)
    }
    for (let iteration = 0; iteration < 4; iteration++) {
      if (progress.rotating) await rotate()
      const suffix = wirePhotoId + ':' + Number(progress.attempt || 0)
      const prepare = () => api.request<any>('/photos/uploads', { method: 'POST', key: op.id + ':prepare:' + suffix, body: { clientPhotoId: op.id + ':' + suffix, name: photo.name.slice(0, 150), contentType: mime, bytes: bytes.length, sha256: digest } })
      if (!progress.uploadId) {
        const prepared = await prepare()
        progress.uploadId = prepared.uploadId; progress.photoId = prepared.photoId; await updateOperation(op)
      }
      let status = await api.request<any>('/photos/uploads/' + progress.uploadId)
      if (['cancelled', 'expired'].includes(status.state) || (status.state === 'prepared' && status.expiresAt && Date.parse(status.expiresAt) <= Date.now())) { await rotate(); continue }
      if (status.state === 'prepared') {
        const prepared = await prepare()
        try { await api.capability(prepared.upload.url, 'PUT', bytes, prepared.upload.headers) }
        catch (cause) {
          status = await api.request<any>('/photos/uploads/' + progress.uploadId)
          if (status.state === 'prepared' && (cause as RemoteError).status === 403) { await rotate(); continue }
          if (!['uploaded', 'ready'].includes(status.state)) throw cause
        }
      } else if (!['uploaded', 'ready'].includes(status.state)) throw remoteError('missing', '该上传被拒绝；草稿仍保留，请另存新回忆或放弃该冲突草稿。')
      const completed = await api.request<any>('/photos/uploads/' + progress.uploadId + '/complete', { method: 'POST', body: {}, key: op.id + ':complete:' + suffix })
      if (completed.photo.id !== progress.photoId || completed.photo.inputSha256 !== digest || completed.photo.state !== 'ready') throw remoteError('invalid-photo', '照片转正收据不一致。')
      progress.ready = true; progress.storedSha256 = completed.photo.storedSha256; await updateOperation(op)
      return progress.photoId
    }
    throw remoteError('remote-unavailable', '上传代次连续变化，已暂停；草稿和原操作保留，请稍后重试。')
  }
  async function placeReference(op: Outbox, visit: Visit) {
    if (!visit.customPlace) return { kind: 'public', id: visit.placeId, catalogueVersion: op.steps.catalogueVersion }
    const custom = visit.customPlace, cache = await store.cache()
    const prior = Object.values(cache.places).find(place => 'custom-' + place.id === custom.id || place.clientId === custom.id)
    if (prior) {
      if (prior.name !== custom.name || prior.regionId !== custom.regionId || JSON.stringify(prior.coordinates) !== JSON.stringify(custom.coordinates)) throw remoteError('stale', '已有私人地点身份不能被原地改写，请建立新地点。')
      return { kind: 'custom', id: prior.id }
    }
    if (!op.steps.customId) {
      const result = await api.request<any>('/custom-places', { method: 'POST', key: op.id + ':place', body: { clientId: custom.id, name: custom.name, regionId: custom.regionId, coordinates: custom.coordinates, validationVersion: op.steps.validationVersion } })
      op.steps.customId = result.customPlace.id; await updateOperation(op)
    }
    return { kind: 'custom', id: op.steps.customId }
  }
  async function execute(op: Outbox): Promise<any> {
    guard()
    if (op.status === 'done') {
      if (['create', 'update'].includes(op.kind)) {
        const current = await api.request<{ visit: CachedVisit }>('/visits/' + op.result.visit.id)
        if (current.visit.version !== op.result.visit.version) throw remoteError('stale', '原保存收据已不是当前版本，请重新读取；没有把旧操作当作新保存。')
      }
      return op.result
    }
    if (op.status === 'discarded') throw remoteError('missing', '该冲突操作已由用户放弃，不能再次发送。')
    if (op.status === 'conflict') throw remoteError('stale', op.error || '原操作发生版本冲突，不能自动覆盖。')
    const running = outcomes.get(op.id); if (running) return running
    const promise = (async () => {
      try {
        // A lost final response can be recovered without retransferring any photo.
        let committed: any
        try { committed = (await api.request<any>('/mutations/' + encodeURIComponent(op.id + ':commit'))).result }
        catch (cause) { if ((cause as RemoteError).status !== 404) throw cause }
        if (!committed) {
          if (op.kind === 'create' || op.kind === 'update') {
            const visit = op.payload as Visit, place = await placeReference(op, visit), photos = []
            for (const [position, photo] of visit.photos.entries()) photos.push({ id: await photoReference(op, photo), position })
            const coverIndex = visit.photos.findIndex(photo => photo.id === visit.coverId)
            const body = { place, date: visit.date, note: visit.note, photos, coverPhotoId: coverIndex >= 0 ? photos[coverIndex]!.id : null }
            committed = await api.request<any>(op.kind === 'create' ? '/visits' : '/visits/' + op.expected.id, { method: op.kind === 'create' ? 'POST' : 'PATCH', key: op.id + ':commit',
              body: op.kind === 'create' ? { clientId: visit.id, clientCreatedAt: visit.createdAt, ...body } : body,
              headers: op.kind === 'update' ? { 'If-Match': `"${op.expected.version}"` } : undefined })
          } else if (op.kind === 'delete') committed = await api.request<any>('/visits/' + op.expected.id, { method: 'DELETE', body: {}, key: op.id + ':commit', headers: { 'If-Match': `"${op.expected.version}"` } })
          else committed = await api.request<any>('/map-covers/' + encodeURIComponent(op.payload.placeKey), { method: 'PUT', body: { visitId: op.payload.visitId, photoId: op.payload.photoId }, key: op.id + ':commit', headers: op.expected?.version ? { 'If-Match': `"${op.expected.version}"` } : { 'If-None-Match': '*' } })
        }
        op.result = committed; op.status = 'done'; delete op.payload; delete op.expected; delete op.error
        await updateOperation(op); await refresh(); return committed
      } catch (cause) {
        if (state.status !== 'unauthorized' && state.status !== 'closed') {
          // Another same-account tab may have committed this exact operation
          // while its upload was being inspected/cancelled. Receipts win over
          // a transport or PHOTO_IN_USE error, never over a different operation.
          try {
            const recovered = (await api.request<any>('/mutations/' + encodeURIComponent(op.id + ':commit'))).result
            if (recovered && ((['create', 'update'].includes(op.kind) && recovered.visit?.clientId === op.target) || (op.kind === 'delete' && recovered.deleted?.id === op.expected?.id) || (op.kind === 'cover' && recovered.mapCover?.placeKey === op.target))) {
              op.result = recovered; op.status = 'done'; delete op.payload; delete op.expected; delete op.error; await updateOperation(op); await refresh(); return recovered
            }
          } catch { /* Unconfirmed remains pending below; never report guessed success. */ }
          if (['stale', 'missing'].includes((cause as RemoteError).code) || [400, 409, 410, 412, 422, 428].includes((cause as RemoteError).status)) { op.status = 'conflict'; op.error = cause instanceof Error ? cause.message : '操作冲突' }
          await updateOperation(op).catch(() => undefined); await pendingCount().catch(() => undefined); failed(cause)
        }
        throw cause
      }
    })().finally(() => outcomes.delete(op.id))
    outcomes.set(op.id, promise); return promise
  }
  async function enqueue(kind: Outbox['kind'], target: string, payload: any, expected?: any) {
    guard()
    const payloadDigest = await sha256(api.config.crypto, JSON.stringify(payload)), digest = await sha256(api.config.crypto, JSON.stringify({ kind, target, payloadDigest, expected }))
    guard()
    const op = await store.enqueue({ id: 'op-' + api.config.crypto.randomUUID(), kind, target, payload: copy(payload), expected: expected ? copy(expected) : undefined, digest, createdAt: Date.now(), status: 'pending', steps: { payloadDigest, validationVersion: capability.validationVersion, catalogueVersion: capability.catalogueVersion } })
    await pendingCount(); return op
  }
  async function retryPending() {
    guard(); if (outboxActive) return outboxActive
    outboxActive = (async () => { const ops = (await store.all<Outbox>('outbox')).filter(row => row.status === 'pending').sort((a, b) => a.createdAt - b.createdAt); for (const op of ops) await execute(op); await refresh() })().finally(() => { outboxActive = null })
    return outboxActive
  }
  async function reconcilePendingVisit(visit: Visit) {
    const digest = await sha256(api.config.crypto, JSON.stringify(checked(visit))); guard()
    const op = (await store.all<Outbox>('outbox')).filter(row => ['create', 'update'].includes(row.kind) && row.target === visit.id && row.steps.payloadDigest === digest && row.status !== 'discarded').sort((a, b) => b.createdAt - a.createdAt)[0]
    if (!op) return null
    if (op.status !== 'done') await execute(op)
    await refresh()
    const current = rowFor(await store.cache(), visit.id)
    if (!current || current.version !== op.result?.visit?.version || current.id !== op.result?.visit?.id) return null
    return readVisit(visit.id)
  }
  const repository: LocalRepository = {
    load: disabled,
    async loadIndex(options = {}): Promise<LibraryIndexSnapshot> { guard(options.signal); await refresh(); guard(options.signal); const cache = await store.cache(); return { visits: Object.values(cache.visits).map(row => toSummary(row, cache)), covers: covers(cache), revision: cache.revision } },
    readVisit,
    async assertRevision(revision, options) { guard(options?.signal); if ((await store.cache()).revision !== revision) throw remoteError('stale', '账号缓存已变化。') },
    async hasDraft(options) { guard(options?.signal); return !!await store.read('draft', 'current') },
    async addVisit(value) { const visit = checked(value); const op = await enqueue('create', visit.id, visit); await execute(op); return visit.id },
    async updateVisit(value, expected) { const visit = checked(value), base = expectation(expected.expectedVisit); if (expected.expectedVisit.id !== visit.id) throw remoteError('stale', '回忆身份与原版本不一致。'); await execute(await enqueue('update', visit.id, visit, base)); const result = await readVisit(visit.id); if (!result) throw remoteError('missing', '回忆已不存在。'); return result },
    async deleteVisit(id, expected) { const base = expectation(expected.expectedVisit), cache = await store.cache(), selected = covers(cache).filter(cover => cover.visitId === id); if (expected.expectedVisit.id !== id) throw remoteError('stale', '回忆身份与原版本不一致。'); await execute(await enqueue('delete', id, { id }, base)); return { visit: copy(expected.expectedVisit), covers: selected } },
    restoreVisit: disabled,
    async setMapCover(placeId, reference) {
      guard(); const cache = await store.cache(), visit = rowFor(cache, reference.visitId)
      if (!visit || toSummary(visit, cache).placeId !== placeId || !visit.photos.some(photo => photo.id === reference.photoId)) throw remoteError('stale', '照片和地点关系已变化，请重新打开。')
      const placeKey = `${visit.place.kind}:${visit.place.id}`, old = cache.covers[placeKey]
      // An absent cover can recur after create/delete. Include the observed cache
      // revision so a new explicit absence decision is not an ancient done receipt.
      await execute(await enqueue('cover', placeKey, { placeKey, visitId: visit.id, photoId: reference.photoId }, { version: old?.version ?? null, scopeRevision: cache.revision }))
      return { placeId, ...reference }
    },
    async saveDraft(raw, expected) {
      guard(); const draft = normalizeLocalDraft(raw, backup, catalogue)
      // The anonymous normalizer deliberately strips extensions; keep the read-time
      // account CAS baseline separately and restore it only after explicit validation.
      if (raw.originalVisit) { const base = expectation(raw.originalVisit); draft.originalVisit = { ...draft.originalVisit!, remoteVersion: base.version, remoteId: base.id, remoteAccount: session.account.id } as VersionedVisit }
      return store.draftWrite(draft, expected.expectedVersion)
    },
    async loadDraft() {
      guard(); const raw = await store.read<Draft>('draft', 'current'); if (!raw) return null
      const draft = normalizeLocalDraft(raw, backup, catalogue)
      if (raw.originalVisit) { const base = expectation(raw.originalVisit); draft.originalVisit = { ...draft.originalVisit!, remoteVersion: base.version, remoteId: base.id, remoteAccount: session.account.id } as VersionedVisit }
      return draft
    },
    async clearDraft(id, expected) { const cleared = await store.draftClear(id, expected.expectedVersion); await pendingCount(); return cleared },
    importSnapshot: disabled, beginImportStage: disabled, stageImportVisit: disabled, stageImportCover: disabled, finishImportStage: disabled, planStagedImport: disabled, commitStagedImport: disabled, discardImportStage: disabled, listImportStages: disabled,
    reconcilePendingVisit,
    async close() { await dispose() },
  }
  const blockedBackup = new Proxy(backup, { get(target, property) { if (['normalizeSnapshot', 'normalizeLibrary'].includes(String(property))) return Reflect.get(target, property); return typeof Reflect.get(target, property) === 'function' ? disabled : Reflect.get(target, property) } })
  const services = { catalogue, repository, backup: blockedBackup, restores: { inspect: disabled, resume: disabled, commit: disabled, discard: disabled }, exports: { prepare: disabled, readPart: disabled, resumeReady: disabled, listSessions: disabled, discard: disabled, close: async () => {} } } satisfies TravelServices
  async function dispose() { if (state.status === 'closed') return; api.close(); store.close(); emit({ status: 'closed', message: '账号服务已关闭，原账号草稿与待发送队列保留。' }); listeners.clear() }
  try { await refresh() } catch (cause) { api.close(); store.close(); throw cause }
  return { services, get state() { return { ...state } }, capabilities: { backup: false, restore: false, undo: false }, refresh, retryPending, subscribe(listener) { listeners.add(listener); listener({ ...state }); return () => listeners.delete(listener) }, dispose }
}
