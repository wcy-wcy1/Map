<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import FootprintMap from './components/FootprintMap.vue'
import SearchToolbar from './components/SearchToolbar.vue'
import PlaceList from './components/PlaceList.vue'
import PlaceDetail from './components/PlaceDetail.vue'
import JourneyDetail from './components/JourneyDetail.vue'
import MemoryEditor from './components/MemoryEditor.vue'
import BackupPanel from './components/BackupPanel.vue'
import PhotoViewer from './components/PhotoViewer.vue'
import MemoryCard from './components/MemoryCard.vue'
import { createMemoryCardRenderer } from './sharing/card-renderer'
import type { RenderMemoryCard } from './sharing/card-types'
import { createCatalogue, publicPlaces, regions } from './domain/catalogue'
import { getProvince } from './domain/provinces'
import { createGeographyService } from './services/geography-service'
import { filter, indexVisits } from './domain/map-layout'
import { createTravelServices, type TravelServices } from './services/travel-services'
import { createPhotoLoader, PHOTO_LOADER_KEY } from './services/photo-loader'
import { toVisitSummary } from './domain/visit-summary'
import type { Coordinates, Cover, Draft, Place, Visit, VisitSummary } from './domain/models'
import type { MergeCounts, TravelServiceError, UndoVisit } from './services/contracts'

// Switching accounts remounts the entire tree; no private repository or photo
// loader is shared between identities. Default entry remains entirely local.
const props = withDefaults(defineProps<{ services?: TravelServices; mode?: 'local' | 'account' }>(), { mode: 'local' })
const emit = defineEmits<{ interaction: [value: boolean] }>()
const accountMode = computed(() => props.mode === 'account')
const catalogue = props.services?.catalogue ?? createCatalogue()
const geographyService = createGeographyService()
const geography = shallowRef(geographyService.base(''))
const geographyLoading = ref(false), geographyError = ref(''), locationError = ref('')
let geographyRequest = 0, geographyController: AbortController | undefined
const services = props.services ?? createTravelServices({ catalogue })
const repository = services.repository
const photoLoader = createPhotoLoader(repository)
provide(PHOTO_LOADER_KEY, photoLoader)
const query = ref(''), provinceId = ref(''), regionId = ref(''), visitedOnly = ref(false)
const currentProvince = computed(() => getProvince(provinceId.value))
const scopeRegions = computed(() => regions.filter(region => region.provinceId === provinceId.value))
const scopePublicCount = computed(() => publicPlaces.filter(place => !provinceId.value || place.mapId === provinceId.value).length)
const areaLabel = computed(() => currentProvince.value?.shortName ?? '全国')
const pickingProvince = ref('')
const selectedId = ref<string | null>(null), groupIds = ref<string[]>([]), limit = ref(12)
const journeyIds = ref<string[]>([])
const visits = shallowRef<VisitSummary[]>([]), covers = shallowRef<Cover[]>([]), catalogueVersion = ref(0)
const libraryRevision = ref(-1), readingRecord = ref(false)
const ready = ref(false), storageMessage = ref(accountMode.value ? '正在读取账号回忆…' : '正在读取本机回忆…'), storageError = ref(false)
const editorOpen = ref(false), editorBusy = ref(false), backupBusy = ref(false), mutationBusy = ref(false), hasDraft = ref(false)
const editorPlaceId = ref(''), editingVisit = shallowRef<Visit | null>(null)
const editor = ref<InstanceType<typeof MemoryEditor> | null>(null), pickingLocation = ref(false)
const activePhoto = shallowRef<{ visit: Visit; index: number } | null>(null), photoStatus = ref('')
const activeCard = shallowRef<{ visit: Visit; placeName: string; selectedPhotoId?: string; render: RenderMemoryCard } | null>(null)
const cardRenderer = createMemoryCardRenderer(catalogue)
const deleteCandidate = shallowRef<Visit | null>(null), deleteError = ref(''), undo = shallowRef<UndoVisit | null>(null)
const deleteDialog = ref<HTMLDialogElement | null>(null), backupHost = ref<HTMLElement | null>(null)
const busy = computed(() => editorBusy.value || backupBusy.value || mutationBusy.value || readingRecord.value)
watch(() => busy.value || editorOpen.value || !!deleteCandidate.value || !!activePhoto.value || !!activeCard.value || pickingLocation.value,
  value => emit('interaction', value), { immediate: true, flush: 'sync' })
