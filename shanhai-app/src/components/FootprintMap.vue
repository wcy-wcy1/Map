<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Coordinates, Cover, Geography, Place, Region, VisitSummary } from '../domain/models'
import { type PlaceGroup } from '../domain/map-layout'
import { svg, ensureLandmarks, subscribeLandmarks, nationalLandmarkSvg } from '../map/landmarks'
import { clusterZoom, focusAnchor, markerDimensions, markerLabel, overviewPlaces, stableGroups } from '../map/presentation'
import { selectPlaceCover } from '../domain/place-cover'
import { layoutMapCovers, layoutMapLabels, type Rect, type CoverPlacement } from '../map/cover-layout'
import { createMapPhotoCover } from '../map/photo-cover'
import { buildMemoryRoutes, type MemoryRoute } from '../map/routes'
import { PHOTO_LOADER_KEY } from '../services/photo-loader'
import '../map/photo-cover.css'

const props = withDefaults(defineProps<{
  places: readonly Place[]
  geography: Geography
  regions: readonly Region[]
  visitedIds: readonly string[]
  selectedId: string | null
  recordIndex?: ReadonlyMap<string, readonly VisitSummary[]>
  covers?: readonly Cover[]
  revision?: number
  query?: string
  regionId?: string
  provinceId?: string
  areaLabel?: string
  pickingLocation?: boolean
  bottomInset?: number
  plannedRouteIds?: readonly string[]
}>(), { bottomInset: 0, query: '', regionId: '', provinceId: 'yunnan', areaLabel: '云南', pickingLocation: false, recordIndex: () => new Map(), covers: () => [], revision: -1, plannedRouteIds: () => [] })
const emit = defineEmits<{
  select: [placeId: string]
  cluster: [placeIds: string[]]
  journey: [placeIds: string[]]
  pick: [coordinates: Coordinates]
  reset: []
  province: [provinceId: string]
}>()

const element = ref<HTMLDivElement>()
const summary = ref('正在打开地图…')
const routeSummary = ref('')
const plannedSummary = ref('')
const zoom = ref(5)
const coarsePointer = ref(false)
const artworkFailed = ref(false)
let unsubscribeArtwork: (() => void) | undefined
let artworkRequest = 0
async function loadArtwork() {
  const request = ++artworkRequest
  artworkFailed.value = false
  try { await ensureLandmarks(props.provinceId) }
  catch { if (request === artworkRequest) artworkFailed.value = true }
}
const photoLoader = inject(PHOTO_LOADER_KEY, null)
interface MarkerView {
  marker: L.Marker
  button: HTMLButtonElement
  artwork: HTMLSpanElement
  label: HTMLSpanElement
  count: HTMLSpanElement
  item: PlaceGroup
  artworkKey: string
  size: number
  coverKey?: string
  photo?: ReturnType<typeof createMapPhotoCover>
}
const markerViews = new Map<string, MarkerView>()
const labelViews = new Map<string, { marker: L.Marker; label: HTMLSpanElement }>()
const featureMetrics = new WeakMap<Geography['features'][number], { bounds: L.LatLngBounds; center: L.LatLng }>()
const scopeViews = new Map<string, { center: L.LatLng; zoom: number }>()
let previousGroups: PlaceGroup[] = []
let previousCoverOffsets = new Map<string, CoverPlacement>()
let routeKey = ''
let reducedMotion: MediaQueryList | undefined
let scopeAnimation: Animation | undefined
function revealScope() {
  scopeAnimation?.cancel()
  if (!reducedMotion?.matches) scopeAnimation = element.value?.animate?.([{ opacity: 0.65 }, { opacity: 1 }], { duration: 220, easing: 'ease-out' })
}
function releaseMarker(view: MarkerView) { view.photo?.dispose(); markers?.removeLayer(view.marker) }
function motion(duration = 0.24): L.ZoomPanOptions { return { animate: !reducedMotion?.matches, duration } }

let map: L.Map | undefined
let markers: L.LayerGroup | undefined
let routes: L.LayerGroup | undefined
let regionLabels: L.LayerGroup | undefined
let geographyLayer: L.GeoJSON | undefined
let provinceBounds: L.LatLngBounds | undefined
let markerFrame: number | undefined
let resizeFrame: number | undefined
let activeRouteIds: string[] = []
let activePlannedIds: string[] = []
let resizeObserver: ResizeObserver | undefined
let chromeObserver: ResizeObserver | undefined
let pointerQuery: MediaQueryList | undefined
let root: HTMLElement | null = null
let lastWidth = 0
let lastHeight = 0
const asLatLng = (place: Place): L.LatLngTuple => [place.coordinates[1], place.coordinates[0]]
const labelledProvinceIds = () => new Set(props.places.map(place => place.mapId).filter((id): id is string => !!id))
const PLACE_LABEL_ZOOM = 8.5
const nationalLabelGap = (zoom: number) => zoom < 4.8 ? 26 : zoom < 5.8 ? 16 : 8

