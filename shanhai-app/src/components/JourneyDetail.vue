<script setup lang="ts">
import { computed } from 'vue'
import type { Cover, Place, VisitSummary } from '../domain/models'
import { selectPlaceCover } from '../domain/place-cover'
import LandmarkIcon from './LandmarkIcon.vue'
import PhotoThumbnail from './PhotoThumbnail.vue'

const props = defineProps<{
  placeIds: readonly string[]
  places: readonly Place[]
  recordIndex: ReadonlyMap<string, readonly VisitSummary[]>
  covers?: readonly Cover[]
  revision: number
}>()
const emit = defineEmits<{ back: []; select: [placeId: string]; add: [placeId: string]; viewPhoto: [visit: VisitSummary, index: number] }>()

const placeById = computed(() => new Map(props.places.map(place => [place.id, place])))
const rows = computed(() => props.placeIds.map((id, index) => {
  const place = placeById.value.get(id)
  const visits = [...(props.recordIndex.get(id) ?? [])].sort((a, b) =>
    a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const visit = visits[0]
  const selectedCover = place ? selectPlaceCover(place.id, props.recordIndex, props.covers ?? [], '') : undefined
  const coverPhotoId = selectedCover?.photoId ?? visit?.coverId ?? visit?.photos[0]?.id
  const coverVisitId = selectedCover?.visitId ?? visit?.id
  const coverIndex = visit && coverPhotoId ? Math.max(0, visit.photos.findIndex(photo => photo.id === coverPhotoId)) : 0
  return { index: index + 1, place, visit, visits, coverPhotoId, coverVisitId, coverIndex }
}).filter(row => row.place))
const title = computed(() => rows.value.length > 1
  ? `${rows.value[0]?.place?.name ?? '这趟旅行'} 到 ${rows.value.at(-1)?.place?.name ?? ''}`
  : rows.value[0]?.place?.name ?? '我的足迹线')
const dateRange = computed(() => {
  const dates = rows.value.flatMap(row => row.visits.map(visit => visit.date)).sort()
  if (!dates.length) return '按留下回忆的顺序整理'
  return dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} 至 ${dates.at(-1)}`
})
</script>

<template>
  <section class="yn-journey-detail" tabindex="-1" aria-live="polite">
    <button class="yn-back" type="button" @click="emit('back')">返回景点列表</button>
    <div class="yn-journey-hero">
      <p>{{ dateRange }}</p>
      <h2>{{ title }}</h2>
      <span>{{ rows.length }} 个地点 · 足迹线不是导航路线</span>
    </div>
    <ol class="yn-journey-steps">
      <li v-for="row in rows" :key="row.place!.id">
        <span class="yn-journey-number">{{ row.index }}</span>
        <button v-if="row.coverPhotoId && row.coverVisitId && row.visit" type="button" class="yn-journey-cover" :aria-label="`查看${row.place!.name}的照片`" @click="emit('viewPhoto', row.visit, row.coverIndex)">
          <PhotoThumbnail :visit-id="row.coverVisitId" :photo-id="row.coverPhotoId" :revision="revision" :alt="`${row.place!.name}的回忆封面`" compact />
        </button>
        <LandmarkIcon v-else class="yn-journey-icon" :icon-key="row.place!.iconKey" :variant="row.place!.id" />
        <span class="yn-journey-copy">
          <strong>{{ row.place!.name }}</strong>
          <small>{{ row.place!.regionName }}{{ row.visit ? ` · ${row.visit.date}` : '' }}</small>
          <span v-if="row.visit?.note">{{ row.visit.note.slice(0, 72) }}</span>
          <span v-else>这里还没有手记，可以补一段。</span>
        </span>
        <span class="yn-journey-actions">
          <button type="button" @click="emit('select', row.place!.id)">看地点</button>
          <button type="button" @click="emit('add', row.place!.id)">记一下</button>
        </span>
      </li>
    </ol>
  </section>
</template>
