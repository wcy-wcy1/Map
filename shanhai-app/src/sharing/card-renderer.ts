import type { CardCatalogue, MemoryCardInput, MemoryCardResult, RenderMemoryCard } from './card-types'

// A selected public payload enters; an independent, flattened PNG leaves.
const TOKENS = Object.freeze({
  width: 1080, height: 1440, margin: 72, gap: 20,
  paper: '#FBF8EF', ink: '#163D3A', muted: '#56685E', frame: '#F0F1E8', rule: '#CFD7C9',
  serif: '"Songti SC", "Noto Serif CJK SC", SimSun, serif',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
  imageTimeout: 12000, blobTimeout: 12000, maxPhotoUrl: 14000000, maxLandmarkUrl: 2000000,
  maxTextCodepoints: 100,
})
const CLOSING_PUNCTUATION = new Set(Array.from('，。！？；：、）》】”’〕〉」』〗〙〛％‰℃°…,.!?;:%)]}'))
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u

class MemoryCardError extends Error {
  readonly code: string
  readonly friendlyMessage: string
  constructor(code: string, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ShanhaiMemoryCardError'
    this.code = code
    this.friendlyMessage = message
  }
}

const failure = (code: string, message: string, cause?: unknown) => new MemoryCardError(code, message, cause)
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
interface Box { x: number; y: number; width: number; height: number }
interface FittedText { lines: string[]; fontSize: number; lineHeight: number }
interface Selection {
  placeName: string; date: string; showDate: boolean; text: string
  photos: { id: string; url: string }[]; landmarkUrl: string | null
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, '\n').replace(/[\u2028\u2029]/g, '\n').replace(/\t/g, '    ')
}

export function splitGraphemes(value: string): string[] {
  if (typeof value !== 'string') throw failure('invalid-text', '分享文字需要是文本。')
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    return Array.from(new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(value), item => item.segment)
  }
  // Compatibility fallback retains combining marks, flags, skin tones and joined emoji.
  const units: string[] = []
  let regionalRun = 0
  for (const point of Array.from(value)) {
    const code = point.codePointAt(0)!
    const mark = /\p{Mark}/u.test(point) || code === 0xFE0E || code === 0xFE0F ||
      (code >= 0x1F3FB && code <= 0x1F3FF) || (code >= 0xE0020 && code <= 0xE007F)
    const regional = code >= 0x1F1E6 && code <= 0x1F1FF
    const previous = units.at(-1)
    if (previous && (mark || point === '\u200D' || previous.endsWith('\u200D') || (regional && regionalRun % 2 === 1))) {
      units[units.length - 1] = previous + point
    } else units.push(point)
    regionalRun = regional ? regionalRun + 1 : 0
  }
  return units
}

function measuredWidth(context: CanvasRenderingContext2D, text: string): number {
  const width = context.measureText(text).width
  if (!Number.isFinite(width) || width < 0) throw failure('layout', '图片排版暂不可用，请重新生成。')
  return width
}

function wrapText(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  for (const paragraph of normalizeText(text).split('\n')) {
    if (!paragraph) { lines.push(''); continue }
    let current = ''
    for (const grapheme of splitGraphemes(paragraph)) {
      if (measuredWidth(context, grapheme) > maxWidth) {
        throw failure('text-overflow', '这一段文字无法完整排入图片，请缩短文字后重试。')
      }
      const candidate = current + grapheme
      if (current && measuredWidth(context, candidate) > maxWidth) {
        if (CLOSING_PUNCTUATION.has(Array.from(grapheme)[0]!)) {
          // Carry a whole prior grapheme so soft breaks do not strand closing punctuation.
          const previous = splitGraphemes(current)
          let breakAt = previous.length - 1
          while (breakAt > 0 && (CLOSING_PUNCTUATION.has(Array.from(previous[breakAt]!)[0]!) || /^\s+$/u.test(previous[breakAt]!))) breakAt--
          const carried = previous.slice(breakAt).join('') + grapheme
          if (breakAt === 0 || measuredWidth(context, carried) > maxWidth) {
            throw failure('text-overflow', '这一段文字无法完整排入图片，请缩短文字后重试。')
          }
          lines.push(previous.slice(0, breakAt).join(''))
          current = carried
        } else {
          lines.push(current)
          current = grapheme
        }
      } else current = candidate
    }
    lines.push(current)
  }
  return lines
}

function realDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const parsed = new Date(value + 'T12:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function validDataImage(value: unknown, kind: 'photo' | 'landmark'): value is string {
  if (typeof value !== 'string' || !value.length || value.length > (kind === 'landmark' ? TOKENS.maxLandmarkUrl : TOKENS.maxPhotoUrl)) return false
  const match = value.match(kind === 'landmark'
    ? /^data:image\/webp;base64,([A-Za-z0-9+/]+={0,2})$/
    : /^data:image\/(?:jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/)
  return !!match && match[1]!.length % 4 === 0
}

function validateInput(input: unknown, catalogue: CardCatalogue): Selection {
  if (!catalogue || typeof catalogue.has !== 'function' || typeof catalogue.get !== 'function') {
    throw failure('catalog-unavailable', '景点目录尚未加载，暂时无法制作回忆卡，请稍后重试。')
  }
  if (!isRecord(input) || typeof input.placeId !== 'string' || !catalogue.has(input.placeId)) {
    throw failure('invalid-place', '当前版本尚不支持这个地点，请选择已支持景点的回忆。')
  }
  const place = catalogue.get(input.placeId)
  if (!place || typeof place.name !== 'string' || !place.name.trim()) {
    throw failure('catalog-unavailable', '景点目录无法读取，暂时无法制作回忆卡，请稍后重试。')
  }
  if (input.showDate !== undefined && typeof input.showDate !== 'boolean') throw failure('invalid-date', '请重新选择是否显示日期。')
  const showDate = input.showDate === true
  if ((input.date !== undefined && !realDate(input.date)) || (showDate && !realDate(input.date))) {
    throw failure('invalid-date', '到访日期无效，请使用有效的年月日。')
  }
  const rawText = input.text === undefined ? '' : input.text
  if (typeof rawText !== 'string' || Array.from(rawText).length > TOKENS.maxTextCodepoints) {
    throw failure('invalid-text', '分享文字最多100字，请缩短后重试。')
  }
  const text = normalizeText(rawText)
  if (CONTROL_CHARACTERS.test(text)) throw failure('invalid-text', '分享文字含有无法显示的控制字符，请移除后重试。')
  if (!Array.isArray(input.photos) || input.photos.length > 3) throw failure('invalid-photos', '每张回忆卡最多选择3张照片。')
  const ids = new Set<string>()
  const photos = input.photos.map((photo: unknown) => {
    if (!isRecord(photo) || typeof photo.id !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(photo.id) || ids.has(photo.id) || !validDataImage(photo.url, 'photo')) {
      throw failure('invalid-photos', '照片无效，请重新选择本次回忆中的JPEG或PNG照片。')
    }
    ids.add(photo.id)
    return { id: photo.id, url: photo.url }
  })
  if (!photos.length && !text.trim()) throw failure('empty', '请至少选择一张照片，或写下一句分享文字。')
  return {
    placeName: place.name, date: showDate && typeof input.date === 'string' ? input.date : '', showDate, text, photos,
    // Do not load unsupported decorative URLs. Only authored WebP is accepted here.
    landmarkUrl: validDataImage(input.landmarkUrl, 'landmark') ? input.landmarkUrl : null,
  }
}

function containRect(sourceWidth: number, sourceHeight: number, box: Box): Box {
  if (![sourceWidth, sourceHeight, box.x, box.y, box.width, box.height].every(Number.isFinite) ||
    sourceWidth <= 0 || sourceHeight <= 0 || box.width <= 0 || box.height <= 0) {
    throw failure('image-size', '这张照片的尺寸无法读取，请重新选择照片。')
  }
  const ratio = Math.min(box.width / sourceWidth, box.height / sourceHeight)
  const width = sourceWidth * ratio
  const height = sourceHeight * ratio
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height }
}

function layoutFor(photoCount: number) {
  const photoBoxes: Box[] = []
  const x = TOKENS.margin
  const width = TOKENS.width - x * 2
  const top = 320
  const half = (width - TOKENS.gap) / 2
  if (photoCount === 1) photoBoxes.push({ x, y: top, width, height: 660 })
  if (photoCount === 2) photoBoxes.push({ x, y: top, width: half, height: 660 }, { x: x + half + TOKENS.gap, y: top, width: half, height: 660 })
  if (photoCount === 3) photoBoxes.push({ x, y: top, width, height: 412 },
    { x, y: top + 432, width: half, height: 228 }, { x: x + half + TOKENS.gap, y: top + 432, width: half, height: 228 })
  return {
    brand: { x, y: 102 }, title: { x, y: 128, width: 720, height: 112 }, date: { x, y: 268 },
    landmark: { x: 860, y: 58, width: 148, height: 166 }, photoBoxes,
    text: { x, y: photoCount ? 1030 : 400, width, height: photoCount ? 260 : 810 },
    footer: { x, y: 1374, ruleY: 1328, width },
  }
}

