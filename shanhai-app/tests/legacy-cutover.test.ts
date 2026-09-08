// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { IDBDatabase as FakeDatabase, IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { createHash, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { createTravelServices, DATABASE_VERSION, DEFAULT_DATABASE_NAME } from '../src/services/travel-services'
import type { BackupCodec, LocalRepository, TravelPlatform } from '../src/services/contracts'
import type { Cover, Draft, Photo, Snapshot, Visit } from '../src/domain/models'

/** Controlled compatibility evidence, NOT a native-browser migration test.
 * The authoritative source is the preserved full old build, not the mutable
 * source kernels that now use schema 4. Only its DOM-free catalogue, codec
 * and local-store modules execute in a fresh VM with fake-indexeddb. No page,
 * editor, global browser object, user database or production origin is used.
 *
 * Schema 2/token fixtures use the actual old store writer. Schema 1 and the
 * versionless schema 2 draft are explicitly synthetic historical schema models.
 * All content is authored test data; the embedded 1x1 PNG is a public test pixel.
 * Unknown top-level visit fields exercise preservation of existing local rows.
 * Like the old codec, portable backups include only the defined v1 fields and
 * exclude drafts; a backup is not claimed to preserve opaque extension fields.
 */
const OLD_BUILD_SHA256 = 'bfa10f4a3ef5f5d8e492c7744e239e0657016e7847f124815f1e18e88510565e'
const oldBuildUrl = new URL('../../output/shanhai-yunnan/index.html', import.meta.url)
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const repositories: Array<Pick<LocalRepository, 'close'>> = []
let source = '', sequence = 0
let oldScripts: { catalogue: string; codec: string; store: string; data: unknown }
let schema3Store = ''

beforeAll(async () => {
  const bytes = await readFile(oldBuildUrl)
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(OLD_BUILD_SHA256)
  source = bytes.toString('utf8')
  const scripts = Array.from(source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), match => match[1]!)
  function one(marker: string) {
    const matches = scripts.filter(script => script.includes(marker))
    expect(matches, `one preserved DOM-free module for ${marker}`).toHaveLength(1)
    return matches[0]!
  }
  const dataScript = one('globalThis.ShanhaiYunnanData=')
  oldScripts = {
    data: JSON.parse(dataScript.replace(/^globalThis\.ShanhaiYunnanData=/, '').replace(/;\s*$/, '')),
    catalogue: one('root.ShanhaiPlaces=Object.freeze'),
    codec: one('root.ShanhaiBackup = Object.freeze'),
    store: one('root.createShanhaiLocalStore = function createShanhaiLocalStore'),
  }
  const schema3Bytes = await readFile(new URL('../../output/shanhai-yunnan/qa/incremental-20260907/bundle/index.html', import.meta.url))
  expect(createHash('sha256').update(schema3Bytes).digest('hex')).toBe('58a528d096740a4a3ae862dd70414a7d9ffe895daa3b50781a94e20f710fb9a9')
  const schema3Scripts = Array.from(schema3Bytes.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), match => match[1]!)
  const stores = schema3Scripts.filter(script => script.includes('root.createShanhaiLocalStore = function createShanhaiLocalStore'))
  expect(stores).toHaveLength(1)
  schema3Store = stores[0]!
  expect(schema3Store).toContain('root.indexedDB.open(dbName, 3)')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(repositories.splice(0).map(repository => repository.close()))
})

function identity() { return { indexedDB: new IDBFactory(), dbName: `isolated-legacy-cutover-${++sequence}` } }
type Identity = ReturnType<typeof identity>
function platform(indexedDB: IDBFactory): TravelPlatform {
  return { indexedDB, IDBKeyRange, crypto: webcrypto as unknown as Crypto, Blob, TextEncoder,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }
}
function current(id: Identity) {
  const services = createTravelServices({ ...id, platform: platform(id.indexedDB) })
  repositories.push(services.repository)
  return services
}
function legacy(id: Identity, schema3 = false) {
  const sandbox = createContext({ ...platform(id.indexedDB), ShanhaiYunnanData: structuredClone(oldScripts.data) })
  for (const [name, script] of [['catalogue', oldScripts.catalogue], ['codec', oldScripts.codec], ['store', schema3 ? schema3Store : oldScripts.store]]) {
    // Only these three preserved, reviewed service modules are evaluated.
    runInContext(script!, sandbox, { timeout: 1000, filename: `preserved-old-${name}.js` })
  }
  const backup = sandbox.ShanhaiBackup as Pick<BackupCodec, 'normalizeSnapshot' | 'serialize' | 'parse'>
  const repository = sandbox.createShanhaiLocalStore({ dbName: id.dbName }) as LocalRepository
  repositories.push(repository)
  return { backup, repository }
}

