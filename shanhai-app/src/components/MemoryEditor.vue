<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Coordinates, Draft, Visit } from '../domain/models'
import type { LocalRepository, TravelCatalogue, TravelServiceError } from '../services/contracts'
import { copy, localToday, newDraft, sameVisit, visitFromDraft } from '../editor/draft'
import { importPhotos, secureId, type PhotoFailure } from '../editor/photos'
import './memory-editor.css'

const props = defineProps<{ open: boolean; placeId?: string; provinceId?: string; visit?: Visit | null; repository: LocalRepository; catalogue: TravelCatalogue; accountMode?: boolean }>()
const emit = defineEmits<{
  close: []
  saved: [visit: Visit, result: { edited: boolean; draftWarning?: string }]
  busy: [value: boolean]
  'pick-location': [custom: NonNullable<Draft['customPlace']>]
  'location-error': [message: string]
  'draft-change': [value: boolean]
}>()
const dialog = ref<HTMLDialogElement>(), noteInput = ref<HTMLTextAreaElement>(), closeCancel = ref<HTMLButtonElement>()
const draft = ref<Draft | null>(null), busy = ref(false), dirty = ref(false), error = ref(''), status = ref(''), statusFailed = ref(false)
const initialising = ref(false), resumed = ref(false), closing = ref(false), discarding = ref(false), duplicate = ref(false), conflict = ref(false)
const replacing = ref(false), forking = ref(false), copying = ref(false), canCopy = ref(false), picking = ref(false)
const photoErrors = ref<PhotoFailure[]>([]), progress = ref('')
const unreadable = ref<TravelServiceError['recoverableDraft']>(), removeUnreadable = ref(false)
const editorProvinceId = ref('yunnan')
let revision = 0, version: string | null = null, queue = Promise.resolve(), timer: ReturnType<typeof setTimeout> | undefined
let forkCandidate: Draft | null = null, photoController: AbortController | undefined, disposed = false, trigger: HTMLElement | null = null
const choice = computed(() => draft.value?.customPlace ? '__custom' : draft.value?.placeId ?? '')
const title = computed(() => draft.value?.originalVisit ? '编辑这段回忆' : '记一段旅行')
const selectedPlaceName = computed(() => draft.value?.customPlace?.name.trim() || props.catalogue.get(draft.value?.placeId || '')?.name || '还没选地点')
const memoryBrief = computed(() => {
  if (!draft.value) return []
  return [
    draft.value.photos.length ? `${draft.value.photos.length} 张照片` : '未加照片',
    selectedPlaceName.value,
    draft.value.date || '未选日期',
  ]
})
const contentHint = computed(() => {
  if (!draft.value) return ''
  if (draft.value.photos.length && draft.value.note.trim()) return '照片和手记都在了，可以保存成一段完整回忆。'
  if (draft.value.photos.length) return '已有照片；再补一句当时的感觉，会更像你的旅行册。'
  if (draft.value.note.trim()) return '已有手记；也可以只保存文字，之后再补照片。'
  return '先选照片，或先写一句手记，都可以开始。'
})
const customProvinceId = computed(() => props.catalogue.provinceForRegion(draft.value?.customPlace?.regionId || '')?.id || 'yunnan')
const customRegions = computed(() => props.catalogue.regions.filter(region => region.id !== customProvinceId.value && props.catalogue.provinceForRegion(region.id)?.id === customProvinceId.value))
const availablePlaces = computed(() => props.catalogue.all.filter(place => !editorProvinceId.value || place.mapId === editorProvinceId.value || place.id === draft.value?.placeId))
const message = (cause: unknown, fallback: string) => {
  const detail = cause as TravelServiceError | undefined
  return detail?.friendlyMessage || detail?.message || fallback
}
function setError(cause: unknown, fallback: string) {
  error.value = message(cause, fallback)
  if ((cause as TravelServiceError | undefined)?.code === 'draft-conflict') conflict.value = true
}
function stopTimer() { if (timer !== undefined) clearTimeout(timer); timer = undefined }
function changed() {
  revision++; dirty.value = true
  status.value = conflict.value ? '本页有更改，草稿冲突尚未处理，请保留当前页面。' : '草稿有更改，正在准备保存…'
  statusFailed.value = conflict.value
  closing.value = false; discarding.value = false; duplicate.value = false; copying.value = false; replacing.value = false; forking.value = false; forkCandidate = null
  stopTimer()
  if (!conflict.value) timer = setTimeout(() => { void persist().catch(() => {}) }, 450)
  emit('draft-change', true)
}
async function persist(): Promise<void> {
  stopTimer()
  const source = draft.value
  if (!source) return
  const snapshot = copy(source), savedRevision = revision
  snapshot.updatedAt = Date.now()
  const work = queue.then(async () => {
    if (disposed) return
    status.value = '正在保存草稿…'
    // Read the CAS version after the preceding queued write, never at enqueue.
    const saved = await props.repository.saveDraft(snapshot, { expectedVersion: version })
    if (draft.value === source) {
      version = saved.version; source.version = saved.version; source.updatedAt = saved.updatedAt
      if (revision === savedRevision) { dirty.value = false; status.value = '草稿已保存到本机'; statusFailed.value = false }
    }
  })
  queue = work.catch(cause => {
    if (draft.value !== source || disposed) return
    dirty.value = true; statusFailed.value = true
    status.value = message(cause, '草稿尚未存到本机。') + ' 请保留当前页面。'
    if ((cause as TravelServiceError)?.code === 'draft-conflict') conflict.value = true
  })
  return work
}
function resetPrompts() {
  closing.value = false; discarding.value = false; duplicate.value = false; replacing.value = false; forking.value = false; copying.value = false; canCopy.value = false
}
function adopt(value: Draft, restored: boolean) {
  draft.value = copy(value); version = value.version ?? null; dirty.value = false; revision++
  editorProvinceId.value = props.catalogue.provinceForRegion(value.customPlace?.regionId || props.catalogue.get(value.placeId)?.regionId || '')?.id || (restored ? 'yunnan' : props.provinceId) || 'yunnan'
  if (!restored && draft.value.customPlace && !draft.value.customPlace.regionId && editorProvinceId.value !== 'yunnan') draft.value.customPlace.regionId = editorProvinceId.value
  resumed.value = restored; conflict.value = false; forkCandidate = null; resetPrompts(); error.value = ''; photoErrors.value = []
  status.value = restored ? '已恢复本机草稿' : ''; statusFailed.value = false
  emit('draft-change', restored)
}
async function show() {
  await nextTick()
  if (!props.open || disposed || picking.value || !dialog.value) return
  if (!dialog.value.open) {
    if (typeof dialog.value.showModal === 'function') dialog.value.showModal()
    else dialog.value.setAttribute('open', '')
  }
  await nextTick()
  if (draft.value) noteInput.value?.focus(); else dialog.value.focus()
}
function hide() {
  if (dialog.value?.open) {
    if (typeof dialog.value.close === 'function') dialog.value.close()
    else dialog.value.removeAttribute('open')
  }
}
async function initialise() {
  trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
  if (draft.value) { resumed.value = true; await show(); return }
  initialising.value = true; busy.value = true; error.value = ''; unreadable.value = undefined; removeUnreadable.value = false
  await show()
  try {
    const saved = await props.repository.loadDraft()
    if (disposed) return
    adopt(saved ?? newDraft(props.catalogue, props.placeId, props.visit), !!saved)
  } catch (cause) {
    setError(cause, '无法读取本机草稿，请重试；没有覆盖任何内容。')
    unreadable.value = (cause as TravelServiceError).recoverableDraft
  } finally { initialising.value = false; busy.value = false; await show() }
}
function finishClose() {
  closing.value = false; hide(); emit('close')
  if (trigger?.isConnected) trigger.focus({ preventScroll: true })
}
async function requestClose() {
  if (busy.value) return
  if (dirty.value) { closing.value = true; await nextTick(); closeCancel.value?.focus(); return }
  finishClose()
}
async function saveAndClose() {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await persist(); finishClose() }
  catch (cause) { setError(cause, '草稿还未保存，请继续保留当前页面。') }
  finally { busy.value = false }
}
function continueEditing() { resetPrompts(); void nextTick(() => noteInput.value?.focus()) }
function changePlace(event: Event) {
  const source = draft.value
  if (!source) return
  const value = (event.target as HTMLSelectElement).value
  try {
    if (value === '__custom') {
      if (!editorProvinceId.value) editorProvinceId.value = props.provinceId || 'yunnan'
      source.customPlace = { id: secureId('custom-'), name: '', regionId: editorProvinceId.value === 'yunnan' ? '' : editorProvinceId.value, coordinates: null }; source.placeId = source.customPlace.id
    } else {
      const place = props.catalogue.get(value)
      source.placeId = value
      if (place?.customPlace) source.customPlace = copy(place.customPlace); else delete source.customPlace
    }
    changed()
  } catch (cause) { setError(cause, '地点暂时无法创建，请重试。') }
}
function changeCustomProvince(event: Event) {
  const custom = draft.value?.customPlace
  if (!custom) return
  const value = (event.target as HTMLSelectElement).value
  editorProvinceId.value = value
  custom.regionId = value === 'yunnan' ? '' : value
  custom.coordinates = null
  error.value = ''
  changed()
}
function changeCustomRegion() {
  if (!draft.value?.customPlace) return
  draft.value.customPlace.coordinates = null
  error.value = ''
  changed()
}
async function choosePhotos(event: Event) {
  const input = event.target as HTMLInputElement, selected = Array.from(input.files ?? []), source = draft.value
  if (busy.value || !source || !selected.length) return
  busy.value = true; photoErrors.value = []; error.value = ''; photoController = new AbortController()
  try {
    const result = await importPhotos(selected, { existingCount: source.photos.length, signal: photoController.signal, onProgress: value => { progress.value = `已处理 ${value.completed} / ${value.total} 张` } })
    if (disposed || source !== draft.value) return
    source.photos.push(...result.photos)
    if (!source.coverId) source.coverId = source.photos[0]?.id ?? null
    photoErrors.value = result.errors
    if (result.photos.length) changed()
  } catch (cause) { if (!disposed) setError(cause, '照片处理未完成，已有内容仍保留。') }
  finally { input.value = ''; progress.value = ''; photoController = undefined; busy.value = false }
}
function removePhoto(id: string) {
  if (!draft.value || busy.value) return
  draft.value.photos = draft.value.photos.filter(photo => photo.id !== id)
  if (draft.value.coverId === id) draft.value.coverId = draft.value.photos[0]?.id ?? null
  changed()
}
function chooseCover(id: string) { if (draft.value && !busy.value) { draft.value.coverId = id; changed() } }
async function save(allowDuplicate = false) {
  if (busy.value || !draft.value) return
  const source = draft.value
  error.value = ''
  let visit: Visit
  try { visit = visitFromDraft(source, props.catalogue) }
  catch (cause) { setError(cause, '请检查日期、地点和回忆内容。'); noteInput.value?.focus(); return }
  const edited = !!source.originalVisit
  busy.value = true; stopTimer()
  try {
    await persist()
    if (disposed) return
    const reconciled = await props.repository.reconcilePendingVisit?.(visit)
    if (disposed) return
    const current = await props.repository.loadIndex()
    if (disposed) return
    const existing = current.visits.some(row => row.id === visit.id)
      ? await props.repository.readVisit(visit.id, { expectedRevision: current.revision })
      : null
    if (disposed) return
    const alreadySaved = !!reconciled || !!existing && sameVisit(existing, visit)
    if (reconciled) visit = reconciled
    if (existing && !alreadySaved && !source.originalVisit) {
      canCopy.value = true; error.value = '另一页已经保存了这份草稿对应的回忆。本页内容仍保留，可以另存为一条新回忆。'; return
    }
    if (!alreadySaved && !source.originalVisit && !allowDuplicate && current.visits.some(row => row.id !== visit.id && row.placeId === visit.placeId && row.date === visit.date)) {
      duplicate.value = true; return
    }
    if (!alreadySaved) {
      if (source.originalVisit) visit = await props.repository.updateVisit(visit, { expectedVisit: copy(source.originalVisit) })
      else {
        await props.repository.addVisit(visit)
        // Remote transforms may replace photo and private-place identities.
        // A write receipt is distinct from comparing re-encoded photo bytes.
        const committed = await props.repository.reconcilePendingVisit?.(visit)
        if (committed) visit = committed
      }
    }
    if (disposed) return
    let draftWarning: string | undefined
    try {
      await props.repository.clearDraft(source.id, { expectedVersion: version })
      draft.value = null; version = null; emit('draft-change', false)
    } catch (cause) {
      // The visit already committed. Report that fact without retrying addVisit
      // or pretending that cleanup succeeded; keep the same identity for retry.
      source.originalVisit = copy(visit)
      draftWarning = '回忆已保存，但草稿未清理。' + message(cause, '请继续草稿检查。')
      if ((cause as TravelServiceError)?.code === 'draft-conflict') conflict.value = true
    }
    dirty.value = false; resetPrompts(); emit('saved', visit, { edited, ...(draftWarning ? { draftWarning } : {}) }); finishClose()
  } catch (cause) {
    setError(cause, '保存没有完成，请重试。'); dirty.value = true
    if (['stale', 'missing', 'VERSION_CONFLICT', 'RESOURCE_DELETED'].includes((cause as TravelServiceError).code ?? '')) canCopy.value = true
    if (!error.value.includes('当前草稿仍保留')) error.value += ' 当前草稿仍保留。'
  } finally { busy.value = false }
}
async function discard() {
  if (busy.value || !draft.value) return
  if (!discarding.value) { discarding.value = true; return }
  busy.value = true; stopTimer(); error.value = ''
  try {
    await queue
    await props.repository.clearDraft(draft.value.id, { expectedVersion: version })
    draft.value = null; version = null; dirty.value = false; emit('draft-change', false); finishClose()
  } catch (cause) { setError(cause, '草稿未移除，当前内容仍保留。'); discarding.value = false }
  finally { busy.value = false }
}
async function checkDraftSlot() {
  if (busy.value || !draft.value) return
  busy.value = true; error.value = ''; stopTimer()
  try {
    await queue
    const incoming = await props.repository.loadDraft()
    if (incoming) { error.value = '本机已有另一份草稿。本页内容仍保留；可以确认后载入另一份草稿。'; forking.value = false }
    else { forking.value = true; replacing.value = false; status.value = '本机草稿已被清空。本页内容尚未另存，请确认后再创建新草稿。' }
  } catch (cause) { setError(cause, '无法检查草稿，请保留当前页面。') }
  finally { busy.value = false }
}
async function replaceDraft() {
  if (busy.value) return
  if (!replacing.value) { replacing.value = true; forking.value = false; return }
  busy.value = true; stopTimer()
  try {
    await queue
    const incoming = await props.repository.loadDraft()
    if (!incoming) { replacing.value = false; forking.value = true; return }
    adopt(incoming, true)
    await nextTick(); noteInput.value?.focus()
  } catch (cause) { setError(cause, '另一份草稿无法读取，本页内容仍保留。'); replacing.value = false }
  finally { busy.value = false }
}
async function forkDraft() {
  const source = draft.value
  if (busy.value || !source || !forking.value) return
  busy.value = true; error.value = ''; stopTimer()
  try {
    await queue
    if (!forkCandidate) {
      forkCandidate = { ...copy(source), id: secureId('draft-'), visitId: secureId('visit-'), createdAt: Date.now(), updatedAt: Date.now() }
      delete forkCandidate.version; delete forkCandidate.originalVisit
    }
    const saved = await props.repository.saveDraft(copy(forkCandidate), { expectedVersion: null })
    adopt(saved, true); status.value = '本页内容已另存为新草稿，尚未保存为回忆。确认后点“保存回忆”。'
  } catch (cause) { setError(cause, '本页草稿尚未另存，请保留当前页面。'); dirty.value = true }
  finally { busy.value = false; await nextTick(); noteInput.value?.focus() }
}
async function saveCopy() {
  if (!draft.value || busy.value) return
  if (!copying.value) { copying.value = true; return }
  try {
    draft.value.visitId = secureId('visit-'); draft.value.createdAt = Date.now(); delete draft.value.originalVisit
    changed(); canCopy.value = false
    await save(true)
  } catch (cause) { setError(cause, '暂时无法创建新回忆，当前内容仍保留。') }
}
async function recoverUnreadable() {
  if (busy.value || !unreadable.value) return
  if (!removeUnreadable.value) { removeUnreadable.value = true; return }
  busy.value = true
  try { await props.repository.clearDraft(unreadable.value.id, { expectedVersion: unreadable.value.expectedVersion }); await initialise() }
  catch (cause) { setError(cause, '无法读取的草稿未移除，请重试。'); removeUnreadable.value = false }
  finally { busy.value = false }
}
async function pickLocation() {
  if (!draft.value?.customPlace || busy.value) return
  if (!draft.value.customPlace.name.trim() || !draft.value.customPlace.regionId) { error.value = '先填写地点名称和所在地区，再到地图选位置。'; return }
  busy.value = true
  try {
    await persist(); picking.value = true; hide(); emit('pick-location', copy(draft.value.customPlace))
  } catch (cause) { setError(cause, '草稿尚未保存，请先保留当前页面。') }
  finally { busy.value = false }
}
async function acceptLocation(coordinates: Coordinates): Promise<boolean> {
  if (!draft.value?.customPlace || !picking.value) return false
  try {
    draft.value.customPlace = props.catalogue.normalizeCustomPlace({ ...draft.value.customPlace, coordinates })
    picking.value = false; changed(); error.value = ''; await show(); return true
  } catch (cause) {
    error.value = message(cause, '请在所选省区的示意轮廓内选择位置。')
    emit('location-error', error.value)
    return false
  }
}
async function cancelLocationPick() { picking.value = false; await show() }
function beforeUnload(event: BeforeUnloadEvent) { if (dirty.value || busy.value) { event.preventDefault(); event.returnValue = '' } }
watch(() => props.open, open => { if (open) void initialise(); else { picking.value = false; hide() } }, { immediate: true })
watch(busy, value => emit('busy', value), { immediate: true })
window.addEventListener('beforeunload', beforeUnload)
onBeforeUnmount(() => { disposed = true; stopTimer(); photoController?.abort(); window.removeEventListener('beforeunload', beforeUnload); hide() })
defineExpose({ acceptLocation, cancelLocationPick })
</script>

