import type { createCatalogue } from '../domain/catalogue'
import type { Cover, Draft, LibraryIndexSnapshot, Photo, Snapshot, Visit } from '../domain/models'
import type { EncodedArchive, ExportPayload, ExportSink, StreamExportSource } from './export-types'

export type TravelCatalogue = ReturnType<typeof createCatalogue>
export interface TravelPlatform {
  indexedDB?: IDBFactory
  IDBKeyRange: typeof IDBKeyRange
  crypto?: Pick<Crypto, 'getRandomValues'> & Partial<Pick<Crypto, 'randomUUID' | 'subtle'>>
  Blob: typeof Blob
  TextEncoder: typeof TextEncoder
  FileReader?: typeof FileReader
  setTimeout: (callback: () => void, delay: number) => unknown
  clearTimeout: (handle: unknown) => void
}
export interface OperationOptions { signal?: AbortSignal }
export interface ReadVisitOptions extends OperationOptions { expectedRevision?: number }
export type BackupFormat = 'single-v1' | 'volume-v2'
export interface BackupSummary { visits: number; photos: number; places: number; from: string | null; to: string | null }
export interface MergeCounts { added: number; skipped: number; coversAdded: number; coversKept: number }
export interface MergePlan extends MergeCounts { visitsToAdd: Visit[]; coversToAdd: Cover[] }
export interface StageMeta {
  archiveId: string
  exportedAt: string
  archiveSha256: string
  summary: BackupSummary
  covers: number
}
export interface CommitReceipt extends MergeCounts { sessionId: string }
export interface CommitResult extends CommitReceipt { replayed: boolean }
export type StagedPlan = MergeCounts | (CommitReceipt & { status: 'committed' })
export interface ImportStage extends StageMeta {
  id: string
  status: 'staging' | 'ready' | 'committed'
  result?: CommitReceipt
  cleaned: boolean
}
export interface ParsedBackup { snapshot: Snapshot; exportedAt: string; summary: BackupSummary }
export interface SingleBackup extends ParsedBackup { format: 'single-v1'; parts: 1 }
/** Opaque provenance: consumeVolumes accepts only the original preflight object
 * from the same codec instance. Do not clone, persist or reconstruct it. */
export interface VolumeDescriptor {
  readonly format: 'volume-v2'
  readonly parts: number
  readonly archiveId: string
  readonly exportedAt: string
  readonly summary: Readonly<BackupSummary>
  readonly stageMeta: Readonly<StageMeta>
}
export interface BackupProgress { phase: 'check' | 'assemble' | 'prepare' | 'checksum'; part?: number; parts?: number; records?: number }
export interface CodecOperationOptions extends OperationOptions { onProgress?: (progress: BackupProgress) => void }
export interface ExportOptions extends CodecOperationOptions { forceVolumes?: boolean; volumeChars?: number }
export interface ExportFile { filename: string; blob: Blob; bytes: number; part: number }
export interface PreparedExport {
  format: BackupFormat
  files: ExportFile[]
  totalBytes: number
  sourceBytes: number
  summary: BackupSummary
  archiveId?: string
}
export interface BackupFile { size: number; text(): Promise<string> }
export type BackupFiles = Iterable<BackupFile> | ArrayLike<BackupFile>
export interface ConsumeOptions extends CodecOperationOptions {
  onVisit: (visit: Visit) => Promise<unknown>
  onCover: (cover: Cover) => Promise<unknown>
  /** Mandatory actual image decode by the UI/platform, not just MIME inspection. */
  decodePhoto: (photo: Photo) => Promise<unknown>
}
export interface BackupCodec {
  readonly MAX_BYTES: number
  readonly VOLUME_CHARS: number
  normalizeSnapshot(snapshot: unknown): Snapshot
  normalizeLibrary(snapshot: unknown): Snapshot
  parse(text: string): ParsedBackup
  /** Compatibility collector; do not use for interactive volume restore. */
  parseFiles(files: BackupFiles, options?: CodecOperationOptions): Promise<SingleBackup | (ParsedBackup & { format: 'volume-v2'; parts: number; archiveId: string })>
  preflightFiles(files: BackupFiles, options?: CodecOperationOptions): Promise<SingleBackup | VolumeDescriptor>
  consumeVolumes(descriptor: VolumeDescriptor, options: ConsumeOptions): Promise<{ summary: BackupSummary; covers: number; records: number }>
  serialize(snapshot: unknown): { text: string; filename: string; summary: BackupSummary }
  prepareExport(snapshot: unknown, options?: ExportOptions): Promise<PreparedExport>
  /** Bounded interactive export: the sink must settle before the next part. */
  writeVolumes(source: StreamExportSource, sink: ExportSink, options?: ExportOptions): Promise<EncodedArchive>
  wrapVolume(archive: EncodedArchive, payload: ExportPayload, options?: OperationOptions): Promise<ExportFile>
  summarize(snapshot: unknown): BackupSummary
  planMerge(current: unknown, incoming: unknown): MergePlan
  planLibraryMerge(current: unknown, incoming: unknown): MergePlan
}
export interface ExpectedVisit { expectedVisit: Visit }
/** null means the caller observed an empty/versionless slot; omitted tokens are
 * deliberately not allowed through the typed UI boundary. */
