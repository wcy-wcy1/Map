// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { webcrypto } from 'node:crypto'
import { createTravelServices } from '../src/services/travel-services'
import { createBackupRestoreService } from '../src/services/backup-service'
import type { BackupFile, LocalRepository, TravelPlatform } from '../src/services/contracts'
import type { Visit } from '../src/domain/models'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
function visit(id: string, photos = false): Visit {
  return { id, createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '分卷回忆🌄',
    photos: photos ? [{ id: 'photo-one', name: '雪山.png', url: png }] : [], coverId: photos ? 'photo-one' : null }
}
const repositories: LocalRepository[] = []
function harness() {
  const platform: TravelPlatform = {
    indexedDB: new IDBFactory(), IDBKeyRange, crypto: webcrypto as unknown as Crypto, Blob, TextEncoder,
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  }
  const services = createTravelServices({ platform, dbName: 'backup-service-test' })
  repositories.push(services.repository)
  return services
}
afterEach(async () => { await Promise.all(repositories.splice(0).map(repository => repository.close())) })
async function volumeFiles(h: ReturnType<typeof harness>, visits: Visit[], volumeChars = 1024) {
  return (await h.backup.prepareExport({ visits, covers: [] }, { forceVolumes: true, volumeChars })).files.map(file => file.blob)
}

