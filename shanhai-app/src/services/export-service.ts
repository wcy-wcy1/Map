import type { Cover, VisitSummary } from '../domain/models'
import type { BackupCodec, BackupSummary, LocalRepository, OperationOptions, TravelPlatform } from './contracts'
import type { BackupExportError, BackupExportService, EncodedArchive, ExportCompletion, ExportFileInfo, ExportStore, PrepareBackupOptions, ReadyExportSession } from './export-types'

function failure(code: string, message: string): BackupExportError {
  return Object.assign(new Error(message), { name: 'ShanhaiExportError', code, friendlyMessage: message })
}
function check(signal?: AbortSignal) {
  if (signal?.aborted) throw failure('aborted', '已取消准备备份，原记录没有更改。')
}
function summary(rows: VisitSummary[]): BackupSummary {
  let photos = 0, from: string | null = null, to: string | null = null
  const places = new Set<string>()
  for (const row of rows) {
    photos += row.photos.length; places.add(row.placeId)
    if (from === null || row.date < from) from = row.date
    if (to === null || row.date > to) to = row.date
  }
  return { visits: rows.length, photos, places: places.size, from, to }
}
/** Stable whitelist projection; never serializes a photo URL or extension. */
function projection(row: VisitSummary): string {
  const custom = row.customPlace
  return JSON.stringify({ id: row.id, createdAt: row.createdAt, placeId: row.placeId, date: row.date,
    note: row.note, photos: row.photos.map(photo => ({ id: photo.id, name: photo.name })), coverId: row.coverId,
    ...(custom ? { customPlace: { id: custom.id, name: custom.name, regionId: custom.regionId, coordinates: custom.coordinates } } : {}) })
}
function secureId(platform: TravelPlatform): string {
  if (platform.crypto?.randomUUID) return platform.crypto.randomUUID()
  if (!platform.crypto?.getRandomValues) throw failure('unsupported', '当前浏览器无法创建安全的备份标识，请换用支持的浏览器。')
  return Array.from(platform.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('')
}
function cleanupError(cause: unknown, id: string): BackupExportError {
  const original = cause instanceof Error ? cause : new Error('备份操作没有完成。')
  const friendly = (cause as BackupExportError | undefined)?.friendlyMessage || original.message
  const message = friendly + ' 临时备份尚未清理，请在临时副本列表中重试；原记录没有更改。'
  return Object.assign(new Error(message, { cause: original }), {
    name: 'ShanhaiExportError', code: 'cleanup-pending', friendlyMessage: message, cleanupPending: true, sessionId: id,
  })
}
function exportFailure(cause: unknown): unknown {
  const code = (cause as BackupExportError | null)?.code
  const messages: Record<string, string> = {
    stale: '生成期间回忆或地图封面发生了变化。请重新生成最新备份，原记录没有更改。',
    quota: '本机临时空间不足，备份未生成。请保留原有回忆，释放空间后重试。',
    'export-state': '这份临时备份已被其他页面清理或状态改变，请重新生成。',
    integrity: '这份临时备份不完整或已损坏，请清理后重新生成。原记录没有更改。',
  }
  return code && messages[code] ? failure(code, messages[code]) : cause
}

/** One heavy operation at a time; cancellation joins actual work instead of
 * racing a Promise and releasing the UI lock while buffers are still live. */
export function createBackupExportService(repository: LocalRepository, backup: BackupCodec, store: ExportStore,
  platform: TravelPlatform, sourceDbName: string): BackupExportService {
  let active: { controller: AbortController; promise: Promise<unknown> } | null = null
  let closed = false
  function run<T>(options: OperationOptions, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (closed) return Promise.reject(failure('closed', '备份服务已关闭，请重新打开页面。'))
    if (active) return Promise.reject(failure('busy', '上一项备份操作仍在结束，请稍后重试。'))
    const controller = new AbortController()
    const relay = () => controller.abort()
    options.signal?.addEventListener('abort', relay, { once: true })
    if (options.signal?.aborted) controller.abort()
    const current = { controller, promise: Promise.resolve() as Promise<unknown> }
    active = current
    const promise = Promise.resolve().then(() => { check(controller.signal); return work(controller.signal) })
      .finally(() => {
        options.signal?.removeEventListener('abort', relay)
        if (active === current) active = null
      })
    current.promise = promise
    return promise
  }
  async function verifyParts(id: string, archive: EncodedArchive, options: PrepareBackupOptions & { writerToken?: string }): Promise<ExportCompletion> {
    const files: ExportFileInfo[] = []
    let totalBytes = 0
    for (let part = 1; part <= archive.manifest.parts.length; part++) {
      check(options.signal)
      options.onProgress?.({ phase: 'verify', part, parts: archive.manifest.parts.length })
      const payload = await store.readPart(id, part, { signal: options.signal, writerToken: options.writerToken })
      check(options.signal)
      const file = await backup.wrapVolume(archive, payload, options)
      check(options.signal)
      files.push({ filename: file.filename, bytes: file.bytes, part: file.part })
      totalBytes += file.bytes
      if (!Number.isSafeInteger(totalBytes)) throw failure('size', '备份大小超出安全计数范围，未生成下载文件。')
    }
    return { archive, files, totalBytes }
  }
  async function ready(id: string, options: OperationOptions): Promise<ReadyExportSession> {
    const session = await store.get(id, options)
    check(options.signal)
    if (!session || session.status !== 'ready' || session.sourceDbName !== sourceDbName) {
      throw failure('export-state', '这份临时备份尚未完整生成或已清理，请重新生成。')
    }
    return session
  }
  return {
    prepare(options = {}) {
      return run(options, async signal => {
        const index = await repository.loadIndex({ signal })
        check(signal)
        if (!index.visits.length) throw failure('empty', '还没有已保存的记录。先记下一次旅行，再导出备份。')
        const revision = index.revision
        const rows = index.visits.map(row => ({ id: row.id, projection: projection(row) }))
        const totals = summary(index.visits)
        const covers: Cover[] = index.covers.map(({ placeId, visitId, photoId }) => ({ placeId, visitId, photoId }))
        const id = secureId(platform), token = secureId(platform)
        try {
          await store.begin({ id, sourceDbName, sourceRevision: revision, createdAt: new Date().toISOString(), summary: totals }, token, { signal })
          check(signal)
          async function* visits() {
            let count = 0
            for (const row of rows) {
              check(signal)
              const visit = await repository.readVisit(row.id, { expectedRevision: revision, signal })
              check(signal)
              if (!visit || projection(visit) !== row.projection) throw failure('stale', '回忆内容与开始时不一致，请重新生成最新备份。')
              options.onProgress?.({ phase: 'read', records: ++count, totalRecords: rows.length })
              yield visit
            }
          }
          const archive = await backup.writeVolumes({ summary: totals, covers, visits: visits() }, async payload => {
            check(signal)
            await store.appendPart(id, token, payload, { signal })
            check(signal)
            options.onProgress?.({ phase: 'stage', part: payload.part })
          }, { signal, volumeChars: options.volumeChars })
          check(signal)
          const completion = await verifyParts(id, archive, { ...options, signal, writerToken: token })
          await repository.assertRevision(revision, { signal })
          check(signal)
          const result = await store.complete(id, token, completion, { signal })
          check(signal)
          return result
        } catch (cause) {
          // Deliberately no cancelled signal: exact-session cleanup must finish.
          const error = exportFailure(cause)
          try { await store.discard(id, token) } catch { throw cleanupError(error, id) }
          throw error
        }
      })
    },
    readPart(id, part, options = {}) {
      return run(options, async signal => {
        const session = await ready(id, { signal })
        const expected = session.files.find(file => file.part === part)
        if (!Number.isSafeInteger(part) || !expected) throw failure('invalid', '这份备份没有所选分卷。')
        const payload = await store.readPart(id, part, { signal })
        const file = await backup.wrapVolume(session.archive, payload, { signal })
        check(signal)
        if (file.filename !== expected.filename || file.bytes !== expected.bytes) throw failure('corrupt', '临时备份内容不完整，请重新生成；不要混用不同备份的分卷。')
        return file
      })
    },
    resumeReady(id, options = {}) {
      return run(options, async signal => {
        const session = await ready(id, { signal })
        const verified = await verifyParts(id, session.archive, { ...options, signal })
        if (JSON.stringify(verified.files) !== JSON.stringify(session.files) || verified.totalBytes !== session.totalBytes) {
          throw failure('corrupt', '临时备份内容不完整，请清理后重新生成。')
        }
        await ready(id, { signal })
        check(signal)
        return session
      })
    },
    async listSessions(options = {}) {
      if (closed) throw failure('closed', '备份服务已关闭，请重新打开页面。')
      const sessions = await store.list(options)
      return sessions.filter(session => session.sourceDbName === sourceDbName)
    },
    discard(id) {
      return run({}, async () => {
        const session = await store.get(id)
        if (session && session.sourceDbName !== sourceDbName) throw failure('export-state', '不能清理其他记录库的临时备份。')
        try { await store.discard(id) } catch (cause) { throw cleanupError(cause, id) }
      })
    },
    async close() {
      closed = true
      const pending = active
      pending?.controller.abort()
      if (pending) await pending.promise.catch(() => undefined)
      await store.close()
    },
  }
}
