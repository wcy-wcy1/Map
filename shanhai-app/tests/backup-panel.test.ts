import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import BackupPanel from '../src/components/BackupPanel.vue'
import type { TravelServices } from '../src/services/travel-services'
import type { ImportStage, PreparedExport } from '../src/services/contracts'
import type { InspectRestoreOptions, RestoreCommitResult, RestorePreview, VolumeRestorePreview } from '../src/services/backup-service'
import type { Photo, Snapshot } from '../src/domain/models'
import type { ExportSession, PrepareBackupOptions, ReadyExportSession } from '../src/services/export-types'

const summary = { visits: 1, photos: 0, places: 1, from: '2025-01-01', to: '2025-01-01' }
const counts = { added: 1, skipped: 0, coversAdded: 0, coversKept: 0 }
const snapshot: Snapshot = { visits: [{ id: 'visit', createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '雪山回忆', photos: [], coverId: null }], covers: [] }
const photo: Photo = { id: 'photo', name: 'travel.png', url: 'data:image/png;base64,iVBORw0KGgo=' }
const volume = (): VolumeRestorePreview => ({ format: 'volume-v2', stageId: 'stage-1', exportedAt: '2026-09-01T00:00:00Z', summary, plan: counts })
const single = (): RestorePreview => ({ format: 'single-v1', snapshot, exportedAt: '2026-09-01T00:00:00Z', summary, plan: counts })
const result = (extra: Partial<RestoreCommitResult> = {}): RestoreCommitResult => ({ ...counts, replayed: false, cleanupPending: false, stageId: 'stage-1', ...extra })
const session = (status: ImportStage['status'] = 'ready', id = 'stage-1'): ImportStage => ({ id, status, summary, archiveId: 'archive', exportedAt: '2026-09-01T00:00:00Z', archiveSha256: 'a'.repeat(64), covers: 0, cleaned: false })
const exportSession = (parts = 1, id = 'export-1'): ReadyExportSession => ({ id, status: 'ready', sourceDbName: 'local', sourceRevision: 1, createdAt: '2026-09-01T00:00:00.000Z', summary,
  archive: { format: 'volume-v2', archiveId: 'archive', exportedAt: '2026-09-01T00:00:00.000Z', archiveSha256: 'a'.repeat(64),
    manifest: { encoding: 'shanhai-ndjson-v1', summary, covers: 0, records: 2, parts: Array.from({ length: parts }, () => ({ bytes: 4, sha256: 'a'.repeat(64) })) } },
  files: Array.from({ length: parts }, (_, index) => ({ part: index + 1, filename: `part-${index + 1}.json`, bytes: 4 })), totalBytes: parts * 4 })
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no }); return { resolve, reject, promise } }
const mounted: VueWrapper[] = []
let urlSerial = 0
beforeEach(() => {
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null; onerror: (() => void) | null = null; naturalWidth = 1; naturalHeight = 1
    set src(_value: string) { queueMicrotask(() => this.onload?.()) }
    removeAttribute() { /* browser resource cleanup observed in decoder-specific tests */ }
    decode() { return Promise.resolve() }
  })
  vi.stubGlobal('URL', class extends URL {
    static createObjectURL = vi.fn(() => 'blob:panel-' + (++urlSerial))
    static revokeObjectURL = vi.fn()
  })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
})
afterEach(() => { for (const wrapper of mounted.splice(0)) wrapper.unmount(); document.body.replaceChildren(); vi.unstubAllGlobals() })