function fitText(context: CanvasRenderingContext2D, text: string, box: Box, photoCount: number): FittedText {
  if (!text) return { lines: [], fontSize: photoCount ? 38 : 60, lineHeight: 0 }
  for (let size = photoCount ? 38 : 60; size >= (photoCount ? 26 : 32); size -= 2) {
    context.font = `${size}px ${TOKENS.serif}`
    let lines: string[]
    try { lines = wrapText(context, text, box.width) }
    catch (error) {
      if (error instanceof MemoryCardError && error.code === 'text-overflow') continue
      throw error
    }
    const lineHeight = Math.ceil(size * 1.52)
    if (lines.length * lineHeight <= box.height) return { lines, fontSize: size, lineHeight }
  }
  throw failure('text-overflow', '换行太多，文字无法完整排入图片。请减少空行或缩短文字后重试。')
}

function fitTitle(context: CanvasRenderingContext2D, name: string, box: Box): FittedText & { baseline: number } {
  const text = normalizeText(name)
  if (CONTROL_CHARACTERS.test(text)) throw failure('title-overflow', '地点名称含有无法显示的字符，请修改地点名称后重试。')
  // The original 64px / 210 baseline remains exact for ordinary catalogue names.
  context.font = `64px ${TOKENS.serif}`
  if (!text.includes('\n') && measuredWidth(context, text) <= box.width) return { lines: [text], fontSize: 64, lineHeight: 0, baseline: 210 }
  for (let size = 62; size >= 28; size -= 2) {
    context.font = `${size}px ${TOKENS.serif}`
    let lines: string[]
    try { lines = wrapText(context, text, box.width) }
    catch (error) {
      if (error instanceof MemoryCardError && error.code === 'text-overflow') continue
      throw error
    }
    const lineHeight = Math.ceil(size * 1.2)
    if (lines.length * lineHeight <= box.height) {
      return { lines, fontSize: size, lineHeight, baseline: box.y + size }
    }
  }
  throw failure('title-overflow', '地点名称无法完整排入图片，请减少换行或缩短地点名称后重试。')
}

function safeFilename(name: string, date: string): string {
  const clean = name.replace(/[<>:"/\\|?*\u0000-\u001F\u007F\u202A-\u202E\u2066-\u2069]/gu, '-')
    .replace(/\s+/gu, ' ').replace(/^[. ]+|[. ]+$/gu, '')
  // Keep portable filename length bounded without cutting a Unicode grapheme.
  let safe = ''
  const encoder = new TextEncoder()
  for (const grapheme of splitGraphemes(clean)) {
    if (encoder.encode(safe + grapheme).length > 180) break
    safe += grapheme
  }
  return `山海集-${safe || '地点'}${date ? '-' + date : ''}-回忆卡.png`
}

function loadImage(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    if (typeof Image !== 'function') { reject(failure('unavailable', '当前浏览器不能生成图片，请换用支持图片绘制的浏览器。')); return }
    const img = new Image()
    let settled = false
    const finish = (error?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      img.onload = null
      img.onerror = null
      if (error) reject(error)
      else resolve(img)
    }
    const abort = () => finish(failure('image-cancelled', '图片生成已结束，请重新生成。'))
    const timer = setTimeout(() => finish(failure('image-timeout', '照片读取超时，请稍后重新生成。')), TOKENS.imageTimeout)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) { abort(); return }
    img.onerror = () => finish(failure('image-decode', '有照片无法读取，请重新选择照片后生成。'))
    img.onload = async () => {
      if (settled) return
      try {
        if (typeof img.decode === 'function') await img.decode()
        if (!Number.isFinite(img.naturalWidth) || !Number.isFinite(img.naturalHeight) || img.naturalWidth <= 0 || img.naturalHeight <= 0) {
          throw failure('image-size', '有照片的尺寸无效，请重新选择照片。')
        }
        finish()
      } catch (error) { finish(failure('image-decode', '有照片无法完整解码，请重新选择照片后生成。', error)) }
    }
    try { img.src = url }
    catch (error) { finish(failure('image-decode', '照片读取失败，请重新选择照片后生成。', error)) }
  })
}

