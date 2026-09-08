import type { Coordinates, Place, VisitSummary } from '../domain/models'

export interface MemoryRoute {
  regionId: string
  placeIds: string[]
  coordinates: Coordinates[]
}

interface RouteVisit {
  place: Place
  date: string
  createdAt: number
  visitId: string
}

/**
 * Build a lightweight visual route from saved memories.
 *
 * This is deliberately not a navigation route. It only connects places that
 * have user memories, keeps each region independent, and orders places by the
 * user's earliest visit so the line reads like a travel diary.
 */
export function buildMemoryRoutes(
  places: readonly Place[],
  recordIndex: ReadonlyMap<string, readonly VisitSummary[]>,
  { minimumPlaces = 2 }: { minimumPlaces?: number } = {},
): MemoryRoute[] {
  const placeById = new Map(places.map(place => [place.id, place]))
  const grouped = new Map<string, RouteVisit[]>()

  for (const [placeId, visits] of recordIndex) {
    const place = placeById.get(placeId)
    if (!place || !visits.length) continue
    const first = [...visits].sort((a, b) =>
      a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))[0]
    if (!first) continue
    const rows = grouped.get(place.regionId) ?? []
    rows.push({ place, date: first.date, createdAt: first.createdAt, visitId: first.id })
    grouped.set(place.regionId, rows)
  }

  const routes: MemoryRoute[] = []
  for (const [regionId, rows] of grouped) {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt ||
      a.visitId.localeCompare(b.visitId) || a.place.id.localeCompare(b.place.id))
    const unique = rows.filter((row, index) => index === 0 || row.place.id !== rows[index - 1]?.place.id)
    if (unique.length < minimumPlaces) continue
    routes.push({
      regionId,
      placeIds: unique.map(row => row.place.id),
      coordinates: unique.map(row => [row.place.coordinates[0], row.place.coordinates[1]]),
    })
  }
  return routes.sort((a, b) => a.regionId.localeCompare(b.regionId))
}
