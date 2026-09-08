// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { webcrypto } from 'node:crypto'
import { createCatalogue, normalizeCustomPlace, provinceForRegion } from '../src/domain/catalogue'
import { filter } from '../src/domain/map-layout'
import { createTravelServices, DATABASE_VERSION } from '../src/services/travel-services'
import type { TravelPlatform } from '../src/services/contracts'
import type { Coordinates, Draft, Snapshot, Visit } from '../src/domain/models'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
const services: ReturnType<typeof createTravelServices>[] = []
function harness(indexedDB = new IDBFactory(), dbName = 'national-test') {
  const platform: TravelPlatform = { indexedDB, IDBKeyRange, crypto: webcrypto as unknown as Crypto, Blob, TextEncoder,
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: value => clearTimeout(value as ReturnType<typeof setTimeout>) }
  const value = createTravelServices({ platform, dbName }); services.push(value); return value
}
function custom(id: string, regionId: string, name: string, coordinates: Coordinates): Visit {
  return { id: `visit-${id}`, createdAt: 10, date: '2025-03-01', placeId: `custom-${id}`, note: '测试旅行，春日留影',
    photos: [{ id: 'photo-one', name: '合成照片.png', url: png }], coverId: 'photo-one',
    customPlace: { id: `custom-${id}`, name, regionId, coordinates } }
}
const old = () => custom('old-lijiang', 'lijiang', '丽江旧回忆', [100.233, 26.872])
const beijing = () => custom('beijing', 'cn-11', '北京的庭院', [116.4, 39.9])
const sichuan = () => custom('chengdu', 'cn-51', '成都散步', [104.0668, 30.5728])
afterEach(async () => { await Promise.all(services.splice(0).map(service => service.repository.close())) })

describe('cross-province records preserve the existing storage and backup protocol', () => {
  it('retains legacy identities and derives new province identities without adding fields to visits', () => {
    const catalogue = createCatalogue(), rows = [old(), beijing(), sichuan()]
    expect(provinceForRegion('lijiang')?.id).toBe('yunnan')
    expect(provinceForRegion('cn-51')?.id).toBe('cn-51')
    expect(provinceForRegion('51')).toBeUndefined()
    catalogue.replaceCustomPlaces(rows)
    expect(catalogue.get(beijing().placeId)?.mapId).toBe('cn-11')
    expect(catalogue.get(sichuan().placeId)?.mapId).toBe('cn-51')
    expect(catalogue.get(old().placeId)?.mapId).toBe('yunnan')
    expect(filter(catalogue.all, { provinceId: 'cn-51' }).map(place => place.name)).toEqual(['成都散步'])
    expect(filter(catalogue.all, { query: '四川' }).map(place => place.id)).toEqual([sichuan().placeId])
    expect(filter(catalogue.all, { visitedOnly: true, visitedIds: rows.map(row => row.placeId) })).toHaveLength(3)
    expect(normalizeCustomPlace(old().customPlace)).toEqual(old().customPlace)
  })
  it('rejects province/point mismatch, unknown regions, unknown public ids, and conflicting custom ids without writing', async () => {
    const h = harness(), row = beijing()
    await h.repository.addVisit(row)
    const before = await h.repository.loadIndex()
    await expect(h.repository.addVisit({ ...sichuan(), customPlace: { ...sichuan().customPlace!, coordinates: row.customPlace!.coordinates } })).rejects.toBeDefined()
    await expect(h.repository.addVisit({ ...sichuan(), customPlace: { ...sichuan().customPlace!, regionId: 'world' } })).rejects.toBeDefined()
    await expect(h.repository.addVisit({ ...row, id: 'unknown', placeId: 'future-public', customPlace: undefined })).rejects.toBeDefined()
    h.catalogue.replaceCustomPlaces([row])
    await expect(h.repository.importSnapshot({ visits: [{ ...row, id: 'conflicting', customPlace: { ...row.customPlace!, name: '同ID不同名称' } }], covers: [] })).rejects.toBeDefined()
    expect(await h.repository.loadIndex()).toEqual(before)
  })
  it('reopens mixed-province visits, per-place covers and incomplete drafts without a schema rewrite', async () => {
    const db = new IDBFactory(), first = harness(db), rows = [old(), beijing(), sichuan()]
    for (const row of rows) await first.repository.addVisit(row)
    await first.repository.setMapCover(sichuan().placeId, { visitId: sichuan().id, photoId: 'photo-one' })
    const draft: Draft = { ...beijing(), id: 'draft-cross', visitId: 'next-cross', updatedAt: 10,
      customPlace: { ...beijing().customPlace!, name: '', coordinates: null } }
    const savedDraft = await first.repository.saveDraft(draft, { expectedVersion: null })
    const before = await first.repository.load()
    await first.repository.close()
    const reopened = harness(db)
    expect(DATABASE_VERSION).toBe(4)
    expect(await reopened.repository.load()).toEqual(before)
    expect(await reopened.repository.loadDraft()).toEqual(savedDraft)
    const index = await reopened.repository.loadIndex()
    expect(JSON.stringify(index)).not.toContain('data:image')
    expect(index.visits.map(row => row.customPlace?.regionId).sort()).toEqual(['cn-11', 'cn-51', 'lijiang'])
  })
  it.each(['single-v1', 'volume-v2'] as const)('round-trips old and new provinces with covers through %s without changing payload identities', async format => {
    const source = harness(), rows = [old(), beijing(), sichuan()]
    for (const row of rows) await source.repository.addVisit(row)
    await source.repository.setMapCover(beijing().placeId, { visitId: beijing().id, photoId: 'photo-one' })
    const before = await source.repository.load(), target = harness(new IDBFactory(), 'national-target')
    let files: Blob[]
    if (format === 'single-v1') files = [new Blob([source.backup.serialize(before).text])]
    else {
      const session = await source.exports.prepare({ volumeChars: 1024 })
      expect(session.files.length).toBeGreaterThan(1)
      files = []
      for (const info of session.files) files.push((await source.exports.readPart(session.id, info.part)).blob)
    }
    let decoded = 0
    const preview = await target.restores.inspect(files, { decodePhoto: async photo => { expect(photo.url).toBe(png); decoded++ } })
    expect(preview.format).toBe(format); expect(decoded).toBe(3)
    expect(await target.repository.load()).toEqual({ visits: [], covers: [] })
    expect((await target.restores.commit(preview)).added).toBe(3)
    const sort = (value: Snapshot) => ({ visits: [...value.visits].sort((a, b) => a.id.localeCompare(b.id)), covers: value.covers })
    expect(sort(await target.repository.load())).toEqual(sort(before))
    target.catalogue.replaceCustomPlaces((await target.repository.loadIndex()).visits)
    expect(target.catalogue.get(sichuan().placeId)?.mapId).toBe('cn-51')
  })
})
