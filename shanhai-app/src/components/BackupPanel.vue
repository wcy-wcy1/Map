<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, useId } from 'vue'
import type { Photo } from '../domain/models'
import type { BackupProgress, ImportStage, TravelServiceError } from '../services/contracts'
import type { RestoreCommitResult, RestorePreview, RestoreServiceError } from '../services/backup-service'
import type { TravelServices } from '../services/travel-services'
import BackupExport from './BackupExport.vue'

const props = defineProps<{
  services: TravelServices
  disabled?: boolean
  onCommitted?: (result: RestoreCommitResult) => Promise<void>
}>()
const emit = defineEmits<{ busy: [value: boolean]; imported: [result: RestoreCommitResult] }>()
const helpId = useId()
const busy = ref(false), status = ref(''), isError = ref(false)
const blocked = computed(() => busy.value || props.disabled)
const pending = shallowRef<RestorePreview | null>(null), previewLabel = ref('')
const exportControl = ref<InstanceType<typeof BackupExport>>()
const sessions = shallowRef<ImportStage[]>([]), checkedRecovery = ref(false), cleanupIds = ref<string[]>([])
const operation = shallowRef<{ kind: 'check'; controller: AbortController } | null>(null)
const input = ref<HTMLInputElement>(), confirm = ref<HTMLButtonElement>()
const recoveryButton = ref<HTMLButtonElement>(), cleanupButton = ref<HTMLButtonElement>()
let disposed = false

