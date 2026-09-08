import type { Cover, Visit } from '../domain/models'
import type { BackupSummary, ExportFile, ExportOptions, OperationOptions, TravelServiceError } from './contracts'

export interface PartChecksum { bytes: number; sha256: string }
export interface ExportManifest {
  encoding: 'shanhai-ndjson-v1'
  summary: BackupSummary
  covers: number
  records: number
  parts: PartChecksum[]
}
/** Wire-format metadata only. Never contains a complete payload or photo. */
export interface EncodedArchive {
  format: 'volume-v2'
  archiveId: string
  exportedAt: string
  archiveSha256: string
  manifest: ExportManifest
}
export interface ExportPayload extends PartChecksum { part: number; blob: Blob }
export interface StreamExportSource { summary: BackupSummary; covers: Cover[]; visits: AsyncIterable<Visit> }
export type ExportSink = (payload: ExportPayload) => Promise<unknown>
export interface ExportFileInfo { filename: string; bytes: number; part: number }
export interface ExportSessionBase {
  id: string
  sourceDbName: string
  sourceRevision: number
  createdAt: string
  summary: BackupSummary
}
export interface IncompleteExportSession extends ExportSessionBase { status: 'building' | 'deleting' }
export interface ReadyExportSession extends ExportSessionBase {
  status: 'ready'
  archive: EncodedArchive
  files: ExportFileInfo[]
  totalBytes: number
}
/** Safe recovery projection when the payload/ready metadata cannot be trusted. */
export interface DamagedExportSession {
  status: 'damaged'
  id: string
  sourceDbName: string
  sourceRevision: number | null
  createdAt: string | null
  summary: BackupSummary | null
}
export type ExportSession = IncompleteExportSession | ReadyExportSession | DamagedExportSession
export interface ExportCompletion { archive: EncodedArchive; files: ExportFileInfo[]; totalBytes: number }
/** All writes settle their real transactions before resolving/rejecting. */
export interface ExportStore {
  begin(session: ExportSessionBase, writerToken: string, options?: OperationOptions): Promise<void>
  appendPart(id: string, writerToken: string, payload: ExportPayload, options?: OperationOptions): Promise<void>
  readPart(id: string, part: number, options?: OperationOptions & { writerToken?: string }): Promise<ExportPayload>
  complete(id: string, writerToken: string, completion: ExportCompletion, options?: OperationOptions): Promise<ReadyExportSession>
  get(id: string, options?: OperationOptions): Promise<ExportSession | null>
  list(options?: OperationOptions): Promise<ExportSession[]>
  /** Invalidate the writer first; delete only this session and its own parts. */
  discard(id: string, writerToken?: string): Promise<void>
  close(): Promise<void>
}
export interface ExportProgress {
  phase: 'read' | 'stage' | 'verify'
  records?: number
  totalRecords?: number
  part?: number
  parts?: number
}
export interface PrepareBackupOptions extends OperationOptions {
  onProgress?: (progress: ExportProgress) => void
  volumeChars?: ExportOptions['volumeChars']
}
export interface BackupExportService {
  prepare(options?: PrepareBackupOptions): Promise<ReadyExportSession>
  readPart(id: string, part: number, options?: OperationOptions): Promise<ExportFile>
  resumeReady(id: string, options?: PrepareBackupOptions): Promise<ReadyExportSession>
  listSessions(options?: OperationOptions): Promise<ExportSession[]>
  discard(id: string): Promise<void>
  /** Abort and join this service's active work before closing the spool. */
  close(): Promise<void>
}
export interface BackupExportError extends TravelServiceError { cleanupPending?: boolean; sessionId?: string }