const map = ref<InstanceType<typeof FootprintMap> | null>(null)
const app = ref<HTMLElement | null>(null), panel = ref<HTMLElement | null>(null)
const recordIndex = computed(() => indexVisits(visits.value))
const visitedIds = computed(() => [...recordIndex.value.keys()])
const filtered = computed(() => {
  void catalogueVersion.value
  const places = filter(catalogue.all, { query: query.value, provinceId: provinceId.value, regionId: regionId.value, visitedOnly: visitedOnly.value, visitedIds: visitedIds.value, visits: visits.value })
  return visitedOnly.value ? places.sort((a, b) => (recordIndex.value.get(b.id)?.[0]?.date ?? '').localeCompare(recordIndex.value.get(a.id)?.[0]?.date ?? '')) : places
})
const shown = computed(() => groupIds.value.length ? filtered.value.filter(place => groupIds.value.includes(place.id)) : filtered.value)
const selected = computed(() => { void catalogueVersion.value; return selectedId.value ? catalogue.get(selectedId.value) : undefined })
const journeyPlaces = computed(() => { void catalogueVersion.value; return journeyIds.value.map(id => catalogue.get(id)).filter(Boolean) as Place[] })
const hasFilters = computed(() => !!query.value || !!provinceId.value || !!regionId.value || visitedOnly.value)

