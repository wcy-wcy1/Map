<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { Coordinates, Cover, Geography, Place, Region, VisitSummary } from '../domain/models'
import { group, type PlaceGroup } from '../domain/map-layout'
import { svg } from '../map/landmarks'
import { focusAnchor, markerDimensions, markerLabel } from '../map/presentation'
import { selectPlaceCover } from '../domain/place-cover'
import { layoutMapCovers, type Rect } from '../map/cover-layout'
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
}>(), { query: '', regionId: '', provinceId: 'yunnan', areaLabel: '云南', pickingLocation: false, recordIndex: () => new Map(), covers: () => [], revision: -1 })
const emit = defineEmits<{
  select: [placeId: string]
  cluster: [placeIds: string[]]
  pick: [coordinates: Coordinates]
  reset: []
  province: [provinceId: string]
}>()

const element = ref<HTMLDivElement>()
const summary = ref('正在打开地图…')
const zoom = ref(5)
const coarsePointer = ref(false)
const photoLoader = inject(PHOTO_LOADER_KEY, null)
let photoViews: ReturnType<typeof createMapPhotoCover>[] = []
function releasePhotos() { photoViews.forEach(view => view.dispose()); photoViews = [] }
let map: L.Map | undefined
let markers: L.LayerGroup | undefined
let routes: L.LayerGroup | undefined
let regionLabels: L.LayerGroup | undefined
let geographyLayer: L.GeoJSON | undefined
let provinceBounds: L.LatLngBounds | undefined
let markerFrame: number | undefined
let resizeFrame: number | undefined
let resizeObserver: ResizeObserver | undefined
let chromeObserver: ResizeObserver | undefined
let pointerQuery: MediaQueryList | undefined
let root: HTMLElement | null = null
let lastWidth = 0
let lastHeight = 0
const asLatLng = (place: Place): L.LatLngTuple => [place.coordinates[1], place.coordinates[0]]

function fitProvince() {
  if (!map || !provinceBounds?.isValid() || !element.value) return
  map.fitBounds(provinceBounds, { padding: element.value.clientWidth < 500 ? [18, 32] : [40, 40], animate: false })
}
function fitPlaces(places: readonly Place[]) {
  if (!map || !places.length) return
  const first = places[0]
  if (places.length === 1 && first) map.setView(asLatLng(first), 9.5, { animate: false })
  else map.fitBounds(L.latLngBounds(places.map(asLatLng)), { padding: [62, 70], maxZoom: 12, animate: false })
}
function selectPlace(place: Place) {
  map?.setView(asLatLng(place), Math.max(9.5, map.getZoom()), { animate: false })
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
  const next = Math.min(18, Math.max(map.getZoom() + 1.5, map.getBoundsZoom(bounds, false, L.point(140, 140))))
  map.setView(bounds.getCenter(), next, { animate: false })
  emit('cluster', item.members.map(place => place.id))
  queueMarkers()
  if (window.matchMedia('(max-width:900px)').matches) element.value?.focus({ preventScroll: true })
}

function addText(parent: HTMLElement, className: string, text: string) {
  const span = document.createElement('span')
  span.className = className
  span.textContent = text
  parent.append(span)
}

function renderRoutes(currentZoom: number) {
  if (!map || !routes) return
  routes.clearLayers()
  // The route is a diary affordance, not a national navigation overlay.
  // Keep it hidden in the overview and reveal it once the map is readable.
  if (currentZoom < 8.5 || props.pickingLocation) return
  const memoryRoutes = buildMemoryRoutes(props.places, props.recordIndex)
  for (const route of memoryRoutes) addRoute(route)
}

function addRoute(route: MemoryRoute) {
  if (!routes || route.coordinates.length < 2) return
  const latlngs = route.coordinates.map(([longitude, latitude]) => [latitude, longitude] as L.LatLngTuple)
  // A quiet underlay keeps the route legible over the illustrated geography.
  L.polyline(latlngs, {
    className: 'yn-memory-route-underlay',
    pane: 'memoryRoutes',
    color: 'var(--lj-paper)',
    weight: 7,
    opacity: 0.78,
    interactive: false,
    bubblingMouseEvents: false,
  }).addTo(routes)
  L.polyline(latlngs, {
    className: 'yn-memory-route',
    pane: 'memoryRoutes',
    color: 'var(--lj-red)',
    weight: 2.2,
    opacity: 0.86,
    dashArray: '2 8',
    lineCap: 'round',
    lineJoin: 'round',
    interactive: false,
    bubblingMouseEvents: false,
  }).addTo(routes)
}

