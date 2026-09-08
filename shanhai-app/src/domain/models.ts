import type { FeatureCollection, Geometry } from 'geojson'

export type Coordinates = [longitude: number, latitude: number]
export interface Photo { id: string; name: string; url: string }
export interface PhotoSummary { id: string; name: string }
export interface CustomPlace { id: string; name: string; regionId: string; coordinates: Coordinates }
export interface Visit {
  id: string
  createdAt: number
  placeId: string
  date: string
  note: string
  photos: Photo[]
  coverId: string | null
  customPlace?: CustomPlace
}
export interface Cover { placeId: string; visitId: string; photoId: string }
export interface Snapshot { visits: Visit[]; covers: Cover[] }
/** Metadata only: no photo payloads or opaque extension fields. */
export interface VisitSummary extends Omit<Visit, 'photos'> { photos: PhotoSummary[] }
export interface LibraryIndexSnapshot { visits: VisitSummary[]; covers: Cover[]; revision: number }
export interface Draft {
  id: string
  visitId: string
  createdAt: number
  placeId: string
  date: string
  note: string
  photos: Photo[]
  coverId: string | null
  updatedAt: number
  version?: string
  originalVisit?: Visit
  customPlace?: Omit<CustomPlace, 'coordinates'> & { coordinates: Coordinates | null }
}
export interface Region { id: string; name: string; placeIds: string[]; provinceId?: string }
export interface Place {
  id: string
  name: string
  aliases: string[]
  mapId?: string
  regionId: string
  regionName: string
  city: string
  category: string
  iconKey: string
  coordinates: Coordinates
  coordinateSystem: 'WGS84'
  coordinateSource: { type: string; url?: string; [key: string]: unknown }
  anchorNote: string
  source?: string
  text: string
  highlights: string[]
  priority: number
  isCustom?: boolean
  customPlace?: CustomPlace
}
export interface GeographyProperties {
  kind: string
  name?: string
  regionId?: string
  sourceUrl?: string
  [key: string]: unknown
}
export type Geography = FeatureCollection<Geometry, GeographyProperties>
export interface FilterOptions {
  query?: string
  provinceId?: string
  regionId?: string
  visitedOnly?: boolean
  visitedIds?: readonly string[]
  visits?: readonly VisitSummary[]
}