function fitProvince() {
  if (!map || !provinceBounds?.isValid() || !element.value) return
  map.stop()
  map.fitBounds(provinceBounds, { padding: !props.provinceId ? [24, 28] : element.value.clientWidth < 500 ? [18, 32] : [40, 40], animate: false })
  revealScope()
}
function fitPlaces(places: readonly Place[]) {
  if (!map || !places.length) return
  map.stop()
  const first = places[0]
  if (places.length === 1 && first) map.setView(asLatLng(first), 9.5, motion())
  else map.fitBounds(L.latLngBounds(places.map(asLatLng)), { paddingTopLeft: [62, 70], paddingBottomRight: [62, 70 + props.bottomInset], maxZoom: 12, ...motion() })
}
function selectPlace(place: Place) {
  if (!map) return
  map.stop()
  const point = map.latLngToContainerPoint(asLatLng(place)), size = map.getSize()
  const left = 72, right = Math.max(left, size.x - 80)
  const top = 90, bottom = Math.max(top, size.y - props.bottomInset - 80)
  const x = Math.min(right, Math.max(left, point.x)), y = Math.min(bottom, Math.max(top, point.y))
  // Selection is immediate; only move an obscured anchor into the usable area.
  if (x !== point.x || y !== point.y) map.panBy([point.x - x, point.y - y], motion())
}
defineExpose({ fitProvince, fitOverview: fitProvince, fitPlaces, selectPlace })

function activateGroup(item: PlaceGroup) {
  if (!map) return
  if (props.pickingLocation) {
    emit('pick', [...item.anchor.coordinates])
    return
  }
  if (item.members.length === 1) {
    emit('select', item.anchor.id)
    return
  }
  const bounds = L.latLngBounds(item.members.map(asLatLng))
  const spread = map.project(bounds.getNorthEast(), 16).distanceTo(map.project(bounds.getSouthWest(), 16))
  const next = clusterZoom(map.getZoom(), map.getBoundsZoom(bounds, false, L.point(140, 140)), spread)
  map.stop()
  if (next > map.getZoom()) map.setView(bounds.getCenter(), next, motion())
  emit('cluster', item.members.map(place => place.id))
  queueMarkers()
  if (window.matchMedia('(max-width:900px)').matches) element.value?.focus({ preventScroll: true })
}

const collides = (rect: Rect, others: readonly Rect[], gap = 6) => others.some(other =>
  rect.x < other.x + other.width + gap && rect.x + rect.width + gap > other.x &&
  rect.y < other.y + other.height + gap && rect.y + rect.height + gap > other.y)
function ringMetrics(ring: number[][]): { area: number, centroid: Coordinates } | null {
  let twiceArea = 0, x = 0, y = 0
  for (let index = 0; index < ring.length - 1; index++) {
    const current = ring[index], next = ring[index + 1]
    const currentLng = current?.[0], currentLat = current?.[1]
    const nextLng = next?.[0], nextLat = next?.[1]
    if (currentLng === undefined || currentLat === undefined || nextLng === undefined || nextLat === undefined) continue
    const cross = currentLng * nextLat - nextLng * currentLat
    twiceArea += cross
    x += (currentLng + nextLng) * cross
    y += (currentLat + nextLat) * cross
  }
  if (Math.abs(twiceArea) < 0.000001) return null
  return { area: Math.abs(twiceArea / 2), centroid: [x / (3 * twiceArea), y / (3 * twiceArea)] }
}
function labelCenter(feature: Geography['features'][number], fallback: L.LatLng): L.LatLng {
  const geometry = feature.geometry
  if (geometry.type === 'Polygon') {
    const metrics = ringMetrics(geometry.coordinates[0] as number[][])
    if (metrics) return L.latLng(metrics.centroid[1], metrics.centroid[0])
  }
  if (geometry.type === 'MultiPolygon') {
    const rings = (geometry.coordinates as number[][][][]).map(polygon => polygon[0]).filter(Boolean)
    const largest = rings.map(ring => ringMetrics(ring!)).filter(metrics => metrics !== null).sort((a, b) => b.area - a.area)[0]
    if (largest) return L.latLng(largest.centroid[1], largest.centroid[0])
  }
  return fallback
}

