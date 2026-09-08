import type { Geography } from '../domain/models'
import { getProvince, nationalGeography, yunnanBoundary } from '../domain/provinces'

function unavailable(message: string) {
  return Object.assign(new Error(message), { code: 'geography-unavailable', friendlyMessage: message })
}
const cancelled = () => new DOMException('地图读取已取消。', 'AbortError')

/** Public, checked-in geography only. Base boundaries remain available offline;
 * the much larger Yunnan water/prefecture layer is requested on entering Yunnan.
 * No catalogue, record or photo data is changed by this loader. */
export function createGeographyService(options: { loadYunnan?: () => Promise<Geography> } = {}) {
  let networkController: AbortController | undefined
  // A failed dynamic import is cached as a module failure in some browsers.
  // A fixed same-origin data request can actually be retried after connectivity
  // returns, without reloading an editor or discarding its current inputs.
  const loadYunnan = options.loadYunnan ?? (async () => {
    const controller = new AbortController(); networkController = controller
    const timeout = setTimeout(() => controller.abort(), 15_000)
    try {
      const response = await fetch('/data/yunnan-geography.geojson', { cache: 'no-cache', signal: controller.signal })
      if (!response.ok) throw new Error('Geography request failed')
      const text = await response.text()
      if (text.length > 4 * 1024 * 1024) throw new Error('Geography exceeds the approved data budget')
      return JSON.parse(text) as Geography
    } finally { clearTimeout(timeout); if (networkController === controller) networkController = undefined }
  })
  const bases = new Map<string, Geography>([['', nationalGeography], ['yunnan', yunnanBoundary]])
  const callers = new Set<() => void>()
  let closed = false, pending: Promise<Geography> | undefined, cached: Geography | undefined

  function base(provinceId: string): Geography {
    if (closed) throw cancelled()
    if (provinceId && !getProvince(provinceId)) throw unavailable('这个地区尚未配置，地图没有切换。')
    if (!bases.has(provinceId)) {
      const features = nationalGeography.features.filter(feature => feature.properties.provinceId === provinceId)
      if (!features.length) throw unavailable('这个地区的轮廓暂时无法读取。')
      bases.set(provinceId, { type: 'FeatureCollection', features })
    }
    return bases.get(provinceId)!
  }

  function load(provinceId: string, { signal }: { signal?: AbortSignal } = {}): Promise<Geography> {
    if (closed || signal?.aborted) return Promise.reject(cancelled())
    let outline: Geography
    try { outline = base(provinceId) } catch (error) { return Promise.reject(error) }
    if (provinceId !== 'yunnan') return Promise.resolve(outline)
    if (!pending) {
      pending = cached ? Promise.resolve(cached) : Promise.resolve().then(loadYunnan).then(data => {
        if (!data || data.type !== 'FeatureCollection' || !data.features?.some(feature => feature.properties?.kind === 'province')) {
          throw unavailable('云南细节数据不完整，已保留省区轮廓。请重试。')
        }
        if (!closed) cached = data
        return data
      }).catch(() => { throw unavailable('云南细节暂时无法加载，已保留省区轮廓与回忆。请重试。') })
      const task = pending
      // A rejected chunk request must not permanently poison subsequent retries.
      void task.finally(() => { if (pending === task) pending = undefined }).catch(() => {})
    }
    const task = pending
    return new Promise<Geography>((resolve, reject) => {
      let settled = false
      const finish = (error?: unknown, value?: Geography) => {
        if (settled) return
        settled = true; signal?.removeEventListener('abort', abort); callers.delete(abort)
        if (error) reject(error); else resolve(value!)
      }
      const abort = () => finish(cancelled())
      callers.add(abort); signal?.addEventListener('abort', abort, { once: true })
      task.then(data => closed || signal?.aborted ? abort() : finish(undefined, data), error => finish(error))
    })
  }

  return { base, load, close() { closed = true; networkController?.abort(); for (const abort of [...callers]) abort(); cached = undefined; bases.clear() } }
}
