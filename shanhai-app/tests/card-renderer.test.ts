// Deterministic Canvas API contracts: fonts, pixels, decoding and PNG encoding are
// controlled adapters. These tests do not claim real browser or PNG visual evidence.
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMemoryCardRenderer, splitGraphemes } from '../src/sharing/card-renderer'
import type { CardCatalogue, MemoryCardInput } from '../src/sharing/card-types'

const PHOTO = 'data:image/png;base64,iVBORw0KGgo='
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkY='
const LANDMARK = 'data:image/webp;base64,UklGRgAAAABXRUJQ'
const base: MemoryCardInput = { placeId: 'yulong', date: '2026-09-05', text: '', photos: [{ id: 'photo-1', url: PHOTO }] }
const catalogue: CardCatalogue = new Map([['yulong', { name: '玉龙雪山' }], ['baisha', { name: '白沙镇' }]])
type ImageMode = 'load-error' | 'decode-error' | 'never-load' | 'never-decode' | 'src-throw'
interface Settings {
  catalogue?: CardCatalogue
  name?: string
  imageMode?: ImageMode
  imageModes?: (ImageMode | undefined)[]
  landmarkError?: boolean
  blobMode?: 'null' | 'wrong-type' | 'empty' | 'throw' | 'never'
  contextMissing?: boolean
  width?: number
  height?: number
  metrics?: (text: string, fontSize: number) => number
  fontsReady?: Promise<unknown>
}
interface TextCall { text: string; x: number; y: number; font: string; width: number }