function renderRoutes(currentZoom: number) {
  if (!map || !routes) return
  routeSummary.value = ''
  plannedSummary.value = ''
  activeRouteIds = []
  activePlannedIds = []
  // The route is a diary affordance, not a national navigation overlay.
  // Keep it hidden in the overview and reveal it once the map is readable.
  const plannedRoute = !props.pickingLocation && currentZoom >= 5 ? plannedMemoryRoute() : null
  const memoryRoutes = !props.pickingLocation && currentZoom >= 8.5 ? buildMemoryRoutes(props.places, props.recordIndex) : []
  const key = JSON.stringify([plannedRoute, memoryRoutes])
  if (key !== routeKey) {
    routes.clearLayers()
    if (plannedRoute) addRoute(plannedRoute, 'planned')
    for (const route of memoryRoutes) addRoute(route, 'memory')
    routeKey = key
  }
  const activeRoute = memoryRoutes.find(route => route.coordinates.some(([longitude, latitude]) =>
    map?.getBounds().contains([latitude, longitude])))
  if (activeRoute) {
    const names = activeRoute.placeIds.map(id => props.places.find(place => place.id === id)?.name).filter(Boolean)
    routeSummary.value = `${names.slice(0, 3).join(' · ')}${names.length > 3 ? ` 等 ${names.length} 处` : ''}`
    activeRouteIds = [...activeRoute.placeIds]
  }
  if (plannedRoute && currentZoom >= 5) {
    const names = plannedRoute.placeIds.map(id => props.places.find(place => place.id === id)?.name).filter(Boolean)
    plannedSummary.value = `${names.slice(0, 3).join(' · ')}${names.length > 3 ? ` 等 ${names.length} 处` : ''}`
    activePlannedIds = [...plannedRoute.placeIds]
  }
}

function plannedMemoryRoute(): MemoryRoute | null {
  const placeById = new Map(props.places.map(place => [place.id, place]))
  const places = props.plannedRouteIds.map(id => placeById.get(id)).filter(Boolean) as Place[]
  if (places.length < 2) return null
  const first = places[0]!
  return { regionId: first.regionId, placeIds: places.map(place => place.id), coordinates: places.map(place => [...place.coordinates]) }
}

function addRoute(route: MemoryRoute, variant: 'memory' | 'planned') {
  if (!routes || route.coordinates.length < 2) return
  const latlngs = route.coordinates.map(([longitude, latitude]) => [latitude, longitude] as L.LatLngTuple)
  // A quiet underlay keeps the route legible over the illustrated geography.
  L.polyline(latlngs, {
    className: `yn-${variant}-route-underlay`,
    pane: 'memoryRoutes',
    color: 'var(--lj-paper)',
    weight: variant === 'planned' ? 8 : 7,
    opacity: variant === 'planned' ? 0.88 : 0.78,
    interactive: false,
    bubblingMouseEvents: false,
  }).addTo(routes)
  const line = L.polyline(latlngs, {
    className: `yn-${variant}-route`,
    pane: 'memoryRoutes',
    color: variant === 'planned' ? 'var(--yn-water)' : 'var(--lj-red)',
    weight: variant === 'planned' ? 2.6 : 2.2,
    opacity: variant === 'planned' ? 0.92 : 0.86,
    dashArray: variant === 'planned' ? '8 7' : '2 8',
    lineCap: 'round',
    lineJoin: 'round',
    interactive: true,
    bubblingMouseEvents: false,
  }).addTo(routes)
  line.on('click', () => emit('journey', [...route.placeIds]))
}

