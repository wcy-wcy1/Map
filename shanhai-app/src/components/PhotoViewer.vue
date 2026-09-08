<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { Visit } from '../domain/models'
const props = defineProps<{ visit: Visit | null; index: number; busy?: boolean; status?: string }>()
const emit = defineEmits<{ close: []; cover: [photoId: string]; share: [photoId: string] }>()
const dialog = ref<HTMLDialogElement | null>(null), position = ref(0), imageError = ref(false)
const photo = computed(() => props.visit?.photos[position.value])
let opener: HTMLElement | null = null
watch(() => [props.visit, props.index] as const, async ([visit, index]) => {
  imageError.value = false
  position.value = Math.max(0, Math.min(index, (visit?.photos.length ?? 1) - 1))
  await nextTick()
  if (visit?.photos.length) {
    if (!dialog.value?.open) {
      opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
      dialog.value?.showModal()
    }
  } else {
    dialog.value?.close()
    if (opener?.isConnected) opener.focus({ preventScroll: true })
    opener = null
  }
}, { immediate: true })
function close() { if (!props.busy) emit('close') }
function step(delta: number) {
  if (props.busy || !props.visit) return
  position.value = (position.value + delta + props.visit.photos.length) % props.visit.photos.length
  imageError.value = false
}
onBeforeUnmount(() => dialog.value?.close())
</script>

<template>
  <dialog ref="dialog" class="yn-photo-viewer" aria-labelledby="yn-photo-title" @cancel.prevent="close" @keydown.left.prevent="step(-1)" @keydown.right.prevent="step(1)">
    <header><h2 id="yn-photo-title">{{ visit?.date }} 的照片</h2><button type="button" :disabled="busy" @click="close">关闭照片</button></header>
    <figure v-if="photo"><img :src="photo.url" :alt="photo.name" @error="imageError = true"><figcaption>{{ position + 1 }} / {{ visit?.photos.length }} · {{ photo.name }}</figcaption></figure>
    <p v-if="imageError" role="alert">这张照片暂时无法显示，回忆没有被删除。请保留备份后重试。</p>
    <div class="yn-detail-actions"><button type="button" :disabled="busy || (visit?.photos.length ?? 0) < 2" @click="step(-1)">上一张</button><button type="button" :disabled="busy || !photo || imageError" @click="photo && emit('cover', photo.id)">用作地点封面</button><button type="button" :disabled="busy || (visit?.photos.length ?? 0) < 2" @click="step(1)">下一张</button></div>
    <div class="yn-detail-actions"><button type="button" :disabled="busy || !photo || imageError" @click="photo && emit('share', photo.id)">用这张制作回忆卡</button></div>
    <p role="status" aria-live="polite">{{ status }}</p>
  </dialog>
</template>

<style scoped>
.yn-photo-viewer { width:min(920px,calc(100% - 28px)); max-height:92dvh; overflow:auto; padding:20px; border:1px solid var(--lj-line); border-radius:10px; background:var(--lj-paper); color:var(--lj-ink); }
.yn-photo-viewer::backdrop { background:#112e2ab3; }
header { display:flex; align-items:center; justify-content:space-between; gap:12px; }
h2 { margin:0; font:500 21px/1.4 "Songti SC","SimSun",serif; }
figure { margin:16px 0 0; }
img { display:block; width:100%; height:min(58dvh,620px); object-fit:contain; background:var(--lj-photo); }
figcaption { margin-top:8px; overflow-wrap:anywhere; color:var(--lj-muted); font-size:12px; }
p { margin:8px 0; font-size:13px; }
@media (max-width:480px) { .yn-photo-viewer { padding:14px; } h2 { font-size:18px; } }
</style>
