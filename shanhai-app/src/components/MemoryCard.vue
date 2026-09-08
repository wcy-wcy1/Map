<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import type { Visit } from '../domain/models'
import { splitGraphemes } from '../sharing/card-renderer'
import type { MemoryCardInput, MemoryCardResult, RenderMemoryCard } from '../sharing/card-types'

const props = defineProps<{ visit: Visit | null; placeName: string; selectedPhotoId?: string; renderCard: RenderMemoryCard }>()
const emit = defineEmits<{ close: []; busy: [boolean] }>()
type CardSnapshot = Pick<Visit, 'id' | 'placeId' | 'date' | 'note'> & { placeName: string; photos: MemoryCardInput['photos'] }
const dialog = ref<HTMLDialogElement | null>(null), back = ref<HTMLButtonElement | null>(null)
const textInput = ref<HTMLTextAreaElement | null>(null), previewSection = ref<HTMLElement | null>(null)
const download = ref<HTMLAnchorElement | null>(null)
const snapshot = shallowRef<CardSnapshot | null>(null), selected = ref(new Set<string>())
const text = ref(''), showDate = ref(false), generating = ref(false), status = ref(''), failed = ref(false)
const preview = shallowRef<{ url: string; result: MemoryCardResult } | null>(null)
const shareFile = shallowRef<File | null>(null), pendingShare = ref<symbol | null>(null)
const count = (value: string) => Array.from(value).length
const textCount = computed(() => count(text.value))
const noteLabel = computed(() => count(snapshot.value?.note ?? '') > 100 ? '带入手记前100字' : '带入这次手记')
let generation = 0, disposed = false, opener: HTMLElement | null = null

function notice(message: string, error = false) { status.value = message; failed.value = error }
function setGenerating(value: boolean) {
  if (generating.value === value) return
  generating.value = value; emit('busy', value)
}
function releasePreview() {
  const old = preview.value
  preview.value = null; shareFile.value = null
  if (old) URL.revokeObjectURL(old.url)
}
function invalidate(message = '内容已调整，请重新生成预览。') {
  generation++
  const hadPreview = !!preview.value
  releasePreview(); notice(hadPreview ? message : '')
}
function hide() {
  if (dialog.value?.open) dialog.value.close()
  if (opener?.isConnected) opener.focus({ preventScroll: true })
  opener = null
}
function clear() {
  invalidate(); snapshot.value = null; selected.value = new Set()
  text.value = ''; showDate.value = false; setGenerating(false); hide()
}
function close() { clear(); emit('close') }

// Refreshing the same stored visit must not replace the user's detached selection.
// The parent keeps this component mounted with visit=null while it is closed, so
// a still-pending system share cannot be duplicated by closing and reopening it.
watch(() => props.visit?.id, async () => {
  const visit = props.visit
  if (!visit) { clear(); return }
  invalidate(); setGenerating(false)
  snapshot.value = { id: visit.id, placeId: visit.placeId, placeName: props.placeName,
    date: visit.date, note: visit.note, photos: visit.photos.map(photo => ({ id: photo.id, url: photo.url })) }
  const initial = snapshot.value.photos.find(photo => photo.id === props.selectedPhotoId)
    ?? snapshot.value.photos.find(photo => photo.id === visit.coverId) ?? snapshot.value.photos[0]
  selected.value = new Set(initial ? [initial.id] : [])
  text.value = ''; showDate.value = false; notice('')
  const job = generation
  await nextTick()
  if (disposed || job !== generation || !snapshot.value) return
  if (!dialog.value?.open) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.value?.showModal()
  }
  back.value?.focus({ preventScroll: true })
}, { immediate: true })

