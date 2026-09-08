<script setup lang="ts">
import { inject, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PHOTO_LOADER_KEY } from '../services/photo-loader'
import './photo-thumbnail.css'

const props = defineProps<{ visitId: string; photoId: string; revision: number; alt: string; compact?: boolean }>()
const loader = inject(PHOTO_LOADER_KEY, null)
const frame = ref<HTMLElement>(), image = ref<HTMLImageElement>(), url = ref(''), state = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
let observer: IntersectionObserver | undefined, controller: AbortController | undefined
let visible = false, disposed = false, visibilityUnsupported = false, request = 0
function release() {
  request++; controller?.abort(); controller = undefined
  url.value = ''; state.value = 'idle'
}
async function load() {
  if (!visible || disposed || controller || url.value) return
  if (!loader) { state.value = 'error'; return }
  const token = ++request, pending = new AbortController()
  controller = pending; state.value = 'loading'
  try {
    const photo = await loader.load(props.visitId, props.photoId, props.revision, pending.signal)
    if (disposed || token !== request || pending.signal.aborted || !visible) return
    url.value = photo.url
  } catch (cause) {
    if (disposed || token !== request || pending.signal.aborted) return
    state.value = 'error'
  } finally { if (controller === pending) controller = undefined }
}
function decoded(event: Event) {
  if (event.target === image.value && visible && url.value && image.value?.getAttribute('src') === url.value) state.value = 'ready'
}
function failed(event: Event) {
  if (event.target !== image.value || image.value?.getAttribute('src') !== url.value) return
  url.value = ''; state.value = 'error'
}
watch(() => [props.visitId, props.photoId, props.revision], () => {
  release()
  if (visibilityUnsupported) state.value = 'error'; else void load()
})
onMounted(() => {
  // Browsers without IntersectionObserver keep the existing parent button as
  // the explicit full-photo action rather than loading every offscreen image.
  if (typeof IntersectionObserver !== 'function') { visibilityUnsupported = true; state.value = 'error'; return }
  observer = new IntersectionObserver(entries => {
    // A delivery can contain several crossings for one target; the last entry
    // represents its final visibility, not necessarily the first one.
    const entry = entries.filter(item => item.target === frame.value).at(-1)
    if (!entry || disposed) return
    if (entry.isIntersecting) { visible = true; void load() }
    else { visible = false; release() }
  }, { rootMargin: '0px', threshold: 0 })
  if (frame.value) observer.observe(frame.value)
})
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); release() })
</script>

<template>
  <span ref="frame" class="yn-photo-thumbnail" :class="{ 'yn-photo-thumbnail-compact': compact }" :data-state="state" :aria-busy="state === 'loading' ? 'true' : undefined">
    <img v-if="url" ref="image" :key="url" :src="url" :alt="alt" decoding="async" @load="decoded" @error="failed">
    <span v-if="state !== 'ready'" class="yn-photo-placeholder" :title="state === 'error' ? '照片未载入，点开回忆重试' : undefined">{{ state === 'error' ? (compact ? '点开查看' : '照片未载入，点开重试') : (compact ? '照片' : '照片加载中') }}</span>
  </span>
</template>