function setup(options: { preview?: RestorePreview; onCommitted?: (value: RestoreCommitResult) => Promise<void>; disabled?: boolean } = {}) {
  const inspect = vi.fn(async (_files: unknown, _options: InspectRestoreOptions): Promise<RestorePreview> => options.preview || volume())
  const commit = vi.fn(async (_preview: RestorePreview): Promise<RestoreCommitResult> => result())
  const discard = vi.fn(async (_preview: RestorePreview) => {})
  const resume = vi.fn(async (_id: string): Promise<VolumeRestorePreview> => volume())
  const discardImportStage = vi.fn(async (_id: string) => true)
  const listImportStages = vi.fn(async (): Promise<ImportStage[]> => [])
  const load = vi.fn(async () => snapshot)
  const prepareExport = vi.fn(async (): Promise<PreparedExport> => ({ format: 'single-v1', files: [{ filename: 'backup.json', blob: new Blob(['backup']), bytes: 6, part: 1 }], summary, sourceBytes: 6, totalBytes: 6 }))
  const prepare = vi.fn(async (_options?: PrepareBackupOptions) => exportSession())
  const readExport = vi.fn(async (_id: string, part: number, _options?: { signal?: AbortSignal }) => ({ part, filename: `part-${part}.json`, bytes: 4, blob: new Blob(['part']) }))
  const listExports = vi.fn(async (): Promise<ExportSession[]> => [])
  const resumeExport = vi.fn(async (_id: string, _options?: PrepareBackupOptions) => exportSession())
  const discardExport = vi.fn(async (_id: string) => {})
  const services = { repository: { load, discardImportStage, listImportStages }, backup: { prepareExport }, restores: { inspect, commit, discard, resume },
    exports: { prepare, readPart: readExport, listSessions: listExports, resumeReady: resumeExport, discard: discardExport } } as unknown as TravelServices
  const wrapper = mount(BackupPanel, { props: { services, onCommitted: options.onCommitted, disabled: options.disabled }, attachTo: document.body })
  mounted.push(wrapper)
  async function click(selector: string) { await wrapper.get(selector).trigger('click'); await flushPromises() }
  async function select(files: File[] = [new File(['backup'], 'backup.json', { type: 'application/json' })]) {
    const input = wrapper.get('input'); Object.defineProperty(input.element, 'files', { configurable: true, value: files })
    await input.trigger('change'); await flushPromises()
  }
  const status = () => wrapper.get('.lj-backup-status').text()
  return { wrapper, services, inspect, commit, discard, resume, discardImportStage, listImportStages, load, prepareExport, prepare, readExport, listExports, resumeExport, discardExport, click, select, status }
}

