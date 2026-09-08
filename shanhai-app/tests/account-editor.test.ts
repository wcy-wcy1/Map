import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MemoryEditor from '../src/components/MemoryEditor.vue'
import { createCatalogue } from '../src/domain/catalogue'
import { toVisitSummary } from '../src/domain/visit-summary'
import type { Draft, LibraryIndexSnapshot, Visit } from '../src/domain/models'
import type { LocalRepository } from '../src/services/contracts'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const inputVisit: Visit = { id: 'visit-input', createdAt: 1, placeId: 'yulong', date: '2025-01-01', note: '本页手记', photos: [{ id: 'photo-input', name: '输入.png', url: png }], coverId: 'photo-input' }
const canonical: Visit = { ...inputVisit, id: 'visit-confirmed', photos: [{ id: 'photo-confirmed', name: '输入.png', url: 'data:image/jpeg;base64,/9j/4AAAAAA=' }], coverId: 'photo-confirmed' }
const draft = (value: Visit = inputVisit): Draft => ({ id: 'draft-account', visitId: value.id, createdAt: value.createdAt, placeId: value.placeId, date: value.date, note: value.note, photos: structuredClone(value.photos), coverId: value.coverId, updatedAt: 1 })
const empty = (): LibraryIndexSnapshot => ({ visits: [], covers: [], revision: 0 })
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T
function harness(savedDraft: Draft | null = draft()) {
  let version = 0
  const repository = {
    loadDraft: vi.fn().mockResolvedValue(savedDraft),
    saveDraft: vi.fn(async (value: Draft) => ({ ...clone(value), version: String(++version) })),
    clearDraft: vi.fn().mockResolvedValue(true), loadIndex: vi.fn().mockResolvedValue(empty()), readVisit: vi.fn().mockResolvedValue(null),
    addVisit: vi.fn(async (value: Visit) => value.id), updateVisit: vi.fn<LocalRepository['updateVisit']>().mockImplementation(async value => value),
    reconcilePendingVisit: vi.fn<NonNullable<LocalRepository['reconcilePendingVisit']>>().mockResolvedValue(null),
  }
  return { repository, catalogue: createCatalogue() }
}
const wrappers: VueWrapper[] = []
async function open(h = harness(), props: { visit?: Visit; accountMode?: boolean } = {}) {
  const wrapper = mount(MemoryEditor, { attachTo: document.body, props: { open: true, placeId: 'yulong', accountMode: true, ...props,
    catalogue: h.catalogue, repository: h.repository as unknown as LocalRepository } })
  wrappers.push(wrapper); await flushPromises(); expect(wrapper.find('textarea').exists()).toBe(true)
  return { wrapper, ...h }
}
async function submit(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes }); return { promise, resolve } }
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open') } })
})
afterEach(() => { wrappers.splice(0).forEach(wrapper => wrapper.unmount()); document.body.innerHTML = '' })