function renderMarkers() {
  if (!map || !markers || !regionLabels || !element.value) return
  const active = document.activeElement instanceof HTMLElement && element.value.contains(document.activeElement)
    ? document.activeElement.dataset.mapPlace : undefined
  const currentZoom = map.getZoom()
  const visited = new Set(props.visitedIds)
  renderRoutes(currentZoom)
  const dimensions = markerDimensions(currentZoom)
  const size = map.getSize()
  const controls: Rect[] = [{ x: size.x - 62, y: 10, width: 52, height: 152 },
    { x: 12, y: 12, width: 40, height: 30 }, { x: 0, y: size.y - 62, width: size.x, height: 62 }]
  const overview = !props.provinceId && currentZoom < 7 && !props.query
  const viewport = map.getBounds().pad(0.18)
  const candidates = overview ? overviewPlaces(props.places.filter(place => {
    if (!viewport.contains(L.latLng(...asLatLng(place)))) return false
    if (place.id === props.selectedId || visited.has(place.id)) return true
    const point = map!.latLngToContainerPoint(asLatLng(place))
    // Pick another representative when a fixed control would cover this symbol;
    // neither the public point nor a user's selected coordinate is displaced.
    return !collides({ x: point.x - dimensions.anchorX, y: point.y - dimensions.anchorY,
      width: dimensions.width, height: dimensions.height }, controls, 0)
  }), props.visitedIds, props.selectedId, element.value.clientWidth < 600 ? 6 : 12) : props.places
  const projected = candidates.map(place => {
    const pixel = map!.project(asLatLng(place), currentZoom)
    return { ...place, x: pixel.x, y: pixel.y }
  })
  const groups = stableGroups(projected, previousGroups, { radius: overview ? 60 : currentZoom >= 14 ? 54 : 70, selectedId: props.selectedId })
  previousGroups = groups
  const visible: PlaceGroup[] = []
  // Layout uses container pixels, while grouping continues to use true projected
  // coordinates. Neither the artwork nor the geographic anchor is displaced.
  const visibleGroups = groups.filter(item => viewport.contains(L.latLng(...asLatLng(item.anchor))))
  const revealCovers = currentZoom >= 9.5
  const coverReferences = new Map(visibleGroups.map(item => [item.anchor.id,
    props.pickingLocation || item.members.length > 1 && item.anchor.id !== props.selectedId || (!revealCovers && item.anchor.id !== props.selectedId)
      ? undefined : selectPlaceCover(item.anchor.id, props.recordIndex, props.covers, props.query)]))
  const layoutMarkers = visibleGroups.map(item => {
    const point = map!.latLngToContainerPoint(asLatLng(item.anchor))
    return { id: item.anchor.id, x: point.x - dimensions.anchorX, y: point.y - dimensions.anchorY,
      width: dimensions.width, height: dimensions.height, anchorX: point.x, anchorY: point.y,
      hasCover: !!coverReferences.get(item.anchor.id), selected: item.anchor.id === props.selectedId,
      labelWidth: Math.min(172, Math.max(48, [...item.anchor.name].length * 17 + 24)) }
  })
  const obstacles: Rect[] = []
  if (props.bottomInset) obstacles.push({ x: 0, y: map.getSize().y - props.bottomInset, width: map.getSize().x, height: props.bottomInset })
  visibleGroups.forEach((item, index) => {
    const marker = layoutMarkers[index]!
    const left = marker.x, top = marker.y
    if (item.members.length > 1) {
      const width = Math.max(36, String(item.members.length).length * 7 + 20)
      obstacles.push({ x: left + dimensions.width + 8 - width, y: top, width, height: 22 })
    }
  })
  // UI overlays (controls, north, attribution/scale and status) must also stay clear.
  obstacles.push(...controls)
  if (routeSummary.value) obstacles.push({ x: 12, y: size.y - 104, width: Math.min(370, size.x * 0.62), height: 42 })
  if (plannedSummary.value) obstacles.push({ x: 12, y: size.y - 150, width: Math.min(370, size.x * 0.62), height: 42 })
  const labelPlacements = layoutMapLabels(layoutMarkers, { width: size.x, height: size.y }, obstacles)
  obstacles.push(...labelPlacements.values())
  const placements = layoutMapCovers(layoutMarkers, { width: size.x, height: size.y }, obstacles, previousCoverOffsets)
  previousCoverOffsets = new Map(layoutMarkers.flatMap(marker => {
    const placement = placements.get(marker.id)
    return placement ? [[marker.id, { ...placement, x: placement.x - marker.anchorX, y: placement.y - marker.anchorY }] as const] : []
  }))
  let shown = 0
  let grouped = 0
  const liveMarkers = new Set<string>()
  for (const item of groups) {
    const place = item.anchor
    const latlng = L.latLng(...asLatLng(place))
    if (!viewport.contains(latlng)) continue
    visible.push(item)
    shown += item.members.length
    if (item.members.length > 1) grouped++
    liveMarkers.add(place.id)
    let view = markerViews.get(place.id)
    if (!view) {
      const button = document.createElement('button')
      button.type = 'button'; button.className = 'yn-pin'
      const artwork = document.createElement('span'), label = document.createElement('span'), count = document.createElement('span')
      artwork.className = 'yn-pin-artwork'; label.className = 'yn-pin-label'; count.className = 'yn-cluster-count'
      button.append(artwork, label, count)
      const marker = L.marker(latlng, { keyboard: false, bubblingMouseEvents: false,
        icon: L.divIcon({ className: 'yn-map-icon', html: button, iconSize: [dimensions.width, dimensions.height], iconAnchor: [dimensions.anchorX, dimensions.anchorY] }) })
      view = { marker, button, artwork, label, count, item, artworkKey: '', size: dimensions.width }
      markerViews.set(place.id, view)
      button.addEventListener('click', () => activateGroup(markerViews.get(place.id)!.item))
      L.DomEvent.disableClickPropagation(button)
      markers.addLayer(marker)
    }
    const { button } = view
    view.item = item
    view.marker.setLatLng(latlng).setZIndexOffset(place.id === props.selectedId ? 1000 : 0)
    // Resize the existing icon wrapper instead of detaching its focused button/photo.
    const icon = view.marker.getElement()
    if (icon && view.size !== dimensions.width) {
      icon.style.width = `${dimensions.width}px`; icon.style.height = `${dimensions.height}px`
      icon.style.marginLeft = `${-dimensions.anchorX}px`; icon.style.marginTop = `${-dimensions.anchorY}px`
      view.size = dimensions.width
    }
    button.style.width = `${dimensions.width}px`
    button.style.height = `${dimensions.height}px`
    button.dataset.mapPlace = place.id
    button.dataset.longitude = String(place.coordinates[0])
    button.dataset.latitude = String(place.coordinates[1])
    button.dataset.members = item.members.map(member => member.id).join(',')
    const visitedCount = item.members.filter(member => visited.has(member.id)).length
    button.dataset.visited = String(visitedCount > 0)
    button.dataset.visitedCount = String(visitedCount)
    const labelPlacement = labelPlacements.get(place.id)
    button.dataset.label = String(!!labelPlacement && (place.id === props.selectedId ||
      (currentZoom >= PLACE_LABEL_ZOOM || overview || props.places.length <= 4) && item.members.length === 1))
    button.setAttribute('aria-pressed', String(props.selectedId === place.id))
    button.setAttribute('aria-label', markerLabel(item, visited, props.pickingLocation))
    // svg() only returns internal authored artwork. User names never enter markup.
    const artwork = (overview ? nationalLandmarkSvg(place.mapId ?? '', place.id) : undefined) ?? svg(place.iconKey, { variant: place.id })
    if (view.artworkKey !== artwork) { view.artwork.innerHTML = artwork; view.artworkKey = artwork }
    const reference = coverReferences.get(place.id), placement = placements.get(place.id)
    button.dataset.cover = reference ? placement ? 'shown' : 'collapsed' : 'none'
    const coverKey = reference && placement ? JSON.stringify([reference.visitId, reference.photoId, reference.photoCount, props.revision]) : undefined
    if (view.coverKey !== coverKey) {
      view.photo?.dispose(); view.photo?.element.remove(); view.photo = undefined
      view.coverKey = coverKey
      if (reference && placement) { view.photo = createMapPhotoCover(reference, props.revision, photoLoader); button.append(view.photo.element) }
    }
    if (reference && placement && view.photo) {
      const point = map.latLngToContainerPoint(asLatLng(place)), photo = view.photo.element
      photo.style.left = `${placement.x - point.x + dimensions.anchorX}px`
      photo.style.top = `${placement.y - point.y + dimensions.anchorY}px`
      photo.style.width = `${placement.width}px`; photo.style.height = `${placement.height}px`
      photo.dataset.compact = String(placement.compact)
      button.setAttribute('aria-label', `${markerLabel(item, visited, props.pickingLocation)}，封面来自${place.name}的回忆，共 ${reference.photoCount} 张照片`)
    }
    view.label.textContent = place.name
    button.title = place.name
    view.label.style.visibility = labelPlacement ? '' : 'hidden'
    if (labelPlacement) {
      const point = map.latLngToContainerPoint(asLatLng(place))
      view.label.style.left = `${labelPlacement.x - point.x + dimensions.anchorX}px`
      view.label.style.top = `${labelPlacement.y - point.y + dimensions.anchorY}px`
      view.label.style.width = `${labelPlacement.width}px`
      view.label.style.height = `${labelPlacement.height}px`
      view.label.style.transform = 'none'
      view.label.style.textAlign = 'center'
    }
    view.count.textContent = item.members.length > 1 ? `${item.members.length} 处` : ''
    view.count.hidden = item.members.length <= 1
  }
  for (const [id, view] of markerViews) if (!liveMarkers.has(id)) { releaseMarker(view); markerViews.delete(id) }
  const liveLabels = new Set<string>()
  const showProvinceLabels = !props.provinceId
  const showRegionLabels = !!props.provinceId && currentZoom < 11.5
  if ((showProvinceLabels || showRegionLabels) && !props.query) {
    const priorityProvinceIds = showProvinceLabels ? labelledProvinceIds() : new Set<string>()
    const labelRects: Rect[] = []
    const labelFeatures = props.geography.features.filter(feature => feature.properties.kind === (props.provinceId ? 'region' : 'province'))
      .sort((a, b) => Number(priorityProvinceIds.has(String(b.properties.provinceId || ''))) - Number(priorityProvinceIds.has(String(a.properties.provinceId || ''))))
    for (const feature of labelFeatures) {
      const id = props.provinceId ? feature.properties.regionId : String(feature.properties.provinceId || '')
      if (props.regionId && id !== props.regionId) continue
      let metrics = featureMetrics.get(feature)
      if (!metrics) {
        const bounds = L.geoJSON(feature).getBounds()
        if (!bounds.isValid()) continue
        metrics = { bounds, center: labelCenter(feature, bounds.getCenter()) }; featureMetrics.set(feature, metrics)
      }
      const region = props.regions.find(region => region.id === id)
      const text = (region?.name || feature.properties.name || '').replace(/壮族自治区$|回族自治区$|维吾尔自治区$|自治区$|特别行政区$|[省市州]$/u, '')
      const center = metrics.center
      if (showProvinceLabels && !viewport.contains(center)) continue
      const point = map.latLngToContainerPoint(center)
      const isPriority = showProvinceLabels && id && priorityProvinceIds.has(id)
      const labelWidth = showProvinceLabels ? Math.max(50, Math.min(98, text.length * 16 + 18)) : Math.max(54, Math.min(120, text.length * 15 + 18))
      const labelHeight = showProvinceLabels ? 25 : 23
      const rect = { x: point.x - labelWidth / 2, y: point.y - labelHeight / 2, width: labelWidth, height: labelHeight }
      if (showProvinceLabels && collides(rect, [...obstacles, ...layoutMarkers], 6)) continue
      if (showProvinceLabels && collides(rect, labelRects, isPriority ? 6 : nationalLabelGap(currentZoom))) continue
      labelRects.push(rect)
      const key = `${props.provinceId || 'national'}:${id || feature.properties.name}`
      liveLabels.add(key)
      let labelView = labelViews.get(key)
      const label = labelView?.label ?? document.createElement('span')
      label.className = 'yn-region-label'
      label.dataset.scope = props.provinceId ? 'region' : 'province'
      label.dataset.priority = isPriority ? 'memory' : 'map'
      label.dataset.labelLongitude = String(center.lng)
      label.dataset.labelLatitude = String(center.lat)
      label.textContent = text
      if (id) label.dataset.regionLabel = id
      if (!labelView) {
        const marker = L.marker(center, { interactive: false, keyboard: false, zIndexOffset: -1000,
          icon: L.divIcon({ className: 'yn-map-icon', html: label, iconSize: [labelWidth, labelHeight], iconAnchor: [labelWidth / 2, labelHeight / 2] }) })
        labelView = { marker, label }; labelViews.set(key, labelView); regionLabels.addLayer(marker)
      } else labelView.marker.setLatLng(center)
    }
  }
  for (const [id, view] of labelViews) if (!liveLabels.has(id)) { regionLabels.removeLayer(view.marker); labelViews.delete(id) }
  summary.value = projected.length ? `视野内约 ${shown} 处${grouped ? ' · 点击数字展开' : ''}`
    : props.query || props.regionId ? '没有符合筛选的地点，可调整筛选或添加我的地点' : '这里还没有地点，可添加我的地点留回忆'
  zoom.value = currentZoom
  const center = map.getCenter()
  element.value.dataset.zoom = String(currentZoom)
  element.value.dataset.centerLat = String(center.lat)
  element.value.dataset.centerLng = String(center.lng)
  if (active) {
    const id = focusAnchor(visible, active)
    const replacement = [...element.value.querySelectorAll<HTMLButtonElement>('[data-map-place]')].find(button => button.dataset.mapPlace === id)
    // If filtering hides the marker, keep keyboard focus on the map, not the body.
    if (document.activeElement !== replacement) (replacement || element.value).focus({ preventScroll: true })
  }
}
function queueMarkers() {
  if (markerFrame !== undefined) cancelAnimationFrame(markerFrame)
  markerFrame = requestAnimationFrame(() => { markerFrame = undefined; renderMarkers() })
}

