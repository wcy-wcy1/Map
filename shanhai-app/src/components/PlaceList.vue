<script setup lang="ts">
import { computed } from 'vue'
import type { Cover, Place, VisitSummary } from '../domain/models'
import { matchesVisit } from '../domain/map-layout'
import { selectPlaceCover } from '../domain/place-cover'
import LandmarkIcon from './LandmarkIcon.vue'
import PhotoThumbnail from './PhotoThumbnail.vue'
const props = defineProps<{ places: readonly Place[]; recordIndex: Map<string, VisitSummary[]>; covers?: readonly Cover[]; revision: number; query: string; limit: number; hasFilters: boolean; visitedOnly: boolean }>()
const emit = defineEmits<{ select: [placeId: string]; more: []; reset: [] }>()
const shown = computed(() => props.places.slice(0, props.limit))
const firstVisit = (id: string) => {
  const rows = props.recordIndex.get(id) ?? []
  return rows.find(visit => matchesVisit(visit, props.query)) ?? rows[0]
}
const selectedCovers = computed(() => new Map(shown.value.map(place => [place.id,
  selectPlaceCover(place.id, props.recordIndex, props.covers ?? [], props.query)])))
const cover = (id: string) => selectedCovers.value.get(id)
</script>

<template>
  <section class="yn-browse" tabindex="-1">
    <div class="yn-list-heading"><h2>{{ visitedOnly ? '我的足迹' : '找一个地方' }}</h2><span class="yn-result-count" role="status">{{ places.length }} 处</span></div>
    <p class="yn-list-intro">{{ visitedOnly ? '只有留下过回忆的地点，才会出现在这里。' : '公共景点供你寻找地点，不表示你已经去过。' }}</p>
    <div v-if="!places.length" class="yn-empty">
      <p>{{ hasFilters ? '没有找到符合条件的地点或回忆。' : '还没有留下足迹。' }}</p>
      <button v-if="hasFilters" type="button" @click="emit('reset')">清除筛选，看看全部景点</button>
    </div>
    <div class="yn-place-list">
      <button v-for="place in shown" :key="place.id" class="yn-place-row" type="button" :aria-label="`查看${place.name}${recordIndex.has(place.id) ? '，有我的回忆' : ''}`" @click="emit('select', place.id)">
        <span v-if="cover(place.id)" class="yn-row-photo"><PhotoThumbnail :visit-id="cover(place.id)!.visitId" :photo-id="cover(place.id)!.photoId" :revision="revision" :alt="`${place.name}的回忆封面`" compact /></span>
        <LandmarkIcon v-else class="yn-list-icon" :icon-key="place.iconKey" :variant="place.id" />
        <span class="yn-row-copy"><strong>{{ place.name }}</strong><small>{{ place.regionName }}{{ place.isCustom ? ' · 我的地点' : '' }}</small><span v-if="firstVisit(place.id)" class="yn-row-memory">{{ firstVisit(place.id)!.date }} · {{ firstVisit(place.id)!.note.slice(0, 54) || '那天的照片' }}</span></span>
        <span v-if="recordIndex.has(place.id)" class="yn-row-count">{{ recordIndex.get(place.id)!.length }} 段</span>
      </button>
    </div>
    <button v-if="places.length > limit" class="yn-show-more" type="button" @click="emit('more')">查看更多景点（还有 {{ places.length - limit }} 处）</button>
  </section>
</template>
