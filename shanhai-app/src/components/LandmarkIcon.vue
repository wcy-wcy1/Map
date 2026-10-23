<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ensureLandmarks, getLandmarkRevision, landmarkDataUrl, landmarkProvince, nationalLandmarkSvg, subscribeLandmarks } from '../map/landmarks'

const props = defineProps<{ iconKey: string; variant?: string; simple?: boolean }>()
const revision = ref(getLandmarkRevision())
const unsubscribe = subscribeLandmarks(() => { revision.value = getLandmarkRevision() })
onBeforeUnmount(unsubscribe)
watch(() => [props.variant, props.simple] as const, ([variant, simple]) => {
  if (simple) return
  // Failed optional artwork leaves the safe category symbol visible; revisiting retries.
  void ensureLandmarks(landmarkProvince(variant)).catch(() => {})
}, { immediate: true })
const source = computed(() => {
  void revision.value
  if (props.simple) {
    const representative = nationalLandmarkSvg(landmarkProvince(props.variant), props.variant)
    if (representative) return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(representative)
  }
  return landmarkDataUrl(props.iconKey, { variant: props.variant })
})
</script>

<template>
  <span aria-hidden="true"><img :src="source" alt="" draggable="false" /></span>
</template>

<style scoped>
span { display: block; }
img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