export interface ExpectedDraft { expectedVersion: string | null }
export interface UndoVisit { visit: Visit; covers: Cover[] }
export interface RestoredVisit extends UndoVisit { coversKept: number }
export interface LocalRepository {
  /** Optional remote write receipt reconciliation. Returns a canonical record
   * only when this exact input was durably confirmed by the same account. */
  reconcilePendingVisit?(visit: Visit): Promise<Visit | null>
  /** Full compatibility/backup snapshot. Not for homepage or editor preflight. */
  load(): Promise<Snapshot>
  loadIndex(options?: OperationOptions): Promise<LibraryIndexSnapshot>
  readVisit(id: string, options?: ReadVisitOptions): Promise<Visit | null>
  assertRevision(expectedRevision: number, options?: OperationOptions): Promise<void>
  hasDraft(options?: OperationOptions): Promise<boolean>
  addVisit(visit: Visit): Promise<string>
  updateVisit(visit: Visit, expectation: ExpectedVisit): Promise<Visit>
  deleteVisit(id: string, expectation: ExpectedVisit): Promise<UndoVisit>
  restoreVisit(undo: UndoVisit): Promise<RestoredVisit>
  setMapCover(placeId: string, reference: Pick<Cover, 'visitId' | 'photoId'>): Promise<Cover>
  saveDraft(draft: Draft, expectation: ExpectedDraft): Promise<Draft & { version: string }>
  loadDraft(): Promise<Draft | null>
  clearDraft(id: string, expectation: ExpectedDraft): Promise<boolean>
  importSnapshot(snapshot: unknown, options?: { format?: BackupFormat }): Promise<MergeCounts>
  beginImportStage(meta: StageMeta, options?: OperationOptions): Promise<ImportStage>
  stageImportVisit(id: string, visit: Visit, options?: OperationOptions): Promise<{ visits: number; photos: number }>
  stageImportCover(id: string, cover: Cover, options?: OperationOptions): Promise<{ covers: number }>
  finishImportStage(id: string, options?: OperationOptions): Promise<ImportStage>
  planStagedImport(id: string, options?: OperationOptions): Promise<StagedPlan>
  commitStagedImport(id: string): Promise<CommitResult>
  discardImportStage(id: string, options?: OperationOptions): Promise<boolean>
  listImportStages(options?: OperationOptions & { includeCleaned?: boolean }): Promise<ImportStage[]>
  close(): Promise<void>
}

/** Raw IndexedDB reads are not statically trustworthy. Only this narrow
 * generated boundary has unknown outputs; the public repository validates them. */
export interface LocalStoreKernel extends Omit<LocalRepository, 'load' | 'loadDraft' | 'readVisit'> {
  load(): Promise<unknown>
  loadDraft(): Promise<unknown>
  readVisit(id: string, options?: ReadVisitOptions): Promise<unknown>
}
export interface TravelServiceError extends Error {
  code?: string
  friendlyMessage?: string
  recoverableDraft?: { id: string; expectedVersion: string | null }
}