describe('account editor repository-confirmation boundary (simulated repository, not HTTP)', () => {
  it('explains explicit upload while keeping autosave as a separate draft operation', async () => {
    const { wrapper, repository } = await open()
    expect(wrapper.text()).toContain('点击保存后，照片副本和手记会上传到本机测试服务')
    expect(wrapper.text()).not.toContain('照片仅在本机处理')
    await wrapper.get('textarea').setValue('尚未点击保存的草稿')
    await vi.waitFor(() => expect(repository.saveDraft).toHaveBeenCalled(), { timeout: 1500 })
    expect(repository.addVisit).not.toHaveBeenCalled(); expect(repository.updateVisit).not.toHaveBeenCalled()
    expect(repository.reconcilePendingVisit).not.toHaveBeenCalled(); expect(wrapper.emitted('saved')).toBeUndefined()
  })
  it('emits confirmed canonical IDs and transformed photos only after add confirmation', async () => {
    const h = harness()
    h.repository.reconcilePendingVisit.mockResolvedValueOnce(null).mockResolvedValueOnce(canonical)
    const { wrapper } = await open(h)
    await submit(wrapper)
    expect(h.repository.addVisit).toHaveBeenCalledExactlyOnceWith(inputVisit)
    expect(h.repository.reconcilePendingVisit).toHaveBeenCalledTimes(2)
    expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual(canonical)
    expect(h.repository.clearDraft).toHaveBeenCalledOnce()
    expect(h.repository.clearDraft.mock.invocationCallOrder[0]).toBeGreaterThan(h.repository.reconcilePendingVisit.mock.invocationCallOrder[1]!)
  })
  it('reconciles an exact previously confirmed input before duplicate/photo-byte comparison', async () => {
    const h = harness()
    h.repository.reconcilePendingVisit.mockResolvedValue(canonical)
    h.repository.loadIndex.mockResolvedValue({ visits: [toVisitSummary(canonical), toVisitSummary({ ...canonical, id: 'another-visit' })], covers: [], revision: 5 })
    const { wrapper } = await open(h)
    await submit(wrapper)
    expect(h.repository.reconcilePendingVisit).toHaveBeenCalledExactlyOnceWith(inputVisit)
    expect(h.repository.addVisit).not.toHaveBeenCalled(); expect(h.repository.updateVisit).not.toHaveBeenCalled()
    expect(wrapper.find('[aria-label="同日回忆确认"]').exists()).toBe(false)
    expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual(canonical)
    expect(h.repository.clearDraft).toHaveBeenCalledOnce()
  })
  it('does not treat transformed same-ID server content as saved without an exact receipt', async () => {
    const h = harness(), changed = { ...canonical, id: inputVisit.id }
    h.repository.loadIndex.mockResolvedValue({ visits: [toVisitSummary(changed)], covers: [], revision: 5 })
    h.repository.readVisit.mockResolvedValue(changed)
    const { wrapper } = await open(h)
    await submit(wrapper)
    expect(wrapper.text()).toContain('另一页已经保存了这份草稿对应的回忆')
    expect(wrapper.emitted('saved')).toBeUndefined(); expect(h.repository.clearDraft).not.toHaveBeenCalled()
    expect(h.repository.addVisit).not.toHaveBeenCalled(); expect(h.repository.updateVisit).not.toHaveBeenCalled()
  })
  it('keeps a commit-unknown draft and retries the same input through reconciliation without adding again', async () => {
    const h = harness()
    h.repository.reconcilePendingVisit.mockResolvedValueOnce(null).mockRejectedValueOnce(Object.assign(new Error('提交结果需要核对'), { friendlyMessage: '提交结果需要核对' })).mockResolvedValueOnce(canonical)
    const { wrapper } = await open(h)
    await submit(wrapper)
    expect(h.repository.addVisit).toHaveBeenCalledOnce()
    expect(wrapper.emitted('saved')).toBeUndefined(); expect(h.repository.clearDraft).not.toHaveBeenCalled()
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe(inputVisit.note)
    expect(wrapper.text()).toContain('当前草稿仍保留')
    await submit(wrapper)
    expect(h.repository.addVisit).toHaveBeenCalledOnce()
    expect(h.repository.reconcilePendingVisit.mock.calls[2]?.[0]).toEqual(inputVisit)
    expect(wrapper.emitted('saved')?.[0]?.[0]).toEqual(canonical)
  })
  it.each(['原回忆已删除，当前草稿仍保留。', '原回忆已删除。'])('states retained draft once when the server says %s', async friendlyMessage => {
    const h = harness()
    h.repository.reconcilePendingVisit.mockRejectedValue(Object.assign(new Error('RESOURCE_DELETED'), { code: 'missing', friendlyMessage }))
    const { wrapper } = await open(h)
    await submit(wrapper)
    const alert = wrapper.get('.yn-record-error[role="alert"]').text()
    expect(alert).toContain(friendlyMessage)
    expect(alert.match(/当前草稿仍保留/g)).toHaveLength(1)
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe(inputVisit.note)
    expect(h.repository.clearDraft).not.toHaveBeenCalled(); expect(h.repository.addVisit).not.toHaveBeenCalled()
    expect(wrapper.emitted('saved')).toBeUndefined()
  })
  it('preserves the original edit expectation after an index refresh reveals a newer record', async () => {
    const original = { ...inputVisit, photos: [], coverId: null }, newer = { ...original, note: '另一端已更新' }
    const h = harness(null)
    h.repository.loadIndex.mockResolvedValue({ visits: [toVisitSummary(newer)], covers: [], revision: 5 })
    h.repository.readVisit.mockResolvedValue(newer)
    h.repository.updateVisit.mockRejectedValue(Object.assign(new Error('版本冲突'), { code: 'VERSION_CONFLICT', friendlyMessage: '版本冲突' }))
    const { wrapper } = await open(h, { visit: original })
    await wrapper.get('textarea').setValue('不能覆盖另一端的本页文字'); await submit(wrapper)
    expect(h.repository.updateVisit.mock.calls[0]?.[1]).toEqual({ expectedVisit: original })
    expect(wrapper.emitted('saved')).toBeUndefined(); expect(h.repository.clearDraft).not.toHaveBeenCalled()
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('不能覆盖另一端的本页文字')
    expect(wrapper.text()).toContain('另存为新回忆')
  })
  it('does not initiate a write after unmount while the preflight index is delayed', async () => {
    const h = harness(), pending = deferred<LibraryIndexSnapshot>()
    h.repository.loadIndex.mockReturnValue(pending.promise)
    const { wrapper } = await open(h)
    await submit(wrapper); expect(h.repository.loadIndex).toHaveBeenCalledOnce()
    wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1)
    pending.resolve(empty()); await flushPromises()
    expect(h.repository.addVisit).not.toHaveBeenCalled(); expect(h.repository.updateVisit).not.toHaveBeenCalled()
    expect(h.repository.clearDraft).not.toHaveBeenCalled(); expect(wrapper.emitted('saved')).toBeUndefined()
  })
  it('does not start reconciliation after unmount while draft persistence is delayed', async () => {
    const h = harness(), pending = deferred<Draft & { version: string }>()
    h.repository.saveDraft.mockReturnValue(pending.promise)
    const { wrapper } = await open(h)
    await submit(wrapper); expect(h.repository.saveDraft).toHaveBeenCalledOnce()
    wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1)
    pending.resolve({ ...draft(), version: '1' }); await flushPromises()
    expect(h.repository.reconcilePendingVisit).not.toHaveBeenCalled(); expect(h.repository.loadIndex).not.toHaveBeenCalled()
    expect(h.repository.addVisit).not.toHaveBeenCalled(); expect(h.repository.clearDraft).not.toHaveBeenCalled()
  })
  it('does not submit a stale edit after unmount while the existing record read is delayed', async () => {
    const h = harness({ ...draft(), originalVisit: inputVisit }), pending = deferred<Visit>()
    h.repository.loadIndex.mockResolvedValue({ visits: [toVisitSummary(inputVisit)], covers: [], revision: 2 })
    h.repository.readVisit.mockReturnValue(pending.promise)
    const { wrapper } = await open(h)
    await submit(wrapper); expect(h.repository.readVisit).toHaveBeenCalledOnce()
    wrapper.unmount(); wrappers.splice(wrappers.indexOf(wrapper), 1)
    pending.resolve({ ...inputVisit, note: '读请求结束时的另一端版本' }); await flushPromises()
    expect(h.repository.updateVisit).not.toHaveBeenCalled(); expect(h.repository.addVisit).not.toHaveBeenCalled()
    expect(h.repository.clearDraft).not.toHaveBeenCalled(); expect(wrapper.emitted('saved')).toBeUndefined()
  })
})