function encodePng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: unknown, blob?: Blob) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else if (blob) resolve(blob)
    }
    const timer = setTimeout(() => finish(failure('export-timeout', '图片生成超时，请重新生成。')), TOKENS.blobTimeout)
    try {
      canvas.toBlob(blob => {
        if (!blob || !blob.size || blob.type !== 'image/png') finish(failure('export', '图片暂时无法生成，请重新生成。'))
        else finish(undefined, blob)
      }, 'image/png')
    } catch (error) { finish(failure('export', '图片暂时无法生成，请重新生成。', error)) }
  })
}

export function createMemoryCardRenderer(catalogue: CardCatalogue): { render: RenderMemoryCard } {
  const render = async (input: MemoryCardInput): Promise<MemoryCardResult> => {
    const selected = validateInput(input, catalogue)
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      throw failure('unavailable', '当前环境不能生成图片，请在试用页中打开。')
    }
    const canvas = document.createElement('canvas')
    const images = new AbortController()
    canvas.width = TOKENS.width
    canvas.height = TOKENS.height
    try {
      const context = canvas.getContext('2d', { alpha: false })
      if (!context || typeof canvas.toBlob !== 'function') throw failure('unavailable', '当前浏览器不能生成图片，请换用支持图片绘制的浏览器。')
      const layout = layoutFor(selected.photos.length)
      if (document.fonts?.ready) await document.fonts.ready
      const fitted = fitText(context, selected.text, layout.text, selected.photos.length)
      const title = fitTitle(context, selected.placeName, layout.title)
      const [photos, landmark] = await Promise.all([
        Promise.all(selected.photos.map(photo => loadImage(photo.url, images.signal))),
        selected.landmarkUrl ? loadImage(selected.landmarkUrl, images.signal).catch(() => null) : null,
      ])
      context.fillStyle = TOKENS.paper
      context.fillRect(0, 0, TOKENS.width, TOKENS.height)
      context.textAlign = 'left'
      context.textBaseline = 'alphabetic'
      context.fillStyle = TOKENS.muted
      context.font = `28px ${TOKENS.serif}`
      context.fillText('山海集', layout.brand.x, layout.brand.y)
      context.fillStyle = TOKENS.ink
      context.font = `${title.fontSize}px ${TOKENS.serif}`
      title.lines.forEach((line, index) => context.fillText(line, layout.title.x, title.baseline + index * title.lineHeight))
      if (landmark) {
        const rect = containRect(landmark.naturalWidth, landmark.naturalHeight, layout.landmark)
        context.drawImage(landmark, rect.x, rect.y, rect.width, rect.height)
      }
      if (selected.showDate) {
        context.fillStyle = TOKENS.muted
        context.font = `26px ${TOKENS.sans}`
        context.fillText(selected.date, layout.date.x, layout.date.y)
      }
      context.imageSmoothingEnabled = true
      context.imageSmoothingQuality = 'high'
      photos.forEach((photo, index) => {
        const box = layout.photoBoxes[index]!
        context.fillStyle = TOKENS.frame
        context.fillRect(box.x, box.y, box.width, box.height)
        const rect = containRect(photo.naturalWidth, photo.naturalHeight, box)
        // Five arguments draw the entire source photograph without cropping.
        context.drawImage(photo, rect.x, rect.y, rect.width, rect.height)
      })
      context.fillStyle = TOKENS.ink
      context.font = `${fitted.fontSize}px ${TOKENS.serif}`
      fitted.lines.forEach((line, index) => context.fillText(line, layout.text.x, layout.text.y + fitted.fontSize + index * fitted.lineHeight))
      context.strokeStyle = TOKENS.rule
      context.lineWidth = 1.5
      context.beginPath()
      context.moveTo(layout.footer.x, layout.footer.ruleY)
      context.lineTo(layout.footer.x + layout.footer.width, layout.footer.ruleY)
      context.stroke()
      context.fillStyle = TOKENS.muted
      context.font = `24px ${TOKENS.serif}`
      context.fillText('旅行回忆', layout.footer.x, layout.footer.y)
      const blob = await encodePng(canvas)
      return { blob, width: TOKENS.width, height: TOKENS.height, filename: safeFilename(selected.placeName, selected.date) }
    } catch (error) {
      if (error instanceof MemoryCardError) throw error
      throw failure('render', '回忆卡暂时无法生成，请稍后重新生成。', error)
    } finally {
      images.abort()
      canvas.width = 1
      canvas.height = 1
    }
  }
  return Object.freeze({ render })
}
