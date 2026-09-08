import type { Geometry } from 'geojson'
import provinceData from '../data/province-boundaries.json'
import yunnanData from '../data/yunnan-boundary.json'
import type { Coordinates, Geography } from './models'

export interface Province { id: string; code: string; name: string; shortName: string }

// Generated, checked-in assets: no network requests are needed at runtime.
export const nationalGeography = provinceData as unknown as Geography
export const yunnanBoundary = yunnanData as unknown as Geography
export const provinces: readonly Province[] = provinceData.features.map(({ properties }) => ({
  id: properties.provinceId, code: properties.divisionCode, name: properties.name, shortName: properties.shortName,
}))
const byId = new Map(provinces.map(province => [province.id, province]))
const featuresById = new Map(nationalGeography.features.map(feature => [feature.properties.provinceId, feature]))

export function getProvince(id: string): Province | undefined { return byId.get(id) }

function validPoint(point: number[]): boolean {
  return Array.isArray(point) && point.length === 2 && point.every(Number.isFinite) && Math.abs(point[0]!) <= 180 && Math.abs(point[1]!) <= 90
}

function validRing(ring: number[][]): boolean {
  if (ring.length < 4 || !ring.every(validPoint)) return false
  const first = ring[0]!, last = ring.at(-1)!
  return first[0] === last[0] && first[1] === last[1]
}

/** -1 outside/invalid; 0 boundary; 1 inside. */
function inRing(point: Coordinates, ring: number[][]): -1 | 0 | 1 {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j]!, b = ring[i]!
    const ax = a[0]!, ay = a[1]!, bx = b[0]!, by = b[1]!
    const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy
    if (length2 === 0) {
      if (Math.abs(x - ax) < 1e-10 && Math.abs(y - ay) < 1e-10) return 0
    } else {
      const projection = ((x - ax) * dx + (y - ay) * dy) / length2
      if (projection >= 0 && projection <= 1 && Math.abs((x - ax) * dy - (y - ay) * dx) <= 1e-10 * Math.sqrt(length2)) return 0
    }
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside
  }
  return inside ? 1 : -1
}

/** Exterior boundaries belong to the polygon; holes and their boundaries do not. */
export function withinGeometry(point: Coordinates, geometry: Geometry): boolean {
  if (!validPoint(point)) return false
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  return polygons.some(polygon => {
    if (!polygon[0] || !polygon.every(validRing)) return false
    return inRing(point, polygon[0]) >= 0 && polygon.slice(1).every(hole => inRing(point, hole) < 0)
  })
}

export function withinProvince(point: Coordinates, provinceId = 'yunnan'): boolean {
  if (!validPoint(point) || !getProvince(provinceId)) return false
  if (provinceId === 'yunnan') {
    // Preserve the previous import/backup acceptance boundary, including its bounding precheck.
    const [lng, lat] = point
    if (lng < 97.45 || lng > 106.25 || lat < 21.05 || lat > 29.3) return false
    return yunnanBoundary.features.some(feature => withinGeometry(point, feature.geometry))
  }
  const feature = featuresById.get(provinceId)
  return !!feature && withinGeometry(point, feature.geometry)
}