function content() {
  const mountain: Visit & { legacyExtension: unknown } = {
    id: 'visit-old-mountain', createdAt: 1710000000000, placeId: 'yulong', date: '2024-03-09',
    note: '雪山清晨 🌄\n纳西小院、café、雨后松香；第二张是封面。',
    photos: [{ id: 'photo-old-first', name: '清晨－一.png', url: png }, { id: 'photo-old-selected', name: '雪山🌄－二.png', url: png }],
    coverId: 'photo-old-selected', legacyExtension: { source: 'synthetic-old-row', labels: ['保留', 'é'], nested: { revision: 7 } },
  }
  const custom: Visit & { legacyExtension: unknown } = {
    id: 'visit-old-custom', createdAt: 1710086400000, placeId: 'custom-old-courtyard', date: '2024-03-10',
    note: '私下命名的小院 🏡，下次还来。', photos: [], coverId: null,
    customPlace: { id: 'custom-old-courtyard', name: '雪山下的小院', regionId: 'lijiang', coordinates: [100.233, 26.872] },
    legacyExtension: { preserved: true, customOwnerTag: '测试资料' },
  }
  const cover: Cover = { placeId: mountain.placeId, visitId: mountain.id, photoId: mountain.photos[1]!.id }
  const draft: Draft = {
    id: 'draft-old-partial', visitId: 'visit-not-saved', createdAt: 1710172800000, updatedAt: 1710172800450,
    placeId: 'custom-unfinished', date: '', note: '还没填完的草稿 📝\n照片和空日期应保留。',
    photos: [{ id: 'photo-draft', name: '未完成.png', url: png }], coverId: 'photo-draft',
    customPlace: { id: 'custom-unfinished', name: '', regionId: '', coordinates: null },
  }
  return { snapshot: { visits: [mountain, custom], covers: [cover] } as Snapshot, mountain, custom, cover, draft }
}

