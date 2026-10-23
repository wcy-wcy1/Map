import type { PlaceGroup } from '../domain/map-layout'
import { nationalLandmarkId } from './landmarks/national'

/** The image viewBox is 80 × 72, with the true coordinate at (40, 68). */
export function markerDimensions(zoom: number) {
  const width = zoom < 8 ? 54 : zoom < 11 ? 58 : 64
  return { width, height: width * 0.9, anchorX: width / 2, anchorY: width * 0.85 }
}

export function markerLabel(group: PlaceGroup, visited: ReadonlySet<string>, picking: boolean): string {
  if (picking) return `将${group.anchor.name}的位置用于我的地点`
  const visitedCount = group.members.filter(member => visited.has(member.id)).length
  return group.members.length > 1
    ? `${group.anchor.name}附近 ${group.members.length} 个景点，点击展开${visitedCount ? '，其中 ' + visitedCount + ' 处已记录' : ''}`
    : `查看${group.anchor.name}${visitedCount ? '，已记录' : ''}`
}

/** A previously focused marker can become a member of a different cluster. */
export function focusAnchor(groups: readonly PlaceGroup[], previousId: string): string | undefined {
  return groups.find(group => group.members.some(place => place.id === previousId))?.anchor.id
}

/** A cluster click is a short drill-down, not a flight to street scale. The
 * accompanying member list remains usable for coincident or very close pins. */
export function clusterZoom(current: number, fitted: number, spreadAtLimit: number, limit = 16): number {
  if (current >= limit || spreadAtLimit < 8) return current
  return Math.min(limit, current + 2, Math.max(current + 1, fitted))
}

/** One authored representative per province keeps the national page readable.
 * Filter/search lists remain complete; this is only a low-zoom display budget. */
export function overviewPlaces<T extends import('../domain/models').Place>(places: readonly T[], visitedIds: readonly string[], selectedId: string | null, limit: number): T[] {
  const visited = new Set(visitedIds)
  const ranked = places.slice().sort((a, b) => Number(b.id === selectedId) - Number(a.id === selectedId) ||
    Number(visited.has(b.id)) - Number(visited.has(a.id)) ||
    Number(b.id === nationalLandmarkId(b.mapId)) - Number(a.id === nationalLandmarkId(a.mapId)) ||
    (a.priority ?? 3) - (b.priority ?? 3) || a.id.localeCompare(b.id))
  if (limit <= 0) return []
  const scopes = new Set<string>(), representatives: T[] = []
  for (const place of ranked) {
    const scope = place.mapId || place.regionId
    if (scopes.has(scope)) continue
    scopes.add(scope); representatives.push(place)
  }
  const result = representatives.filter(place => place.id === selectedId || visited.has(place.id)).slice(0, limit)
  if (!result.length && representatives[0]) result.push(representatives[0])
  const distance = (a: T, b: T) => {
    const latitude = (a.coordinates[1] + b.coordinates[1]) * Math.PI / 360
    return ((a.coordinates[0] - b.coordinates[0]) * Math.cos(latitude)) ** 2 + (a.coordinates[1] - b.coordinates[1]) ** 2
  }
  // Farthest-first keeps the west, northeast and coast represented. It changes
  // selection only, never real coordinates. Ranked order resolves equal scores.
  while (result.length < Math.min(limit, representatives.length)) {
    let best: T | undefined, bestScore = -1
    for (const candidate of representatives) {
      if (result.includes(candidate)) continue
      const score = Math.min(...result.map(chosen => distance(candidate, chosen)))
      if (score > bestScore) { best = candidate; bestScore = score }
    }
    if (!best) break
    result.push(best)
  }
  return result
}

/** An 8px dead band around the merge threshold avoids regrouping on small zoom
 * changes. Coordinates and selected-anchor precedence stay authoritative. */
export function stableGroups(points: readonly import('../domain/map-layout').ProjectedPlace[], previous: readonly PlaceGroup[],
  { radius, selectedId }: { radius: number; selectedId: string | null }): PlaceGroup[] {
  const previousAnchor = new Map(previous.flatMap(item => item.members.map(member => [member.id, item.anchor.id] as const)))
  const ordered = points.filter(point => Number.isFinite(point.x) && Number.isFinite(point.y)).slice().sort((a, b) =>
    Number(b.id === selectedId) - Number(a.id === selectedId) || (a.priority ?? 3) - (b.priority ?? 3) || a.id.localeCompare(b.id))
  const result: PlaceGroup[] = []
  for (const point of ordered) {
    const nearby = result.find(item => {
      const wasTogether = previousAnchor.has(point.id) && previousAnchor.get(point.id) === previousAnchor.get(item.anchor.id)
      return Math.hypot(item.anchor.x - point.x, item.anchor.y - point.y) < radius + (wasTogether ? 8 : 0)
    })
    if (nearby) nearby.members.push(point)
    else result.push({ anchor: point, members: [point] })
  }
  return result
}