function updateGeography() {
  if (!map) return
  geographyLayer?.remove()
  geographyLayer = L.geoJSON(props.geography, {
    interactive: !props.provinceId,
    onEachFeature: (feature, layer) => {
      if (layer instanceof L.Polyline) layer.options.smoothFactor = 0.5
      const id = feature.properties.provinceId
      if (!props.provinceId && feature.properties.kind === 'province' && typeof id === 'string') {
        layer.on('add', () => {
          if (!(layer instanceof L.Path)) return
          const path = layer.getElement()
          path?.setAttribute('data-province-id', id)
          path?.setAttribute('aria-label', feature.properties.name || id)
        })
        layer.on('click', (event: L.LeafletMouseEvent) => {
          if (event.originalEvent) L.DomEvent.stopPropagation(event.originalEvent)
          if (props.pickingLocation) emit('pick', [event.latlng.lng, event.latlng.lat])
          else emit('province', id)
        })
      }
    },
    style: feature => {
      const kind = feature?.properties.kind
      if (kind === 'province') return { color: 'var(--lj-ink)', weight: 1.2, fillColor: 'var(--yn-forest)', fillOpacity: 0.6, opacity: 0.65, bubblingMouseEvents: false }
      if (kind === 'water') return { color: 'var(--yn-water)', weight: 0.7, fillColor: 'var(--yn-water)', fillOpacity: 0.9 }
      if (kind === 'river') return { color: 'var(--yn-water)', weight: 1.2, opacity: 0.85 }
      if (kind === 'road') return { color: 'var(--lj-muted)', weight: 0.8, opacity: 0.3 }
      return { color: 'var(--lj-muted)', weight: 0.6, opacity: 0.4, fillColor: 'var(--yn-forest)', fillOpacity: 0.3 }
    },
  }).addTo(map)
  const province = props.geography.features.filter(feature => feature.properties.kind === 'province')
  provinceBounds = L.geoJSON(province.length ? province : props.geography).getBounds()
}

