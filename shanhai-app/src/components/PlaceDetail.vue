<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Place, VisitSummary } from '../domain/models'
import { detailPage } from '../domain/map-layout'
import LandmarkIcon from './LandmarkIcon.vue'
import PhotoThumbnail from './PhotoThumbnail.vue'
const props = defineProps<{ place: Place; visits: readonly VisitSummary[]; revision: number; query: string; disabled?: boolean }>()
const emit = defineEmits<{ back: []; viewPhoto: [visit: VisitSummary, index: number]; add: []; edit: [visit: VisitSummary]; delete: [visit: VisitSummary]; share: [visit: VisitSummary] }>()
const limit = ref(8), showAll = ref(false)
watch(() => [props.place.id, props.query], () => { limit.value = 8; showAll.value = false })
const page = computed(() => detailPage(props.visits, props.query, { limit: limit.value, showAll: showAll.value }))
const validUrl = (url?: string) => typeof url === 'string' && /^https:\/\//.test(url) ? url : undefined
const coverIndex = (visit: VisitSummary) => Math.max(0, visit.photos.findIndex(photo => photo.id === visit.coverId))
</script>

<template>
  <section class="yn-detail" tabindex="-1" aria-live="polite">
    <button class="yn-back" type="button" @click="emit('back')">返回景点列表</button>
    <div class="yn-detail-hero"><LandmarkIcon class="yn-detail-icon" :icon-key="place.iconKey" :variant="place.id" /><div><p class="yn-region-name">{{ place.regionName }}{{ place.isCustom ? ' · 我的地点' : '' }}</p><h2>{{ place.name }}</h2><p>{{ place.text }}</p></div></div>
    <p class="yn-anchor-note">{{ place.anchorNote }}</p>
    <p v-if="place.source || place.coordinateSource.url" class="yn-source"><a v-if="validUrl(place.source)" :href="validUrl(place.source)" target="_blank" rel="noopener noreferrer">公共景点资料</a><span v-if="place.source && place.coordinateSource.url"> · </span><a v-if="validUrl(place.coordinateSource.url)" :href="validUrl(place.coordinateSource.url)" target="_blank" rel="noopener noreferrer">坐标来源</a></p>
    <h3>在这里的回忆 <small>{{ visits.length }} 段</small></h3>
    <div class="yn-detail-actions"><button type="button" class="yn-primary" :disabled="disabled" @click="emit('add')">{{ visits.length ? '再记一次' : '记下这次到访' }}</button></div>
    <p v-if="!visits.length" class="yn-empty">这里还没有你的旅行回忆。公共景点标记不代表已到访。</p>
    <p v-if="page.filtering" class="yn-memory-filter">找到 {{ page.matched }} 段与搜索匹配的回忆。<button type="button" @click="showAll = true; limit = 8">查看这里的全部回忆</button></p>
    <article v-for="visit in page.items" :key="visit.id" class="yn-memory">
      <p><time :datetime="visit.date">{{ visit.date }}</time><span v-if="visit.photos.length"> · {{ visit.photos.length }} 张照片</span></p>
      <button v-if="visit.photos[coverIndex(visit)]" class="yn-memory-cover" type="button" :aria-label="`查看 ${visit.date} 的完整照片`" @click="emit('viewPhoto', visit, coverIndex(visit))"><PhotoThumbnail :visit-id="visit.id" :photo-id="visit.photos[coverIndex(visit)]!.id" :revision="revision" :alt="visit.photos[coverIndex(visit)]!.name" /></button>
      <p v-if="visit.note" class="yn-memory-note">{{ visit.note }}</p>
      <div class="yn-detail-actions"><button type="button" :disabled="disabled" @click="emit('share', visit)">制作回忆卡</button><button type="button" :disabled="disabled" @click="emit('edit', visit)">编辑</button><button type="button" :disabled="disabled" @click="emit('delete', visit)">删除</button></div>
    </article>
    <button v-if="page.remaining" type="button" @click="limit += 8">查看更多回忆（还有 {{ page.remaining }} 段）</button>
  </section>
</template>