describe('Native Vue backup panel', () => {
  it('renders accessible native controls without loading storage until a user acts', () => {
    const h = setup()
    expect(h.wrapper.get('details summary').text()).toBe('备份与恢复')
    expect(h.wrapper.get('input').attributes('multiple')).toBeDefined()
    expect(h.wrapper.get('input').attributes('aria-describedby')).toBeTruthy()
    expect(h.wrapper.get('[role="status"]').attributes('aria-live')).toBe('polite')
    expect(h.inspect).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled(); expect(h.listImportStages).not.toHaveBeenCalled()
  })
  it('v2 inspection previews before committing and never asks the panel to load a whole snapshot', async () => {
    const h = setup(); await h.select()
    expect(h.inspect).toHaveBeenCalledOnce(); expect(h.commit).not.toHaveBeenCalled(); expect(h.load).not.toHaveBeenCalled()
    expect(h.wrapper.get('.lj-backup-counts').text()).toContain('1 条记录')
    expect(document.activeElement).toBe(h.wrapper.get('.lj-backup-confirm').element)
    await h.click('.lj-backup-confirm')
    expect(h.commit).toHaveBeenCalledWith(volume()); expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false)
    expect(h.status()).toContain('已导入 1 条记录'); expect(h.wrapper.emitted('imported')).toEqual([[result()]])
    expect(h.wrapper.emitted('busy')).toEqual([[true], [false], [true], [false]])
  })
  it('v1 keeps its snapshot preview and passes it unchanged to the coordinator', async () => {
    const preview = single(), h = setup({ preview }); await h.select(); await h.click('.lj-backup-confirm')
    expect(h.commit).toHaveBeenCalledWith(preview); expect(h.status()).toContain('已导入 1 条记录')
  })
  it('a failed atomic commit keeps the checked preview available for retry', async () => {
    const h = setup(); h.commit.mockRejectedValueOnce({ friendlyMessage: '空间不足，没有更改原记录。' })
    await h.select(); await h.click('.lj-backup-confirm')
    expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(true); expect(h.status()).toContain('备份仍在，可以重试或取消')
    expect(h.wrapper.emitted('imported')).toBeUndefined()
    await h.click('.lj-backup-confirm'); expect(h.commit).toHaveBeenCalledTimes(2); expect(h.status()).toContain('已导入 1 条记录')
  })
  it('final commit locks controls, offers no cancel, and waits for the parent refresh', async () => {
    const save = deferred<RestoreCommitResult>(), refresh = deferred<void>(), callback = vi.fn(() => refresh.promise)
    const h = setup({ onCommitted: callback }); h.commit.mockReturnValue(save.promise)
    await h.select(); await h.wrapper.get('.lj-backup-confirm').trigger('click')
    expect(h.wrapper.find('.lj-backup-stop').exists()).toBe(false); expect((h.wrapper.get('input').element as HTMLInputElement).disabled).toBe(true)
    save.resolve(result()); await flushPromises(); expect(callback).toHaveBeenCalledWith(result())
    expect((h.wrapper.get('input').element as HTMLInputElement).disabled).toBe(true)
    refresh.resolve(); await flushPromises(); expect((h.wrapper.get('input').element as HTMLInputElement).disabled).toBe(false)
  })
  it('parent refresh failure never converts committed data into a failed import or retry', async () => {
    const h = setup({ onCommitted: async () => { throw new Error('Refresh failed') } })
    await h.select(); await h.click('.lj-backup-confirm')
    expect(h.status()).toContain('已导入 1 条记录'); expect(h.status()).toContain('回忆已保存，地图暂时无法刷新')
    expect(h.status()).not.toMatch(/导入未完成|备份仍在/); expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false)
    expect(h.wrapper.emitted('imported')).toHaveLength(1)
  })
  it('cancel waits for the coordinator to settle its current staged write and cleanup', async () => {
    const gate = deferred<RestorePreview>(), h = setup(); let signal: AbortSignal | undefined
    h.inspect.mockImplementation((_files, options) => { signal = options.signal; return gate.promise })
    await h.select(); expect(h.wrapper.get('.lj-backup-stop').text()).toBe('取消检查')
    await h.click('.lj-backup-stop'); expect(signal?.aborted).toBe(true)
    expect((h.wrapper.get('input').element as HTMLInputElement).disabled).toBe(true)
    gate.reject({ code: 'aborted' }); await flushPromises()
    expect(h.status()).toContain('已取消检查'); expect(h.commit).not.toHaveBeenCalled()
    expect((h.wrapper.get('input').element as HTMLInputElement).disabled).toBe(false)
  })
  it('inspection cleanup failures expose a scoped retry instead of a ready preview', async () => {
    const h = setup(); h.inspect.mockRejectedValue({ code: 'cleanup-pending', stageId: 'stage-1', cleanupPending: true, friendlyMessage: '检查未完成，临时副本尚未清理。' })
    await h.select(); expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false)
    expect(h.wrapper.find('.lj-backup-cleanup').exists()).toBe(true)
    await h.click('.lj-backup-cleanup-retry'); expect(h.discardImportStage).toHaveBeenCalledWith('stage-1')
    expect(h.wrapper.find('.lj-backup-cleanup').exists()).toBe(false); expect(h.commit).not.toHaveBeenCalled()
  })
  it('ready cancel and file replacement clean only the prior preview', async () => {
    const h = setup(); await h.select(); await h.click('.lj-backup-cancel')
    expect(h.discard).toHaveBeenCalledWith(volume()); expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false)
    await h.select(); await h.select([new File(['other'], 'other.json')])
    expect(h.discard).toHaveBeenCalledTimes(2); expect(h.inspect).toHaveBeenCalledTimes(3)
    expect(h.commit).not.toHaveBeenCalled()
  })
  it('cancel cleanup failure drops the confirm action but leaves a visible cleanup retry', async () => {
    const h = setup(); h.discard.mockRejectedValueOnce(new Error('quota')); await h.select(); await h.click('.lj-backup-cancel')
    expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false); expect(h.status()).toContain('尚未清理')
    await h.click('.lj-backup-cleanup-retry'); expect(h.discardImportStage).toHaveBeenCalledWith('stage-1')
  })
  it('a committed cleanup failure is successful and cleanup retry cannot repeat the import', async () => {
    const h = setup(); h.commit.mockResolvedValue(result({ cleanupPending: true })); await h.select(); await h.click('.lj-backup-confirm')
    expect(h.status()).toContain('已导入 1 条记录'); expect(h.status()).toContain('无需再次导入')
    await h.click('.lj-backup-cleanup-retry'); expect(h.commit).toHaveBeenCalledOnce(); expect(h.discardImportStage).toHaveBeenCalledWith('stage-1')
  })
  it('recovery is explicit and incomplete or committed sessions offer only scoped cleanup', async () => {
    const h = setup(); h.listImportStages.mockResolvedValue([session(), session('staging', 'incomplete'), session('committed', 'done')])
    await h.click('.lj-backup-recovery-check'); expect(h.wrapper.findAll('.lj-backup-resume')).toHaveLength(1)
    expect(h.wrapper.findAll('.lj-backup-remove')).toHaveLength(3); expect(h.commit).not.toHaveBeenCalled()
    await h.click('.lj-backup-resume'); expect(h.resume).toHaveBeenCalledWith('stage-1')
    expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(true); expect(h.commit).not.toHaveBeenCalled()
  })
  it('stale ready recovery already committed elsewhere refreshes without offering confirmation', async () => {
    const callback = vi.fn(async () => {}), h = setup({ onCommitted: callback })
    h.listImportStages.mockResolvedValue([session()]); h.resume.mockResolvedValue({ ...volume(), plan: { ...counts, sessionId: 'stage-1', status: 'committed' } })
    h.commit.mockResolvedValue(result({ replayed: true }))
    await h.click('.lj-backup-recovery-check'); await h.click('.lj-backup-resume')
    expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false); expect(h.status()).toContain('本次没有重复写入')
    expect(h.status()).not.toContain('已导入 1 条记录'); expect(callback).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(h.wrapper.get('.lj-backup-recovery-check').element)
  })
  it('commit racing after preview reports replay without newly-added counts', async () => {
    const h = setup(); h.commit.mockResolvedValue(result({ replayed: true })); await h.select(); await h.click('.lj-backup-confirm')
    expect(h.status()).toContain('本次没有重复写入'); expect(h.status()).not.toContain('已导入 1 条记录')
  })
  it('a recovered session discarded elsewhere clears the stale preview without a success claim', async () => {
    const h = setup(); await h.select(); h.listImportStages.mockResolvedValue([session()])
    h.resume.mockRejectedValue({ friendlyMessage: '暂存已被清理，请重新选择完整备份。' })
    await h.click('.lj-backup-recovery-check'); await h.click('.lj-backup-resume')
    expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false); expect(h.status()).toContain('暂存已被清理')
    expect(h.commit).not.toHaveBeenCalled()
  })
  it('native image decode callback rejects broken photos before a preview exists', async () => {
    vi.stubGlobal('Image', class { onerror: (() => void) | null = null; onload: (() => void) | null = null; set src(_value: string) { queueMicrotask(() => this.onerror?.()) }; removeAttribute() {} })
    const h = setup(); h.inspect.mockImplementation(async (_files, options) => { await options.decodePhoto(photo, options.signal); return volume() })
    await h.select(); expect(h.status()).toContain('照片无法完整解码'); expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false)
    expect(h.commit).not.toHaveBeenCalled()
  })
  it('single volume needs preparation and an explicit download click; never loads the full library', async () => {
    const h = setup(); await h.click('.lj-backup-export')
    expect(h.load).not.toHaveBeenCalled(); expect(h.prepareExport).not.toHaveBeenCalled()
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(h.readExport).not.toHaveBeenCalled()
    await h.click('.lj-backup-part-prepare')
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled(); expect(h.wrapper.find('.lj-backup-download').exists()).toBe(true)
    const first = h.wrapper.get('.lj-backup-download').attributes('href')
    h.wrapper.get('.lj-backup-download').element.addEventListener('click', event => event.preventDefault())
    await h.click('.lj-backup-download'); expect(h.status()).toContain('已发起第 1 卷下载')
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(first)
    await h.click('.lj-backup-export'); expect(URL.revokeObjectURL).toHaveBeenCalledWith(first)
    await h.click('.lj-backup-part-prepare'); const second = h.wrapper.get('.lj-backup-download').attributes('href')
    h.wrapper.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith(second)
  })
  it('switching volumes revokes the old URL before reading and keeps just one link', async () => {
    const h = setup(); h.prepare.mockResolvedValue(exportSession(2))
    await h.click('.lj-backup-export'); expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled()
    expect(h.wrapper.findAll('.lj-backup-part-prepare')).toHaveLength(2); expect(h.status()).toContain('尚未发起下载')
    await h.click('.lj-backup-part-prepare'); const first = h.wrapper.get('.lj-backup-download').attributes('href')
    h.readExport.mockImplementationOnce(async (_id, part) => {
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(first)
      return { part, filename: `part-${part}.json`, bytes: 4, blob: new Blob(['part']) }
    })
    await h.click('.lj-backup-part-prepare'); expect(h.wrapper.findAll('.lj-backup-download')).toHaveLength(1)
    expect(h.wrapper.get('.lj-backup-download').text()).toContain('第 2 卷')
    expect(h.status()).not.toContain('下载成功')
  })
  it('cancel holds the busy lock until preparation settles and ignores late data', async () => {
    const gate = deferred<ReadyExportSession>(), h = setup(); h.prepare.mockReturnValue(gate.promise)
    await h.click('.lj-backup-export'); await h.click('.lj-backup-stop')
    expect(h.prepare.mock.calls[0]![0]!.signal?.aborted).toBe(true)
    expect((h.wrapper.get('input').element as HTMLInputElement).disabled).toBe(true)
    await h.click('.lj-backup-export'); expect(h.prepare).toHaveBeenCalledOnce()
    gate.reject({ code: 'aborted' }); await flushPromises(); expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(h.status()).toContain('已取消本次准备'); expect((h.wrapper.get('input').element as HTMLInputElement).disabled).toBe(false)
  })
  it('empty export and disabled parent state cannot create a backup or mutate storage', async () => {
    const h = setup(); h.prepare.mockRejectedValue({ code: 'empty', friendlyMessage: '还没有已保存的记录。' }); await h.click('.lj-backup-export')
    expect(h.status()).toContain('还没有已保存的记录'); expect(h.prepareExport).not.toHaveBeenCalled()
    await h.wrapper.setProps({ disabled: true }); await h.select()
    expect(h.inspect).not.toHaveBeenCalled(); expect((h.wrapper.get('input').element as HTMLInputElement).disabled).toBe(true)
  })
  it('unmount cancels a pending part read without creating a late URL or deleting a ready session', async () => {
    const h = setup(), gate = deferred<Awaited<ReturnType<typeof h.readExport>>>()
    await h.click('.lj-backup-export'); h.readExport.mockReturnValue(gate.promise); await h.click('.lj-backup-part-prepare')
    const signal = h.readExport.mock.calls[0]![2]!.signal; h.wrapper.unmount(); expect(signal?.aborted).toBe(true)
    gate.resolve({ part: 1, filename: 'part-1.json', bytes: 4, blob: new Blob(['part']) }); await flushPromises()
    expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(h.discardExport).not.toHaveBeenCalled()
  })
  it('lists persistent export metadata only on request, resumes ready and confirms scoped cleanup', async () => {
    const h = setup(); expect(h.listExports).not.toHaveBeenCalled()
    h.listExports.mockResolvedValue([exportSession(), { ...exportSession(), id: 'building', status: 'building' }])
    await h.click('.lj-export-list'); expect(h.wrapper.findAll('.lj-export-resume')).toHaveLength(1)
    expect(h.readExport).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled()
    await h.click('.lj-export-resume'); expect(h.resumeExport).toHaveBeenCalledWith('export-1', expect.objectContaining({ signal: expect.any(AbortSignal) }))
    await h.click('.lj-backup-part-prepare'); const url = h.wrapper.get('.lj-backup-download').attributes('href')
    await h.click('.lj-export-clean-ready'); expect(h.discardExport).not.toHaveBeenCalled()
    expect(h.wrapper.get('.lj-export-confirmation').text()).toContain('若另一页还在生成')
    await h.click('.lj-export-confirm-clean'); expect(h.discardExport).toHaveBeenCalledWith('export-1')
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url); expect(h.status()).toContain('已下载文件没有更改')
    expect(h.discardImportStage).not.toHaveBeenCalled()
  })
  it('export cleanup failure is visible even on cancel and retries only its session', async () => {
    const h = setup(); h.prepare.mockRejectedValue({ code: 'cleanup-pending', cleanupPending: true, sessionId: 'failed-export', friendlyMessage: '临时备份尚未清理。' })
    await h.click('.lj-backup-export'); expect(h.wrapper.find('.lj-export-cleanup-retry').exists()).toBe(true)
    await h.click('.lj-export-cleanup-retry'); expect(h.discardExport).toHaveBeenCalledWith('failed-export')
    expect(h.wrapper.find('.lj-export-cleanup-retry').exists()).toBe(false); expect(h.discardImportStage).not.toHaveBeenCalled()
  })
  it('damaged export metadata offers only explicit cleanup without invented counts', async () => {
    const h = setup(); h.listExports.mockResolvedValue([{ id: 'damaged', sourceDbName: 'local', sourceRevision: null, status: 'damaged', summary: null, createdAt: null }])
    await h.click('.lj-export-list')
    expect(h.wrapper.get('.lj-export-session-list').text()).toContain('记录数无法读取')
    expect(h.wrapper.find('.lj-export-resume').exists()).toBe(false)
    await h.click('.lj-export-remove'); expect(h.discardExport).not.toHaveBeenCalled()
    await h.click('.lj-export-confirm-clean'); expect(h.discardExport).toHaveBeenCalledWith('damaged')
  })
  it('unmount aborts unfinished inspection and does not publish a stale import event', async () => {
    const gate = deferred<RestorePreview>(), h = setup(); let signal: AbortSignal | undefined
    h.inspect.mockImplementation((_files, options) => { signal = options.signal; return gate.promise })
    await h.select(); h.wrapper.unmount(); expect(signal?.aborted).toBe(true)
    gate.resolve(volume()); await flushPromises(); expect(h.discard).toHaveBeenCalledWith(volume())
    expect(h.commit).not.toHaveBeenCalled(); expect(h.wrapper.emitted('imported')).toBeUndefined()
  })
  it('ready recovery removes its previous failed cleanup intent before showing the new preview', async () => {
    const h = setup(); h.discard.mockRejectedValueOnce(new Error('quota')); await h.select(); await h.click('.lj-backup-cancel')
    h.listImportStages.mockResolvedValue([session()]); await h.click('.lj-backup-recovery-check'); await h.click('.lj-backup-resume')
    expect(h.wrapper.find('.lj-backup-cleanup').exists()).toBe(false); expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(true)
    await h.click('.lj-backup-confirm'); expect(h.commit).toHaveBeenCalledOnce()
  })
  it('recovery list failure leaves the check action available without writing records', async () => {
    const h = setup(); h.listImportStages.mockRejectedValueOnce(new Error('blocked')); await h.click('.lj-backup-recovery-check')
    expect(h.status()).toContain('暂时无法检查临时副本'); expect((h.wrapper.get('.lj-backup-recovery-check').element as HTMLButtonElement).disabled).toBe(false)
    expect(h.commit).not.toHaveBeenCalled(); expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false)
  })
  it('a broken image decoder can be cancelled without waiting for a late decode promise', async () => {
    const decode = deferred<void>(), h = setup()
    vi.stubGlobal('Image', class {
      onload: (() => void) | null = null; onerror: (() => void) | null = null; naturalWidth = 1; naturalHeight = 1
      set src(_value: string) { queueMicrotask(() => this.onload?.()) }; removeAttribute() {}
      decode() { return decode.promise }
    })
    h.inspect.mockImplementation(async (_files, options) => { await options.decodePhoto(photo, options.signal); return volume() })
    await h.select(); await h.click('.lj-backup-stop'); expect(h.status()).toContain('已取消检查')
    expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false)
    decode.resolve(); await flushPromises(); expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false); expect(h.commit).not.toHaveBeenCalled()
  })
  it('stale committed recovery refresh failure cannot be mislabeled as a failed new import', async () => {
    const h = setup(); h.listImportStages.mockResolvedValue([session()])
    h.resume.mockResolvedValue({ ...volume(), plan: { ...counts, sessionId: 'stage-1', status: 'committed' } })
    h.commit.mockRejectedValueOnce(new Error('receipt read failed'))
    await h.click('.lj-backup-recovery-check'); await h.click('.lj-backup-resume')
    expect(h.status()).toContain('已在其他页面导入'); expect(h.status()).toContain('暂时无法刷新')
    expect(h.status()).not.toContain('导入未完成'); expect(h.wrapper.find('.lj-backup-preview').exists()).toBe(false)
  })
})