function sizeMapToViewport() {
  if (!element.value?.getClientRects().length || !root) return
  const value = `${Math.round(element.value.getBoundingClientRect().top + window.scrollY)}px`
  if (root.style.getPropertyValue('--yn-map-top') !== value) root.style.setProperty('--yn-map-top', value)
}
function resizeMap() {
  sizeMapToViewport()
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = undefined
    if (!map || !element.value?.getClientRects().length) return
    const width = element.value.clientWidth, height = element.value.clientHeight
    if (width === lastWidth && height === lastHeight) return
    lastWidth = width
    lastHeight = height
    // Keep the user's current view when notices, panels, or screen size change.
    map.invalidateSize({ pan: false, debounceMoveend: true })
    queueMarkers()
  })
}
function updatePointer() {
  coarsePointer.value = pointerQuery?.matches ?? false
  if (coarsePointer.value) map?.dragging.disable()
  else map?.dragging.enable()
}

onMounted(() => {
  if (!element.value) return
  unsubscribeArtwork = subscribeLandmarks(queueMarkers)
  void loadArtwork()
  root = element.value.closest<HTMLElement>('#shanhai-lijiang')
  sizeMapToViewport()
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  pointerQuery = window.matchMedia('(pointer:coarse)')
  coarsePointer.value = pointerQuery.matches
  map = L.map(element.value, {
    zoomControl: false, attributionControl: true, minZoom: 2, maxZoom: 18,
    zoomSnap: 0.25, zoomDelta: 1, scrollWheelZoom: false,
    dragging: !coarsePointer.value, touchZoom: true,
    // CSS zoom transitions cannot be interrupted with Leaflet's public stop().
    // Keep scope jumps immediate with a cancellable fade, and animate short pans.
    zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false,
    // Viewport guard only; record validation uses the selected province geometry.
    maxBounds: [[-5, 60], [65, 150]], maxBoundsViscosity: 0.9,
  })
  const routePane = map.createPane('memoryRoutes')
  routePane.style.zIndex = '450'
  map.attributionControl.setPrefix('')
  map.attributionControl.addAttribution('<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>')
  map.attributionControl.addAttribution('<a href="https://www.geoboundaries.org/" target="_blank" rel="noopener noreferrer">geoBoundaries</a> · 轮廓仅作示意')
  L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 90 }).addTo(map)
  updateGeography()
  markers = L.layerGroup().addTo(map)
  routes = L.layerGroup().addTo(map)
  // Keep the route layer below markers while allowing it to sit above the
  // geography illustration.
  map.removeLayer(routes)
  routes.addTo(map)
  regionLabels = L.layerGroup().addTo(map)
  map.on('moveend zoomend', queueMarkers)
  map.on('click', (event: L.LeafletMouseEvent) => {
    if (props.pickingLocation) emit('pick', [event.latlng.lng, event.latlng.lat])
  })
  pointerQuery.addEventListener('change', updatePointer)
  resizeObserver = new ResizeObserver(resizeMap)
  resizeObserver.observe(element.value)
  chromeObserver = new ResizeObserver(sizeMapToViewport)
  root?.querySelectorAll('.yn-header,.yn-toolbar,.yn-storage,.yn-location-banner,.yn-undo').forEach(node => chromeObserver?.observe(node))
  window.addEventListener('resize', resizeMap)
  sizeMapToViewport()
  fitProvince()
  queueMarkers()
})

