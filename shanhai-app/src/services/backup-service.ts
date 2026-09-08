import type { Photo, Snapshot } from '../domain/models'
import type {
  BackupCodec, BackupFiles, BackupSummary, CodecOperationOptions, LocalRepository,
  MergeCounts, OperationOptions, StagedPlan, TravelServiceError,
} from './contracts'

export interface InspectRestoreOptions extends CodecOperationOptions {
  decodePhoto: (photo: Photo, signal?: AbortSignal) => Promise<unknown>
}
export interface SingleRestorePreview {
  format: 'single-v1'
  snapshot: Snapshot
  summary: BackupSummary
  exportedAt: string
  plan: MergeCounts
}
export interface VolumeRestorePreview {
  format: 'volume-v2'
  stageId: string
  summary: BackupSummary
  exportedAt: string
  plan: StagedPlan
}
export type RestorePreview = SingleRestorePreview | VolumeRestorePreview
export interface RestoreCommitResult extends MergeCounts {
  replayed: boolean
  cleanupPending: boolean
  stageId?: string
}
export interface RestoreServiceError extends TravelServiceError {
  /** A failed cleanup must remain visible and independently retryable. */
  cleanupPending?: boolean
  stageId?: string
}

function aborted(): never {
  throw Object.assign(new Error('已取消本次备份检查，正式记录没有更改。'), {
    name: 'ShanhaiBackupError', code: 'aborted', friendlyMessage: '已取消本次备份检查，正式记录没有更改。',
  })
}
function checkAbort(signal?: AbortSignal) { if (signal?.aborted) aborted() }
function invalidStage(): never {
  throw Object.assign(new Error('这次备份尚未完成检查，或暂存已被清理。请重新选择完整备份。'), {
    name: 'ShanhaiLocalStoreError', code: 'import-state', friendlyMessage: '这次备份尚未完成检查，或暂存已被清理。请重新选择完整备份。',
  })
}
function counts(value: MergeCounts): MergeCounts {
  return { added: value.added, skipped: value.skipped, coversAdded: value.coversAdded, coversKept: value.coversKept }
}
/** Reject promptly on cancellation even if a decoder or readonly load cannot
 * itself be cancelled. Late work is observed but can never progress to writes. */
async function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', cancel)
    const cancel = () => { cleanup(); try { aborted() } catch (cause) { reject(cause) } }
    signal.addEventListener('abort', cancel, { once: true })
    promise.then(value => { cleanup(); try { checkAbort(signal); resolve(value) } catch (cause) { reject(cause) } }, cause => { cleanup(); reject(cause) })
    if (signal.aborted) cancel()
  })
}

/** UI-independent restore workflow. inspect() never writes live visits/covers.
 * The caller must show the preview and obtain user confirmation before commit().
 * Volume restore does not use parseFiles or collect an aggregate snapshot. */
export function createBackupRestoreService(repository: LocalRepository, backup: BackupCodec) {
  return {
    async inspect(files: BackupFiles, options: InspectRestoreOptions): Promise<RestorePreview> {
      const { signal, onProgress, decodePhoto } = options
      checkAbort(signal)
      const descriptor = await backup.preflightFiles(files, { signal, onProgress })
      checkAbort(signal)
      if (!descriptor.summary.visits) {
        throw Object.assign(new Error('备份中没有可以导入的回忆。'), { code: 'empty', friendlyMessage: '备份中没有可以导入的回忆。' })
      }
      if (descriptor.format === 'single-v1') {
        for (const visit of descriptor.snapshot.visits) for (const photo of visit.photos) {
          checkAbort(signal)
          await waitFor(Promise.resolve().then(() => { checkAbort(signal); return decodePhoto(photo, signal) }), signal)
        }
        const current = await waitFor(repository.load(), signal)
        checkAbort(signal)
        return { format: 'single-v1', snapshot: descriptor.snapshot, summary: descriptor.summary, exportedAt: descriptor.exportedAt,
          plan: counts(backup.planMerge(current, descriptor.snapshot)) }
      }
      let stageId: string | undefined
      try {
        const stage = await repository.beginImportStage(descriptor.stageMeta, { signal })
        stageId = stage.id
        checkAbort(signal)
        await backup.consumeVolumes(descriptor, {
          signal, onProgress,
          decodePhoto: photo => waitFor(Promise.resolve().then(() => { checkAbort(signal); return decodePhoto(photo, signal) }), signal),
          onVisit: visit => repository.stageImportVisit(stage.id, visit, { signal }),
          onCover: cover => repository.stageImportCover(stage.id, cover, { signal }),
        })
        await repository.finishImportStage(stage.id, { signal })
        const plan = await repository.planStagedImport(stage.id, { signal })
        checkAbort(signal)
        return { format: 'volume-v2', stageId: stage.id, summary: stage.summary, exportedAt: stage.exportedAt, plan }
      } catch (cause) {
        if (stageId) {
          try { await repository.discardImportStage(stageId) } catch (cleanupCause) {
            const original = cause instanceof Error ? cause : new Error('备份检查没有完成。')
            const message = original.message + ' 临时导入数据尚未清理，可在备份恢复列表中重试清理；正式记录没有更改。'
            const error: RestoreServiceError = Object.assign(new Error(message, { cause: original }), {
              name: original.name, code: 'cleanup-pending', friendlyMessage: message, stageId, cleanupPending: true,
            })
            Object.defineProperty(error, 'cleanupCause', { value: cleanupCause })
            throw error
          }
        }
        throw cause
      }
    },

    /** Explicit recovery for ready/committed sessions; never resumes an
     * incomplete stream or silently imports it after a refresh. */
    async resume(stageId: string, options: OperationOptions = {}): Promise<VolumeRestorePreview> {
      checkAbort(options.signal)
      const stages = await repository.listImportStages({ ...options, includeCleaned: true })
      const stage = stages.find(value => value.id === stageId)
      if (!stage || stage.status === 'staging') invalidStage()
      const plan = await repository.planStagedImport(stageId, options)
      checkAbort(options.signal)
      return { format: 'volume-v2', stageId, summary: stage.summary, exportedAt: stage.exportedAt, plan }
    },

    /** No AbortSignal: final IDB merge must settle before UI unlocks. Cleanup is
     * a separate transaction and must not turn committed data into a failure. */
    async commit(preview: RestorePreview): Promise<RestoreCommitResult> {
      if (preview.format === 'single-v1') {
        const result = await repository.importSnapshot(preview.snapshot, { format: 'single-v1' })
        return { ...counts(result), replayed: false, cleanupPending: false }
      }
      const result = await repository.commitStagedImport(preview.stageId)
      let cleanupPending = false
      try { await repository.discardImportStage(preview.stageId) } catch { cleanupPending = true }
      return { ...counts(result), replayed: result.replayed, cleanupPending, stageId: preview.stageId }
    },

    async discard(preview: RestorePreview, options: OperationOptions = {}): Promise<void> {
      checkAbort(options.signal)
      if (preview.format === 'volume-v2') await repository.discardImportStage(preview.stageId, options)
    },
  }
}

export type BackupRestoreService = ReturnType<typeof createBackupRestoreService>
