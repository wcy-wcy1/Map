import type { Visit, VisitSummary } from './models'

/** Never spread a raw stored row into the lightweight UI index: extensions may
 * contain large/private payloads too. Keep this whitelist aligned with v4 IDB. */
export function toVisitSummary(visit: Visit): VisitSummary {
  const summary: VisitSummary = {
    id: visit.id, createdAt: visit.createdAt, placeId: visit.placeId,
    date: visit.date, note: visit.note, coverId: visit.coverId,
    photos: visit.photos.map(photo => ({ id: photo.id, name: photo.name })),
  }
  if (visit.customPlace) {
    const place = visit.customPlace
    summary.customPlace = { id: place.id, name: place.name, regionId: place.regionId,
      coordinates: [place.coordinates[0], place.coordinates[1]] }
  }
  return summary
}
