<script setup lang="ts">
import { computed } from 'vue'
import { landmarkDataUrl } from '../map/landmarks'

const props = defineProps<{ iconKey: string; variant?: string }>()
const source = computed(() => landmarkDataUrl(props.iconKey, { variant: props.variant }))
</script>

<template>
  <span aria-hidden="true"><img :src="source" alt="" draggable="false" /></span>
</template>

<style scoped>
span { display: block; }
img { display: block; width: 100%; height: 100%; object-fit: contain; }
</style>
