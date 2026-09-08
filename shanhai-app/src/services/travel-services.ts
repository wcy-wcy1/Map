import { createCatalogue } from '../domain/catalogue'
import type { Draft, Snapshot, Visit } from '../domain/models'
import { createBackupKernel } from '../generated/backup-kernel.js'
import { createLocalStoreKernel } from '../generated/local-store-kernel.js'
import type { BackupCodec, LocalRepository, TravelCatalogue, TravelPlatform, TravelServiceError } from './contracts'
import { createBackupRestoreService } from './backup-service'
import { createExportStore } from './export-store'
import { createBackupExportService } from './export-service'

export const DEFAULT_DATABASE_NAME = 'shanhai-lijiang-local-v1'
export const DATABASE_VERSION = 4

/** Capture platform capabilities explicitly. Importing this module performs no
 * database access and never installs globals on window/globalThis. */
export function browserTravelPlatform(): TravelPlatform {
  let indexedDB: IDBFactory | undefined
  let crypto: Crypto | undefined
  try { indexedDB = globalThis.indexedDB } catch { /* Kernel returns actionable permission error. */ }
  try { crypto = globalThis.crypto } catch { /* Secure IDs must fail, never fall back to Math.random. */ }
  return {
    indexedDB, crypto,
    IDBKeyRange: globalThis.IDBKeyRange,
    Blob: globalThis.Blob,
    TextEncoder: globalThis.TextEncoder,
    FileReader: globalThis.FileReader,
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function draftError(value: unknown): never {
  const message = '这份草稿无法安全读取，未修改草稿或已保存的回忆。请保留当前页面并检查备份。'
  const error: TravelServiceError = Object.assign(new Error(message), {
    name: 'ShanhaiLocalStoreError', code: 'invalid-draft', friendlyMessage: message,
  })
  if (object(value) && typeof value.id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value.id)
    && (value.version === undefined || typeof value.version === 'string')) {
    error.recoverableDraft = { id: value.id, expectedVersion: value.version ?? null }
  }
  throw error
}
function localToday(): string {
  const date = new Date()
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
}

/** Drafts deliberately allow unfinished location/date/content. Validate their
 * shape and photos without demanding that a draft already be a savable visit. */
export function normalizeLocalDraft(value: unknown, backup: BackupCodec, catalogue: TravelCatalogue): Draft {
  if (!object(value) || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value.id)
    || typeof value.visitId !== 'string' || typeof value.note !== 'string' || value.note.length > 2000
    || typeof value.date !== 'string' || value.date.length > 10
    || (value.version !== undefined && (typeof value.version !== 'string' || !value.version))) draftError(value)
  try {
    const firstPlace = catalogue.publicPlaces[0]
    if (!firstPlace) draftError(value)
    const checked = backup.normalizeSnapshot({ visits: [{ id: value.visitId, createdAt: 0, placeId: firstPlace.id,
      date: localToday(), note: value.note.trim() ? value.note : '草稿检查', photos: value.photos, coverId: value.coverId }], covers: [] }).visits[0]!
    const createdAt = typeof value.createdAt === 'number' && Number.isFinite(value.createdAt) ? value.createdAt : Date.now()
    const draft: Draft = {
      id: value.id, visitId: value.visitId, createdAt,
      placeId: typeof value.placeId === 'string' ? value.placeId : '', date: value.date,
      note: value.note, photos: checked.photos, coverId: checked.coverId,
      updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : createdAt,
    }
    if (typeof value.version === 'string') draft.version = value.version
    if (value.originalVisit !== undefined) draft.originalVisit = backup.normalizeSnapshot({ visits: [value.originalVisit], covers: [] }).visits[0]!
    if (value.customPlace !== undefined) {
      const custom = value.customPlace
      if (!object(custom) || typeof custom.id !== 'string' || custom.id !== draft.placeId
        || !/^custom-[A-Za-z0-9_-]{1,93}$/.test(custom.id) || typeof custom.name !== 'string' || custom.name.length > 60
        || typeof custom.regionId !== 'string' || (custom.coordinates !== null
          && (!Array.isArray(custom.coordinates) || custom.coordinates.length !== 2 || !custom.coordinates.every(item => typeof item === 'number' && Number.isFinite(item))))) draftError(value)
      draft.customPlace = { id: custom.id, name: custom.name, regionId: custom.regionId,
        coordinates: custom.coordinates === null ? null : [Number(custom.coordinates[0]), Number(custom.coordinates[1])] }
    }
    return draft
  } catch (cause) {
    if (object(cause) && cause.code === 'invalid-draft') throw cause
    draftError(value)
  }
}

export interface TravelServicesOptions { catalogue?: TravelCatalogue; platform?: TravelPlatform; dbName?: string }
export function createTravelServices({ catalogue = createCatalogue(), platform = browserTravelPlatform(), dbName = DEFAULT_DATABASE_NAME }: TravelServicesOptions = {}) {
  const backup = createBackupKernel({ catalogue, platform })
  const kernel = createLocalStoreKernel({ catalogue, backup, platform }, { dbName })
  function checkedVisit(value: Visit): Visit {
    return backup.normalizeSnapshot({ visits: [value], covers: [] }).visits[0]!
  }
  const repository: LocalRepository = {
    ...kernel,
    async load() {
      const raw = await kernel.load()
      // Validate without writing repairs or stripping unknown metadata from the
      // detached rows. The normalizer proves the supported fields at this edge.
      backup.normalizeLibrary(raw)
      return raw as Snapshot
    },
    async readVisit(id, options) {
      const raw = await kernel.readVisit(id, options)
      if (raw === null) return null
      backup.normalizeLibrary({ visits: [raw], covers: [] })
      return raw as Visit
    },
    async addVisit(visit) {
      // Legacy addVisit expected its editor to validate. The Vue service makes
      // that invariant explicit and detaches before awaiting an IDB connection.
      return kernel.addVisit(checkedVisit(visit))
    },
    async loadDraft() {
      const raw = await kernel.loadDraft()
      return raw === null ? null : normalizeLocalDraft(raw, backup, catalogue)
    },
    async saveDraft(draft, expectation) {
      return kernel.saveDraft(normalizeLocalDraft(draft, backup, catalogue), expectation)
    },
  }
  const restores = createBackupRestoreService(repository, backup)
  const exportStore = createExportStore(platform, `${dbName}-exports-v1`)
  const exports = createBackupExportService(repository, backup, exportStore, platform, dbName)
  repository.close = async () => {
    await exports.close()
    await kernel.close()
  }
  return { catalogue, repository, backup, restores, exports }
}

export type TravelServices = ReturnType<typeof createTravelServices>
export type * from './contracts'
