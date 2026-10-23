import { readFile } from 'node:fs/promises'
import { hash } from './crypto.js'
import { fail, fields, string } from './errors.js'
import { catalogueManifest } from './catalogue-manifest.js'
export const VALIDATION_VERSION = catalogueManifest.validationVersion
export const CATALOGUE_VERSION = catalogueManifest.catalogueVersion
export function verifyCatalogueAsset(name: string, bytes: Buffer, expected: string) {
  const value = JSON.parse(bytes.toString().replace(/^\uFEFF/, ''))
  if (hash(JSON.stringify(value)) !== expected) throw new Error(`Controlled catalogue data changed: ${name}`)
  return value
}
type Point = [number, number]
type Geometry = { type: string; coordinates: any }
function inRing(point: Point, ring: Point[]): number {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i], dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy
    if (!length2) { if (Math.abs(x - ax) < 1e-10 && Math.abs(y - ay) < 1e-10) return 0 }
    else {
      const projection = ((x - ax) * dx + (y - ay) * dy) / length2
      if (projection >= 0 && projection <= 1 && Math.abs((x - ax) * dy - (y - ay) * dx) <= 1e-10 * Math.sqrt(length2)) return 0
    }
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside
  }
  return inside ? 1 : -1
}
export function within(point: Point, geometry: Geometry): boolean {
  const polygons: Point[][][] = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.type === 'MultiPolygon' ? geometry.coordinates : []
  return polygons.some(polygon => polygon[0] && inRing(point, polygon[0]) >= 0 && polygon.slice(1).every(ring => inRing(point, ring) < 0))
}
export class Catalogue {
  places = new Map<string, any>(); regions = new Map<string, string>(); boundaries = new Map<string, Geometry>()
  async load() {
    const pins = catalogueManifest.pins
    const data: Record<string, any> = {}
    for (const [name, expected] of Object.entries(pins)) {
      const bytes = await readFile(new URL('../../shanhai-app/src/data/' + name, import.meta.url))
      data[name] = verifyCatalogueAsset(name, bytes, expected)
    }
    for (const feature of data['province-boundaries.json'].features) {
      this.boundaries.set(feature.properties.provinceId, feature.geometry)
      if (feature.properties.provinceId !== 'yunnan') this.regions.set(feature.properties.provinceId, feature.properties.provinceId)
    }
    this.boundaries.set('yunnan', data['yunnan-boundary.json'].features[0].geometry)
    for (const place of data['places.json']) { this.places.set(place.id, { ...place, mapId: 'yunnan' }); this.regions.set(place.regionId, 'yunnan') }
    for (const place of data['national-places.json']) {
      if (this.places.has(place.id) || !this.boundaries.has(place.mapId) || this.regions.get(place.regionId) !== place.mapId) throw new Error('Invalid controlled place ownership')
      this.places.set(place.id, place)
    }
    const counts = catalogueManifest.counts
    if (this.boundaries.size !== counts.provinces || this.regions.size !== counts.regions || this.places.size !== counts.publicPlaces) throw new Error('Unexpected controlled catalogue coverage')
  }
  supportsReference(placeId: string, version: unknown): boolean {
    if (!this.places.has(placeId)) return false
    if (version === CATALOGUE_VERSION) return true
    const legacy = catalogueManifest.legacyVersions as Record<string, readonly string[]>
    return typeof version === 'string' && Object.hasOwn(legacy, version) && legacy[version]!.includes(placeId)
  }
  custom(input: unknown) {
    const value = fields(input, ['clientId', 'name', 'regionId', 'coordinates', 'validationVersion'])
    const clientId = string(value.clientId, 'clientId'), name = string(value.name, 'name', 60).trim(), regionId = string(value.regionId, 'regionId')
    if (!name) fail(422, 'VALIDATION_FAILED', 'Name is required')
    if (value.validationVersion !== VALIDATION_VERSION) fail(422, 'VALIDATION_VERSION_UNSUPPORTED', 'Use the published boundary version', { validationVersion: VALIDATION_VERSION })
    const provinceId = this.regions.get(regionId), point = value.coordinates
    if (!provinceId || !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) fail(422, 'VALIDATION_FAILED', 'Invalid region or WGS84 coordinates')
    if ((provinceId === 'yunnan' && (point[0] < 97.45 || point[0] > 106.25 || point[1] < 21.05 || point[1] > 29.3)) || !within(point as Point, this.boundaries.get(provinceId)!)) fail(422, 'VALIDATION_FAILED', 'The point is outside this coarse province illustration; border points may be rejected')
    return { clientId, name, regionId, coordinates: point, validationVersion: VALIDATION_VERSION }
  }
}
