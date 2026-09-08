import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGeographyService } from '../src/services/geography-service'
import { nationalGeography, yunnanBoundary } from '../src/domain/provinces'
import type { Geography } from '../src/domain/models'

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
afterEach(() => vi.unstubAllGlobals())
describe('region-specific public geography loading', () => {
  it('the actual default loader retries the same-origin JSON URL after an HTTP failure', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(yunnanBoundary) })
    vi.stubGlobal('fetch', fetcher)
    const service = createGeographyService()
    await expect(service.load('yunnan')).rejects.toMatchObject({ code: 'geography-unavailable' })
    expect(await service.load('yunnan')).toEqual(yunnanBoundary)
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const call of fetcher.mock.calls) expect(call).toEqual(['/data/yunnan-geography.geojson', { cache: 'no-cache', signal: expect.any(AbortSignal) }])
    service.close()
  })
  it('shows nationwide and external-province boundaries without requesting detailed Yunnan data', async () => {
    const loader = vi.fn(), service = createGeographyService({ loadYunnan: loader })
    expect(service.base('')).toBe(nationalGeography)
    expect(service.base('yunnan')).toBe(yunnanBoundary)
    expect((await service.load('cn-51')).features).toHaveLength(1)
    expect((await service.load('cn-11')).features[0]?.properties.provinceId).toBe('cn-11')
    expect(await service.load('')).toBe(nationalGeography)
    expect(loader).not.toHaveBeenCalled()
    expect(() => service.base('../../private')).toThrow()
    await expect(service.load('unknown')).rejects.toMatchObject({ code: 'geography-unavailable' })
    service.close()
  })
  it('loads Yunnan on demand, shares work and reuses the successful result', async () => {
    const work = deferred<Geography>(), loader = vi.fn(() => work.promise)
    const service = createGeographyService({ loadYunnan: loader })
    const first = service.load('yunnan'), second = service.load('yunnan')
    await Promise.resolve(); expect(loader).toHaveBeenCalledTimes(1)
    work.resolve(yunnanBoundary)
    expect(await first).toBe(yunnanBoundary); expect(await second).toBe(yunnanBoundary)
    expect(await service.load('yunnan')).toBe(yunnanBoundary)
    expect(loader).toHaveBeenCalledTimes(1)
    service.close()
  })
  it('does not let one cancelled region request cancel a shared request', async () => {
    const work = deferred<Geography>(), service = createGeographyService({ loadYunnan: () => work.promise })
    const controller = new AbortController(), first = service.load('yunnan', { signal: controller.signal })
    const second = service.load('yunnan')
    controller.abort(); await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    work.resolve(yunnanBoundary); expect(await second).toBe(yunnanBoundary)
    service.close()
  })
  it('retries a failed detail request without losing the usable base boundary', async () => {
    const loader = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue(yunnanBoundary)
    const service = createGeographyService({ loadYunnan: loader })
    await expect(service.load('yunnan')).rejects.toMatchObject({ code: 'geography-unavailable' })
    expect(service.base('yunnan')).toBe(yunnanBoundary)
    expect(await service.load('yunnan')).toBe(yunnanBoundary)
    expect(loader).toHaveBeenCalledTimes(2)
    service.close()
  })
  it('close settles active callers and rejects later work, including late chunk resolution', async () => {
    const work = deferred<Geography>(), service = createGeographyService({ loadYunnan: () => work.promise })
    const result = service.load('yunnan'); service.close()
    await expect(result).rejects.toMatchObject({ name: 'AbortError' })
    work.resolve(yunnanBoundary); await Promise.resolve()
    await expect(service.load('cn-11')).rejects.toMatchObject({ name: 'AbortError' })
    expect(() => service.base('')).toThrow()
  })
  it('does not start an already cancelled read and rejects invalid detail data', async () => {
    const loader = vi.fn(async () => ({ type: 'FeatureCollection', features: [] }) as Geography)
    const service = createGeographyService({ loadYunnan: loader }), controller = new AbortController()
    controller.abort()
    await expect(service.load('yunnan', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(loader).not.toHaveBeenCalled()
    await expect(service.load('yunnan')).rejects.toMatchObject({ code: 'geography-unavailable' })
    service.close()
  })
})
