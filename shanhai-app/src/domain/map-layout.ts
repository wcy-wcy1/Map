import type { FilterOptions, Place, VisitSummary } from './models'

export type ProjectedPlace = Place & { x: number; y: number }
export interface PlaceGroup { anchor: ProjectedPlace; members: ProjectedPlace[] }

// Grouping changes presentation, never the geographic anchor.
export function group(points: readonly ProjectedPlace[], { radius = 68, selectedId = null }: { radius?: number; selectedId?: string | null } = {}): PlaceGroup[] {
  const ordered = points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y)).slice().sort((a, b) =>
    (a.id === selectedId ? -1 : b.id === selectedId ? 1 : 0) || (a.priority || 3) - (b.priority || 3) || a.id.localeCompare(b.id))
  const groups: PlaceGroup[] = []
  for (const point of ordered) {
    const nearby = groups.find(g => Math.hypot(g.anchor.x - point.x, g.anchor.y - point.y) < radius)
    if (nearby) nearby.members.push(point)
    else groups.push({ anchor: point, members: [point] })
  }
  return groups
}

export const normalizeQuery = (value: unknown): string => String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/gu, '')
export function matchesVisit(visit: Pick<VisitSummary, 'date' | 'note'>, query: string): boolean {
  const q = normalizeQuery(query)
  return !!q && [visit.date, visit.note].some(value => normalizeQuery(value).includes(q))
}
export function filter(places: readonly Place[], { query = '', provinceId = '', regionId = '', visitedOnly = false, visitedIds = [], visits = [] }: FilterOptions = {}): Place[] {
  const q = normalizeQuery(query), visited = new Set(visitedIds)
  const memoryPlaces = new Set(q ? visits.filter(v => matchesVisit(v, q)).map(v => v.placeId) : [])
  return places.filter(p => (!provinceId || p.mapId === provinceId) && (!regionId || p.regionId === regionId) && (!visitedOnly || visited.has(p.id)) &&
    (!q || memoryPlaces.has(p.id) || [p.name, p.city, p.regionName, ...p.aliases].some(value => normalizeQuery(value).includes(q))))
}
export function detailPage<T extends VisitSummary>(visits: readonly T[], query: string, { showAll = false, limit = 8 }: { showAll?: boolean; limit?: number } = {}) {
  const matches = visits.filter(visit => matchesVisit(visit, query))
  const filtering = matches.length > 0 && !showAll
  const selected = filtering ? matches : visits
  const count = Number.isSafeInteger(limit) && limit > 0 ? limit : 8
  return { items: selected.slice(0, count), total: visits.length, matched: matches.length, filtering, remaining: Math.max(0, selected.length - count) }
}

export function indexVisits<T extends VisitSummary>(visits: readonly T[]): Map<string, T[]> {
  const index = new Map<string, T[]>()
  for (const visit of visits) {
    let rows = index.get(visit.placeId)
    if (!rows) { rows = []; index.set(visit.placeId, rows) }
    rows.push(visit)
  }
  for (const rows of index.values()) rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt || a.id.localeCompare(b.id))
  return index
}