function renderMarkers() {
  if (!map || !markers || !regionLabels || !element.value) return
  const active = document.activeElement instanceof HTMLElement && element.value.contains(document.activeElement)
    ? document.activeElement.dataset.mapPlace : undefined
  releasePhotos()
  markers.clearLayers()
  regionLabels.clearLayers()
  const currentZoom = map.getZoom()
  renderRoutes(currentZoom)
  const dimensions = markerDimensions(currentZoom)
  const projected = props.places.map(place => {
    const pixel = map!.project(asLatLng(place), currentZoom)
    return { ...place, x: pixel.x, y: pixel.y }
  })
  const groups = group(projected, { radius: currentZoom >= 14 ? 54 : 70, selectedId: props.selectedId })
  const viewport = map.getBounds().pad(0.18)
  const visible: PlaceGroup[] = []
  const visited = new Set(props.visitedIds)
  // Layout uses container pixels, while grouping continues to use true projected
  // coordinates. Neither the artwork nor the geographic anchor is displaced.
  const visibleGroups = groups.filter(item => viewport.contains(L.latLng(...asLatLng(item.anchor))))
  const coverReferences = new Map(visibleGroups.map(item => [item.anchor.id,
    props.pickingLocation ? undefined : selectPlaceCover(item.anchor.id, props.recordIndex, props.covers, props.query)]))
  const layoutMarkers = visibleGroups.map(item => {
    const point = map!.latLngToContainerPoint(asLatLng(item.anchor))
    return { id: item.anchor.id, x: point.x - dimensions.anchorX, y: point.y - dimensions.anchorY,
      width: dimensions.width, height: dimensions.height, anchorX: point.x, anchorY: point.y,
      hasCover: !!coverReferences.get(item.anchor.id), selected: item.anchor.id === props.selectedId }
  })
  const obstacles: Rect[] = []
  visibleGroups.forEach((item, index) => {
    const marker = layoutMarkers[index]!
    const left = marker.x, top = marker.y
    // Reserve even transient hover labels, so revealing a name cannot cover a photo.
    obstacles.push({ x: marker.anchorX - 75, y: top + dimensions.height + 4, width: 150, height: 24 })
    if (item.members.length > 1) {
      const width = Math.max(36, String(item.members.length).length * 7 + 20)
      obstacles.push({ x: left + dimensions.width + 8 - width, y: top, width, height: 22 })
    }
  })
  // UI overlays (controls, north, attribution/scale and status) must also stay clear.
  const size = map.getSize()
  obstacles.push({ x: size.x - 62, y: 10, width: 52, height: 152 },
    { x: 12, y: 12, width: 40, height: 30 }, { x: 0, y: size.y - 62, width: size.x, height: 62 })
  const placements = layoutMapCovers(layoutMarkers, { width: size.x, height: size.y }, obstacles)
  let shown = 0
  let grouped = 0
  for (const item of groups) {
    const place = item.anchor
    const latlng = L.latLng(...asLatLng(place))
    if (!viewport.contains(latlng)) continue
    visible.push(item)
    shown += item.members.length
    if (item.members.length > 1) grouped++
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'yn-pin'
    button.style.width = `${dimensions.width}px`
    button.style.height = `${dimensions.height}px`
    button.dataset.mapPlace = place.id
    button.dataset.longitude = String(place.coordinates[0])
    button.dataset.latitude = String(place.coordinates[1])
    button.dataset.members = item.members.map(member => member.id).join(',')
    const visitedCount = item.members.filter(member => visited.has(member.id)).length
    button.dataset.visited = String(visitedCount > 0)
    button.dataset.visitedCount = String(visitedCount)
    button.dataset.label = String(currentZoom >= 11 && item.members.length === 1)
    button.setAttribute('aria-pressed', String(props.selectedId === place.id))
    button.setAttribute('aria-label', markerLabel(item, visited, props.pickingLocation))
    // svg() only returns internal authored artwork. User names never enter markup.
    button.innerHTML = svg(place.iconKey, { variant: place.id })
    const reference = coverReferences.get(place.id), placement = placements.get(place.id)
    button.dataset.cover = reference ? placement ? 'shown' : 'collapsed' : 'none'
    if (reference && placement) {
      const point = map.latLngToContainerPoint(asLatLng(place))
      const view = createMapPhotoCover(reference, props.revision, photoLoader)
      view.element.style.left = `${placement.x - point.x + dimensions.anchorX}px`
      view.element.style.top = `${placement.y - point.y + dimensions.anchorY}px`
      view.element.style.width = `${placement.width}px`
      view.element.style.height = `${placement.height}px`
      view.element.dataset.compact = String(placement.compact)
      button.append(view.element); photoViews.push(view)
      button.setAttribute('aria-label', `${markerLabel(item, visited, props.pickingLocation)}，封面来自${place.name}的回忆，共 ${reference.photoCount} 张照片`)
    }
    addText(button, 'yn-pin-label', item.members.length > 1 ? `${place.name}附近 · ${item.members.length}处` : place.name)
    if (item.members.length > 1) addText(button, 'yn-cluster-count', `${item.members.length} 处`)
    button.addEventListener('click', () => activateGroup(item))
    L.DomEvent.disableClickPropagation(button)
    markers.addLayer(L.marker(latlng, {
      keyboard: false,
      bubblingMouseEvents: false,
      zIndexOffset: place.id === props.selectedId ? 1000 : 0,
      icon: L.divIcon({
        className: 'yn-map-icon', html: button,
        iconSize: [dimensions.width, dimensions.height],
        iconAnchor: [dimensions.anchorX, dimensions.anchorY],
      }),
    }))
  }
  if (currentZoom < 8.5 && !props.query) {
    for (const feature of props.geography.features.filter(feature => feature.properties.kind === (props.provinceId ? 'region' : 'province'))) {
      const id = props.provinceId ? feature.properties.regionId : String(feature.properties.provinceId || '')
      if (props.regionId && id !== props.regionId) continue
      const bounds = L.geoJSON(feature).getBounds()
      if (!bounds.isValid()) continue
      const region = props.regions.find(region => region.id === id)
      const label = document.createElement('span')
      label.className = 'yn-region-label'
      label.textContent = (region?.name || feature.properties.name || '').replace(/壮族自治区$|回族自治区$|维吾尔自治区$|自治区$|特别行政区$|[省市州]$/u, '')
      if (id) label.dataset.regionLabel = id
      regionLabels.addLayer(L.marker(bounds.getCenter(), {
        interactive: false, keyboard: false, zIndexOffset: -1000,
        icon: L.divIcon({ className: 'yn-map-icon', html: label, iconSize: [80, 18], iconAnchor: [40, 9] }),
      }))
    }
  }
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
    ;(replacement || element.value).focus({ preventScroll: true })
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
  root = element.value.closest<HTMLElement>('#shanhai-lijiang')
  pointerQuery = window.matchMedia('(pointer:coarse)')
  coarsePointer.value = pointerQuery.matches
  map = L.map(element.value, {
    zoomControl: false, attributionControl: true, minZoom: 2, maxZoom: 18,
    zoomSnap: 0.5, zoomDelta: 1, scrollWheelZoom: false,
    dragging: !coarsePointer.value, touchZoom: true,
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
  props.recordIndex, props.covers, props.revision], () => { releasePhotos(); queueMarkers() }, { deep: true })
watch(() => [props.geography, props.provinceId], () => { updateGeography(); queueMarkers() })
onBeforeUnmount(() => {
  releasePhotos()
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
    </div>
    <p class="yn-map-help"><span class="yn-visited-dot"></span>有我的回忆 <span>{{ coarsePointer ? '双指移动或缩放，单指滚动页面；照片随空间展开。' : '照片随空间展开；数字是附近景点数，点击展开。' }}</span></p>
    <p class="yn-map-detail-note">{{ !provinceId ? '点击省区轮廓，或用上方选择框进入。' : '' }}省区轮廓为粗略示意，仅作回忆定位，不用于导航或判定行政归属。</p>
  </div>
</template>