function harness(settings: Settings = {}) {
  const calls = {
    images: [] as string[], decodes: 0, draws: [] as { image: MockImage; args: number[] }[],
    text: [] as TextCall[], fills: [] as { args: number[]; color: string }[],
    blobs: [] as { mime?: string; width: number; height: number }[], canvases: [] as MockCanvas[],
    instances: [] as MockImage[],
  }
  const context = {
    font: '38px serif', fillStyle: '', strokeStyle: '',
    measureText(text: string) {
      const size = Number(this.font.match(/(\d+)px/)?.[1] || 38)
      return { width: settings.metrics?.(text, size) ?? Array.from(text).length * size * 0.95 }
    },
    fillText(text: string, x: number, y: number) { calls.text.push({ text, x, y, font: this.font, width: this.measureText(text).width }) },
    drawImage(image: MockImage, ...args: number[]) { calls.draws.push({ image, args }) },
    fillRect(...args: number[]) { calls.fills.push({ args, color: this.fillStyle }) },
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
  }
  class MockImage {
    naturalWidth = settings.width ?? 1600
    naturalHeight = settings.height ?? 900
    onload: (() => unknown) | null = null
    onerror: (() => unknown) | null = null
    url = ''
    mode?: ImageMode
    constructor() {
      this.mode = settings.imageModes?.[calls.instances.length] ?? settings.imageMode
      calls.instances.push(this)
    }
    set src(value: string) {
      this.url = value
      calls.images.push(value)
      if (this.mode === 'src-throw') throw Error('Synthetic source failure')
      if (this.mode !== 'never-load') queueMicrotask(() => {
        if (this.mode === 'load-error' || (settings.landmarkError && value.includes('/webp'))) this.onerror?.()
        else this.onload?.()
      })
    }
    async decode() {
      calls.decodes++
      if (this.mode === 'decode-error') throw Error('Synthetic decoder failure')
      if (this.mode === 'never-decode') await new Promise(() => {})
    }
  }
  class MockCanvas {
    width = 0
    height = 0
    getContext(kind: string, options: { alpha: boolean }) {
      expect(kind).toBe('2d')
      expect(options).toEqual({ alpha: false })
      return settings.contextMissing ? null : context
    }
    toBlob(callback: (blob: Blob | null) => unknown, mime?: string) {
      calls.blobs.push({ mime, width: this.width, height: this.height })
      if (settings.blobMode === 'throw') throw Error('Synthetic encoder failure')
      if (settings.blobMode !== 'never') queueMicrotask(() => callback(settings.blobMode === 'null' ? null : new Blob(
        settings.blobMode === 'empty' ? [] : ['mock PNG bytes, not an actual image'],
        { type: settings.blobMode === 'wrong-type' ? 'image/jpeg' : 'image/png' },
      )))
    }
  }
  vi.stubGlobal('Image', MockImage)
  vi.stubGlobal('document', {
    fonts: { ready: settings.fontsReady ?? Promise.resolve() },
    createElement(tag: string) {
      expect(tag).toBe('canvas')
      const canvas = new MockCanvas()
      calls.canvases.push(canvas)
      return canvas
    },
  })
  const selectedCatalogue = settings.catalogue ?? (settings.name === undefined ? catalogue : new Map([['yulong', { name: settings.name }]]))
  return { ...createMemoryCardRenderer(selectedCatalogue), calls }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
const rejection = (promise: Promise<unknown>, code: string) => expect(promise).rejects.toMatchObject({ name: 'ShanhaiMemoryCardError', code, friendlyMessage: expect.any(String) })
const body = (text: TextCall[]) => text.filter(item => item.y > 300 && item.y < 1328)
const titles = (text: TextCall[]) => text.filter(item => item.y >= 128 && item.y <= 240)
const flush = () => new Promise<void>(resolve => setImmediate(resolve))
function released(calls: ReturnType<typeof harness>['calls']) {
  expect(calls.canvases.every(canvas => canvas.width === 1 && canvas.height === 1)).toBe(true)
  expect(calls.instances.every(image => image.onload === null && image.onerror === null)).toBe(true)
}

describe('typed memory card renderer — controlled Canvas API evidence', () => {
  it('uses the injected catalogue, drops extra private metadata, and defaults to a hidden date', async () => {
    const { render, calls } = harness()
    const input = {
      ...base, placeName: 'caller-title/path', note: 'private-note', latitude: 27,
      get visits() { throw Error('The renderer must not read private records') },
      photos: [{ ...base.photos[0]!, get sourceMetadata() { throw Error('Private photo metadata') } }],
    }
    const result = await render(input)
    expect(titles(calls.text)).toEqual([{ text: '玉龙雪山', x: 72, y: 210, font: expect.stringMatching(/^64px /), width: 243.2 }])
    expect(result.filename).toBe('山海集-玉龙雪山-回忆卡.png')
    expect(calls.text.map(item => item.text).join('')).not.toMatch(/2026-09-05|caller-title|private/)
    expect(calls.images).toEqual([PHOTO])
  })

  it('fails closed for missing or inconsistent catalogues before allocating a canvas', async () => {
    for (const candidate of [null, {}, { has: () => true, get: () => undefined }, { has: () => true, get: () => ({ name: '' }) }]) {
      const { render, calls } = harness({ catalogue: candidate as CardCatalogue })
      // Undefined/null must be passed directly: harness uses a default catalogue.
      const operation = candidate === null ? createMemoryCardRenderer(candidate as unknown as CardCatalogue).render : render
      await rejection(operation(base), 'catalog-unavailable')
      expect(calls.canvases).toHaveLength(0)
      expect(calls.images).toHaveLength(0)
    }
  })

  it.each(['other', '__proto__', 'constructor', null, ['yulong']])('rejects unlisted place %j', async placeId => {
    const { render, calls } = harness()
    await rejection(render({ ...base, placeId } as MemoryCardInput), 'invalid-place')
    expect(calls.canvases).toHaveLength(0)
  })

  it('supports a custom catalogue and a text-only card without loading an illustration', async () => {
    const { render, calls } = harness({ name: '我的小院' })
    expect((await render({ ...base, photos: [], text: '记得风声。\n\n还记得雪。' })).filename).toBe('山海集-我的小院-回忆卡.png')
    expect(calls.images).toHaveLength(0)
    expect(body(calls.text).map(item => item.text)).toEqual(['记得风声。', '', '还记得雪。'])
  })

  it.each(['2025-02-29', '2026-02-30', '2026-13-01', '0000-01-01', '2026-9-5', '2026-09-05T00:00:00Z'])('rejects invalid literal date %s', async date => {
    const { render } = harness()
    await rejection(render({ ...base, date, showDate: true }), 'invalid-date')
  })

  it('shows only an explicitly enabled valid calendar date in the image and filename', async () => {
    const { render, calls } = harness()
    const result = await render({ ...base, date: '2024-02-29', showDate: true })
    expect(result.filename).toBe('山海集-玉龙雪山-2024-02-29-回忆卡.png')
    expect(calls.text.find(item => item.text === '2024-02-29')).toMatchObject({ x: 72, y: 268 })
    await rejection(render({ ...base, date: undefined, showDate: true }), 'invalid-date')
    await rejection(render({ ...base, showDate: 'false' } as unknown as MemoryCardInput), 'invalid-date')
  })

  it('rejects empty content, duplicate IDs, bad IDs, and over-selection', async () => {
    const { render } = harness()
    await rejection(render({ ...base, photos: [], text: ' \n ' }), 'empty')
    for (const photos of [[base.photos[0]!, base.photos[0]!], [{ id: '../private', url: PHOTO }], Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, url: PHOTO }))]) {
      await rejection(render({ ...base, photos }), 'invalid-photos')
    }
  })

  it.each([
    'https://example.invalid/p.png', 'blob:private', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/webp;base64,UklGRgAAAABXRUJQ', 'data:image/png;base64,not base64',
    'data:image/png;base64,abc', 'data:image/png;base64,====', 'data:image/png;name=p;base64,AAAA',
    'data:image/png;base64,' + 'A'.repeat(14000000),
  ])('rejects an unsupported or malformed photo URL before any image load (#%#)', async url => {
    const { render, calls } = harness()
    await rejection(render({ ...base, photos: [{ id: 'p', url }] }), 'invalid-photos')
    expect(calls.images).toHaveLength(0)
    expect(calls.canvases).toHaveLength(0)
  })

  it.each([0, 1, 2, 3])('preserves every character of 100-character and mixed text with %i photos', async count => {
    for (const text of ['山'.repeat(100), '😀'.repeat(100), 'abcdefghijklmnopqrstuvwxyz'.repeat(3) + '旅途😀回忆']) {
      const { render, calls } = harness()
      const input = { ...base, text, photos: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, url: PHOTO })) }
      const before = structuredClone(input)
      await render(input)
      const lines = body(calls.text)
      expect(lines.map(line => line.text).join('')).toBe(text)
      expect(lines.every(line => line.width <= 936 && line.y <= 1290)).toBe(true)
      expect(input).toEqual(before)
    }
  })

  it('rejects 101 Unicode codepoints and invisible control characters', async () => {
    const { render } = harness()
    for (const text of ['山'.repeat(101), '😀'.repeat(101), 'x\u0000y']) await rejection(render({ ...base, text }), 'invalid-text')
  })

  it('normalizes line separators while retaining blank lines, spaces and tabs', async () => {
    const { render, calls } = harness()
    await render({ ...base, photos: [], text: '一\r\n\r二\u2028三\u2029四\t五' })
    expect(body(calls.text).map(line => line.text)).toEqual(['一', '', '二', '三', '四    五'])
  })

  it.each([false, true])('keeps joined emoji, flags, tones and combining marks intact (fallback %s)', fallback => {
    if (fallback) vi.stubGlobal('Intl', {})
    expect(splitGraphemes('雪👨‍👩‍👧‍👦👍🏽🇨🇳é')).toEqual(['雪', '👨‍👩‍👧‍👦', '👍🏽', '🇨🇳', 'é'])
  })

  it('moves the preceding grapheme with closing punctuation at automatic wraps', async () => {
    for (const punctuation of Array.from('，。！？；：、）》】”')) {
      const { render, calls } = harness()
      const text = '山'.repeat(24) + '间' + punctuation + '再次出发。'
      await render({ ...base, text })
      const lines = body(calls.text)
      expect(lines.map(line => line.text).join('')).toBe(text)
      expect(lines[0]?.text).toBe('山'.repeat(24))
      expect(lines[1]?.text.startsWith('间')).toBe(true)
      expect(lines.every(line => !/^[，。！？；：、）》】”]/u.test(line.text) && line.width <= 936)).toBe(true)
    }
  })

  it('keeps consecutive closing marks and whole emoji together', async () => {
    const text = '山'.repeat(24) + '👨‍👩‍👧‍👦。！再次出发'
    const { render, calls } = harness({ metrics: (value, size) => splitGraphemes(value).length * size * 0.95 })
    await render({ ...base, text })
    expect(body(calls.text).map(line => line.text).join('')).toBe(text)
    expect(body(calls.text).every(line => !/^[。！]/u.test(line.text))).toBe(true)
    expect(body(calls.text).some(line => line.text.includes('👨‍👩‍👧‍👦。！'))).toBe(true)
  })

  it('preserves punctuation and blank lines at explicit paragraph starts', async () => {
    const { render, calls } = harness()
    await render({ ...base, photos: [], text: '山海\n，之间\n\n。' })
    expect(body(calls.text).map(line => line.text)).toEqual(['山海', '，之间', '', '。'])
  })

  it('retries smaller fonts for an oversized grapheme without splitting it', async () => {
    const cluster = '👨‍👩‍👧‍👦'
    const { render, calls } = harness({ metrics: (text, size) => text === cluster ? size * 30 : Array.from(text).length * size * 0.95 })
    await render({ ...base, text: cluster })
    expect(body(calls.text)).toEqual([{ text: cluster, x: 72, y: expect.any(Number), font: expect.stringMatching(/^30px /), width: 900 }])
  })

  it('fails excessive line breaks before decoding and releases its drawing buffer', async () => {
    const { render, calls } = harness()
    await rejection(render({ ...base, text: '山\n'.repeat(49) }), 'text-overflow')
    expect(calls.images).toHaveLength(0)
    released(calls)
  })

  it.each([1, 2, 3])('uses full originals with contain geometry in the %i-photo template', async count => {
    const { render, calls } = harness({ width: 100, height: 400 })
    await render({ ...base, photos: Array.from({ length: count }, (_, i) => ({ id: `p${i}`, url: i === 1 ? JPEG : PHOTO })) })
    expect(calls.images).toHaveLength(count)
    expect(calls.decodes).toBe(count)
    expect(calls.draws).toHaveLength(count)
    const frames = calls.fills.filter(call => call.color === '#F0F1E8')
    for (const [i, draw] of calls.draws.entries()) {
      expect(draw.args).toHaveLength(4) // image + four destination arguments, no cropped source.
      const [x, y, width, height] = draw.args as [number, number, number, number]
      const [bx, by, bw, bh] = frames[i]!.args as [number, number, number, number]
      expect(width / height).toBeCloseTo(0.25)
      expect(x).toBeCloseTo(bx + (bw - width) / 2)
      expect(y).toBeCloseTo(by + (bh - height) / 2)
      expect(x + width).toBeLessThanOrEqual(bx + bw)
      expect(y + height).toBeLessThanOrEqual(by + bh)
      expect(bx).toBeGreaterThanOrEqual(72)
      expect(by).toBeGreaterThanOrEqual(320)
      expect(bx + bw).toBeLessThanOrEqual(1008)
      expect(by + bh).toBeLessThan(1030)
    }
    released(calls)
  })

  it('exports the original 1080 by 1440 PNG tokens then releases its buffer', async () => {
    const { render, calls } = harness()
    const result = await render(base)
    expect(result).toMatchObject({ width: 1080, height: 1440, blob: expect.any(Blob) })
    expect(calls.blobs).toEqual([{ mime: 'image/png', width: 1080, height: 1440 }])
    expect(calls.fills[0]).toEqual({ color: '#FBF8EF', args: [0, 0, 1080, 1440] })
    expect(calls.draws[0]?.args).toEqual([72, 386.75, 936, 526.5])
    released(calls)
  })

  it('waits for local fonts before measuring or loading images', async () => {
    let resolveFonts!: () => void
    const { render, calls } = harness({ fontsReady: new Promise<void>(resolve => { resolveFonts = resolve }) })
    const result = render(base)
    await flush()
    expect(calls.images).toHaveLength(0)
    resolveFonts()
    await result
    expect(calls.images).toHaveLength(1)
  })

  it('accepts only an optional embedded WebP landmark and tolerates its failure', async () => {
    const valid = harness()
    await valid.render({ ...base, landmarkUrl: LANDMARK })
    expect(valid.calls.images).toEqual([PHOTO, LANDMARK])
    expect(valid.calls.draws).toHaveLength(2)
    for (const landmarkUrl of ['https://example.invalid/mountain.webp', 'data:image/svg+xml;base64,PHN2Zz4=', PHOTO, 'data:image/webp;base64,' + 'A'.repeat(2000000)]) {
      const { render, calls } = harness()
      await render({ ...base, landmarkUrl })
      expect(calls.images).toEqual([PHOTO])
    }
    const failed = harness({ landmarkError: true })
    await failed.render({ ...base, landmarkUrl: LANDMARK })
    expect(failed.calls.draws).toHaveLength(1)
    released(failed.calls)
  })

  it.each(['load-error', 'decode-error', 'src-throw'] as const)('makes image %s failure actionable and retryable', async imageMode => {
    const { render, calls } = harness({ imageMode })
    await rejection(render(base), 'image-decode')
    await rejection(render(base), 'image-decode')
    expect(calls.blobs).toHaveLength(0)
    released(calls)
  })

  it.each([0, -10, Number.NaN, Number.POSITIVE_INFINITY])('rejects decoded image dimension %s', async width => {
    const { render, calls } = harness({ width })
    await rejection(render(base), 'image-decode')
    released(calls)
  })

  it.each(['never-load', 'never-decode'] as const)('times out %s and clears timers, handlers and buffer', async imageMode => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { render, calls } = harness({ imageMode })
    const result = rejection(render(base), 'image-timeout')
    await flush()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(12000)
    await result
    expect(vi.getTimerCount()).toBe(0)
    released(calls)
  })

  it('cancels other pending photo decoders when one required photo fails', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { render, calls } = harness({ imageModes: ['load-error', 'never-load', 'never-decode'] })
    await rejection(render({ ...base, photos: [0, 1, 2].map(i => ({ id: `p${i}`, url: PHOTO })) }), 'image-decode')
    expect(vi.getTimerCount()).toBe(0)
    released(calls)
  })

  it.each(['null', 'wrong-type', 'empty', 'throw'] as const)('rejects PNG encoder %s with a retryable error', async blobMode => {
    const { render, calls } = harness({ blobMode })
    await rejection(render(base), 'export')
    await rejection(render(base), 'export')
    released(calls)
  })

  it('times out a stalled PNG encoder and releases its buffer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { render, calls } = harness({ blobMode: 'never' })
    const result = rejection(render(base), 'export-timeout')
    await flush()
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(12000)
    await result
    expect(vi.getTimerCount()).toBe(0)
    released(calls)
  })

  it('reports unavailable Canvas and image support clearly', async () => {
    const missingContext = harness({ contextMissing: true })
    await rejection(missingContext.render(base), 'unavailable')
    released(missingContext.calls)
    const missingImage = harness()
    vi.stubGlobal('Image', undefined)
    await rejection(missingImage.render(base), 'unavailable')
    vi.stubGlobal('document', undefined)
    await rejection(missingImage.render(base), 'unavailable')
  })

  it.each(['山'.repeat(60), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(2) + 'abcdefgh', '丽江👨‍👩‍👧‍👦白沙👍🏽'.repeat(4)])('keeps a long trusted title complete and inside the title box (#%#)', async name => {
    const { render, calls } = harness({ name })
    await render({ ...base, showDate: true, landmarkUrl: LANDMARK })
    const lines = titles(calls.text)
    expect(lines.map(line => line.text).join('')).toBe(name)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.every(line => line.x === 72 && line.width <= 720 && line.y <= 240)).toBe(true)
    expect(lines.every(line => Number(line.font.match(/\d+/)?.[0]) >= 28)).toBe(true)
    expect(calls.text.find(line => line.text === base.date)?.y).toBe(268)
  })

  it('fails an impossible title explicitly before image decoding, without clipping or ellipsis', async () => {
    for (const name of ['山\n'.repeat(29), '山'.repeat(600), '山\u0000海']) {
      const { render, calls } = harness({ name })
      await rejection(render(base), 'title-overflow')
      expect(calls.images).toHaveLength(0)
      expect(calls.blobs).toHaveLength(0)
      released(calls)
    }
  })

  it('retains the full displayed name but sanitizes filesystem-unsafe filename characters', async () => {
    const name = '../玉龙/雪山\\ :?*<>|". '
    const { render, calls } = harness({ name })
    const result = await render(base)
    expect(titles(calls.text).map(line => line.text).join('')).toBe(name)
    expect(result.filename).toMatch(/^山海集-.+-回忆卡\.png$/u)
    expect(result.filename).not.toMatch(/[<>:"/\\|?*\u0000-\u001F]/u)
    expect(new TextEncoder().encode(result.filename).length).toBeLessThan(255)
  })

  it('fails invalid font metrics explicitly instead of silently clipping', async () => {
    const { render, calls } = harness({ metrics: () => Number.NaN })
    await rejection(render({ ...base, text: '山海' }), 'layout')
    expect(calls.blobs).toHaveLength(0)
    released(calls)
  })

  it('renders the selection without contacting network, storage or the system share surface', async () => {
    const fetch = vi.fn(), xhr = vi.fn(), open = vi.fn(), getItem = vi.fn(), setItem = vi.fn(), share = vi.fn(), sendBeacon = vi.fn()
    vi.stubGlobal('fetch', fetch); vi.stubGlobal('XMLHttpRequest', xhr)
    vi.stubGlobal('indexedDB', { open })
    vi.stubGlobal('localStorage', { getItem, setItem }); vi.stubGlobal('sessionStorage', { getItem, setItem })
    vi.stubGlobal('navigator', { share, sendBeacon })
    const { render, calls } = harness()
    const result = await render({ ...base, text: '只带上明确选择的照片和文字' })
    expect(result.blob.type).toBe('image/png')
    expect(calls.images).toEqual([PHOTO])
    for (const effect of [fetch, xhr, open, getItem, setItem, share, sendBeacon]) expect(effect).not.toHaveBeenCalled()
  })
})