function open(id: Identity, version?: number, upgrade?: (db: IDBDatabase, tx: IDBTransaction) => void): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = id.indexedDB.open(id.dbName, version)
    request.onupgradeneeded = () => upgrade?.(request.result, request.transaction!)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
  })
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function stored(id: Identity) {
  const db = await open(id)
  try {
    const names = [...db.objectStoreNames]
    const tx = db.transaction(names)
    const rows = await Promise.all(names.map(async name => [name, await requestResult(tx.objectStore(name).getAll())] as const))
    return { version: db.version, rows: Object.fromEntries(rows) }
  } finally { db.close() }
}
type OldVariant = 'schema-1-synthetic' | 'schema-2-versionless-synthetic' | 'schema-2-old-writer' | 'schema-3-old-writer'
async function seed(id: Identity, variant: OldVariant, snapshot = content().snapshot) {
  const fixture = content(), old = legacy(id, variant === 'schema-3-old-writer')
  // Proves every supported visit/photo/custom-place field is accepted by the
  // preserved old codec, rather than assuming today's codec is backward proof.
  old.backup.normalizeSnapshot(snapshot)
  if (variant === 'schema-2-old-writer' || variant === 'schema-3-old-writer') {
    for (const visit of snapshot.visits) await old.repository.addVisit(visit)
    for (const cover of snapshot.covers) await old.repository.setMapCover(cover.placeId, cover)
    const draft = await old.repository.saveDraft(fixture.draft, { expectedVersion: null })
    await old.repository.close()
    return { ...fixture, snapshot, draft }
  }
  const version = variant === 'schema-1-synthetic' ? 1 : 2
  const db = await open(id, version, (db, tx) => {
    db.createObjectStore('visits', { keyPath: 'id' })
    db.createObjectStore('covers', { keyPath: 'placeId' })
    if (version === 2) db.createObjectStore('drafts', { keyPath: 'slot' })
    for (const visit of snapshot.visits) tx.objectStore('visits').add(visit)
    for (const cover of snapshot.covers) tx.objectStore('covers').add(cover)
    if (version === 2) tx.objectStore('drafts').add({ slot: 'active', draft: fixture.draft })
  })
  db.close()
  return { ...fixture, snapshot, draft: version === 2 ? fixture.draft : null }
}
async function assertSchema4(id: Identity) {
  const db = await open(id)
  try {
    expect(db.version).toBe(4)
    expect([...db.objectStoreNames]).toEqual(['backupImportCovers', 'backupImportSessions', 'backupImportVisits', 'covers', 'drafts', 'libraryMeta', 'visitIndex', 'visits'])
    const tx = db.transaction([...db.objectStoreNames])
    for (const [name, key] of Object.entries({ visits: 'id', covers: 'placeId', drafts: 'slot', backupImportSessions: 'id',
      backupImportVisits: ['sessionId', 'id'], backupImportCovers: ['sessionId', 'placeId'], visitIndex: 'id', libraryMeta: 'id' })) {
      expect(tx.objectStore(name).keyPath).toEqual(key)
    }
    const staged = tx.objectStore('backupImportVisits')
    expect([...staged.indexNames]).toEqual(['sessionPlace'])
    expect(staged.index('sessionPlace').keyPath).toEqual(['sessionId', 'placeId'])
    expect(staged.index('sessionPlace').unique).toBe(false)
  } finally { db.close() }
}

