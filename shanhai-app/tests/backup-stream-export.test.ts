// @vitest-environment node
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createHash, webcrypto } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createContext, runInContext } from 'node:vm'
import { IDBKeyRange } from 'fake-indexeddb'
import { createCatalogue } from '../src/domain/catalogue'
import { createBackupKernel } from '../src/generated/backup-kernel.js'
import type { BackupCodec, BackupSummary, TravelPlatform } from '../src/services/contracts'
import type { EncodedArchive, ExportPayload, StreamExportSource } from '../src/services/export-types'
import type { Snapshot, Visit } from '../src/domain/models'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const row = (id = 'one', count = 0): Visit => ({ id, createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '中文雪山🌄\n"回忆"\\路',
  photos: Array.from({ length: count }, (_, index) => ({ id: `photo-${index}`, name: `照片-${index}-🌄.png`, url: png })), coverId: count ? `photo-${count - 1}` : null })
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const randomValues = (webcrypto as unknown as Crypto).getRandomValues.bind(webcrypto)
function platform(crypto: TravelPlatform['crypto'] = webcrypto as unknown as Crypto): TravelPlatform {
  return { IDBKeyRange, crypto, Blob, TextEncoder, setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>) }
}
function codec(crypto?: TravelPlatform['crypto']) { return createBackupKernel({ catalogue: createCatalogue(), platform: platform(crypto) }) }
function summary(snapshot: Snapshot): BackupSummary {
  const dates = snapshot.visits.map(visit => visit.date).sort()
  return { visits: snapshot.visits.length, photos: snapshot.visits.reduce((n, visit) => n + visit.photos.length, 0),
    places: new Set(snapshot.visits.map(visit => visit.placeId)).size, from: dates[0] ?? null, to: dates.at(-1) ?? null }
}
function source(snapshot: Snapshot): StreamExportSource {
  return { summary: summary(snapshot), covers: snapshot.covers, visits: (async function* () { for (const visit of snapshot.visits) yield visit })() }
}
async function encode(backup: BackupCodec, snapshot: Snapshot, volumeChars = 1024) {
  // Collecting these small test fixtures is intentional. Production sinks
  // store one Blob and release it before requesting another payload.
  const payloads: ExportPayload[] = []
  const archive = await backup.writeVolumes(source(snapshot), async part => { payloads.push(part) }, { volumeChars })
  return { archive, payloads }
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function turn() { await new Promise(resolve => setTimeout(resolve, 0)) }
function rehash(archive: EncodedArchive) {
  archive.archiveSha256 = hash(JSON.stringify({ format: 'shanhai-backup-volume', version: 2,
    archiveId: archive.archiveId, exportedAt: archive.exportedAt, manifest: archive.manifest }))
  return archive
}
let oldCodec: BackupCodec, authoritative = ''
beforeAll(async () => {
  const fixture = await readFile(new URL('../../output/shanhai-yunnan/qa/incremental-20260907/bundle/index.html', import.meta.url), 'utf8')
  expect(hash(fixture)).toBe('58a528d096740a4a3ae862dd70414a7d9ffe895daa3b50781a94e20f710fb9a9')
  const scripts = Array.from(fixture.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g), match => match[1]!)
  const original = scripts.find(script => script.includes('root.ShanhaiBackup = Object.freeze'))!
  const context = createContext({ ShanhaiPlaces: createCatalogue(), ...platform(), setTimeout })
  runInContext(original, context)
  oldCodec = context.ShanhaiBackup as BackupCodec
  authoritative = await readFile(new URL('../../output/shanhai-lijiang-records/backup-codec.js', import.meta.url), 'utf8')
})
afterEach(() => vi.restoreAllMocks())

