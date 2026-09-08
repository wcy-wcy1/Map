import type { Draft, Visit } from '../domain/models'
import type { TravelCatalogue } from '../services/contracts'
import { secureId } from './photos'

export function copy<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
export function localToday(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
export function newDraft(catalogue: TravelCatalogue, placeId = '', visit?: Visit | null): Draft {
  const place = catalogue.get(placeId)
  const draft: Draft = {
    id: secureId('draft-'), visitId: visit?.id ?? secureId('visit-'), createdAt: visit?.createdAt ?? Date.now(),
    placeId: visit?.placeId ?? place?.id ?? '', date: visit?.date ?? localToday(), note: visit?.note ?? '',
    photos: copy(visit?.photos ?? []), coverId: visit?.coverId ?? null, updatedAt: Date.now(),
  }
  if (visit) draft.originalVisit = copy(visit)
  const custom = visit?.customPlace ?? place?.customPlace
  if (custom) draft.customPlace = copy(custom)
  if (placeId === '__custom' && !visit) {
    draft.customPlace = { id: secureId('custom-'), name: '', regionId: '', coordinates: null }
    draft.placeId = draft.customPlace.id
  }
  return draft
}
export function visitFromDraft(draft: Draft, catalogue: TravelCatalogue): Visit {
  if (!draft.photos.length && !draft.note.trim()) throw new Error('选一张照片或写一句手记，就可以保存这段回忆。')
  if (draft.note.length > 2000) throw new Error('手记最多 2000 字，请缩短后再保存。')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || !Number.isFinite(Date.parse(draft.date)) || new Date(draft.date).toISOString().slice(0, 10) !== draft.date || draft.date > localToday()) throw new Error('请选择有效的旅行日期，不能晚于今天。')
  if (draft.photos.length > 9) throw new Error('每条回忆最多 9 张照片。')
  const visit: Visit = { id: draft.visitId, createdAt: draft.createdAt, placeId: draft.placeId, date: draft.date, note: draft.note.trim(), photos: copy(draft.photos), coverId: draft.coverId }
  if (draft.customPlace) {
    const metadata = catalogue.normalizeCustomPlace(draft.customPlace)
    const existing = catalogue.get(metadata.id)?.customPlace ?? (draft.originalVisit?.customPlace?.id === metadata.id ? draft.originalVisit.customPlace : undefined)
    if (existing && (existing.name !== metadata.name || existing.regionId !== metadata.regionId || existing.coordinates[0] !== metadata.coordinates[0] || existing.coordinates[1] !== metadata.coordinates[1])) metadata.id = secureId('custom-')
    visit.customPlace = metadata; visit.placeId = metadata.id
    // Retain the replacement identity across failed save attempts.
    draft.customPlace = copy(metadata); draft.placeId = metadata.id
  } else if (!catalogue.has(visit.placeId)) throw new Error('请确认这段回忆的地点。')
  if (visit.photos.length && !visit.photos.some(photo => photo.id === visit.coverId)) throw new Error('请选择一张照片作为封面。')
  if (!visit.photos.length) visit.coverId = null
  return visit
}
/** Compare only supported fields; unrelated legacy row metadata is preserved by
 * the repository's CAS write, not treated as a reason to duplicate a visit. */
export function sameVisit(a: Visit, b: Visit): boolean {
  const fields = (visit: Visit) => ({ id: visit.id, createdAt: visit.createdAt, placeId: visit.placeId, date: visit.date, note: visit.note, photos: visit.photos.map(p => ({ id: p.id, name: p.name, url: p.url })), coverId: visit.coverId, customPlace: visit.customPlace ? { id: visit.customPlace.id, name: visit.customPlace.name, regionId: visit.customPlace.regionId, coordinates: visit.customPlace.coordinates } : null })
  return JSON.stringify(fields(a)) === JSON.stringify(fields(b))
}