watch(() => [props.places, props.regions, props.visitedIds, props.selectedId, props.query, props.regionId, props.pickingLocation,
  props.plannedRouteIds,
  props.recordIndex, props.covers, props.revision, props.bottomInset], queueMarkers)
watch(() => props.bottomInset, () => {
  const selected = props.places.find(place => place.id === props.selectedId)
  if (selected) selectPlace(selected)
})
watch(() => [props.geography, props.provinceId] as const, ([_geography, scope], [, previousScope]) => {
  const changed = scope !== previousScope
  if (changed) void loadArtwork()
  if (changed && map) { map.stop(); scopeViews.set(previousScope, { center: map.getCenter(), zoom: map.getZoom() }); previousGroups = [] }
  updateGeography()
  if (changed && map) {
    const saved = scopeViews.get(scope)
    if (saved) { map.setView(saved.center, saved.zoom, { animate: false }); revealScope() }
    else fitProvince()
  }
  queueMarkers()
})
onBeforeUnmount(() => {
  artworkRequest++; unsubscribeArtwork?.(); scopeAnimation?.cancel()
  markerViews.forEach(releaseMarker); markerViews.clear(); labelViews.clear()
  routes?.clearLayers()
  if (markerFrame !== undefined) cancelAnimationFrame(markerFrame)
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
  resizeObserver?.disconnect()
  chromeObserver?.disconnect()
  pointerQuery?.removeEventListener('change', updatePointer)
  window.removeEventListener('resize', resizeMap)
  map?.remove()
  map = undefined
  routes = undefined
})
</script>

