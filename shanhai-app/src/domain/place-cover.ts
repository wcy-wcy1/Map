import type { Cover, VisitSummary } from './models'
import { matchesVisit } from './map-layout'

export interface PlaceCoverSelection {
  visitId: string
  photoId: string
  photoName: string
  /** All photos in the matching candidate visits, not just the chosen visit. */
  photoCount: number
}

const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const latestFirst = (a: VisitSummary, b: VisitSummary) =>
  compareText(b.date, a.date) || b.createdAt - a.createdAt || compareText(a.id, b.id)

/** Shared list/map selection over metadata only. A place-name-only search has
 * no matching visits, so keeps the normal curated cover. When date/note matches
 * do exist, unrelated visits must never provide a misleading photo. */
export function selectPlaceCover(
  placeId: string,
  recordIndex: ReadonlyMap<string, readonly VisitSummary[]>,
  covers: readonly Cover[],
  query: string,
): PlaceCoverSelection | undefined {
  const rows = (recordIndex.get(placeId) ?? []).filter(visit => visit.placeId === placeId)
  const matches = rows.filter(visit => matchesVisit(visit, query))
  const candidates = (matches.length ? matches : rows).slice().sort(latestFirst)
  const photoCount = candidates.reduce((count, visit) => count + visit.photos.length, 0)
  if (!photoCount) return undefined

  const selected = (visit: VisitSummary, photoId: string): PlaceCoverSelection | undefined => {
    const photo = visit.photos.find(item => item.id === photoId)
    return photo ? { visitId: visit.id, photoId: photo.id, photoName: photo.name, photoCount } : undefined
  }
  // Repository validation allows one cover per place. Sorting also makes this
  // pure helper deterministic for callers that supply redundant references.
  const references = covers.filter(cover => cover.placeId === placeId).slice().sort((a, b) =>
    compareText(a.visitId, b.visitId) || compareText(a.photoId, b.photoId))
  for (const reference of references) {
    const visit = candidates.find(row => row.id === reference.visitId)
    const chosen = visit && selected(visit, reference.photoId)
    if (chosen) return chosen
  }
  const latest = candidates.find(visit => visit.photos.length > 0)
  if (!latest) return undefined
  return (latest.coverId && selected(latest, latest.coverId)) || selected(latest, latest.photos[0]!.id)
}
