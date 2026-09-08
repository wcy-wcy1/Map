import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import MemoryCard from '../src/components/MemoryCard.vue'
import type { Visit } from '../src/domain/models'
import type { MemoryCardResult, RenderMemoryCard } from '../src/sharing/card-types'

const result = (): MemoryCardResult => ({ blob: new Blob(['generated PNG, no record metadata'], { type: 'image/png' }),
  width: 1080, height: 1440, filename: '旅行回忆卡.png' })
function visit(overrides: Partial<Visit> = {}): Visit {
  return { id: 'visit-one', createdAt: 12, placeId: 'yulong', date: '2025-01-01', note: '仅自己看的私人手记',
    photos: ['a', 'b', 'c', 'd'].map(id => ({ id, name: `private-original-${id}.jpg`, url: `data:image/jpeg;base64,${id}` })), coverId: 'b', ...overrides }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const mounted: VueWrapper[] = []
const createUrl = vi.fn(), revokeUrl = vi.fn(), share = vi.fn(), canShare = vi.fn()
function button(wrapper: VueWrapper, label: string) { return wrapper.findAll('button').find(item => item.text() === label)! }
async function open(props: { visit?: Visit | null; selectedPhotoId?: string; renderCard?: RenderMemoryCard } = {}) {
  const renderCard = props.renderCard ?? vi.fn<RenderMemoryCard>().mockResolvedValue(result())
  const wrapper = mount(MemoryCard, { attachTo: document.body,
    props: { visit: visit(), placeName: '玉龙雪山', ...props, renderCard } })
  mounted.push(wrapper); await flushPromises()
  return { wrapper, renderCard }
}
async function generate(wrapper: VueWrapper) { await wrapper.get('form').trigger('submit'); await flushPromises() }
const photo = (wrapper: VueWrapper, index: number) => wrapper.get<HTMLInputElement>(`[aria-label="选择第 ${index} 张照片"]`)
beforeEach(() => {
  // These controlled DOM/platform tests do not simulate real image decode,
  // native modal trapping, download completion, or a phone's system share sheet.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function(this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function(this: HTMLDialogElement) { this.removeAttribute('open') } })
  createUrl.mockReset().mockImplementation(() => `blob:card-${createUrl.mock.calls.length}`)
  revokeUrl.mockReset(); share.mockReset().mockResolvedValue(undefined); canShare.mockReset().mockReturnValue(true)
  vi.stubGlobal('isSecureContext', true)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl })
  Object.defineProperty(navigator, 'share', { configurable: true, value: share })
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: canShare })
})
afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks()
})

