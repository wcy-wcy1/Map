<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef } from 'vue'
import type { BackupExportError, BackupExportService, ExportProgress, ExportSession, ReadyExportSession } from '../services/export-types'

const props = defineProps<{ service: BackupExportService; disabled?: boolean }>()
const emit = defineEmits<{ busy: [value: boolean]; status: [message: string, error: boolean] }>()
const busy = ref(false), blocked = computed(() => busy.value || props.disabled)
const ready = shallowRef<ReadyExportSession | null>(null)
const active = shallowRef<{ part: number; url: string } | null>(null)
const requested = ref<number[]>([]), sessions = shallowRef<ExportSession[]>([])
const checkedSessions = ref(false), cleanupIds = ref<string[]>([]), cleanupChoice = ref<string | null>(null)
const operation = shallowRef<{ kind: 'prepare' | 'part' | 'resume'; controller: AbortController } | null>(null)
const exportButton = ref<HTMLButtonElement>(), listButton = ref<HTMLButtonElement>(), downloadLink = ref<HTMLAnchorElement>()
let disposed = false
const capacity = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`
function say(message: string, error = false) { if (!disposed) emit('status', message, error) }
function lock(value: boolean) { if (!disposed) { busy.value = value; emit('busy', value) } }
function clearDownload() { if (active.value) URL.revokeObjectURL(active.value.url); active.value = null }
function remember(session: ExportSession) { sessions.value = [session, ...sessions.value.filter(item => item.id !== session.id)] }
async function focus(control?: HTMLElement) { await nextTick(); if (!disposed) control?.focus({ preventScroll: true }) }
function progress(value: ExportProgress) {
  if (operation.value?.controller.signal.aborted) return
  say(value.phase === 'read' ? `正在整理第 ${value.records} / ${value.totalRecords} 条回忆…`
    : value.phase === 'stage' ? `正在暂存第 ${value.part} 卷，完整生成后才能下载…`
      : `正在核对第 ${value.part} / ${value.parts} 卷…`)
}
function failed(error: unknown, cancelled: boolean) {
  const detail = error as BackupExportError | null
  if (detail?.cleanupPending && detail.sessionId && !cleanupIds.value.includes(detail.sessionId)) cleanupIds.value = [...cleanupIds.value, detail.sessionId]
  say(detail?.cleanupPending ? detail.friendlyMessage || '临时备份尚未清理，请重试。原记录没有更改。'
    : cancelled ? '已取消本次准备，原记录没有更改。'
      : detail?.friendlyMessage || '备份操作未完成，请重试。原记录没有更改。', Boolean(detail?.cleanupPending) || !cancelled)
}
async function start(kind: 'prepare' | 'resume', id?: string) {
  if (blocked.value) return
  clearDownload(); ready.value = null; requested.value = []; cleanupChoice.value = null
  const current = { kind, controller: new AbortController() }
  operation.value = current; lock(true); say('正在准备备份，尚未下载…')
  try {
    const options = { signal: current.controller.signal, onProgress: progress }
    const session = id ? await props.service.resumeReady(id, options) : await props.service.prepare(options)
    if (disposed || current.controller.signal.aborted) return
    ready.value = session; remember(session)
    say(`完整备份已生成，共 ${session.files.length} 卷，尚未发起下载。请逐卷准备并下载，确认保管后再清理临时副本。`)
  } catch (error) { if (!disposed) failed(error, current.controller.signal.aborted) }
  finally { operation.value = null; lock(false); await focus(exportButton.value) }
}
async function preparePart(part: number) {
  const session = ready.value
  if (blocked.value || !session) return
  clearDownload()
  const current = { kind: 'part' as const, controller: new AbortController() }
  operation.value = current; lock(true); say(`正在准备第 ${part} 卷下载…`)
  try {
    const file = await props.service.readPart(session.id, part, { signal: current.controller.signal })
    if (disposed || current.controller.signal.aborted || ready.value?.id !== session.id) return
    active.value = { part, url: URL.createObjectURL(file.blob) }
    say(`第 ${part} 卷已就绪，请点击下载。尚未保存到设备。`)
  } catch (error) { if (!disposed) failed(error, current.controller.signal.aborted) }
  finally {
    operation.value = null; lock(false)
    await nextTick(); await focus(downloadLink.value || exportButton.value)
  }
}
function download(event: MouseEvent, part: number) {
  if (blocked.value || active.value?.part !== part) { event.preventDefault(); return }
  if (!requested.value.includes(part)) requested.value = [...requested.value, part]
  say(`已发起第 ${part} 卷下载。请检查设备中的文件；恢复时需要选齐这套全部 ${ready.value?.files.length} 卷。`)
}
function cancel() {
  if (!operation.value || operation.value.controller.signal.aborted) return
  operation.value.controller.abort(); operation.value = { ...operation.value }
  say('正在结束当前操作，请稍候；原记录没有更改…')
}
async function listSessions() {
  if (blocked.value) return
  lock(true); say('正在检查本机临时备份，不会自动下载或删除…')
  try { const rows = await props.service.listSessions(); if (!disposed) { sessions.value = rows; checkedSessions.value = true; say(rows.length ? `找到 ${rows.length} 份临时备份。` : '没有临时备份。') } }
  catch (error) { failed(error, false) }
  finally { lock(false); await focus(listButton.value) }
}
async function discard(id: string) {
  if (blocked.value) return
  lock(true)
  if (ready.value?.id === id) { clearDownload(); ready.value = null }
  say('正在清理这份临时备份，已保存的回忆不会更改…')
  try {
    await props.service.discard(id)
    if (disposed) return
    sessions.value = sessions.value.filter(item => item.id !== id)
    cleanupIds.value = cleanupIds.value.filter(item => item !== id); cleanupChoice.value = null
    say('这份临时备份已清理，已保存的回忆和已下载文件没有更改。')
  } catch (error) { failed(error, false) }
  finally { lock(false); await focus(listButton.value) }
}
onBeforeUnmount(() => { disposed = true; operation.value?.controller.abort(); clearDownload() })
defineExpose({ clearDownload, focus: () => focus(exportButton.value) })
</script>

<template>
  <div class="lj-export-flow">
    <button ref="exportButton" class="lj-backup-export" type="button" :disabled="blocked" @click="start('prepare')">导出备份</button>
    <p>生成备份需要额外本机临时空间。临时副本未加密，含照片与手记；下载并确认保管后可以清理。</p>
    <div v-if="ready" class="lj-backup-volumes">
      <p class="lj-backup-volume-summary">{{ ready.summary.visits }} 条记录、{{ ready.summary.photos }} 张照片，共 {{ ready.files.length }} 卷，{{ capacity(ready.totalBytes) }}。</p>
      <p>这是生成时的回忆副本，不会随之后的编辑更新。请逐卷准备并下载，放在同一文件夹；恢复时需要一次选齐全部文件。</p>
      <ol class="lj-backup-volume-list">
        <li v-for="file in ready.files" :key="file.part">
          <p>第 {{ file.part }} / {{ ready.files.length }} 卷 · {{ capacity(file.bytes) }}<span v-if="requested.includes(file.part)"> · 已发起下载，待你核对</span></p>
          <a v-if="active?.part === file.part" :ref="element => { downloadLink = element as HTMLAnchorElement }" class="lj-backup-download" :href="active.url" :download="file.filename" :aria-disabled="blocked" @click="download($event, file.part)">{{ requested.includes(file.part) ? '再次下载' : '下载' }}第 {{ file.part }} 卷</a>
          <button v-else class="lj-backup-part-prepare" type="button" :disabled="blocked" @click="preparePart(file.part)">准备第 {{ file.part }} 卷下载</button>
        </li>
      </ol>
      <button class="lj-export-clean-ready" type="button" :disabled="blocked" @click="cleanupChoice = ready.id">清理这份临时备份</button>
    </div>
    <button v-if="operation" class="lj-backup-stop" type="button" :disabled="operation.controller.signal.aborted" @click="cancel">{{ operation.kind === 'prepare' ? '取消生成' : '取消准备' }}</button>
    <div class="lj-export-sessions">
      <button ref="listButton" class="lj-export-list" type="button" :disabled="blocked" @click="listSessions">查看临时备份</button>
      <ul v-if="checkedSessions && sessions.length" class="lj-export-session-list">
        <li v-for="session in sessions" :key="session.id">
          <p>{{ session.createdAt?.replace('T', ' ').replace('Z', ' UTC') || '生成时间无法读取' }} · {{ session.summary ? `${session.summary.visits} 条回忆` : '记录数无法读取' }} · {{ session.status === 'ready' ? '可继续下载' : session.status === 'building' ? '未生成完整，可能仍在其他页面准备' : session.status === 'damaged' ? '副本损坏，请清理后重新生成' : '等待清理' }}</p>
          <button v-if="session.status === 'ready'" class="lj-export-resume" type="button" :disabled="blocked" @click="start('resume', session.id)">继续下载这份备份</button>
          <button class="lj-export-remove" type="button" :disabled="blocked" @click="cleanupChoice = session.id">清理这份临时备份</button>
        </li>
      </ul>
      <div v-if="cleanupChoice" class="lj-export-confirmation">
        <p>清理只移除这份本机临时副本，不删除回忆或已下载文件。若另一页还在生成它，生成也会终止。请先确认需要的文件已保管好。</p>
        <button class="lj-export-confirm-clean" type="button" :disabled="blocked" @click="discard(cleanupChoice)">确认清理临时备份</button>
        <button type="button" :disabled="blocked" @click="cleanupChoice = null">先保留</button>
      </div>
      <div v-for="id in cleanupIds" :key="id" class="lj-export-cleanup-pending">
        <p>一份临时备份尚未清理，原记录没有更改。</p>
        <button class="lj-export-cleanup-retry" type="button" :disabled="blocked" @click="discard(id)">重试清理导出临时副本</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lj-export-flow { min-width: 0; }
.lj-export-flow p { margin: 6px 0 12px; overflow-wrap: anywhere; }
.lj-export-flow button { min-height: 44px; max-width: 100%; margin: 0 8px 8px 0; padding: 9px 14px; border: 1px solid var(--lj-line); border-radius: 6px; background: var(--lj-paper); color: var(--lj-ink); overflow-wrap: anywhere; }
.lj-export-flow button:disabled { opacity: .55; }
.lj-backup-volumes, .lj-export-sessions, .lj-export-confirmation { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--lj-line); }
.lj-backup-volume-summary { color: var(--lj-ink); }
.lj-backup-volume-list, .lj-export-session-list { padding: 0; margin: 0 0 12px; list-style: none; max-height: 280px; overflow-y: auto; scrollbar-gutter: stable; }
.lj-backup-volume-list li, .lj-export-session-list li { padding: 8px 0; }
.lj-backup-download { display: block; width: fit-content; min-height: 44px; padding: 12px 0; color: var(--lj-ink); overflow-wrap: anywhere; }
.lj-export-flow :is(button,a):focus-visible { outline: 2px solid var(--lj-ink); outline-offset: 3px; }
.lj-export-cleanup-pending { color: var(--lj-red); }
</style>
