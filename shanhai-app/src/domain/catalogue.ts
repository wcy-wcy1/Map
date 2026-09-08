import placeData from '../data/places.json'
import { getProvince, provinces, withinProvince } from './provinces'
import type { Coordinates, CustomPlace, Place, Region, Visit } from './models'

// These are checked-in source assets, never remote or user-provided JSON.
const seeds = placeData as unknown as Place[]
export const publicPlaces: readonly Place[] = seeds.map(p => ({ ...p, mapId: 'yunnan', coordinates: [...p.coordinates], aliases: [...p.aliases, '云南', '云南省'] }))
export const yunnanRegions: readonly Region[] = [...new Set(publicPlaces.map(p => p.regionId))].map(id => ({
  id, provinceId: 'yunnan', name: publicPlaces.find(p => p.regionId === id)!.regionName,
  placeIds: publicPlaces.filter(p => p.regionId === id).map(p => p.id),
}))
// Legacy prefecture ids remain valid identities. Outside the existing Yunnan
// catalogue the first release records the province only, not invented cities.
export const regions: readonly Region[] = [...yunnanRegions, ...provinces.filter(p => p.id !== 'yunnan').map(p => ({
  id: p.id, provinceId: p.id, name: p.name, placeIds: [],
}))]
const regionById = new Map(regions.map(region => [region.id, region]))
export function provinceForRegion(regionId: string) { return getProvince(regionById.get(regionId)?.provinceId ?? '') }
export { provinces, withinProvince }

function fail(message: string): never {
  throw Object.assign(new Error(message), { code: 'invalid-custom-place', friendlyMessage: message })
}
export function normalizeCustomPlace(value: unknown): CustomPlace {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('自定义地点格式不正确。')
  const item = value as Record<string, unknown>
  if (typeof item.id !== 'string' || !/^custom-[A-Za-z0-9_-]{1,93}$/.test(item.id)) fail('自定义地点编号不正确。')
  if (typeof item.name !== 'string' || !item.name.trim() || item.name.trim().length > 60) fail('请填写 1–60 字的地点名称。')
  if (typeof item.regionId !== 'string' || !regionById.has(item.regionId)) fail('请选择支持的省份或地区。')
  const province = provinceForRegion(item.regionId)!
  const positionError = `请在${province.shortName}的示意轮廓内选择位置；轮廓较粗略，边缘地点暂不支持精确校验。`
  if (!Array.isArray(item.coordinates) || item.coordinates.length !== 2 || !item.coordinates.every(Number.isFinite)) fail(positionError)
  const coordinates: Coordinates = [Number(item.coordinates[0]), Number(item.coordinates[1])]
  if (!withinProvince(coordinates, province.id)) fail(positionError)
  return { id: item.id, name: item.name.trim(), regionId: item.regionId, coordinates }
}
export function createCatalogue() {
  let all = [...publicPlaces]
  let byId = new Map(all.map(p => [p.id, p]))
  return {
    get all(): readonly Place[] { return all },
    publicPlaces, regions, provinces, provinceForRegion, normalizeCustomPlace,
    get(id: string): Place | undefined { return byId.get(id) },
    has(id: string): boolean { return byId.has(id) },
    replaceCustomPlaces(visits: readonly Pick<Visit, 'placeId' | 'customPlace'>[]): readonly Place[] {
      const custom = new Map<string, CustomPlace>()
      for (const visit of visits) {
        if (!visit.customPlace && !visit.placeId.startsWith('custom-')) continue
        const metadata = normalizeCustomPlace(visit.customPlace)
        if (metadata.id !== visit.placeId) fail('自定义地点与记录不匹配。')
        const existing = custom.get(metadata.id)
        if (existing && JSON.stringify(existing) !== JSON.stringify(metadata)) fail('同一个自定义地点有不同的位置或名称，请保留备份并检查记录。')
        custom.set(metadata.id, metadata)
      }
      const entries: Place[] = [...custom.values()].map(metadata => {
        const region = regionById.get(metadata.regionId)!
        const province = provinceForRegion(metadata.regionId)!
        return {
          ...metadata, mapId: province.id, regionName: region.name, city: region.name, aliases: [province.name, province.shortName], category: 'personal', iconKey: 'village', coordinateSystem: 'WGS84',
          coordinateSource: { type: 'user-set' }, text: '你命名的回忆地点。图标是通用标记，不代表这里的实际建筑。',
          anchorNote: '位置与所属地区由你手动选择，示意轮廓不证明精确行政归属；仅作回忆定位，不是导航入口。',
          highlights: ['我的地点'], priority: 2, isCustom: true, customPlace: metadata,
        }
      })
      // Publish only after validation of the complete set.
      all = [...publicPlaces, ...entries]
      byId = new Map(all.map(p => [p.id, p]))
      return all
    },
  }
}
