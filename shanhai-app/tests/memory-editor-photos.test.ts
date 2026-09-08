import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { importPhotos, MAX_PHOTO_BYTES } from '../src/editor/photos'

const jpeg = new Uint8Array([255, 216, 255, 224, 0, 0, 0, 0])
const encoded = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='
let latestImage: MockImage | undefined, liveImages = 0, maxLiveImages = 0, failImage = false, pending = false
class MockImage {
  decoding = ''
  naturalWidth = 4000
  naturalHeight = 3000
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  set src(value: string) {
    if (!value) { liveImages = Math.max(0, liveImages - 1); return }
    latestImage = this; liveImages++; maxLiveImages = Math.max(maxLiveImages, liveImages)
    if (!pending) queueMicrotask(() => { if (failImage) this.onerror?.(); else this.onload?.() })
  }
}
let draw: ReturnType<typeof vi.fn>, createUrl: ReturnType<typeof vi.fn>, revoke: ReturnType<typeof vi.fn>
beforeEach(() => {
  latestImage = undefined; liveImages = 0; maxLiveImages = 0; failImage = false; pending = false
  createUrl = vi.fn(() => 'blob:local-photo'); revoke = vi.fn(); draw = vi.fn()
  vi.stubGlobal('Image', MockImage)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ({ fillStyle: '', fillRect: vi.fn(), drawImage: draw })) as unknown as typeof HTMLCanvasElement.prototype.getContext)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(encoded)
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers() })
describe('native local-only photo import', () => {
  it('inspects bytes rather than extension/MIME and outputs resized JPEG with safe name', async () => {
    const file = new File([jpeg], '\u0000风景.png', { type: 'text/plain' })
    const result = await importPhotos([file])
    expect(result.errors).toEqual([])
    expect(result.photos[0]).toMatchObject({ name: '风景.png', url: encoded })
    expect(draw.mock.calls[0]?.slice(1)).toEqual([0, 0, 2000, 1500])
    expect(createUrl.mock.calls[0]?.[0].type).toBe('image/jpeg')
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.86)
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:local-photo')
    expect(file.size).toBe(jpeg.length)
  })
  it('processes sequentially, keeps successes beside invalid files, and ignores progress callback exceptions', async () => {
    const result = await importPhotos([new File([jpeg], 'one.jpg'), new File(['<svg/>'], 'wrong.jpg'), new File([jpeg], 'two.jpg')], { onProgress: () => { throw new Error('presentation failed') } })
    expect(result.photos).toHaveLength(2); expect(result.errors[0]?.name).toBe('wrong.jpg')
    expect(result.errors[0]?.message).toContain('不支持这个文件格式')
    expect(maxLiveImages).toBe(1); expect(revoke).toHaveBeenCalledTimes(2)
  })
  it('rejects more than the remaining nine slots without decoding any selected file', async () => {
    const result = await importPhotos([new File([jpeg], 'one.jpg'), new File([jpeg], 'two.jpg')], { existingCount: 8 })
    expect(result.photos).toEqual([]); expect(result.errors[0]?.message).toContain('本次未添加任何照片')
    expect(createUrl).not.toHaveBeenCalled()
  })
  it('rejects empty and oversized originals before allocating an object URL', async () => {
    const oversized = new File([jpeg], 'large.jpg')
    Object.defineProperty(oversized, 'size', { value: MAX_PHOTO_BYTES + 1 })
    const result = await importPhotos([new File([], 'empty.jpg'), oversized])
    expect(result.errors.map(error => error.message)).toEqual(['这张照片是空文件，请重新选择。', '单张照片不能超过 10 MiB，请选择较小的照片。'])
    expect(createUrl).not.toHaveBeenCalled()
  })
  it('accepts native-decodable HEIC headers but explains a browser decode failure', async () => {
    const heic = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 104, 101, 105, 99, 0, 0, 0, 0, 109, 105, 102, 49])
    failImage = true
    const result = await importPhotos([new File([heic], 'iphone.heic')])
    expect(result.photos).toEqual([]); expect(result.errors[0]?.message).toContain('当前浏览器无法读取这张 HEIC / HEIF')
    expect(revoke).toHaveBeenCalledTimes(1)
  })
  it('rejects AVIF containers, SVG and zero decoded dimensions', async () => {
    const avif = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0, 109, 105, 102, 49])
    const formats = await importPhotos([new File([avif], 'x.heic'), new File(['<svg/>'], 'x.svg')])
    expect(formats.errors).toHaveLength(2); expect(createUrl).not.toHaveBeenCalled()
    pending = true
    const importing = importPhotos([new File([jpeg], 'broken.jpg')])
    await vi.waitFor(() => expect(latestImage).toBeDefined())
    latestImage!.naturalWidth = 0; latestImage!.onload?.()
    expect((await importing).errors[0]?.message).toContain('无法读取这张照片')
    expect(draw).not.toHaveBeenCalled(); expect(revoke).toHaveBeenCalledTimes(1)
  })
  it('aborts an in-flight decode, releases the object URL, and rejects rather than reporting partial success', async () => {
    pending = true
    const controller = new AbortController(), importing = importPhotos([new File([jpeg], 'wait.jpg')], { signal: controller.signal })
    const rejected = expect(importing).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(latestImage).toBeDefined())
    controller.abort(); await rejected
    expect(revoke).toHaveBeenCalledTimes(1); expect(latestImage!.onload).toBeNull(); expect(draw).not.toHaveBeenCalled()
  })
  it('rejects a non-JPEG canvas result and still releases decode resources', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toDataURL).mockReturnValue('data:,')
    const result = await importPhotos([new File([jpeg], 'source.jpg')])
    expect(result.photos).toEqual([]); expect(result.errors[0]?.message).toContain('照片转换失败')
    expect(revoke).toHaveBeenCalledTimes(1)
  })
})