async function loadGeography() {
  const id = provinceId.value, request = ++geographyRequest
  geographyController?.abort()
  const controller = new AbortController(); geographyController = controller
  geography.value = geographyService.base(id); geographyError.value = ''; geographyLoading.value = id === 'yunnan'
  try {
    const data = await geographyService.load(id, { signal: controller.signal })
    if (!disposed && request === geographyRequest && !controller.signal.aborted) geography.value = data
  } catch (error) {
    if (!disposed && request === geographyRequest && !controller.signal.aborted) geographyError.value = friendly(error, '地图细节暂时无法加载，已保留当前地区轮廓。')
  } finally { if (!disposed && request === geographyRequest) geographyLoading.value = false }
}
watch(provinceId, () => { regionId.value = ''; void loadGeography() }, { flush: 'sync' })
watch([query, regionId, visitedOnly, provinceId], async (values, previous) => {
  cancelRecordRead()
  selectedId.value = null; groupIds.value = []; journeyIds.value = []; limit.value = 12
  await nextTick()
  // A cross-province select also waits for this render. Its explicit landmark
  // focus must win over this earlier, generic scope-fit intention.
  if (disposed || selectedId.value) return
  if (values[3] !== previous[3] || !filtered.value.length || pickingLocation.value) map.value?.fitProvince()
  else if (hasFilters.value) map.value?.fitPlaces(filtered.value)
  else map.value?.fitProvince()
})
function reset() {
  cancelRecordRead()
  provinceId.value = pickingLocation.value ? pickingProvince.value : ''
  query.value = ''; regionId.value = ''; visitedOnly.value = false; selectedId.value = null; groupIds.value = []; journeyIds.value = []; limit.value = 12
  void nextTick(() => map.value?.fitProvince())
}
function showFootprints() { if (!pickingLocation.value) { provinceId.value = ''; regionId.value = ''; query.value = ''; visitedOnly.value = true; journeyIds.value = [] } }
function changeProvince(id: string) { if (!pickingLocation.value && (!id || getProvince(id))) { provinceId.value = id; journeyIds.value = [] } }
async function select(id: string, focusMap = false) {
  cancelRecordRead()
  const place = catalogue.get(id)
  if (!place) return
  const changedScope = !!place.mapId && provinceId.value !== place.mapId
  if (changedScope) { provinceId.value = place.mapId!; await nextTick() }
  selectedId.value = id; journeyIds.value = []
  if (focusMap || changedScope) map.value?.selectPlace(place)
  await nextTick()
  const detail = panel.value?.querySelector<HTMLElement>('.yn-detail')
  detail?.focus({ preventScroll: true })
  if (matchMedia('(max-width:900px)').matches) detail?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' })
}
function backToList() { cancelRecordRead(); selectedId.value = null }
function selectCluster(ids: string[]) { cancelRecordRead(); selectedId.value = null; journeyIds.value = []; groupIds.value = ids; limit.value = 12 }
async function openJourney(ids: readonly string[]) {
  cancelRecordRead()
  const readable = ids.filter(id => catalogue.get(id))
  if (readable.length < 2) return
  selectedId.value = null; groupIds.value = []; journeyIds.value = [...readable]
  await nextTick()
  const detail = panel.value?.querySelector<HTMLElement>('.yn-journey-detail')
  detail?.focus({ preventScroll: true })
  if (matchMedia('(max-width:900px)').matches) detail?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' })
}
function message(text: string, error = false) { storageMessage.value = text; storageError.value = error }
function friendly(error: unknown, fallback: string) { return (error as TravelServiceError)?.friendlyMessage || fallback }
let loading: Promise<boolean> | null = null, disposed = false, firstRead = true
let pendingRead: AbortController | null = null
function cancelRecordRead() { pendingRead?.abort(); pendingRead = null; readingRecord.value = false }
function invalidateIndex() { ready.value = false; libraryRevision.value = -1; photoLoader.clear() }
function reload(force = false): Promise<boolean> {
  if (disposed) return Promise.resolve(false)
  if (!force && (busy.value || editorOpen.value || deleteCandidate.value || activePhoto.value || activeCard.value)) return Promise.resolve(false)
  // A post-write refresh must start after an older read has settled. Reusing a
  // pre-write snapshot would falsely report that the new state was refreshed.
  if (loading) return force ? loading.then(() => reload(true)) : loading
  loading = (async () => {
    try {
      const snapshot = await repository.loadIndex()
      if (disposed) return false
      catalogue.replaceCustomPlaces(snapshot.visits)
      if (libraryRevision.value !== snapshot.revision) photoLoader.clear()
      libraryRevision.value = snapshot.revision
      visits.value = snapshot.visits; covers.value = snapshot.covers; catalogueVersion.value++
      ready.value = true
      if (firstRead && snapshot.visits.length) visitedOnly.value = true
      firstRead = false
      message(accountMode.value ? (snapshot.visits.length ? `账号资料 · 已找回 ${snapshot.visits.length} 条记录` : '账号资料为空，从一个去过的地点开始。')
        : snapshot.visits.length ? `本机保存 · 已找回 ${snapshot.visits.length} 条记录` : '本机保存 · 照片和手记不上传')
      try { const exists = await repository.hasDraft(); if (!disposed) hasDraft.value = exists }
      catch (error) { if (!disposed) message(friendly(error, '回忆已读取，草稿暂时无法读取。'), true) }
      return !disposed
    } catch (error) {
      if (!disposed) { invalidateIndex(); message(friendly(error, '暂时无法读取回忆，原有内容没有更改。请重新读取。'), true) }
      return false
    } finally { loading = null }
  })()
  return loading
}
async function withStoredVisit(summary: VisitSummary, open: (visit: Visit, isCurrent: () => boolean) => void | Promise<void>) {
  if (!ready.value || busy.value || editorOpen.value || activePhoto.value || activeCard.value || deleteCandidate.value) return
  const controller = new AbortController(), revision = libraryRevision.value
  pendingRead = controller; readingRecord.value = true
  const isCurrent = () => !disposed && pendingRead === controller && !controller.signal.aborted
  try {
    const visit = await repository.readVisit(summary.id, { signal: controller.signal, expectedRevision: revision })
    if (!isCurrent()) return
    if (!visit) { invalidateIndex(); message('这次回忆已在其他页面移除。请重新读取后查看。', true); return }
    await open(visit, isCurrent)
  } catch (error) {
    if (isCurrent()) {
      invalidateIndex()
      message(friendly(error, '这次回忆暂时无法打开，原有内容没有更改。请重新读取后重试。'), true)
    }
  } finally { if (pendingRead === controller) { pendingRead = null; readingRecord.value = false } }
}
function openRecord(placeId = '', summary: VisitSummary | null = null) {
  if (summary) return withStoredVisit(summary, visit => { editorPlaceId.value = visit.placeId; editingVisit.value = visit; editorOpen.value = true })
  if (!ready.value || busy.value || editorOpen.value || activePhoto.value || activeCard.value || deleteCandidate.value) return
  editorPlaceId.value = placeId; editingVisit.value = null; editorOpen.value = true
}
function hideEditor() { editorOpen.value = false; editingVisit.value = null; pickingLocation.value = false; locationError.value = '' }
function closeEditor() {
  if (disposed || !editorOpen.value) return
  hideEditor(); invalidateIndex()
  // Other pages can change or delete records while the editor owns a draft.
  // Closing resumes a fresh summary read; keeping a draft is not a visit save.
  message(accountMode.value ? '正在重新读取账号回忆…' : '正在重新读取本机回忆…')
  void reload(true)
}
async function saved(visit: Visit, result: { edited: boolean; draftWarning?: string }) {
  if (disposed) return
  // MemoryEditor emits saved and then close. Only this path refreshes a save.
  hideEditor(); invalidateIndex()
  const refreshed = await reload(true)
  if (disposed) return
  if (!refreshed) {
    const summary = toVisitSummary(visit)
    visits.value = visits.value.some(row => row.id === visit.id)
      ? visits.value.map(row => row.id === visit.id ? summary : row) : [...visits.value, summary]
    catalogue.replaceCustomPlaces(visits.value); catalogueVersion.value++
  }
  query.value = ''; regionId.value = ''; visitedOnly.value = true
  // The server assigns a stable private-place identity. Prefer the committed
  // index rather than the editor's pre-upload temporary location identity.
  const savedPlaceId = visits.value.find(row => row.id === visit.id)?.placeId ?? visit.placeId
  await nextTick(); if (disposed) return
  await select(savedPlaceId, true)
  if (disposed) return
  message(!refreshed ? '回忆已保存，其他记录暂时无法刷新，请重新读取。'
    : result.draftWarning || (result.edited ? '回忆已更新。' : '回忆已保存，可以从这个地点再次找回。'), !refreshed || !!result.draftWarning)
}
async function beginPicking(custom: NonNullable<Draft['customPlace']>) {
  const province = catalogue.provinceForRegion(custom.regionId)
  if (!province) { locationError.value = '请先选择省份或地区。'; return }
  pickingProvince.value = province.id; provinceId.value = province.id; locationError.value = ''
  pickingLocation.value = true; selectedId.value = null; groupIds.value = []
  query.value = ''; regionId.value = ''; visitedOnly.value = false
  await nextTick(); map.value?.fitProvince()
  const element = app.value?.querySelector<HTMLElement>('#yn-map'); element?.scrollIntoView({ block: 'center' }); element?.focus({ preventScroll: true })
}
async function acceptLocation(point: Coordinates) { locationError.value = ''; if (await editor.value?.acceptLocation(point)) pickingLocation.value = false }
function cancelPicking() { pickingLocation.value = false; locationError.value = ''; editor.value?.cancelLocationPick() }
async function afterImport(result: MergeCounts & { replayed?: boolean }) {
  invalidateIndex()
  if (!await reload(true)) throw new Error('回忆已保存，但页面暂时无法刷新。')
  message(result.replayed ? '这份备份已在其他页面导入，本次没有重复写入。' : `已导入 ${result.added} 条记录，跳过 ${result.skipped} 条已有记录。`)
}
function jumpToBackup() {
  const section = backupHost.value?.querySelector('details')
  if (section) { section.open = true; section.scrollIntoView({ block: 'start' }); section.querySelector('summary')?.focus() }
}
function viewPhoto(summary: VisitSummary, index: number) {
  const photoId = summary.photos[index]?.id
  if (!photoId) return
  return withStoredVisit(summary, visit => {
    const actualIndex = visit.photos.findIndex(photo => photo.id === photoId)
    if (actualIndex < 0) throw new Error('Photo reference changed')
    activePhoto.value = { visit, index: actualIndex }; photoStatus.value = ''
  })
}
function openCard(summary: VisitSummary) { return withStoredVisit(summary, (visit, isCurrent) => openLoadedCard(visit, undefined, isCurrent)) }
async function openLoadedCard(visit: Visit, selectedPhotoId?: string, isCurrent = () => !disposed) {
  const place = catalogue.get(visit.placeId)
  if (!place) { message('这个地点暂时无法读取，回忆没有更改。请重新读取后重试。', true); return }
  // Freeze the trusted place label with this selection. An older in-flight
  // catalogue refresh must not change the title between selection and export.
  const placeId = place.id, placeName = place.name
  const render = createMemoryCardRenderer({
    has: id => id === placeId,
    get: id => id === placeId ? { name: placeName } : undefined,
  }).render
  activePhoto.value = null
  await nextTick()
  if (isCurrent()) activeCard.value = { visit, placeName, selectedPhotoId, render }
}
function shareCurrentPhoto(photoId: string) {
  if (activePhoto.value && !busy.value) void openLoadedCard(activePhoto.value.visit, photoId)
}
async function setCover(photoId: string) {
  if (!activePhoto.value || busy.value) return
  const visit = activePhoto.value.visit
  mutationBusy.value = true; photoStatus.value = '正在保存地点封面…'
  try {
    if (loading) await loading
    const cover = await repository.setMapCover(visit.placeId, { visitId: visit.id, photoId })
    covers.value = [...covers.value.filter(row => row.placeId !== cover.placeId), cover]
    invalidateIndex()
    const refreshed = await reload(true)
    photoStatus.value = refreshed ? '已设为地点封面。' : '封面已保存，列表暂时无法刷新；关闭照片后请重新读取。'
  } catch (error) { photoStatus.value = friendly(error, '封面尚未保存，请重试。') }
  finally { mutationBusy.value = false }
}
function askDelete(summary: VisitSummary) {
  return withStoredVisit(summary, async (visit, isCurrent) => {
    deleteCandidate.value = visit; deleteError.value = ''
    await nextTick(); if (isCurrent()) deleteDialog.value?.showModal()
    else deleteCandidate.value = null
  })
}
function closeDelete() {
  if (mutationBusy.value) return
  deleteDialog.value?.close(); deleteCandidate.value = null
  panel.value?.querySelector<HTMLElement>('.yn-detail')?.focus({ preventScroll: true })
}
async function removeVisit() {
  if (!deleteCandidate.value || busy.value) return
  mutationBusy.value = true
  try {
    const visit = deleteCandidate.value
    const removed = await repository.deleteVisit(visit.id, { expectedVisit: visit })
    undo.value = accountMode.value ? null : removed
    invalidateIndex()
    const refreshed = await reload(true)
    if (!refreshed) { visits.value = visits.value.filter(row => row.id !== visit.id); covers.value = covers.value.filter(row => row.visitId !== visit.id); catalogue.replaceCustomPlaces(visits.value); catalogueVersion.value++ }
    deleteDialog.value?.close(); deleteCandidate.value = null
    message(accountMode.value ? (refreshed ? '账号中的回忆已删除；原相册没有更改。' : '删除已确认，列表暂时无法刷新，请重新读取。')
      : refreshed ? '回忆已删除，可撤销最近一次删除；原相册没有更改。' : '回忆已删除，可撤销；其他记录暂时无法刷新，请重新读取。', !refreshed)
  } catch (error) { deleteError.value = friendly(error, '删除未完成，原回忆没有更改。') }
  finally { mutationBusy.value = false }
}
async function undoDelete() {
  if (!undo.value || busy.value) return
  const token = undo.value; mutationBusy.value = true
  try {
    const restored = await repository.restoreVisit(token); undo.value = null
    invalidateIndex()
    const refreshed = await reload(true)
    if (!refreshed) {
      visits.value = [...visits.value.filter(row => row.id !== restored.visit.id), toVisitSummary(restored.visit)]
      const restoredPlaces = new Set(restored.covers.map(cover => cover.placeId))
      covers.value = [...covers.value.filter(cover => !restoredPlaces.has(cover.placeId)), ...restored.covers]
      catalogue.replaceCustomPlaces(visits.value); catalogueVersion.value++
    }
    await select(token.visit.placeId)
    message(refreshed ? '已恢复这次回忆及照片。' : '回忆已恢复，其他记录暂时无法刷新，请重新读取。', !refreshed)
  } catch (error) { message(friendly(error, '恢复尚未完成，请重试。'), true) }
  finally { mutationBusy.value = false }
}
const backgroundReload = () => { if (!document.hidden) void reload() }
let observer: ResizeObserver | undefined
function sizeMap() {
  const element = app.value?.querySelector<HTMLElement>('#yn-map')
  if (element) app.value?.style.setProperty('--yn-map-top', `${Math.round(element.getBoundingClientRect().top + window.scrollY)}px`)
}
onMounted(() => {
  observer = new ResizeObserver(sizeMap)
  for (const selector of ['.yn-header', '.yn-toolbar', '.yn-storage', '.yn-account-bar']) {
    const element = app.value?.querySelector(selector)
    if (element) observer.observe(element)
  }
  window.addEventListener('resize', sizeMap); sizeMap()
  window.addEventListener('focus', backgroundReload); document.addEventListener('visibilitychange', backgroundReload)
  void reload()
})
onBeforeUnmount(() => {
  disposed = true; observer?.disconnect(); window.removeEventListener('resize', sizeMap)
  geographyController?.abort(); geographyService.close()
  cancelRecordRead(); photoLoader.close()
  window.removeEventListener('focus', backgroundReload); document.removeEventListener('visibilitychange', backgroundReload)
  void repository.close()
})
defineExpose({ refresh: () => reload(true) })
</script>