function choosePhoto(id: string, event: Event) {
  const input = event.target as HTMLInputElement
  if (generating.value) { input.checked = selected.value.has(id); return }
  if (input.checked && selected.value.size >= 3) {
    input.checked = false; notice('最多选择 3 张，请先取消一张。', true); return
  }
  if (input.checked) selected.value.add(id); else selected.value.delete(id)
  invalidate()
}
function editText(event: Event) {
  if (generating.value) return
  text.value = (event.target as HTMLTextAreaElement).value; invalidate()
}
function editDate(event: Event) {
  if (generating.value) return
  showDate.value = (event.target as HTMLInputElement).checked; invalidate()
}
function importNote() {
  if (generating.value || !snapshot.value) return
  let excerpt = ''
  for (const grapheme of splitGraphemes(snapshot.value.note)) {
    if (count(excerpt + grapheme) > 100) break
    excerpt += grapheme
  }
  text.value = excerpt; invalidate()
  notice('已带入文字，仅用于这张卡片。发送前请确认是否适合分享。')
  textInput.value?.focus({ preventScroll: true })
}
function adjust() {
  if (generating.value) return
  invalidate(); textInput.value?.focus({ preventScroll: true })
  textInput.value?.scrollIntoView?.({ block: 'center' })
}
function prepareShareFile(result: MemoryCardResult): File | null {
  if (!globalThis.isSecureContext || typeof File !== 'function' || typeof navigator.share !== 'function'
    || typeof navigator.canShare !== 'function' || result.blob.type !== 'image/png') return null
  try {
    const file = new File([result.blob], result.filename, { type: 'image/png', lastModified: 0 })
    return navigator.canShare({ files: [file] }) ? file : null
  } catch { return null }
}
async function generate() {
  const source = snapshot.value
  if (generating.value || !source) return
  if (textCount.value > 100) { notice('分享手记最多 100 字，请精简后再生成。', true); textInput.value?.focus(); return }
  if (!selected.value.size && !text.value.trim()) { notice('请至少选一张照片，或写一句分享手记。', true); textInput.value?.focus(); return }
  const input: MemoryCardInput = { placeId: source.placeId, showDate: showDate.value,
    ...(showDate.value ? { date: source.date } : {}), text: text.value,
    photos: source.photos.filter(photo => selected.value.has(photo.id)).map(photo => ({ ...photo })) }
  invalidate()
  const job = generation
  setGenerating(true); notice('正在生成图片，只处理所选内容…')
  try {
    const result = await props.renderCard(input)
    if (disposed || job !== generation || !snapshot.value) return
    if (result.blob?.type !== 'image/png') throw new Error('Unexpected card format')
    preview.value = { url: URL.createObjectURL(result.blob), result }
    shareFile.value = prepareShareFile(result)
    notice(shareFile.value ? '预览已生成。确认照片与文字后，可系统分享或保存图片。' : '预览已生成。确认后保存图片，再从相册或文件中发送给朋友。')
    await nextTick()
    if (job !== generation || disposed) return
    previewSection.value?.scrollIntoView?.({ block: 'start' }); download.value?.focus({ preventScroll: true })
  } catch (cause) {
    if (disposed || job !== generation) return
    releasePreview()
    const message = (cause as { friendlyMessage?: unknown })?.friendlyMessage
    notice(typeof message === 'string' ? message : '图片未能生成，请重试；原记录没有更改。', true)
  } finally { if (job === generation && !disposed) setGenerating(false) }
}
function previewFailed(event: Event) {
  const image = event.target as HTMLImageElement
  if (!preview.value || image.getAttribute('src') !== preview.value.url) return
  invalidate(); setGenerating(false); notice('预览图片暂时无法显示，请重新生成后检查。', true)
}
function saveImage(event: Event) {
  if (!preview.value || generating.value) { event.preventDefault(); return }
  notice('已发起图片下载，请确认已保存后再发给朋友。')
}
async function share() {
  const file = shareFile.value
  if (generating.value || pendingShare.value || !file || !snapshot.value || !preview.value) return
  const job = generation, operation = Symbol('memory-card-share')
  pendingShare.value = operation
  notice('请在系统分享中选择应用；发送前仍可取消。')
  try {
    // Called synchronously from the click: only the generated PNG is shared.
    await navigator.share({ files: [file] })
    if (!disposed && job === generation && shareFile.value === file) notice('图片已交给系统分享；是否发送完成，请到所选应用确认。')
  } catch (cause) {
    if (disposed || job !== generation || shareFile.value !== file) return
    if ((cause as { name?: string })?.name === 'AbortError') notice('本次分享未完成。可以重新打开系统分享，或保存图片后发送。')
    else notice('系统分享未完成。可以重试，或先保存图片再发送。', true)
  } finally { if (pendingShare.value === operation) pendingShare.value = null }
}
onBeforeUnmount(() => { disposed = true; clear() })
</script>