<template>
  <div class="yn-map-column">
    <div class="yn-map-wrap">
      <div id="yn-map" ref="element" role="region" tabindex="0" :aria-label="`${areaLabel}可缩放回忆地图，图标底部圆点对应记录坐标，省区轮廓仅作示意`" :data-province="provinceId" :data-picking="pickingLocation || undefined"></div>
      <div class="yn-map-tools" aria-label="地图操作">
        <button type="button" class="yn-zoom-in" aria-label="放大地图" :disabled="zoom >= 18" @click="map?.zoomIn()">＋</button>
        <button type="button" class="yn-zoom-out" aria-label="缩小地图" :disabled="zoom <= 2" @click="map?.zoomOut()">−</button>
        <button type="button" class="yn-fit" :aria-label="pickingLocation ? '回到所选省区' : '回到全国总览'" @click="emit('reset')">{{ pickingLocation ? '省区' : '总览' }}</button>
      </div>
      <span class="yn-north" aria-label="地图上方为北">北 ↑</span>
      <div class="yn-map-summary" role="status">{{ summary }}</div>
      <button v-if="routeSummary" type="button" class="yn-route-summary" aria-live="polite" @click="emit('journey', activeRouteIds)">
        <span class="yn-route-summary-dot"></span>
        <span><strong>我的足迹线</strong>{{ routeSummary }}</span>
      </button>
      <button v-if="plannedSummary" type="button" class="yn-route-summary yn-planned-summary" aria-live="polite" @click="emit('journey', activePlannedIds)">
        <span class="yn-route-summary-dot"></span>
        <span><strong>计划路线</strong>{{ plannedSummary }}</span>
      </button>
    </div>
    <p v-if="artworkFailed" class="yn-map-detail-note">地标暂用简图显示。<button type="button" @click="loadArtwork">重试地标图形</button></p>
    <p class="yn-map-help"><span class="yn-visited-dot"></span>有我的回忆 <span>{{ coarsePointer ? '双指移动或缩放，单指滚动页面；放大后显示名字和照片。' : '放大后显示名字和照片；数字是附近景点数，点击展开。' }}</span></p>
    <p class="yn-map-detail-note">{{ !provinceId ? '点击省区轮廓，或用上方选择框进入。' : '' }}省区轮廓为粗略示意，仅作回忆定位，不用于导航或判定行政归属。</p>
  </div>
</template>