const capacity = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB（${bytes.toLocaleString('zh-CN')} 字节）`
const committed = (preview: RestorePreview) => preview.format === 'volume-v2' && 'status' in preview.plan && preview.plan.status === 'committed'
function message(value: string, error = false) { if (!disposed) { status.value = value; isError.value = error } }
function lock(value: boolean) { busy.value = value; emit('busy', value) }
function failure(error: unknown, fallback: string) { return (error as TravelServiceError | null)?.friendlyMessage || fallback }
function check(signal: AbortSignal) {
  if (signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'aborted', friendlyMessage: '已取消检查，没有导入任何内容。' })
}
function clearPreview() { pending.value = null; if (input.value) input.value.value = '' }
function rememberCleanup(id: string) { if (!cleanupIds.value.includes(id)) cleanupIds.value = [...cleanupIds.value, id] }
function forgetStage(id: string) {
  cleanupIds.value = cleanupIds.value.filter(value => value !== id)
  sessions.value = sessions.value.filter(value => value.id !== id)
}
async function dropPreview() {
  const previous = pending.value; clearPreview()
  if (!previous) return true
  try { await props.services.restores.discard(previous); if (previous.format === 'volume-v2') forgetStage(previous.stageId); return true }
  catch { if (previous.format === 'volume-v2') rememberCleanup(previous.stageId); return false }
}
async function focus(target?: HTMLElement | (() => HTMLElement | undefined)) {
  await nextTick()
  const control = typeof target === 'function' ? target() : target
  if (!disposed && control && !control.hidden) control.focus({ preventScroll: true })
}
function progress(value: BackupProgress) {
  if (disposed || operation.value?.controller.signal.aborted) return
  message(value.part ? `正在${value.phase === 'check' ? '检查' : value.phase === 'checksum' ? '校验' : '逐条暂存'}分卷 ${value.part} / ${value.parts}，尚未导入…` : '正在整理已保存的回忆…')
}
function decodePhoto(photo: Photo, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(Object.assign(new Error('Cancelled'), { code: 'aborted' })); return }
    const image = new Image()
    let done = false
    const invalid = () => Object.assign(new Error('Image decode failed'), { friendlyMessage: '备份中有照片无法完整解码，没有导入任何内容。请换一份完整备份。' })
    const finish = (error?: unknown) => {
      if (done) return
      done = true; clearTimeout(timer); signal?.removeEventListener('abort', abort)
      image.onload = image.onerror = null; image.removeAttribute('src')
      error ? reject(error) : resolve()
    }
    const abort = () => finish(Object.assign(new Error('Cancelled'), { code: 'aborted' }))
    const timer = setTimeout(() => finish(invalid()), 12000)
    signal?.addEventListener('abort', abort, { once: true })
    image.onload = async () => {
      try {
        if (!image.naturalWidth || !image.naturalHeight) throw invalid()
        if (typeof image.decode === 'function') await image.decode()
        if (signal?.aborted) abort(); else finish()
      } catch { finish(invalid()) }
    }
    image.onerror = () => finish(invalid())
    image.src = photo.url
  })
}
async function finishCommit(result: RestoreCommitResult) {
  clearPreview(); exportControl.value?.clearDownload()
  if (result.stageId) {
    if (result.cleanupPending) rememberCleanup(result.stageId)
    else forgetStage(result.stageId)
  }
  let refreshFailed = false
  try { await props.onCommitted?.(result) } catch { refreshFailed = true }
  emit('imported', result)
  message((result.replayed ? '这份备份已在其他页面导入，本次没有重复写入。'
    : `${result.added ? `已导入 ${result.added} 条记录。` : '没有新增记录。'}跳过 ${result.skipped} 条已有记录。${result.coversKept ? '现有地图封面已保留。' : ''}`)
    + (refreshFailed ? '回忆已保存，地图暂时无法刷新，请重新读取。' : '')
    + (result.cleanupPending ? '回忆已保存，临时副本尚未清理，请重试清理；无需再次导入。' : ''), refreshFailed)
}
async function acceptPreview(value: RestorePreview, label: string) {
  if (disposed) { await props.services.restores.discard(value); return }
  if (committed(value)) {
    // Proven committed receipts can be read/refreshed without a second user
    // confirmation; the repository guarantees this call performs no live writes.
    operation.value = null
    try { await finishCommit(await props.services.restores.commit(value)) }
    catch { clearPreview(); message('这份备份已在其他页面导入，本次没有重复写入。暂时无法刷新，请重新读取地图。', true) }
  } else { pending.value = value; previewLabel.value = label; message('检查通过，确认后才会保存到此浏览器。') }
}
async function selected(event: Event) {
  if (blocked.value) return
  const files = Array.from((event.target as HTMLInputElement).files || [])
  if (!files.length) return
  const current = { kind: 'check' as const, controller: new AbortController() }
  operation.value = current; lock(true); message('正在检查备份，尚未导入…')
  try {
    if (!await dropPreview()) { message('上一份临时副本尚未清理，请先重试清理，再选择备份。没有导入任何内容。', true); return }
    check(current.controller.signal)
    const value = await props.services.restores.inspect(files, { signal: current.controller.signal, onProgress: progress,
      decodePhoto: async (photo, signal) => { message('正在检查照片，尚未导入…'); await decodePhoto(photo, signal) } })
    await acceptPreview(value, value.format === 'volume-v2' ? `完整分卷备份 · ${files.length} 个文件 · ${capacity(files.reduce((sum, file) => sum + file.size, 0))}` : files[0]!.name)
  } catch (error) {
    const detail = error as RestoreServiceError
    clearPreview()
    if (detail.cleanupPending && detail.stageId) rememberCleanup(detail.stageId)
    message(detail.cleanupPending ? failure(error, '临时副本尚未清理，请重试清理。原记录没有更改。')
      : current.controller.signal.aborted ? '已取消检查，没有导入任何内容。' : failure(error, '备份无法读取，没有导入任何内容。请选择完整备份。'), !current.controller.signal.aborted || Boolean(detail.cleanupPending))
  } finally { operation.value = null; lock(false); await focus(() => pending.value ? confirm.value : input.value) }
}
function cancelOperation() {
  const current = operation.value
  if (!current || current.controller.signal.aborted) return
  message('正在取消检查，没有导入任何内容…')
  current.controller.abort(); operation.value = { ...current }
}
async function confirmImport() {
  const value = pending.value
  if (blocked.value || !value) return
  lock(true); message('正在导入，请保持页面打开…')
  try { await finishCommit(await props.services.restores.commit(value)) }
  catch (error) { message(failure(error, '导入未完成，没有更改原记录。') + ' 备份仍在，可以重试或取消。', true) }
  finally { lock(false); if (pending.value) await focus(confirm.value); else await exportControl.value?.focus() }
}
async function cancelPreview() {
  if (blocked.value) return
  lock(true); const cleaned = await dropPreview()
  message('已取消，没有导入任何内容。' + (cleaned ? '' : '临时副本尚未清理，请重试清理。'), !cleaned)
  lock(false); await focus(input.value)
}
async function cleanStage(id: string) {
  try { await props.services.repository.discardImportStage(id); forgetStage(id); return true }
  catch { rememberCleanup(id); return false }
}
async function retryCleanup() {
  if (blocked.value || !cleanupIds.value.length) return
  lock(true); message('正在清理临时副本，已保存的回忆不会更改…')
  for (const id of [...cleanupIds.value]) await cleanStage(id)
  message(cleanupIds.value.length ? '临时副本尚未清理，请稍后重试。已保存的回忆没有更改。' : '临时副本已清理，已保存的回忆没有更改。', cleanupIds.value.length > 0)
  lock(false); await focus(cleanupIds.value.length ? cleanupButton.value : input.value)
}
async function listRecovery() {
  if (blocked.value) return
  lock(true); sessions.value = []; message('正在检查未完成的恢复，不会自动导入…')
  try {
    sessions.value = await props.services.repository.listImportStages(); checkedRecovery.value = true
    message(sessions.value.length ? `发现 ${sessions.value.length} 份临时副本，请选择预览或清理。不会自动导入。` : '没有未完成的恢复。')
  } catch (error) { message(failure(error, '暂时无法检查临时副本，请稍后重试。原记录没有更改。'), true) }
  finally { lock(false); await focus(recoveryButton.value) }
}
async function resumeStage(stage: ImportStage) {
  if (blocked.value) return
  lock(true); message('正在重新核对现有回忆，尚未导入…')
  let alreadyCommitted = false
  try {
    if (pending.value?.format === 'volume-v2' && pending.value.stageId === stage.id) clearPreview()
    else if (!await dropPreview()) { message('上一份临时副本尚未清理，请先重试清理。', true); return }
    const value = await props.services.restores.resume(stage.id)
    alreadyCommitted = committed(value)
    cleanupIds.value = cleanupIds.value.filter(id => id !== stage.id)
    if (alreadyCommitted) sessions.value = sessions.value.map(row => row.id === stage.id ? { ...row, status: 'committed' } : row)
    await acceptPreview(value, '上次已检查的分卷备份')
  } catch (error) {
    clearPreview(); message(alreadyCommitted ? '这份备份已在其他页面导入，本次没有重复写入。暂时无法刷新，请重新读取地图。'
      : failure(error, '暂时无法预览，可以重新检查或清理临时副本。原记录没有更改。'), true)
  } finally { lock(false); await focus(() => pending.value ? confirm.value : recoveryButton.value) }
}
async function discardListed(stage: ImportStage) {
  if (blocked.value) return
  lock(true)
  if (pending.value?.format === 'volume-v2' && pending.value.stageId === stage.id) clearPreview()
  const cleaned = await cleanStage(stage.id)
  message(cleaned ? '临时副本已清理，已保存的回忆没有更改。' : '临时副本尚未清理，请重试清理。已保存的回忆没有更改。', !cleaned)
  lock(false); await focus(recoveryButton.value)
}
onBeforeUnmount(() => { disposed = true; operation.value?.controller.abort() })
</script>

<template>
  <details class="lj-backup" :aria-busy="busy">
    <summary>备份与恢复</summary>
    <p>给这些回忆留一份副本。包含已保存的照片、手记和地图封面，不包含未保存草稿。</p>
    <p class="lj-backup-private">备份未加密，含私人照片与手记，请自己保管。资料较多时会自动分卷，每个文件不超过 100 MiB。</p>
    <BackupExport ref="exportControl" :service="services.exports" :disabled="blocked" @busy="lock" @status="message" />
    <label class="lj-backup-file-label">从备份找回<input ref="input" type="file" multiple accept=".json,application/json" aria-label="选择山海集备份文件" :aria-describedby="helpId" :disabled="blocked" @change="selected"></label>
    <p :id="helpId">普通备份选 1 个文件；分卷备份一次选齐同一套全部文件。分卷检查会占用额外临时空间，确认前不会更改已有回忆。</p>
    <div v-if="pending" class="lj-backup-preview">
      <p class="lj-backup-file-name">{{ previewLabel }}</p>
      <p class="lj-backup-counts">{{ pending.summary.visits }} 条记录 · {{ pending.summary.photos }} 张照片 · {{ pending.summary.places }} 个地点</p>
      <p>{{ pending.summary.from }} 至 {{ pending.summary.to }}</p>
      <p>预计新增 {{ pending.plan.added }} 条，跳过 {{ pending.plan.skipped }} 条已有记录。确认时会再次核对。</p>
      <p>只添加缺少的记录，不覆盖现有内容；地图封面以当前浏览器的选择为准。</p>
      <div class="lj-backup-actions"><button ref="confirm" class="lj-backup-confirm" type="button" :disabled="blocked" @click="confirmImport">确认导入</button><button class="lj-backup-cancel" type="button" :disabled="blocked" @click="cancelPreview">取消</button></div>
    </div>
    <button v-if="operation" class="lj-backup-stop" type="button" :disabled="operation.controller.signal.aborted" @click="cancelOperation">取消检查</button>
    <div v-if="cleanupIds.length" class="lj-backup-cleanup"><p>临时副本尚未清理。已保存的回忆不会被删除，可以稍后重试。</p><button ref="cleanupButton" class="lj-backup-cleanup-retry" type="button" :disabled="blocked" @click="retryCleanup">重试清理临时副本</button></div>
    <div class="lj-backup-recovery">
      <button ref="recoveryButton" class="lj-backup-recovery-check" type="button" :disabled="blocked" @click="listRecovery">检查未完成的恢复</button>
      <p v-if="checkedRecovery && sessions.length">检查通过的副本可以重新预览；未完成检查的副本只能清理后重新选择文件。不会自动导入。</p>
      <ul class="lj-backup-recovery-list"><li v-for="stage in sessions" :key="stage.id"><p>{{ stage.summary.visits }} 条记录 · {{ stage.status === 'ready' ? '已检查，尚未确认导入' : stage.status === 'committed' ? '已经导入，临时副本待清理' : '检查未完成' }}</p><button v-if="stage.status === 'ready'" class="lj-backup-resume" type="button" :disabled="blocked" @click="resumeStage(stage)">重新预览这份备份</button><button class="lj-backup-remove" type="button" :disabled="blocked" @click="discardListed(stage)">清理这份临时副本</button></li></ul>
    </div>
    <p class="lj-backup-status" role="status" aria-live="polite" :data-error="isError">{{ status }}</p>
  </details>
</template>

<style scoped>
.lj-backup { border-top: 1px solid var(--lj-line); padding: 8px 20px 12px; color: var(--lj-muted); font-size: 12px; text-align: left; }
.lj-backup summary { width: fit-content; min-height: 44px; padding: 12px 0; cursor: pointer; color: var(--lj-ink); font-size: 14px; }
.lj-backup p { margin: 6px 0 12px; overflow-wrap: anywhere; }
.lj-backup button, #shanhai-lijiang .lj-backup button { min-height: 44px; padding: 9px 14px; border: 1px solid var(--lj-line); border-radius: 6px; background: var(--lj-paper); color: var(--lj-ink); }
.lj-backup button:disabled, .lj-backup input:disabled { opacity: .55; }
.lj-backup .lj-backup-confirm, #shanhai-lijiang .lj-backup .lj-backup-confirm { background: var(--lj-ink); color: var(--lj-paper); border-color: var(--lj-ink); }
.lj-backup-download, .lj-backup-volume-list a { display: block; width: fit-content; min-height: 44px; padding: 12px 0; color: var(--lj-ink); overflow-wrap: anywhere; }
.lj-backup-volumes, .lj-backup-preview, .lj-backup-cleanup, .lj-backup-recovery { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--lj-line); }
.lj-backup-counts, .lj-backup-volume-summary { color: var(--lj-ink); }
.lj-backup-volume-list { margin: 0; padding-left: 20px; max-height: 280px; overflow-y: auto; scrollbar-gutter: stable; }
.lj-backup-file-label { display: block; margin: 18px 0 12px; color: var(--lj-ink); }
.lj-backup input { display: block; margin-top: 7px; max-width: 100%; width: 100%; min-height: 44px; font: inherit; color: var(--lj-muted); }
.lj-backup input::file-selector-button { min-height: 44px; margin-right: 8px; padding: 8px; border: 1px solid var(--lj-line); border-radius: 6px; background: var(--lj-paper); color: var(--lj-ink); font: inherit; cursor: pointer; }
.lj-backup-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.lj-backup-status { margin-bottom: 0; color: var(--lj-ink); }
.lj-backup-status:empty { display: none; }
.lj-backup-status[data-error="true"], .lj-backup-cleanup p { color: var(--lj-red); }
.lj-backup-recovery-list { margin: 0; padding: 0; list-style: none; max-height: 320px; overflow-y: auto; scrollbar-gutter: stable; }
.lj-backup-recovery-list li { padding: 10px 0; }
.lj-backup-recovery-list button { max-width: 100%; margin: 0 8px 8px 0; overflow-wrap: anywhere; }
.lj-backup :is(button,a,input,summary):focus-visible { outline: 2px solid var(--lj-ink); outline-offset: 3px; }
@media (max-width:359px) { .lj-backup { padding-left: 16px; padding-right: 16px; } }
</style>
