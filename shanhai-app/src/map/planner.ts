import type { Place } from '../domain/models'

function distance(a: Place, b: Place) {
  const [lngA, latA] = a.coordinates, [lngB, latB] = b.coordinates
  const x = (lngB - lngA) * Math.cos(((latA + latB) / 2) * Math.PI / 180)
  const y = latB - latA
  return Math.hypot(x, y)
}

/**
 * Create a lightweight scenic order from selected places.
 *
 * This is not a road route. It keeps the user's first selected place as the
 * start, then repeatedly picks the nearest unvisited place so the preview feels
 * like a plausible local itinerary before a real routing service is added.
 */
export function orderPlacesByNearest(selected: readonly Place[]): Place[] {
  const [start, ...rest] = selected
  if (!start) return []
  const ordered = [start]
  const remaining = [...rest]
  while (remaining.length) {
    const current = ordered[ordered.length - 1]!
    let best = 0
    for (let index = 1; index < remaining.length; index++) {
      if (distance(current, remaining[index]!) < distance(current, remaining[best]!)) best = index
    }
    ordered.push(remaining.splice(best, 1)[0]!)
  }
  return ordered
}