<template>
  <dialog ref="dialog" class="yn-record-dialog yn-vue-editor" aria-labelledby="yn-editor-title" aria-describedby="yn-editor-help" tabindex="-1" @cancel.prevent="requestClose">
    <div class="yn-dialog-heading">
      <h2 id="yn-editor-title">{{ title }}</h2>
      <button type="button" aria-label="关闭回忆编辑器" :disabled="busy" @click="requestClose">关闭</button>
    </div>
    <p id="yn-editor-help" class="yn-record-place">{{ draft?.originalVisit ? '修改日期、地点、照片或手记，保存后生效。' : '先留下照片，再确认是哪一天、在哪里。' }}</p>
    <p v-if="initialising" role="status">正在读取本机草稿…</p>
    <p v-if="resumed" class="yn-draft-notice">正在继续未完成的草稿，不会用另一段回忆覆盖它。先保存或放弃这份草稿。</p>
    <form v-if="draft" novalidate @submit.prevent="save()">
      <fieldset class="yn-editor-fields" :disabled="busy">
        <div class="yn-editor-brief" aria-live="polite">
          <span v-for="item in memoryBrief" :key="item">{{ item }}</span>
          <p>{{ contentHint }}</p>
        </div>
        <label for="yn-editor-photos">旅行照片 <span>{{ draft.photos.length }} / 9 张</span></label>
        <div class="yn-photo-picker">
          <input id="yn-editor-photos" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" :disabled="draft.photos.length >= 9" @change="choosePhotos">
          <p>选 1–9 张，第一张会先作为地图封面。</p>
        </div>
        <p v-if="accountMode" class="yn-record-help">单张不超过 10 MiB。点击保存后，照片副本和手记会上传到本机测试服务；草稿仍留在本浏览器。原照片不变，请保留原片。</p>
        <p v-else class="yn-record-help">照片仅在本机处理，单张不超过 10 MiB。保存压缩副本，原照片不变；请另行保留原片。</p>
        <p v-if="progress" class="yn-photo-progress" role="status">{{ progress }}</p>
        <ul v-if="photoErrors.length" class="yn-record-error" aria-label="未添加的照片"><li v-for="(failure, index) in photoErrors" :key="index">{{ failure.name }}：{{ failure.message }}</li></ul>
        <div v-if="!draft.photos.length" class="yn-photo-empty">照片会以小相纸叠在地图地标旁。先不选也可以，只写一句手记保存。</div>
        <div class="yn-draft-photos">
          <figure v-for="(photo, index) in draft.photos" :key="photo.id" class="yn-draft-photo" :data-cover="photo.id === draft.coverId">
            <img :src="photo.url" :alt="photo.name || `第 ${index + 1} 张旅行照片`">
            <figcaption>
              <button type="button" :aria-pressed="photo.id === draft.coverId" :aria-label="photo.id === draft.coverId ? `第 ${index + 1} 张是封面` : `将第 ${index + 1} 张设为封面`" @click="chooseCover(photo.id)">{{ photo.id === draft.coverId ? '封面' : '设为封面' }}</button>
              <button type="button" :aria-label="`移除第 ${index + 1} 张照片`" @click="removePhoto(photo.id)">移除</button>
            </figcaption>
          </figure>
        </div>
        <div class="yn-editor-place-scope">
          <label for="yn-editor-province">查找地点的省份 / 地区</label>
          <select id="yn-editor-province" v-model="editorProvinceId"><option value="">全部地区</option><option v-for="province in catalogue.provinces" :key="province.id" :value="province.id">{{ province.name }}</option></select>
        </div>
        <label for="yn-editor-place">回忆地点</label>
        <select id="yn-editor-place" :value="choice" @change="changePlace">
          <option value="">请选择地点</option>
          <optgroup label="景点与我的地点"><option v-for="place in availablePlaces" :key="place.id" :value="place.id">{{ place.name }}（{{ place.regionName }}）</option></optgroup>
          <option value="__custom">{{ draft.customPlace ? '编辑自定义地点' : '添加我的地点' }}</option>
        </select>
        <fieldset v-if="draft.customPlace" class="yn-custom-place">
          <legend>我的地点</legend>
          <label for="yn-editor-custom-name">地点名称</label>
          <input id="yn-editor-custom-name" v-model="draft.customPlace.name" maxlength="60" @input="changed">
          <label for="yn-editor-custom-province">所在省份 / 地区</label>
          <select id="yn-editor-custom-province" :value="customProvinceId" @change="changeCustomProvince"><option v-for="province in catalogue.provinces" :key="province.id" :value="province.id">{{ province.name }}</option></select>
          <template v-if="customRegions.length">
            <label for="yn-editor-custom-region">所在州市</label>
            <select id="yn-editor-custom-region" v-model="draft.customPlace.regionId" @change="changeCustomRegion"><option value="">请选择州市</option><option v-for="region in customRegions" :key="region.id" :value="region.id">{{ region.name }}</option></select>
          </template>
          <p class="yn-custom-position">{{ draft.customPlace.coordinates ? `已选位置：${draft.customPlace.coordinates[0].toFixed(5)}，${draft.customPlace.coordinates[1].toFixed(5)}` : '尚未选择地图位置' }}</p>
          <button type="button" class="yn-pick-location" @click="pickLocation">{{ draft.customPlace.coordinates ? '重新选择位置' : '到地图选位置' }}</button>
          <p class="yn-record-help">公共地点目前主要整理于云南，其他地区也可手动留下回忆。省区轮廓为粗略示意，仅作回忆定位，不用于导航或判定行政归属。</p>
        </fieldset>
        <label for="yn-editor-date">旅行日期</label>
        <input id="yn-editor-date" v-model="draft.date" type="date" :max="localToday()" @input="changed">
        <label for="yn-editor-note">旅行手记 <span>{{ draft.note.length }} / 2000</span></label>
        <textarea id="yn-editor-note" ref="noteInput" v-model="draft.note" rows="5" maxlength="2000" placeholder="那天，什么让你想把这一刻留下？" @input="changed"></textarea>
        <p class="yn-record-help">一张照片或一句手记，都可以成为一段回忆。</p>
        <p class="yn-draft-status" :data-error="statusFailed" role="status">{{ status }}</p>
        <div v-if="duplicate" class="yn-duplicate" role="group" aria-label="同日回忆确认">
          <p>这个地点当天已有回忆，仍要添加一条新回忆吗？</p>
          <button type="button" @click="save(true)">仍然添加回忆</button><button type="button" @click="continueEditing">返回检查</button>
        </div>
        <div v-if="conflict" class="yn-duplicate" role="group" aria-label="草稿冲突处理">
          <p>另一页修改了本机草稿，本页内容仍保留。不会自动覆盖。</p>
          <button type="button" @click="checkDraftSlot">检查草稿状态</button>
          <button type="button" @click="replaceDraft">{{ replacing ? '确认载入另一份草稿' : '载入另一份草稿' }}</button>
          <p v-if="replacing">载入后会替换本页尚未保存的内容。请先自行保留需要的文字与原照片。</p>
          <template v-if="forking"><p>本机草稿为空，可以将本页内容另存为新草稿。</p><button type="button" @click="forkDraft">确认另存本页草稿</button></template>
          <button v-if="replacing || forking" type="button" @click="continueEditing">取消，保留本页内容</button>
        </div>
        <div v-if="canCopy" class="yn-duplicate" role="group" aria-label="另存回忆确认">
          <p>原回忆未被覆盖。可以将本页内容另存为一条新回忆。</p>
          <button type="button" @click="saveCopy">{{ copying ? '确认另存为新回忆' : '另存为新回忆' }}</button>
          <button v-if="copying" type="button" @click="continueEditing">取消另存</button>
        </div>
        <div v-if="closing" class="yn-duplicate" role="group" aria-label="关闭前保存草稿">
          <p>本页还有尚未保存的更改。保存草稿后再关闭，或继续编辑。</p>
          <button type="button" @click="saveAndClose">保存草稿并关闭</button><button ref="closeCancel" type="button" @click="continueEditing">继续编辑</button>
        </div>
        <div class="yn-record-actions">
          <button type="submit" class="yn-save">{{ busy ? '正在处理…' : draft.originalVisit ? '保存修改' : '保存回忆' }}</button>
          <button type="button" @click="requestClose">稍后继续</button>
          <button type="button" class="yn-discard" @click="discard">{{ discarding ? '确认放弃这份草稿' : '放弃草稿' }}</button>
          <button v-if="discarding" type="button" @click="continueEditing">取消放弃</button>
        </div>
      </fieldset>
    </form>
    <p v-if="error" class="yn-record-error" role="alert">{{ error }}</p>
    <div v-if="!draft && !initialising" class="yn-record-actions">
      <button type="button" :disabled="busy" @click="initialise">重新读取草稿</button>
      <button v-if="unreadable" type="button" :disabled="busy" @click="recoverUnreadable">{{ removeUnreadable ? '确认移除无法读取的草稿（不影响已存回忆）' : '移除无法读取的草稿' }}</button>
    </div>
  </dialog>
</template>