// Node has no browser image decoder. This labelled callback mock checks the
// authored data URI and verifies the restore pipeline calls its decode boundary;
// it does NOT claim native image decoding, HEIC support or real photo selection.
function nodeDecodeMock() {
  return vi.fn(async (photo: Photo) => {
    expect(photo.url).toBe(png)
    expect(Buffer.from(photo.url.split(',')[1]!, 'base64').subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  })
}

describe('preserved old build → current Vue services: controlled cutover', () => {
  it('pins the old baseline and distinguishes database name, schema and portable backup version', () => {
    expect(DEFAULT_DATABASE_NAME).toBe('shanhai-lijiang-local-v1')
    expect(DATABASE_VERSION).toBe(4)
    expect(oldScripts.store).toContain('root.indexedDB.open(dbName, 2)')
    expect(oldScripts.store).toContain("drafts.put({ slot: 'active', draft: value })")
    expect(oldScripts.store).not.toContain('backupImportSessions')
    expect(oldScripts.store).not.toContain('createIndex(')
    expect(oldScripts.codec).toContain("format: 'shanhai-backup', version: 1")
  })

  for (const variant of ['schema-1-synthetic', 'schema-2-versionless-synthetic', 'schema-2-old-writer', 'schema-3-old-writer'] as const) {
    it(`R01/R04/R05/R06: ${variant} preserves rows, selected covers, draft and metadata through mutation/reopen`, async () => {
      const id = identity(), fixture = await seed(id, variant), before = await stored(id)
      const h = current(id)
      expect(await h.repository.load()).toEqual(fixture.snapshot)
      expect(await h.repository.loadDraft()).toEqual(fixture.draft)
      await assertSchema4(id)
      const migrated = await stored(id)
      for (const [name, rows] of Object.entries(before.rows)) expect(migrated.rows[name]).toEqual(rows)
      expect(migrated.rows.backupImportSessions).toEqual([])
      expect(migrated.rows.backupImportVisits).toEqual([])
      expect(migrated.rows.backupImportCovers).toEqual([])
      expect(migrated.rows.libraryMeta).toEqual([{ id: 'library', revision: 0 }])
      const index = await h.repository.loadIndex()
      expect(index.visits.map(value => ({ ...value, photos: value.photos.map(photo => photo.id) }))).toEqual(fixture.snapshot.visits.map(value => ({
        id: value.id, createdAt: value.createdAt, placeId: value.placeId, date: value.date, note: value.note,
        photos: value.photos.map(photo => photo.id), coverId: value.coverId, ...(value.customPlace ? { customPlace: value.customPlace } : {}),
      })))
      expect(index.covers).toEqual(fixture.snapshot.covers)
      expect(index.revision).toBe(0)
      expect(await h.repository.hasDraft()).toBe(Boolean(fixture.draft))
      expect(await h.repository.readVisit(fixture.mountain.id, { expectedRevision: index.revision })).toEqual(fixture.mountain)
      h.catalogue.replaceCustomPlaces((await h.repository.load()).visits)
      expect(h.catalogue.get(fixture.custom.placeId)?.customPlace).toEqual(fixture.custom.customPlace)

      const edited = await h.repository.updateVisit({ ...fixture.mountain, note: fixture.mountain.note + '\nVue 继续编辑。' }, { expectedVisit: fixture.mountain })
      expect(edited).toHaveProperty('legacyExtension', fixture.mountain.legacyExtension)
      expect(edited.photos).toEqual(fixture.mountain.photos)
      expect(edited.coverId).toBe('photo-old-selected')
      await expect(h.repository.updateVisit(fixture.mountain, { expectedVisit: fixture.mountain })).rejects.toMatchObject({ code: 'stale' })
      await expect(h.repository.deleteVisit(edited.id, { expectedVisit: fixture.mountain })).rejects.toMatchObject({ code: 'stale' })
      const undo = await h.repository.deleteVisit(edited.id, { expectedVisit: edited })
      expect(undo).toEqual({ visit: edited, covers: [fixture.cover] })
      expect(await h.repository.load()).toEqual({ visits: [fixture.custom], covers: [] })
      expect(await h.repository.restoreVisit(undo)).toEqual({ ...undo, coversKept: 0 })
      const added: Visit = { ...fixture.custom, id: 'visit-after-upgrade', createdAt: 1710259200000, note: '升级后新增的纯手记。' }
      await h.repository.addVisit(added)

      let savedDraft: Draft | null = null
      if (fixture.draft) {
        const other = current(id)
        savedDraft = await h.repository.saveDraft({ ...fixture.draft, note: fixture.draft.note + '\n继续填写。' }, { expectedVersion: fixture.draft.version ?? null })
        expect(savedDraft.version).toBeTruthy()
        expect(savedDraft.version).not.toBe(fixture.draft.version)
        await expect(other.repository.saveDraft(fixture.draft, { expectedVersion: fixture.draft.version ?? null })).rejects.toMatchObject({ code: 'draft-conflict' })
        await expect(other.repository.clearDraft(fixture.draft.id, { expectedVersion: fixture.draft.version ?? null })).rejects.toMatchObject({ code: 'draft-conflict' })
        expect(await other.repository.loadDraft()).toEqual(savedDraft)
        await other.repository.close()
      }
      const expected = { visits: [edited, fixture.custom, h.backup.normalizeSnapshot({ visits: [added], covers: [] }).visits[0]!], covers: [fixture.cover] }
      await h.repository.close()
      const reopened = current(id)
      expect(await reopened.repository.load()).toEqual(expected)
      expect(await reopened.repository.loadDraft()).toEqual(savedDraft)
      if (savedDraft) {
        expect(await reopened.repository.clearDraft(savedDraft.id, { expectedVersion: savedDraft.version! })).toBe(true)
        expect(await reopened.repository.loadDraft()).toBeNull()
      }
      const raw = await stored(id)
      expect(raw.rows.visits!.find(row => row.id === edited.id)).toEqual(edited)
      expect(raw.rows.visits!.find(row => row.id === fixture.custom.id)).toEqual(fixture.custom)
    })
  }

  for (const variant of ['schema-1-synthetic', 'schema-2-old-writer', 'schema-3-old-writer'] as const) {
    it(`R08: aborting ${variant} migration rolls back all new stores/indexes and retains original bytes`, async () => {
      const id = identity(), fixture = await seed(id, variant), before = await stored(id)
      const createStore = FakeDatabase.prototype.createObjectStore
      const spy = vi.spyOn(FakeDatabase.prototype, 'createObjectStore').mockImplementation(function (this: IDBDatabase, name, options) {
        if (this.name === id.dbName && name === 'libraryMeta') throw new DOMException('Injected last-store upgrade failure', 'QuotaExceededError')
        return createStore.call(this, name, options)
      })
      const h = current(id)
      await expect(h.repository.load()).rejects.toMatchObject({ code: 'quota' })
      spy.mockRestore()
      await h.repository.close()
      expect(await stored(id)).toEqual(before)
      const retry = current(id)
      expect(await retry.repository.load()).toEqual(fixture.snapshot)
      expect(await retry.repository.loadDraft()).toEqual(fixture.draft)
      await assertSchema4(id)
    })
  }

  it('R08: a held old connection blocks cutover without a late partial upgrade', async () => {
    const id = identity(), fixture = await seed(id, 'schema-2-old-writer'), before = await stored(id)
    const held = await open(id, 2)
    const h = current(id)
    try {
      await expect(h.repository.load()).rejects.toMatchObject({ code: 'blocked' })
      expect([...held.objectStoreNames]).toEqual(['covers', 'drafts', 'visits'])
    } finally { held.close() }
    // The failed open request later receives onupgradeneeded; its settled guard
    // must abort. Queue this read behind it to prove no background migration.
    expect(await stored(id)).toEqual(before)
    expect(await current(id).repository.load()).toEqual(fixture.snapshot)
  })

  it('R08: opening schema 2 after schema 4 produces VersionError, so an HTML rollback is not a database rollback', async () => {
    const id = identity(), fixture = await seed(id, 'schema-2-old-writer'), h = current(id)
    await h.repository.load()
    await h.repository.close()
    const before = await stored(id)
    await expect(open(id, 2)).rejects.toMatchObject({ name: 'VersionError' })
    const old = legacy(id)
    await expect(old.repository.load()).rejects.toMatchObject({ code: 'unavailable', cause: { name: 'VersionError' } })
    await expect(old.repository.addVisit({ ...fixture.custom, id: 'must-not-write-old-client' })).rejects.toMatchObject({ code: 'unavailable' })
    expect(await stored(id)).toEqual(before)
  })

  it('R08: actual old v1 serialization restores through inspect/commit and exported supported content reimports', async () => {
    const id = identity(), fixture = content(), incoming = legacy(identity()).backup.serialize(fixture.snapshot)
    const localCover = { ...fixture.cover, photoId: fixture.mountain.photos[0]!.id }
    await seed(id, 'schema-2-old-writer', { visits: [fixture.mountain], covers: [localCover] })
    const h = current(id), before = await h.repository.load(), savedDraft = await h.repository.loadDraft()
    const decodePhoto = nodeDecodeMock()
    const preview = await h.restores.inspect([new Blob([incoming.text])], { decodePhoto })
    expect(preview.format).toBe('single-v1')
    expect(decodePhoto).toHaveBeenCalledTimes(2)
    expect(preview.plan).toEqual({ added: 1, skipped: 1, coversAdded: 0, coversKept: 1 })
    expect(await h.repository.load()).toEqual(before)
    expect(await h.restores.commit(preview)).toMatchObject({ added: 1, skipped: 1, coversAdded: 0, coversKept: 1 })
    expect(await h.repository.loadDraft()).toEqual(savedDraft)
    const result = await h.repository.load()
    expect(result.covers).toEqual([localCover])
    expect(result.visits[0]).toEqual(fixture.mountain)
    expect(result.visits[1]?.customPlace).toEqual(fixture.custom.customPlace)
    const exported = await h.backup.prepareExport(result)
    expect(exported.format).toBe('single-v1')
    const document = JSON.parse(await exported.files[0]!.blob.text())
    expect(document.version).toBe(1)
    expect(document).not.toHaveProperty('drafts')
    const targetId = identity(), target = current(targetId)
    const restored = await target.restores.inspect(exported.files.map(file => file.blob), { decodePhoto: nodeDecodeMock() })
    await target.restores.commit(restored)
    await target.repository.close()
    const reopened = current(targetId)
    // Portable v1 normalizes opaque extensions, exactly as the old serializer.
    expect(await reopened.repository.load()).toEqual(legacy(identity()).backup.normalizeSnapshot(result))
    expect(await reopened.repository.loadDraft()).toBeNull()
    expect(await reopened.repository.listImportStages()).toEqual([])
  })

  it('R08: old-v1 conflicts at preview and after preview reject the entire merge without overwriting', async () => {
    const id = identity(), fixture = await seed(id, 'schema-2-old-writer'), h = current(id), old = legacy(identity())
    const newVisit = { ...fixture.custom, id: 'a-new-import', createdAt: 1710345600000 }
    const conflicting = old.backup.serialize({ visits: [newVisit, { ...fixture.mountain, note: '同编号却不同内容' }], covers: [] })
    const before = await stored(id)
    await expect(h.restores.inspect([new Blob([conflicting.text])], { decodePhoto: nodeDecodeMock() })).rejects.toMatchObject({ code: 'conflict' })
    // load() may create schema 4, but formal rows/draft remain byte-for-byte equal.
    const rejected = await stored(id)
    for (const [name, rows] of Object.entries(before.rows)) expect(rejected.rows[name]).toEqual(rows)
    const incoming = old.backup.serialize({ visits: [newVisit, fixture.mountain], covers: [fixture.cover] })
    const preview = await h.restores.inspect([new Blob([incoming.text])], { decodePhoto: nodeDecodeMock() })
    expect(preview.plan).toMatchObject({ added: 1, skipped: 1 })
    const other = current(id)
    await other.repository.updateVisit({ ...fixture.mountain, note: '预览之后另一页已经更新' }, { expectedVisit: fixture.mountain })
    const changed = await stored(id)
    await expect(h.restores.commit(preview)).rejects.toMatchObject({ code: 'conflict' })
    expect(await stored(id)).toEqual(changed)
    expect((await h.repository.load()).visits.some(visit => visit.id === newVisit.id)).toBe(false)
  })

  it('R08: an upgraded old database stages a bounded v2 export using its new index and commits atomically', async () => {
    const sourceId = identity(), fixture = await seed(sourceId, 'schema-2-old-writer'), sourceServices = current(sourceId)
    const exported = await sourceServices.backup.prepareExport(await sourceServices.repository.load(), { forceVolumes: true, volumeChars: 1024 })
    expect(exported.files.length).toBeGreaterThan(1)
    const targetId = identity()
    await seed(targetId, 'schema-1-synthetic', { visits: [], covers: [] })
    const h = current(targetId), decodePhoto = nodeDecodeMock()
    const preview = await h.restores.inspect(exported.files.map(file => file.blob), { decodePhoto })
    expect(preview.format).toBe('volume-v2')
    if (preview.format !== 'volume-v2') throw new Error('Expected staged v2 preview')
    expect(decodePhoto).toHaveBeenCalledTimes(2)
    expect(await h.repository.load()).toEqual({ visits: [], covers: [] })
    const db = await open(targetId)
    try {
      const index = db.transaction('backupImportVisits').objectStore('backupImportVisits').index('sessionPlace')
      const staged = await requestResult(index.getAll([preview.stageId, fixture.custom.placeId]))
      expect(staged).toHaveLength(1)
      expect(staged[0]).toMatchObject({ sessionId: preview.stageId, id: fixture.custom.id, placeId: fixture.custom.placeId })
    } finally { db.close() }
    expect(await h.restores.commit(preview)).toMatchObject({ added: 2, skipped: 0, coversAdded: 1, replayed: false, cleanupPending: false })
    await h.repository.close()
    const reopened = current(targetId)
    expect(await reopened.repository.load()).toEqual(sourceServices.backup.normalizeSnapshot(fixture.snapshot))
    expect(await reopened.repository.listImportStages()).toEqual([])
    const receipt = await reopened.restores.resume(preview.stageId)
    expect(await reopened.restores.commit(receipt)).toMatchObject({ replayed: true, added: 2 })
    expect((await reopened.repository.load()).visits).toHaveLength(2)
  })
})