<template>
  <main id="shanhai-lijiang" ref="app" class="yn-app" aria-label="山海集旅行回忆地图">
    <header class="yn-header">
      <a class="yn-brand" href="#" aria-label="山海集，回到全国总览" @click.prevent="reset"><span>山海集</span><small>把走过的地方，留在地图上。</small></a>
      <nav aria-label="个人记录"><button type="button" :disabled="pickingLocation" @click="showFootprints">我的足迹 <span class="yn-total">{{ visitedIds.length }}</span></button><button v-if="!accountMode" type="button" @click="jumpToBackup">备份</button><button type="button" :disabled="!ready || busy || editorOpen" @click="openRecord()">记一下</button></nav>
    </header>
    <slot name="account" />
    <div class="yn-storage" role="status" :data-error="storageError"><span>{{ storageMessage }}</span><button v-if="storageError" type="button" :disabled="busy || editorOpen" @click="reload()">重新读取</button><button v-if="hasDraft" type="button" :disabled="!ready || busy || editorOpen" @click="openRecord()">继续草稿</button></div>
    <p v-if="!accountMode" class="yn-migration-note">新版迁移试用：尚未替换旧入口，仍需完整兼容与真机验收。不同网址和端口不共享本机记录，迁移请导入备份；请保留原照片。<a href="http://127.0.0.1:8767/app">打开旧版</a></p>
    <p v-else class="yn-migration-note">账号联调版：保存时会上传照片副本和手记到这台电脑的服务端，不是云服务。旧本机资料不会自动上传；草稿仅存本浏览器。账号备份、旧库迁移和删除撤销尚未接入，请保留原片。</p>
    <SearchToolbar v-model:query="query" v-model:region-id="regionId" v-model:visited-only="visitedOnly" :province-id="provinceId" :regions="scopeRegions" :place-count="scopePublicCount" :disabled="pickingLocation" @update:province-id="changeProvince" />
    <p v-if="geographyLoading" role="status">正在加载云南的州市与水系细节，回忆仍可使用。</p>
    <p v-if="geographyError" class="yn-record-error" role="alert">{{ geographyError }} <button type="button" @click="loadGeography">重试地图细节</button></p>
    <div v-if="pickingLocation" class="yn-location-banner" role="status"><strong>在{{ areaLabel }}地图上点选这个地点的位置</strong><p>位置由你确认，仅用于保存旅行回忆。地区轮廓较粗略，不是导航地图。</p><p v-if="locationError" class="yn-record-error" role="alert">{{ locationError }}</p><button type="button" @click="cancelPicking">返回填写</button></div>
    <div v-if="undo && !accountMode" class="yn-undo" role="status"><span>最近删除的回忆还可以恢复。</span><button type="button" :disabled="busy" @click="undoDelete">撤销删除</button></div>
    <section class="yn-workspace">
      <FootprintMap ref="map" :places="filtered" :geography="geography" :province-id="provinceId" :area-label="areaLabel" :regions="scopeRegions" :visited-ids="visitedIds" :selected-id="selectedId" :record-index="recordIndex" :covers="covers" :revision="libraryRevision" :query="query" :region-id="regionId" :picking-location="pickingLocation" @select="select($event)" @province="changeProvince" @cluster="selectCluster" @journey="openJourney" @reset="reset" @pick="acceptLocation" />
      <aside ref="panel" class="yn-panel" aria-label="景点与回忆">
        <p v-if="readingRecord" role="status">正在打开这次回忆… <button type="button" @click="cancelRecordRead">取消打开</button></p>
        <PlaceDetail v-if="selected" :place="selected" :visits="recordIndex.get(selected.id) ?? []" :revision="libraryRevision" :query="query" :disabled="!ready || busy || editorOpen" @back="backToList" @add="openRecord(selected.id)" @edit="openRecord($event.placeId, $event)" @delete="askDelete" @view-photo="viewPhoto" @share="openCard($event)" />
        <JourneyDetail v-else-if="journeyIds.length" :place-ids="journeyIds" :places="journeyPlaces" :record-index="recordIndex" :covers="covers" :revision="libraryRevision" @back="journeyIds = []" @select="select($event, true)" @add="openRecord" @view-photo="viewPhoto" />
        <template v-else>
          <p v-if="provinceId && !scopePublicCount && !visitedOnly" class="yn-list-intro">{{ areaLabel }}的公共景点目录尚在整理，可以先添加自己的地点。省区轮廓不等于景点已完整覆盖。</p>
          <p v-if="groupIds.length" class="yn-cluster-intro">这些地点相邻，选择一个查看。<button type="button" @click="groupIds = []">返回全部结果</button></p>
          <PlaceList :places="shown" :record-index="recordIndex" :covers="covers" :revision="libraryRevision" :query="query" :limit="limit" :has-filters="hasFilters" :visited-only="visitedOnly" @select="select($event, true)" @more="limit += 12" @reset="reset" />
          <button type="button" :disabled="!ready || busy || editorOpen" @click="openRecord('__custom')">没有这个地点？自己记一个</button>
        </template>
      </aside>
    </section>
    <div v-if="!accountMode" ref="backupHost"><BackupPanel :services="services" :disabled="editorOpen || mutationBusy || readingRecord" :on-committed="afterImport" @busy="backupBusy = $event" /></div>
    <MemoryEditor ref="editor" :open="editorOpen" :place-id="editorPlaceId" :province-id="provinceId" :visit="editingVisit" :repository="repository" :catalogue="catalogue" :account-mode="accountMode" @close="closeEditor" @saved="saved" @busy="editorBusy = $event" @draft-change="hasDraft = $event" @pick-location="beginPicking" @location-error="locationError = $event" />
    <PhotoViewer :visit="activePhoto?.visit ?? null" :index="activePhoto?.index ?? 0" :busy="mutationBusy" :status="photoStatus" @close="activePhoto = null" @cover="setCover" @share="shareCurrentPhoto" />
    <MemoryCard :visit="activeCard?.visit ?? null" :place-name="activeCard?.placeName ?? ''" :selected-photo-id="activeCard?.selectedPhotoId" :render-card="activeCard?.render ?? cardRenderer.render" @close="activeCard = null" />
    <dialog ref="deleteDialog" class="yn-record-dialog" aria-labelledby="yn-delete-title" @cancel.prevent="closeDelete">
      <h2 id="yn-delete-title">删除这次回忆？</h2><p>{{ deleteCandidate?.date }} · {{ deleteCandidate?.photos.length }} 张照片。不会删除原相册中的照片。</p>
      <p v-if="accountMode">这会删除账号中的回忆与对应照片副本，其他会话同步后也将移除。账号模式暂不支持撤销，请确认原片已保留。</p><p v-else>可在本页撤销最近一次删除；离开页面后，请使用事先保留的备份找回。</p><p v-if="deleteError" role="alert">{{ deleteError }}</p>
      <div class="yn-detail-actions"><button type="button" :disabled="mutationBusy" @click="closeDelete">保留回忆</button><button type="button" :disabled="mutationBusy" @click="removeVisit">确认删除</button></div>
    </dialog>
    <footer class="yn-footer"><p>省区选择已扩展，公共景点目前仍为云南 43 处。个人地点由你确认；照片请保留原件并定期备份。</p><details><summary>地图与资料来源</summary><p>坐标使用 WGS84，仅作旅行回忆示意，不是导航入口或精确行政归属判断。图标是简化意象，不是建筑测绘复原。</p><p>省区示意数据来自 <a href="https://www.geoboundaries.org/api/current/gbOpen/CHN/ADM1/" target="_blank" rel="noopener noreferrer">geoBoundaries / Wikimedia Commons</a>（原资料标记为 2019 年，存在精度与更新限制）。<a href="/data/china-provinces.geojson" download>下载省区示意数据</a>。本机开发版未完成公开地图上线审核。</p><p>云南详细地理数据 © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> · ODbL。<a href="/data/SOURCES.md" target="_blank" rel="noopener noreferrer">来源与重建说明</a> · <a href="/data/yunnan-geography.geojson" download>下载云南衍生地理数据</a></p><p>公共景点资料及坐标来源保留在各地点详情中。这里不提供实时攻略、票价和开放状态。</p></details></footer>
  </main>
</template>
