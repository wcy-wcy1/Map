<script setup lang="ts">
import { computed } from 'vue'
import type { Place, VisitSummary } from '../domain/models'
import { orderPlacesByNearest } from '../map/planner'
import LandmarkIcon from './LandmarkIcon.vue'

const props = defineProps<{
  places: readonly Place[]
  selectedIds: readonly string[]
  recordIndex: ReadonlyMap<string, readonly VisitSummary[]>
  areaLabel: string
}>()
const emit = defineEmits<{ back: []; toggle: [placeId: string]; preview: [placeIds: string[]]; clear: [] }>()

const selected = computed(() => props.selectedIds.map(id => props.places.find(place => place.id === id)).filter(Boolean) as Place[])
const ordered = computed(() => orderPlacesByNearest(selected.value))
const candidates = computed(() => {
  const chosen = new Set(props.selectedIds)
  const visited = [...props.places].filter(place => props.recordIndex.has(place.id) && !chosen.has(place.id))
  const rest = props.places.filter(place => !props.recordIndex.has(place.id) && !chosen.has(place.id))
  return [...visited, ...rest].slice(0, 10)
})
function preview() {
  if (ordered.value.length >= 2) emit('preview', ordered.value.map(place => place.id))
}
</script>

<template>
  <section class="yn-planner" tabindex="-1" aria-live="polite">
    <button class="yn-back" type="button" @click="emit('back')">返回景点列表</button>
    <div class="yn-planner-hero">
      <p>{{ areaLabel }} · 轻量规划</p>
      <h2>选几个想去的地方</h2>
      <span>先按距离生成一个顺路顺序；不是实时导航，也不判断开放时间。</span>
    </div>
    <div v-if="selected.length" class="yn-planner-route">
      <p>已选 {{ selected.length }} 处</p>
      <ol>
        <li v-for="place in ordered" :key="place.id">{{ place.name }}</li>
      </ol>
      <div class="yn-detail-actions">
        <button type="button" class="yn-primary" :disabled="ordered.length < 2" @click="preview">预览这趟路</button>
        <button type="button" @click="emit('clear')">清空</button>
      </div>
    </div>
    <p v-else class="yn-list-intro">可以先从当前筛选结果里选点；留下过回忆的地点会排在前面。</p>
    <div class="yn-planner-candidates">
      <button v-for="place in candidates" :key="place.id" type="button" class="yn-planner-place" @click="emit('toggle', place.id)">
        <LandmarkIcon class="yn-list-icon" :icon-key="place.iconKey" :variant="place.id" />
        <span><strong>{{ place.name }}</strong><small>{{ place.regionName }}{{ recordIndex.has(place.id) ? ' · 有回忆' : '' }}</small></span>
        <em>加入</em>
      </button>
    </div>
    <p v-if="!candidates.length" class="yn-empty">当前范围没有可加入的地点，可以清除筛选或切换省份。</p>
  </section>
</template>
