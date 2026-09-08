// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { webcrypto } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createTravelServices, DATABASE_VERSION, DEFAULT_DATABASE_NAME } from '../src/services/travel-services'
import type { LocalRepository, StageMeta, TravelPlatform } from '../src/services/contracts'
import type { Cover, Draft, Snapshot, Visit } from '../src/domain/models'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const visit = (id = 'visit-one', extra: Partial<Visit> = {}): Visit => ({ id, createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '雪山下的回忆', photos: [], coverId: null, ...extra })
const photographed = (id = 'visit-photo'): Visit => visit(id, { photos: [{ id: 'photo-one', name: '照片.png', url: png }], coverId: 'photo-one' })
const cover = (value: Visit): Cover => ({ placeId: value.placeId, visitId: value.id, photoId: value.photos[0]!.id })
const draft = (extra: Partial<Draft> = {}): Draft => ({ ...visit(), id: 'draft-one', visitId: 'visit-one', updatedAt: 1, ...extra })
const tracked: LocalRepository[] = []
let sequence = 0
function harness(dbName = `vue-service-${++sequence}`, indexedDB = new IDBFactory()) {
  const platform: TravelPlatform = {
    indexedDB, IDBKeyRange, crypto: webcrypto as unknown as Crypto, Blob, TextEncoder,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
  const services = createTravelServices({ platform, dbName })
  tracked.push(services.repository)
  return { ...services, platform, indexedDB, dbName }
}
afterEach(async () => { await Promise.all(tracked.splice(0).map(repository => repository.close())) })

function open(indexedDB: IDBFactory, dbName: string, version: number, upgrade?: (db: IDBDatabase, tx: IDBTransaction) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version)
    request.onerror = () => reject(request.error)
    request.onupgradeneeded = () => upgrade?.(request.result, request.transaction!)
    request.onsuccess = () => resolve(request.result)
  })
}
function write(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([store], 'readwrite')
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.objectStore(store).put(value)
  })
}
function meta(snapshot: Snapshot): StageMeta {
  const dates = snapshot.visits.map(value => value.date).sort()
  return { archiveId: 'archive-bridge', exportedAt: '2026-09-01T00:00:00.000Z', archiveSha256: 'a'.repeat(64), covers: snapshot.covers.length,
    summary: { visits: snapshot.visits.length, photos: snapshot.visits.reduce((count, value) => count + value.photos.length, 0),
      places: new Set(snapshot.visits.map(value => value.placeId)).size, from: dates[0] ?? null, to: dates.at(-1) ?? null } }
}
async function ready(repository: LocalRepository, visits: Visit[], covers: Cover[] = []) {
  const stage = await repository.beginImportStage(meta({ visits, covers }))
  for (const row of visits) await repository.stageImportVisit(stage.id, row)
  for (const row of covers) await repository.stageImportCover(stage.id, row)
  return repository.finishImportStage(stage.id)
}