describe('native Vue memory card selection and lifecycle', () => {
  it('starts with the cover, empty public text, no date, labelled modal and return focus', async () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus()
    const source = visit(), { wrapper, renderCard } = await open({ visit: source })
    expect(wrapper.get('dialog').attributes('open')).toBe('')
    expect(wrapper.get('dialog').attributes('aria-labelledby')).toBe('yn-card-title')
    expect(document.activeElement).toBe(button(wrapper, '返回回忆').element)
    expect(photo(wrapper, 2).element.checked).toBe(true)
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('')
    expect(wrapper.get<HTMLInputElement>('.yn-card-date input').element.checked).toBe(false)
    expect(wrapper.text()).not.toContain(source.note)
    await generate(wrapper)
    expect(renderCard).toHaveBeenCalledWith({ placeId: 'yulong', showDate: false, text: '', photos: [{ id: 'b', url: source.photos[1]!.url }] })
    expect(wrapper.get('.yn-card-download').attributes('download')).toBe('旅行回忆卡.png')
    expect(document.activeElement).toBe(wrapper.get('.yn-card-download').element)
    expect(share).not.toHaveBeenCalled()
    await wrapper.get('dialog').trigger('cancel')
    expect(wrapper.emitted('close')).toEqual([[]]); expect(wrapper.get('dialog').attributes('open')).toBeUndefined()
    expect(document.activeElement).toBe(opener); expect(revokeUrl).toHaveBeenCalledWith('blob:card-1')
  })

  it('prefers the requested photo, caps selection at three and renders in original order', async () => {
    const { wrapper, renderCard } = await open({ selectedPhotoId: 'c' })
    expect(photo(wrapper, 3).element.checked).toBe(true)
    await photo(wrapper, 4).setValue(true); await photo(wrapper, 1).setValue(true)
    await photo(wrapper, 2).setValue(true)
    expect(photo(wrapper, 2).element.checked).toBe(false)
    expect(wrapper.text()).toContain('最多选择 3 张，请先取消一张')
    expect(wrapper.get('.yn-card-selected').text()).toBe('已选 3 / 3 张')
    await generate(wrapper)
    expect(vi.mocked(renderCard).mock.calls[0]![0].photos.map(item => item.id)).toEqual(['a', 'c', 'd'])
    // Reserve the PNG ratio before decoding, so the preview scroll target does
    // not move after the user's Generate click on a narrow screen.
    expect(wrapper.get('.yn-card-preview img').attributes('width')).toBe('1080')
    expect(wrapper.get('.yn-card-preview img').attributes('height')).toBe('1440')
  })

  it('falls back to the first photo when the requested photo and cover are missing', async () => {
    const { wrapper } = await open({ selectedPhotoId: 'missing', visit: visit({ coverId: 'missing' }) })
    expect(photo(wrapper, 1).element.checked).toBe(true)
  })

  it('supports text-only cards and rejects empty or more than 100 code points', async () => {
    const { wrapper, renderCard } = await open({ visit: visit({ photos: [], coverId: null }) })
    expect(wrapper.text()).toContain('可以写一句话，做成文字回忆卡')
    await generate(wrapper)
    expect(renderCard).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('请至少选一张照片')
    await wrapper.get('textarea').setValue('🌄'.repeat(101)); await generate(wrapper)
    expect(renderCard).not.toHaveBeenCalled(); expect(wrapper.text()).toContain('分享手记最多 100 字')
    expect(wrapper.get('textarea').attributes('aria-invalid')).toBe('true')
    await wrapper.get('textarea').setValue('🌄'.repeat(100)); await generate(wrapper)
    expect(renderCard).toHaveBeenCalledOnce()
    expect(vi.mocked(renderCard).mock.calls[0]![0]).toMatchObject({ text: '🌄'.repeat(100), photos: [] })
  })

  it('imports private text only on request, preserves whole graphemes at the 100-point bound and opts in date', async () => {
    const source = visit({ note: '山'.repeat(94) + '👨‍👩‍👧‍👦' + '尾巴' })
    const { wrapper, renderCard } = await open({ visit: source })
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('')
    await button(wrapper, '带入手记前100字').trigger('click')
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('山'.repeat(94))
    expect(source.note).toContain('👨‍👩‍👧‍👦')
    await wrapper.get('.yn-card-date input').setValue(true); await generate(wrapper)
    expect(vi.mocked(renderCard).mock.calls[0]![0]).toMatchObject({ date: '2025-01-01', showDate: true, text: '山'.repeat(94) })
  })

  it('keeps a detached snapshot across same-visit background replacement and starts fresh for a new visit', async () => {
    const source = visit(), originalUrl = source.photos[1]!.url
    const { wrapper, renderCard } = await open({ visit: source })
    await wrapper.get('textarea').setValue('我选择分享的话')
    source.photos[1]!.url = 'data:image/jpeg;base64,changed'
    await wrapper.setProps({ visit: visit({ date: '2026-02-02', note: '后台替换', coverId: 'a' }), placeName: '更改的地点名' })
    await generate(wrapper)
    expect(vi.mocked(renderCard).mock.calls[0]![0]).toMatchObject({ text: '我选择分享的话', photos: [{ id: 'b', url: originalUrl }] })
    expect(wrapper.get('.yn-card-context').text()).toContain('玉龙雪山 · 2025-01-01')
    await wrapper.setProps({ visit: visit({ id: 'visit-two', date: '2025-02-02', coverId: 'd' }) })
    await flushPromises()
    expect(revokeUrl).toHaveBeenCalledWith('blob:card-1'); expect(wrapper.find('.yn-card-preview').exists()).toBe(false)
    expect(photo(wrapper, 4).element.checked).toBe(true)
    expect(wrapper.get<HTMLTextAreaElement>('textarea').element.value).toBe('')
  })

  it('releases and invalidates the old preview on each kind of adjustment', async () => {
    const { wrapper } = await open()
    const actions = [
      () => wrapper.get('textarea').setValue('想分享的文字'),
      () => wrapper.get('.yn-card-date input').setValue(true),
      () => photo(wrapper, 1).setValue(true),
      () => button(wrapper, '带入这次手记').trigger('click'),
      () => button(wrapper, '继续调整').trigger('click'),
    ]
    for (const [index, action] of actions.entries()) {
      await generate(wrapper); await action()
      expect(wrapper.find('.yn-card-preview').exists()).toBe(false)
      expect(revokeUrl).toHaveBeenLastCalledWith(`blob:card-${index + 1}`)
    }
    await generate(wrapper); await wrapper.setProps({ visit: null })
    expect(wrapper.get('dialog').attributes('open')).toBeUndefined()
    expect(revokeUrl).toHaveBeenCalledTimes(6)
  })

  it('cancels a generation on close and ignores its late result after reopening', async () => {
    const old = deferred<MemoryCardResult>()
    const renderCard = vi.fn<RenderMemoryCard>().mockReturnValueOnce(old.promise).mockResolvedValueOnce(result())
    const { wrapper } = await open({ renderCard })
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('dialog').attributes('aria-busy')).toBe('true')
    expect(wrapper.emitted('busy')).toEqual([[true]])
    await button(wrapper, '返回回忆').trigger('click')
    expect(wrapper.emitted('busy')).toEqual([[true], [false]])
    await wrapper.setProps({ visit: null }); await wrapper.setProps({ visit: visit() }); await flushPromises()
    await generate(wrapper)
    old.resolve(result()); await flushPromises()
    expect(createUrl).toHaveBeenCalledOnce()
    expect(wrapper.get('.yn-card-preview img').attributes('src')).toBe('blob:card-1')
  })

  it('ignores a stale failure on a different visit and releases busy state', async () => {
    const old = deferred<MemoryCardResult>(), renderCard = vi.fn<RenderMemoryCard>().mockReturnValueOnce(old.promise)
    const { wrapper } = await open({ renderCard })
    await wrapper.get('form').trigger('submit')
    await wrapper.setProps({ visit: visit({ id: 'new-visit' }) }); await flushPromises()
    old.reject({ friendlyMessage: '旧回忆出错' }); await flushPromises()
    expect(wrapper.text()).not.toContain('旧回忆出错')
    expect(wrapper.get('dialog').attributes('aria-busy')).toBe('false')
  })

  it('reports a renderer timeout honestly, keeps the selection, and permits retry', async () => {
    const renderCard = vi.fn<RenderMemoryCard>().mockRejectedValueOnce({ friendlyMessage: '照片读取超时，请重试。' }).mockResolvedValueOnce(result())
    const { wrapper } = await open({ renderCard })
    await generate(wrapper)
    expect(wrapper.get('.yn-card-status').text()).toBe('照片读取超时，请重试。')
    expect(wrapper.get('.yn-card-status').attributes('data-error')).toBe('true')
    expect(wrapper.find('.yn-card-preview').exists()).toBe(false); expect(createUrl).not.toHaveBeenCalled()
    expect(photo(wrapper, 2).element.checked).toBe(true)
    expect(wrapper.get('dialog').attributes('aria-busy')).toBe('false')
    await generate(wrapper); expect(wrapper.find('.yn-card-preview').exists()).toBe(true)
  })

  it('cleans up an unreadable preview and releases an active URL on unmount', async () => {
    const { wrapper } = await open()
    await generate(wrapper); await wrapper.get('.yn-card-preview img').trigger('error')
    expect(wrapper.find('.yn-card-preview').exists()).toBe(false)
    expect(wrapper.text()).toContain('预览图片暂时无法显示')
    expect(revokeUrl).toHaveBeenCalledWith('blob:card-1')
    await generate(wrapper); wrapper.unmount(); mounted.splice(mounted.indexOf(wrapper), 1)
    expect(revokeUrl).toHaveBeenCalledWith('blob:card-2')
  })
})