describe('bounded v2 export codec', () => {
  for (const count of [0, 1, 12]) {
    it(`restores ${count} visits with the preserved old v2 reader and canonical wire records`, async () => {
      const backup = codec(), snapshot = { visits: Array.from({ length: count }, (_, index) => row(`visit-${index}`, count > 1 ? 1 : 0)), covers: [] }
      const { archive, payloads } = await encode(backup, snapshot)
      if (count <= 1) expect(payloads.length).toBe(1)
      else expect(payloads.length).toBeGreaterThan(1)
      const files = []
      for (const payload of payloads) {
        const text = await payload.blob.text()
        expect(payload).toMatchObject({ bytes: Buffer.byteLength(text), sha256: hash(text) })
        const file = await backup.wrapVolume(archive, payload)
        expect(file.bytes).toBe(file.blob.size)
        expect(file.bytes).toBeLessThanOrEqual(100 * 1024 * 1024)
        expect(file.filename).toBe(`shanhai-backup-${archive.exportedAt.replace(/[:.]/g, '-')}-${archive.archiveId.slice(0, 8)}-part-${String(payload.part).padStart(String(payloads.length).length, '0')}-of-${payloads.length}.json`)
        const document = JSON.parse(await file.blob.text())
        expect(Object.keys(document)).toEqual(['format', 'version', 'archiveId', 'exportedAt', 'parts', 'part', 'archiveSha256', ...(payload.part === 1 ? ['manifest'] : []), 'payload'])
        files.push(file.blob)
      }
      const descriptor = await oldCodec.preflightFiles(files.reverse())
      if (descriptor.format !== 'volume-v2') throw new Error('Expected v2')
      const restored: Snapshot = { visits: [], covers: [] }
      await oldCodec.consumeVolumes(descriptor, { decodePhoto: async () => {}, onVisit: async visit => { restored.visits.push(visit) }, onCover: async cover => { restored.covers.push(cover) } })
      expect(restored).toEqual(snapshot)
      expect(archive.manifest.records).toBe(1 + summary(snapshot).visits + summary(snapshot).photos)
      expect(rehash(structuredClone(archive))).toEqual(archive)
    })
  }

  it('preserves nine photos, non-first record/map covers, custom places and Chinese/emoji in old recovery', async () => {
    const backup = codec(), first = row('nine', 9), custom = { ...row('custom', 1), placeId: 'custom-courtyard',
      customPlace: { id: 'custom-courtyard', name: '雪山下的庭院🌄', regionId: 'lijiang', coordinates: [100.233, 26.872] as [number, number] } }
    const snapshot: Snapshot = { visits: [first, custom], covers: [
      { placeId: first.placeId, visitId: first.id, photoId: first.photos[6]!.id },
      { placeId: custom.placeId, visitId: custom.id, photoId: custom.coverId! },
    ] }
    const { archive, payloads } = await encode(backup, snapshot)
    const old = await oldCodec.prepareExport(snapshot, { forceVolumes: true, volumeChars: 1024 })
    const oldPayloads = await Promise.all(old.files.map(async file => JSON.parse(await file.blob.text()).payload))
    expect(await Promise.all(payloads.map(payload => payload.blob.text()))).toEqual(oldPayloads)
    const files = []
    for (const payload of payloads) files.push((await backup.wrapVolume(archive, payload)).blob)
    const descriptor = await oldCodec.preflightFiles(files)
    if (descriptor.format !== 'volume-v2') throw new Error('Expected v2')
    const restored: Snapshot = { visits: [], covers: [] }, decoded: string[] = []
    await oldCodec.consumeVolumes(descriptor, { decodePhoto: async photo => { decoded.push(photo.id) },
      onVisit: async visit => { restored.visits.push(visit) }, onCover: async cover => { restored.covers.push(cover) } })
    expect(restored).toEqual(snapshot)
    expect(decoded).toEqual(snapshot.visits.flatMap(visit => visit.photos.map(photo => photo.id)))
    expect(archive.manifest).toMatchObject({ covers: 2, records: 15 })
  })

  it('keeps a surrogate pair together at the exact UTF-16 budget boundary and splits a single line across several parts', async () => {
    const backup = codec(), visit = row('boundary')
    const header = JSON.stringify({ kind: 'library', visits: 1, photos: 0, covers: 0 }) + '\n'
    const shell = JSON.stringify({ kind: 'visit', value: { ...visit, note: '__MARKER__' } })
    const noteAt = header.length + shell.indexOf('__MARKER__')
    const padding = 1023 - noteAt
    visit.note = 'a'.repeat(padding) + '🌄中文'.repeat(Math.floor((1999 - padding) / 4))
    const { archive, payloads } = await encode(backup, { visits: [visit], covers: [] })
    const texts = await Promise.all(payloads.map(payload => payload.blob.text()))
    expect(texts[0]).toHaveLength(1023)
    expect(texts[1]!.startsWith('🌄')).toBe(true)
    expect(texts.length).toBeGreaterThanOrEqual(3)
    expect(texts.every(text => [...text].every(character => character.length === 2
      || character.charCodeAt(0) < 0xd800 || character.charCodeAt(0) > 0xdfff))).toBe(true)
    expect(archive.manifest.parts.map(part => part.bytes)).toEqual(texts.map(text => Buffer.byteLength(text)))
    const old = await oldCodec.prepareExport({ visits: [visit], covers: [] }, { forceVolumes: true, volumeChars: 1024 })
    expect(texts).toEqual(await Promise.all(old.files.map(async file => JSON.parse(await file.blob.text()).payload)))
  })

  it('awaits the active source and sink, never reads ahead while a part is being persisted', async () => {
    const backup = codec(), gate = deferred<void>(), entered = deferred<void>(), visits = [row('one'), row('two')]
    visits.forEach(visit => { visit.note = '记'.repeat(1800) })
    let reads = 0, activeSink = 0, maxSink = 0, parts = 0
    const pending = backup.writeVolumes({ summary: summary({ visits, covers: [] }), covers: [], visits: (async function* () {
      for (const visit of visits) { expect(activeSink).toBe(0); reads++; yield visit }
    })() }, async payload => {
      activeSink++; maxSink = Math.max(activeSink, maxSink)
      expect(payload.part).toBe(++parts)
      if (parts === 1) { entered.resolve(); await gate.promise }
      await turn(); activeSink--
    }, { volumeChars: 1024 })
    await entered.promise
    expect(reads).toBe(1)
    await turn()
    expect(reads).toBe(1)
    expect(parts).toBe(1)
    gate.resolve()
    expect((await pending).manifest.summary.visits).toBe(2)
    expect(maxSink).toBe(1)
    expect(reads).toBe(2)
  })

  it('accepts more than the v1 limit using a source that creates and releases one visit at a time', async () => {
    const backup = codec(), count = 2001, generated = vi.fn(), sink = vi.fn(async (payload: ExportPayload) => {
      expect(payload.bytes).toBe(payload.blob.size)
      expect(payload.sha256).toBe(hash(await payload.blob.text()))
    })
    const archive = await backup.writeVolumes({ covers: [], summary: { visits: count, photos: 0, places: 1, from: '2025-01-01', to: '2025-01-01' },
      visits: (async function* () { for (let index = 0; index < count; index++) { generated(); yield row(`row-${index}`) } })(),
    }, sink, { volumeChars: 32768 })
    expect(generated).toHaveBeenCalledTimes(count)
    expect(archive.manifest.records).toBe(count + 1)
    expect(archive.manifest.parts.length).toBeGreaterThan(1)
    expect(Object.keys(archive)).toEqual(['format', 'archiveId', 'exportedAt', 'archiveSha256', 'manifest'])
  })

  it('waits for sink settlement on cancel and closes the source before any further row or sink', async () => {
    const backup = codec(), gate = deferred<void>(), entered = deferred<void>(), controller = new AbortController()
    let closed = false, reads = 0, finished = false
    const snapshot = { visits: [{ ...row('one'), note: '字'.repeat(1800) }, row('two')], covers: [] }
    const sink = vi.fn(async () => { entered.resolve(); await gate.promise })
    const pending = backup.writeVolumes({ ...source(snapshot), visits: (async function* () {
      try { for (const visit of snapshot.visits) { reads++; yield visit } } finally { closed = true }
    })() }, sink, { volumeChars: 1024, signal: controller.signal })
    const rejection = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    void pending.then(() => { finished = true }, () => { finished = true })
    await entered.promise; controller.abort(); await turn()
    expect(finished).toBe(false)
    gate.resolve(); await rejection
    expect(closed).toBe(true)
    expect(reads).toBe(1)
    expect(sink).toHaveBeenCalledOnce()
  })

  it('does not report digest cancellation until WebCrypto releases its in-flight bytes', async () => {
    const gate = deferred<ArrayBuffer>(), entered = deferred<void>(), controller = new AbortController()
    const digest = vi.fn(() => { entered.resolve(); return gate.promise })
    const backup = codec({ getRandomValues: randomValues, subtle: { digest } as unknown as SubtleCrypto })
    const sink = vi.fn(async () => {}), pending = backup.writeVolumes(source({ visits: [row()], covers: [] }), sink, { signal: controller.signal })
    let finished = false
    const rejection = expect(pending).rejects.toMatchObject({ code: 'aborted' })
    void pending.then(() => { finished = true }, () => { finished = true })
    await entered.promise; controller.abort(); await turn()
    expect(finished).toBe(false)
    gate.resolve(new ArrayBuffer(32)); await rejection
    expect(sink).not.toHaveBeenCalled()
    expect(digest).toHaveBeenCalledOnce()
  })

  for (const method of ['text', 'arrayBuffer'] as const) {
    it(`waits for Blob.${method} settlement when wrapping is cancelled`, async () => {
      const backup = codec(), { archive, payloads } = await encode(backup, { visits: [row()], covers: [] })
      const payload = payloads[0]!, gate = deferred<never>(), entered = deferred<void>(), controller = new AbortController()
      vi.spyOn(payload.blob, method).mockImplementation(() => { entered.resolve(); return gate.promise })
      const pending = backup.wrapVolume(archive, payload, { signal: controller.signal })
      let finished = false
      const rejection = expect(pending).rejects.toMatchObject({ code: 'aborted' })
      void pending.then(() => { finished = true }, () => { finished = true })
      await entered.promise; controller.abort(); await turn()
      expect(finished).toBe(false)
      gate.resolve(undefined as never); await rejection
    })
  }

  it('uses the yielding SHA-256 fallback without subtle and still produces independently verified checksums', async () => {
    const backup = codec({ getRandomValues: randomValues })
    const { archive, payloads } = await encode(backup, { visits: [row('fallback', 1)], covers: [] })
    for (const payload of payloads) {
      expect(payload.sha256).toBe(hash(await payload.blob.text()))
      expect((await backup.wrapVolume(archive, payload)).bytes).toBeGreaterThan(payload.bytes)
    }
    expect(rehash(structuredClone(archive))).toEqual(archive)
  })

  it('fails when secure randomness is absent and never stages a payload', async () => {
    const backup = createBackupKernel({ catalogue: createCatalogue(), platform: { ...platform(), crypto: undefined } }), sink = vi.fn(async () => {})
    await expect(backup.writeVolumes(source({ visits: [], covers: [] }), sink)).rejects.toMatchObject({ code: 'unavailable' })
    expect(sink).not.toHaveBeenCalled()
  })

  it.each(['count', 'photos', 'places', 'dates', 'duplicate', 'cover', 'custom'] as const)('rejects inconsistent streamed %s instead of returning a complete archive', async mismatch => {
    const backup = codec(), first = row('one', 1), snapshot: Snapshot = { visits: [first], covers: [] }
    const input = source(snapshot)
    if (mismatch === 'count') input.summary.visits = 2
    if (mismatch === 'photos') input.summary.photos = 2
    if (mismatch === 'places') input.summary.places = 0
    if (mismatch === 'dates') input.summary.from = input.summary.to = '2024-01-01'
    if (mismatch === 'duplicate') { input.summary.visits = 2; input.summary.photos = 2; input.visits = (async function* () { yield first; yield first })() }
    if (mismatch === 'cover') input.covers.push({ placeId: first.placeId, visitId: 'missing', photoId: first.coverId! })
    if (mismatch === 'custom') {
      const custom = { ...row('custom'), placeId: 'custom-courtyard', customPlace: { id: 'custom-courtyard', name: '小院', regionId: 'lijiang', coordinates: [100.233, 26.872] as [number, number] } }
      const changed = { ...custom, id: 'changed', customPlace: { ...custom.customPlace, name: '另一处' } }
      Object.assign(input, source({ visits: [custom, changed], covers: [] }))
    }
    await expect(backup.writeVolumes(input, async () => {})).rejects.toHaveProperty('code')
  })

  it('rejects tampered archive, payload metadata, unknown fields and actual bytes', async () => {
    const backup = codec(), { archive, payloads } = await encode(backup, { visits: [row()], covers: [] }), payload = payloads[0]!
    await expect(backup.wrapVolume({ ...archive, archiveSha256: '0'.repeat(64) }, payload)).rejects.toMatchObject({ code: 'integrity' })
    await expect(backup.wrapVolume({ ...archive, extra: true } as EncodedArchive, payload)).rejects.toMatchObject({ code: 'integrity' })
    await expect(backup.wrapVolume(archive, { ...payload, bytes: payload.bytes + 1 })).rejects.toMatchObject({ code: 'integrity' })
    await expect(backup.wrapVolume(archive, { ...payload, sha256: '0'.repeat(64) })).rejects.toMatchObject({ code: 'integrity' })
    await expect(backup.wrapVolume(archive, { ...payload, blob: new Blob([(await payload.blob.text()).replace('中文', '坏字')]) })).rejects.toMatchObject({ code: 'integrity' })
    const malformed = new Uint8Array([0xf0, 0x90, 0x80]), bad = { part: 1, blob: new Blob([malformed]), bytes: 3, sha256: hash(malformed) }
    const forged = rehash({ ...structuredClone(archive), manifest: { ...structuredClone(archive.manifest), parts: [{ bytes: bad.bytes, sha256: bad.sha256 }] } })
    expect(Buffer.byteLength(await bad.blob.text())).toBe(bad.bytes)
    await expect(backup.wrapVolume(forged, bad)).rejects.toMatchObject({ code: 'integrity' })
  })

  it('checks final JSON escaping and manifest overhead against the file cap without collecting blobs', async () => {
    expect(codec().MAX_BYTES).toBe(100 * 1024 * 1024)
    // Scale only the 100 MiB constant in an isolated authoritative VM. This
    // exercises final-size rejection without manufacturing huge test buffers.
    const context = createContext({ ShanhaiPlaces: createCatalogue(), ...platform(), setTimeout })
    runInContext(authoritative.replace('const MAX_BYTES = 100 * 1024 * 1024;', 'const MAX_BYTES = 1800;'), context)
    const small = context.ShanhaiBackup as BackupCodec, snapshot = { visits: [{ ...row(), note: '\\"'.repeat(250) }], covers: [] }
    await expect(small.writeVolumes(source(snapshot), async () => {}, { volumeChars: 1024 })).rejects.toMatchObject({ code: 'limit' })
    const { archive, payloads } = await encode(codec(), snapshot)
    await expect(small.wrapVolume(archive, payloads[0]!)).rejects.toMatchObject({ code: 'limit' })
    const streamedBody = authoritative.slice(authoritative.indexOf('async function writeVolumes('), authoritative.indexOf('async function wrapVolume('))
    expect(streamedBody).not.toMatch(/normalizeLibrary\(|normalizeSnapshot\(|prepareExport\(|payloads\s*=|files\s*=|Promise\.all/)
  })
})
