import type { Photo } from '../domain/models'

export const MAX_PHOTOS = 9
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024
export interface PhotoFailure { name: string; message: string }
export interface PhotoImportResult { photos: Photo[]; errors: PhotoFailure[] }
export interface PhotoImportOptions {
  existingCount?: number
  signal?: AbortSignal
  onProgress?: (progress: { completed: number; total: number }) => void
}
export function secureId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return prefix + globalThis.crypto.randomUUID()
  if (!globalThis.crypto?.getRandomValues) throw new Error('浏览器暂时无法安全创建记录编号，请保留当前页面后重试。')
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16))
  return prefix + Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}
function checkpoint(signal?: AbortSignal) { if (signal?.aborted) throw new DOMException('已取消照片处理', 'AbortError') }
function photoType(bytes: Uint8Array, size: number): string | null {
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.slice(offset, offset + length))
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg'
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) return 'image/png'
  if (bytes.length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12, 4))) return 'image/webp'
  if (bytes.length >= 16 && ascii(4, 4) === 'ftyp') {
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0)
    if (length < 16 || length > size || length > bytes.length || length % 4) return null
    const brands = [ascii(8, 4)]
    for (let offset = 16; offset < length; offset += 4) brands.push(ascii(offset, 4))
    if (brands.includes('avif') || brands.includes('avis')) return null
    if (brands.some(brand => ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand))) return 'image/heic'
  }
  return null
}
async function header(file: File): Promise<Uint8Array> {
  const blob = file.slice(0, 512)
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer())
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => reader.result instanceof ArrayBuffer ? resolve(new Uint8Array(reader.result)) : reject(new Error('照片文件无法读取。'))
    reader.onerror = () => reject(new Error('照片文件无法读取。'))
    reader.readAsArrayBuffer(blob)
  })
}
async function convert(file: File, type: string, signal?: AbortSignal): Promise<Photo> {
  const failure = type === 'image/heic' ? '当前浏览器无法读取这张 HEIC / HEIF 照片，请先导出为 JPEG 后再添加。' : '无法读取这张照片，文件可能已损坏。请重新选择或导出为 JPEG 后再试。'
  const url = URL.createObjectURL(file.slice(0, file.size, type))
  const picture = new Image()
  let canvas: HTMLCanvasElement | undefined
  try {
    picture.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      let done = false
      const finish = (error?: Error) => {
        if (done) return
        done = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        picture.onload = null
        picture.onerror = null
        if (error) reject(error); else resolve()
      }
      const abort = () => finish(new DOMException('已取消照片处理', 'AbortError'))
      const timer = setTimeout(() => finish(new Error('照片读取超时，请选择较小的照片后再试。')), 30000)
      picture.onload = () => finish()
      picture.onerror = () => finish(new Error(failure))
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) abort(); else picture.src = url
    })
    checkpoint(signal)
    const width = picture.naturalWidth, height = picture.naturalHeight
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) throw new Error(failure)
    const scale = Math.min(1, 2000 / Math.max(width, height))
    canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器暂时无法处理照片，请关闭其他页面后重试。')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(picture, 0, 0, canvas.width, canvas.height)
    // Only canvas-generated JPEG is retained. Original EXIF and GPS metadata
    // never enter the stored photo; the source File is never changed or uploaded.
    const output = canvas.toDataURL('image/jpeg', 0.86)
    if (!output.startsWith('data:image/jpeg;base64,/9j/')) throw new Error('照片转换失败，请导出为 JPEG 后再试。')
    const body = output.slice(23)
    const bytes = body.length / 4 * 3 - (body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0)
    if (bytes <= 0 || bytes > MAX_PHOTO_BYTES) throw new Error('处理后的照片仍超过 10 MiB，请选择较小的照片。')
    checkpoint(signal)
    return { id: secureId('photo-'), name: file.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || '未命名照片', url: output }
  } finally {
    picture.onload = null; picture.onerror = null; picture.src = ''
    if (canvas) { canvas.width = 0; canvas.height = 0 }
    URL.revokeObjectURL(url)
  }
}
export async function importPhotos(files: Iterable<File>, { existingCount = 0, signal, onProgress }: PhotoImportOptions = {}): Promise<PhotoImportResult> {
  const result: PhotoImportResult = { photos: [], errors: [] }, selected = Array.from(files)
  if (!Number.isInteger(existingCount) || existingCount < 0 || existingCount > MAX_PHOTOS) throw new Error('当前照片数量异常，请保留当前页面后重试。')
  if (selected.length + existingCount > MAX_PHOTOS) return { photos: [], errors: [{ name: '所选照片', message: `每条回忆最多 9 张照片，当前还可添加 ${9 - existingCount} 张。本次未添加任何照片，请重新选择。` }] }
  // Deliberately sequential: a damaged file does not discard earlier successes,
  // and only one original image/canvas is live while processing a selection.
  for (const [index, file] of selected.entries()) {
    checkpoint(signal)
    try {
      if (file.size === 0) throw new Error('这张照片是空文件，请重新选择。')
      if (file.size > MAX_PHOTO_BYTES) throw new Error('单张照片不能超过 10 MiB，请选择较小的照片。')
      const type = photoType(await header(file), file.size)
      checkpoint(signal)
      if (!type) throw new Error('不支持这个文件格式。请使用 JPEG、PNG、WebP，或浏览器可读取的 HEIC / HEIF 照片；不接受 GIF、SVG。')
      result.photos.push(await convert(file, type, signal))
    } catch (cause) {
      checkpoint(signal)
      result.errors.push({ name: file.name, message: cause instanceof Error ? cause.message : '照片处理失败，请重新选择。' })
    }
    try { onProgress?.({ completed: index + 1, total: selected.length }) } catch { /* Progress cannot discard decoded photos. */ }
  }
  return result
}