describe('file-only system share, capability gates and download fallback', () => {
  it.each(['insecure', 'missing-share', 'missing-canShare', 'refused', 'throws'])('keeps download usable when sharing is %s', async gate => {
    if (gate === 'insecure') vi.stubGlobal('isSecureContext', false)
    if (gate === 'missing-share') Object.defineProperty(navigator, 'share', { configurable: true, value: undefined })
    if (gate === 'missing-canShare') Object.defineProperty(navigator, 'canShare', { configurable: true, value: undefined })
    if (gate === 'refused') canShare.mockReturnValue(false)
    if (gate === 'throws') canShare.mockImplementation(() => { throw new Error('denied') })
    const { wrapper } = await open(); await generate(wrapper)
    expect(wrapper.find('.yn-card-share').exists()).toBe(false)
    expect(wrapper.get('.yn-card-download').attributes('href')).toBe('blob:card-1')
    expect(wrapper.text()).toContain('当前浏览器暂不支持直接分享图片')
    expect(share).not.toHaveBeenCalled()
  })

  it('calls navigator.share directly from the click with only the generated PNG File', async () => {
    const card = result(), { wrapper } = await open({ renderCard: vi.fn<RenderMemoryCard>().mockResolvedValue(card) })
    await generate(wrapper)
    expect(share).not.toHaveBeenCalled()
    wrapper.get('.yn-card-share').element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(share).toHaveBeenCalledOnce()
    const payload = share.mock.calls[0]![0] as ShareData
    expect(Object.keys(payload)).toEqual(['files']); expect(payload.files).toHaveLength(1)
    const file = payload.files![0]!
    expect(file).toBeInstanceOf(File); expect(file.type).toBe('image/png'); expect(file.name).toBe(card.filename)
    expect(file.size).toBe(card.blob.size); expect(file.lastModified).toBe(0)
    expect(canShare).toHaveBeenCalledWith({ files: [file] })
    await flushPromises()
    expect(wrapper.text()).toContain('图片已交给系统分享；是否发送完成，请到所选应用确认')
    expect(wrapper.text()).not.toContain('发送成功')
  })

  it('keeps the pending share lock across close/reopen and ignores completion from the old preview', async () => {
    const pending = deferred<void>(); share.mockReturnValueOnce(pending.promise)
    const { wrapper } = await open(); await generate(wrapper)
    await wrapper.get('.yn-card-share').trigger('click'); await wrapper.get('.yn-card-share').trigger('click')
    expect(share).toHaveBeenCalledOnce()
    await button(wrapper, '返回回忆').trigger('click'); await wrapper.setProps({ visit: null })
    await wrapper.setProps({ visit: visit() }); await flushPromises(); await generate(wrapper)
    expect(wrapper.get('.yn-card-share').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.yn-card-download').attributes('href')).toBe('blob:card-2')
    await wrapper.get('.yn-card-share').trigger('click'); expect(share).toHaveBeenCalledOnce()
    pending.resolve(); await flushPromises()
    expect(wrapper.get('.yn-card-share').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.yn-card-status').text()).toContain('预览已生成')
    await wrapper.get('.yn-card-share').trigger('click'); expect(share).toHaveBeenCalledTimes(2)
  })

  it.each(['AbortError', 'NotAllowedError'])('reports %s without claiming a send and permits explicit retry', async name => {
    share.mockRejectedValueOnce(Object.assign(new Error('cancelled or unavailable'), { name }))
    const { wrapper } = await open(); await generate(wrapper); await wrapper.get('.yn-card-share').trigger('click'); await flushPromises()
    expect(wrapper.get('.yn-card-status').text()).toContain('分享未完成')
    expect(wrapper.get('.yn-card-status').attributes('data-error')).toBe(String(name !== 'AbortError'))
    expect(wrapper.get('.yn-card-share').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.yn-card-download').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('发送成功'); expect(share).toHaveBeenCalledOnce()
  })

  it('reports a download request without claiming that a file was saved', async () => {
    const { wrapper } = await open(); await generate(wrapper)
    const link = wrapper.get('.yn-card-download').element
    let componentPrevented = false
    link.addEventListener('click', event => { componentPrevented = event.defaultPrevented; event.preventDefault() })
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); await flushPromises()
    expect(componentPrevented).toBe(false)
    expect(wrapper.get('.yn-card-status').text()).toBe('已发起图片下载，请确认已保存后再发给朋友。')
    expect(share).not.toHaveBeenCalled()
  })
})