describe('typed compatibility service boundary', () => {
  it('uses the exact legacy database identity/schema without installing ambient globals', async () => {
    const names = ['ShanhaiBackup', 'ShanhaiPlaces', 'createShanhaiLocalStore']
    const before = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))
    expect(DEFAULT_DATABASE_NAME).toBe('shanhai-lijiang-local-v1')
    expect(DATABASE_VERSION).toBe(4)
    const h = harness()
    expect(await h.repository.load()).toEqual({ visits: [], covers: [] })
    const db = await open(h.indexedDB, h.dbName, 4)
    expect([...db.objectStoreNames]).toEqual(['backupImportCovers', 'backupImportSessions', 'backupImportVisits', 'covers', 'drafts', 'libraryMeta', 'visitIndex', 'visits'])
    db.close()
    expect(names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))).toEqual(before)
    for (const filename of ['backup-kernel.js', 'local-store-kernel.js']) {
      const source = await readFile(new URL(`../src/generated/${filename}`, import.meta.url), 'utf8')
      expect(source).not.toMatch(/globalThis|\bwindow\b|\broot\.|\beval\s*\(|new Function\b/)
    }
  })

  for (const version of [1, 2]) it(`upgrades the actual v${version} IDB schema in place without losing visits/covers/drafts`, async () => {
    const h = harness(), original = { ...photographed('old-visit'), opaqueFutureField: { retained: true } }
    const oldDraft = draft({ version: 'old-version' })
    const old = await open(h.indexedDB, h.dbName, version, (db, tx) => {
      db.createObjectStore('visits', { keyPath: 'id' })
      db.createObjectStore('covers', { keyPath: 'placeId' })
      if (version === 2) db.createObjectStore('drafts', { keyPath: 'slot' })
      tx.objectStore('visits').add(original)
      tx.objectStore('covers').add(cover(original))
      if (version === 2) tx.objectStore('drafts').add({ slot: 'active', draft: oldDraft })
    })
    old.close()
    expect(await h.repository.load()).toEqual({ visits: [original], covers: [cover(original)] })
    expect(await h.repository.loadDraft()).toEqual(version === 2 ? oldDraft : null)
    const upgraded = await open(h.indexedDB, h.dbName, 4)
    expect(upgraded.version).toBe(4)
    upgraded.close()
  })

  it('adds detached validated visits and rejects invalid content before writing', async () => {
    const h = harness(), incoming = photographed()
    const saving = h.repository.addVisit(incoming)
    incoming.note = 'caller mutation after save starts'
    incoming.photos[0]!.name = 'changed.png'
    await saving
    expect((await h.repository.load()).visits[0]).toEqual(photographed())
    await expect(h.repository.addVisit(visit('bad', { date: '2999-01-01' }))).rejects.toMatchObject({ code: 'invalid' })
    await expect(h.repository.addVisit(photographed())).rejects.toMatchObject({ code: 'conflict' })
    expect((await h.repository.load()).visits).toHaveLength(1)
  })

  it('keeps edit/delete CAS, removes invalid cover references, and preserves unknown metadata through undo', async () => {
    const h = harness(), row = { ...photographed(), privateFuture: { keep: true } }
    await h.repository.load()
    const db = await open(h.indexedDB, h.dbName, 4)
    await write(db, 'visits', row)
    db.close()
    await h.repository.setMapCover(row.placeId, { visitId: row.id, photoId: row.photos[0]!.id })
    const edited = await h.repository.updateVisit({ ...row, note: '新手记' }, { expectedVisit: row })
    expect(edited).toHaveProperty('privateFuture', { keep: true })
    await expect(h.repository.updateVisit({ ...row, note: '旧页面修改' }, { expectedVisit: row })).rejects.toMatchObject({ code: 'stale' })
    await expect(h.repository.deleteVisit(row.id, { expectedVisit: row })).rejects.toMatchObject({ code: 'stale' })
    const undo = await h.repository.deleteVisit(edited.id, { expectedVisit: edited })
    expect(await h.repository.load()).toEqual({ visits: [], covers: [] })
    const restored = await h.repository.restoreVisit(undo)
    expect(restored.visit).toHaveProperty('privateFuture', { keep: true })
    expect(restored.covers).toEqual([cover(row)])
    const noPhoto = await h.repository.updateVisit({ ...restored.visit, photos: [], coverId: null }, { expectedVisit: restored.visit })
    expect((await h.repository.load()).covers).toEqual([])
    await expect(h.repository.setMapCover(noPhoto.placeId, { visitId: noPhoto.id, photoId: 'photo-one' })).rejects.toMatchObject({ code: 'invalid-reference' })
  })

  it('preserves unfinished draft shapes and atomic cross-page draft CAS', async () => {
    const h = harness(), other = harness(h.dbName, h.indexedDB)
    const partial = draft({ placeId: 'custom-unfinished', date: '', note: '', customPlace: { id: 'custom-unfinished', name: '', regionId: '', coordinates: null } })
    const first = await h.repository.saveDraft(partial, { expectedVersion: null })
    expect(first.version).toBeTruthy()
    expect(await other.repository.loadDraft()).toEqual(first)
    const next = await other.repository.saveDraft({ ...first, note: '另一页更新' }, { expectedVersion: first.version })
    await expect(h.repository.saveDraft({ ...first, note: '旧页内容' }, { expectedVersion: first.version })).rejects.toMatchObject({ code: 'draft-conflict' })
    await expect(h.repository.clearDraft(first.id, { expectedVersion: first.version })).rejects.toMatchObject({ code: 'draft-conflict' })
    expect(await other.repository.clearDraft(next.id, { expectedVersion: next.version })).toBe(true)
    await expect(h.repository.saveDraft(first, { expectedVersion: first.version })).rejects.toMatchObject({ code: 'draft-conflict' })
    const fork = await h.repository.saveDraft({ ...partial, id: 'draft-fork', visitId: 'fork-visit' }, { expectedVersion: null })
    expect(fork.version).not.toBe(first.version)
    expect((await h.repository.load()).visits).toEqual([])
  })

  it('rejects unreadable persisted data without repairing or deleting it', async () => {
    const h = harness()
    await h.repository.load()
    const db = await open(h.indexedDB, h.dbName, 4)
    await write(db, 'drafts', { slot: 'active', draft: { id: 'draft-corrupt', version: 'keep-token', photos: 'broken' } })
    await expect(h.repository.loadDraft()).rejects.toMatchObject({ code: 'invalid-draft', recoverableDraft: { id: 'draft-corrupt', expectedVersion: 'keep-token' } })
    await write(db, 'visits', { id: 'bad-row', note: 'Do not drop silently' })
    await expect(h.repository.load()).rejects.toMatchObject({ name: 'ShanhaiBackupError' })
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction('visits').objectStore('visits').count()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    expect(count).toBe(1)
    db.close()
  })

  it('round trips old single-v1 backups with photographs, custom places and current-cover precedence', async () => {
    const h = harness(), row = photographed(), custom = visit('custom-visit', { placeId: 'custom-spot', customPlace: { id: 'custom-spot', name: '雪山下的小院', regionId: 'lijiang', coordinates: [100.233, 26.872] } })
    const snapshot = { visits: [row, custom], covers: [cover(row)] }
    const oldFile = JSON.stringify({ format: 'shanhai-backup', version: 1, exportedAt: '2025-02-01T00:00:00.000Z', ...snapshot })
    const parsed = h.backup.parse(oldFile)
    expect(parsed.snapshot).toEqual(snapshot)
    expect(h.backup.parse(h.backup.serialize(parsed.snapshot).text).snapshot).toEqual(snapshot)
    expect(await h.repository.importSnapshot(parsed.snapshot)).toEqual({ added: 2, skipped: 0, coversAdded: 1, coversKept: 0 })
    expect(await h.repository.importSnapshot(parsed.snapshot)).toEqual({ added: 0, skipped: 2, coversAdded: 0, coversKept: 1 })
    h.catalogue.replaceCustomPlaces((await h.repository.load()).visits)
    expect(h.catalogue.get('custom-spot')?.name).toBe('雪山下的小院')
    const changed = { ...custom, customPlace: { ...custom.customPlace!, name: '同编号不同地点' } }
    await expect(h.repository.addVisit({ ...changed, id: 'new-id' })).rejects.toMatchObject({ code: 'conflict' })
  })

  it('keeps staging isolated, commits atomically, and returns replay provenance without resurrecting deleted visits', async () => {
    const h = harness(), row = photographed()
    const stage = await ready(h.repository, [row], [cover(row)])
    expect(await h.repository.load()).toEqual({ visits: [], covers: [] })
    expect(await h.repository.planStagedImport(stage.id)).toEqual({ added: 1, skipped: 0, coversAdded: 1, coversKept: 0 })
    const committed = await h.repository.commitStagedImport(stage.id)
    expect(committed).toEqual({ added: 1, skipped: 0, coversAdded: 1, coversKept: 0, sessionId: stage.id, replayed: false })
    expect(await h.repository.planStagedImport(stage.id)).toEqual({ added: 1, skipped: 0, coversAdded: 1, coversKept: 0, sessionId: stage.id, status: 'committed' })
    await h.repository.discardImportStage(stage.id)
    await h.repository.deleteVisit(row.id, { expectedVisit: row })
    const reopened = harness(h.dbName, h.indexedDB)
    expect(await reopened.repository.commitStagedImport(stage.id)).toEqual({ ...committed, replayed: true })
    expect(await reopened.repository.load()).toEqual({ visits: [], covers: [] })
    expect(await reopened.repository.listImportStages()).toEqual([])
    expect(await reopened.repository.listImportStages({ includeCleaned: true })).toMatchObject([{ id: stage.id, cleaned: true, status: 'committed' }])
  })

  it('rechecks changes after staging preview and aborts all live writes on conflict', async () => {
    const h = harness(), original = visit('z-existing')
    await h.repository.addVisit(original)
    const stage = await ready(h.repository, [visit('a-new'), original])
    expect(await h.repository.planStagedImport(stage.id)).toMatchObject({ added: 1, skipped: 1 })
    const other = harness(h.dbName, h.indexedDB)
    const changed = await other.repository.updateVisit({ ...original, note: '另一页已修改' }, { expectedVisit: original })
    await expect(h.repository.commitStagedImport(stage.id)).rejects.toMatchObject({ code: 'conflict' })
    expect((await h.repository.load()).visits).toEqual([changed])
    expect(await h.repository.listImportStages()).toMatchObject([{ id: stage.id, status: 'ready' }])
  })

  it('supports pre-aborted staging and discards only the specified temporary session', async () => {
    const h = harness(), controller = new AbortController()
    controller.abort()
    await expect(h.repository.beginImportStage(meta({ visits: [visit()], covers: [] }), { signal: controller.signal })).rejects.toMatchObject({ code: 'aborted' })
    const a = await ready(h.repository, [visit('a')]), b = await ready(h.repository, [visit('b')])
    await h.repository.discardImportStage(a.id)
    expect(await h.repository.listImportStages()).toMatchObject([{ id: b.id }])
    expect(await h.repository.load()).toEqual({ visits: [], covers: [] })
  })

  it('keeps generated modules byte-for-byte fresh with the authoritative kernels', () => {
    const script = fileURLToPath(new URL('../scripts/sync-legacy-kernels.mjs', import.meta.url))
    expect(execFileSync(process.execPath, [script, '--check'], { encoding: 'utf8' })).toContain('FRESH local-store-kernel.js')
  })

  it('surfaces unavailable storage and missing secure randomness without inventing IDs', async () => {
    const h = harness()
    const unavailable = createTravelServices({ platform: { ...h.platform, indexedDB: undefined } })
    tracked.push(unavailable.repository)
    await expect(unavailable.repository.load()).rejects.toMatchObject({ code: 'unavailable' })
    const insecure = createTravelServices({ platform: { ...h.platform, crypto: undefined }, dbName: 'no-secure-ids' })
    tracked.push(insecure.repository)
    await expect(insecure.repository.saveDraft(draft(), { expectedVersion: null })).rejects.toMatchObject({ code: 'unavailable' })
    expect(await insecure.repository.loadDraft()).toBeNull()
  })
})