describe('Vue backup restore workflow', () => {
  it('previews single-v1 with actual decode callbacks and does not commit before confirmation', async () => {
    const h = harness(), row = visit('single', true), decodePhoto = vi.fn(async () => {})
    const blob = new Blob([h.backup.serialize({ visits: [row], covers: [] }).text])
    const preview = await h.restores.inspect([blob], { decodePhoto })
    expect(preview.format).toBe('single-v1')
    expect(decodePhoto).toHaveBeenCalledExactlyOnceWith(row.photos[0], undefined)
    expect(preview.plan).toEqual({ added: 1, skipped: 0, coversAdded: 0, coversKept: 0 })
    expect((await h.repository.load()).visits).toEqual([])
    expect(await h.restores.commit(preview)).toEqual({ added: 1, skipped: 0, coversAdded: 0, coversKept: 0, replayed: false, cleanupPending: false })
    expect((await h.repository.load()).visits).toEqual([row])
  })

  it('rejects empty backups and failed image decode without creating live records or temporary stages', async () => {
    const h = harness(), decodePhoto = vi.fn(async () => { throw new Error('image cannot decode') })
    const empty = new Blob([h.backup.serialize({ visits: [], covers: [] }).text])
    await expect(h.restores.inspect([empty], { decodePhoto })).rejects.toMatchObject({ code: 'empty' })
    const single = new Blob([h.backup.serialize({ visits: [visit('photo', true)], covers: [] }).text])
    await expect(h.restores.inspect([single], { decodePhoto })).rejects.toThrow('image cannot decode')
    expect(await h.repository.listImportStages()).toEqual([])
    expect((await h.repository.load()).visits).toEqual([])
  })

  it('restores 2,001 visits incrementally without calling either snapshot collector or live load', async () => {
    const h = harness(), rows = Array.from({ length: 2001 }, (_, index) => visit(`visit-${String(index).padStart(4, '0')}`))
    const started = performance.now()
    const files = await volumeFiles(h, rows, 32768)
    const exported = performance.now()
    expect(files.length).toBeGreaterThan(1)
    const collect = vi.spyOn(h.repository, 'load').mockRejectedValue(new Error('Volume preview must not collect live snapshots'))
    const collectIncoming = vi.fn(async (): Promise<never> => { throw new Error('Volume workflow must not collect the incoming snapshot') })
    const restores = createBackupRestoreService(h.repository, { ...h.backup, parseFiles: collectIncoming })
    const preview = await restores.inspect([...files].reverse(), { decodePhoto: async () => {} })
    const inspected = performance.now()
    expect(preview.format).toBe('volume-v2')
    expect(preview).not.toHaveProperty('snapshot')
    expect(preview.summary.visits).toBe(2001)
    expect(preview.plan).toMatchObject({ added: 2001, skipped: 0 })
    expect(collect).not.toHaveBeenCalled()
    expect(collectIncoming).not.toHaveBeenCalled()
    const result = await restores.commit(preview)
    const committed = performance.now()
    expect(result).toMatchObject({ added: 2001, replayed: false, cleanupPending: false })
    expect(collect).not.toHaveBeenCalled()
    collect.mockRestore()
    expect((await h.repository.load()).visits).toHaveLength(2001)
    expect(await h.repository.listImportStages()).toEqual([])
    console.info('2,001-row fake-indexeddb service timing (not a device benchmark):', {
      exportMs: Math.round(exported - started), inspectMs: Math.round(inspected - exported), commitMs: Math.round(committed - inspected),
    })
  }, 180000)

  it('awaits each decode and each per-visit sink before continuing', async () => {
    const h = harness(), rows = Array.from({ length: 6 }, (_, index) => visit(`photo-${index}`, true))
    const files = await volumeFiles(h, rows)
    let current = 0, peak = 0
    const trace: string[] = []
    const original = h.repository.stageImportVisit.bind(h.repository)
    vi.spyOn(h.repository, 'stageImportVisit').mockImplementation(async (id, row, options) => {
      current++; peak = Math.max(peak, current); trace.push(`stage:${row.id}`)
      await new Promise(resolve => setTimeout(resolve, 1))
      const result = await original(id, row, options)
      trace.push(`stored:${row.id}`); current--
      return result
    })
    const preview = await h.restores.inspect(files, { decodePhoto: async () => { expect(current).toBe(0); trace.push('decode') } })
    expect(peak).toBe(1)
    expect(trace).toEqual(rows.flatMap(row => ['decode', `stage:${row.id}`, `stored:${row.id}`]))
    await h.restores.discard(preview)
    expect(await h.repository.listImportStages()).toEqual([])
    expect((await h.repository.load()).visits).toEqual([])
  })

  it('rejects missing parts during preflight and a changed file on second read without live writes', async () => {
    const h = harness(), files = await volumeFiles(h, Array.from({ length: 10 }, (_, index) => visit(`v-${index}`, true)))
    expect(files.length).toBeGreaterThan(1)
    await expect(h.restores.inspect(files.slice(1), { decodePhoto: async () => {} })).rejects.toBeInstanceOf(Error)
    expect(await h.repository.listImportStages()).toEqual([])
    const unstable: BackupFile[] = files.map(file => {
      let reads = 0
      return { size: file.size, async text() {
        const text = await file.text()
        return ++reads === 2 ? text.replace('分卷', '坏卷') : text
      } }
    })
    await expect(h.restores.inspect(unstable, { decodePhoto: async () => {} })).rejects.toMatchObject({ code: 'integrity' })
    expect(await h.repository.listImportStages()).toEqual([])
    expect((await h.repository.load()).visits).toEqual([])
  })

  it('cancels an uncooperative decoder promptly and ignores its late resolution', async () => {
    const h = harness(), files = await volumeFiles(h, [visit('cancel', true)]), controller = new AbortController()
    let resolveDecode: (() => void) | undefined
    let entered: (() => void) | undefined
    const started = new Promise<void>(resolve => { entered = resolve })
    const pending = h.restores.inspect(files, {
      signal: controller.signal,
      decodePhoto: () => new Promise<void>(resolve => { resolveDecode = resolve; entered?.() }),
    })
    await started
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'aborted' })
    expect(await h.repository.listImportStages()).toEqual([])
    resolveDecode?.()
    await Promise.resolve()
    expect((await h.repository.load()).visits).toEqual([])
  })

  it('reports cleanup failure as recoverable staging instead of hiding temporary data', async () => {
    const h = harness(), files = await volumeFiles(h, [visit('bad-image', true)])
    const cleanup = vi.spyOn(h.repository, 'discardImportStage').mockRejectedValue(new Error('cleanup denied'))
    await expect(h.restores.inspect(files, { decodePhoto: async () => { throw new Error('decode failed') } })).rejects.toMatchObject({
      code: 'cleanup-pending', cleanupPending: true, stageId: expect.any(String),
    })
    expect(await h.repository.listImportStages()).toMatchObject([{ status: 'staging' }])
    expect((await h.repository.load()).visits).toEqual([])
    cleanup.mockRestore()
    const [stage] = await h.repository.listImportStages()
    await h.repository.discardImportStage(stage!.id)
  })

  it('keeps final merge committed when cleanup fails and distinguishes replay after deletion', async () => {
    const h = harness(), row = visit('cleanup'), files = await volumeFiles(h, [row])
    const preview = await h.restores.inspect(files, { decodePhoto: async () => {} })
    if (preview.format !== 'volume-v2') throw new Error('Expected stage preview')
    const cleanup = vi.spyOn(h.repository, 'discardImportStage').mockRejectedValue(new Error('cleanup failed'))
    expect(await h.restores.commit(preview)).toMatchObject({ added: 1, replayed: false, cleanupPending: true })
    expect((await h.repository.load()).visits).toEqual([row])
    cleanup.mockRestore()
    await h.repository.deleteVisit(row.id, { expectedVisit: row })
    const resumed = await h.restores.resume(preview.stageId)
    expect(resumed.plan).toHaveProperty('status', 'committed')
    expect(await h.restores.commit(resumed)).toMatchObject({ added: 1, replayed: true, cleanupPending: false })
    expect((await h.repository.load()).visits).toEqual([])
  })

  it('resumes only a checked stage, rejects stale concurrent edits, and never auto-imports after refresh', async () => {
    const h = harness(), row = visit('existing')
    await h.repository.addVisit(row)
    const files = await volumeFiles(h, [row, visit('new')])
    const preview = await h.restores.inspect(files, { decodePhoto: async () => {} })
    if (preview.format !== 'volume-v2') throw new Error('Expected stage preview')
    const resumed = await h.restores.resume(preview.stageId)
    expect(resumed.plan).toMatchObject({ added: 1, skipped: 1 })
    expect((await h.repository.load()).visits).toEqual([row])
    const edited = await h.repository.updateVisit({ ...row, note: '现在已更改' }, { expectedVisit: row })
    await expect(h.restores.commit(resumed)).rejects.toMatchObject({ code: 'conflict' })
    expect((await h.repository.load()).visits).toEqual([edited])
    await h.restores.discard(resumed)
    await expect(h.restores.resume(preview.stageId)).rejects.toMatchObject({ code: 'import-state' })
  })
})