<template>
  <dialog ref="dialog" class="yn-memory-card" aria-labelledby="yn-card-title" aria-describedby="yn-card-help" :aria-busy="generating" tabindex="-1" @cancel.prevent="close">
    <button ref="back" type="button" class="yn-card-back" @click="close">返回回忆</button>
    <h2 id="yn-card-title">制作回忆卡</h2>
    <template v-if="snapshot">
      <p class="yn-card-context">{{ snapshot.placeName }} · {{ snapshot.date }} 的这次回忆</p>
      <p id="yn-card-help" class="yn-card-help">只带走你选中的内容。生成图片后，先看一眼，再发给朋友。</p>
      <form @submit.prevent="generate">
        <fieldset class="yn-card-fields" :disabled="generating">
          <fieldset v-if="snapshot.photos.length" class="yn-card-photos">
            <legend>选几张照片</legend>
            <p>最多 3 张，按原照片顺序排版，完整显示、不裁边。</p>
            <div class="yn-card-picker">
              <label v-for="(photo, index) in snapshot.photos" :key="photo.id" :data-selected="selected.has(photo.id)">
                <img :src="photo.url" alt="">
                <input type="checkbox" :checked="selected.has(photo.id)" :aria-label="`选择第 ${index + 1} 张照片`" @change="choosePhoto(photo.id, $event)">
                <span>照片 {{ index + 1 }}</span>
              </label>
            </div>
            <p class="yn-card-selected" role="status">已选 {{ selected.size }} / 3 张</p>
          </fieldset>
          <p v-else class="yn-card-no-photos">这次没有照片，可以写一句话，做成文字回忆卡。</p>
          <label for="yn-card-text" class="yn-card-label">分享手记（选填）</label>
          <textarea id="yn-card-text" ref="textInput" class="yn-card-text" :value="text" aria-label="回忆卡上的手记" aria-describedby="yn-card-text-count" :aria-invalid="textCount > 100" maxlength="200" rows="3" placeholder="写一句想分享的话，最多 100 字" @input="editText"></textarea>
          <div class="yn-card-text-tools">
            <button type="button" class="yn-card-use-note" :disabled="!snapshot.note.trim()" @click="importNote">{{ noteLabel }}</button>
            <span id="yn-card-text-count" :data-error="textCount > 100">{{ textCount }} / 100</span>
          </div>
          <label class="yn-card-date"><input type="checkbox" :checked="showDate" @change="editDate">在图片上显示到访日期</label>
          <p class="yn-card-help">图片会显示景点名、所选照片和这句文字；日期由你决定。不会附带其他记录、精确坐标或备份文件。</p>
          <button type="submit" class="yn-card-generate">{{ generating ? '正在生成…' : '生成预览' }}</button>
        </fieldset>
      </form>
      <p class="yn-card-status" :data-error="failed" role="status" aria-live="polite">{{ status }}</p>
      <section v-if="preview" ref="previewSection" class="yn-card-preview" aria-label="待分享或保存的回忆卡">
        <img :src="preview.url" :width="preview.result.width" :height="preview.result.height" :alt="`${snapshot.placeName}旅行回忆卡预览`" @error="previewFailed">
        <p>{{ preview.result.width }} × {{ preview.result.height }} PNG，预览就是将要分享或保存的图片。</p>
        <div class="yn-card-actions">
          <button v-if="shareFile" type="button" class="yn-card-share" :disabled="generating || !!pendingShare" @click="share">{{ pendingShare ? '分享处理中…' : '系统分享' }}</button>
          <a ref="download" class="yn-card-download" :href="preview.url" :download="preview.result.filename" @click="saveImage">保存图片</a>
          <button type="button" :disabled="generating" @click="adjust">继续调整</button>
        </div>
        <p class="yn-card-share-help">{{ shareFile ? (pendingShare ? '系统分享仍在处理中。可以先保存图片，或完成后再分享。' : '系统分享只带上这张图片。选择应用后，请在应用中确认发送；也可以先保存图片。') : '当前浏览器暂不支持直接分享图片。请先保存图片，再从相册或文件中选择这张回忆卡发送给朋友。' }}</p>
      </section>
    </template>
  </dialog>
</template>

<style scoped src="./memory-card.css"></style>
