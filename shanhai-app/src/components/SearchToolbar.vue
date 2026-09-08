<script setup lang="ts">
import { computed } from 'vue'
import type { Region } from '../domain/models'
import { getProvince, provinces } from '../domain/provinces'
const props = withDefaults(defineProps<{ query: string; regionId: string; visitedOnly: boolean; regions: readonly Region[]; placeCount: number; provinceId?: string; disabled?: boolean }>(), { provinceId: '', disabled: false })
const province = computed(() => getProvince(props.provinceId))
const subregions = computed(() => props.provinceId ? props.regions.filter(region => region.id !== props.provinceId) : [])
const emit = defineEmits<{
  'update:query': [value: string]
  'update:provinceId': [value: string]
  'update:regionId': [value: string]
  'update:visitedOnly': [value: boolean]
}>()
</script>

<template>
  <section class="yn-toolbar" aria-label="地图筛选">
    <div class="yn-map-heading"><h1>{{ province?.shortName || '全国' }}</h1><span class="yn-catalog-count">{{ placeCount }} 个公共地点<span v-if="!provinceId">，目前整理于云南</span><span v-else-if="!placeCount">，可添加我的地点</span></span></div>
    <form class="yn-search" role="search" aria-label="找回旅行回忆" @submit.prevent>
      <svg class="yn-search-symbol" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></svg>
      <label class="yn-sr-only" for="yn-query">搜索地点、日期或手记</label>
      <input id="yn-query" :value="query" :disabled="disabled" type="search" placeholder="地点、日期或手记里的词" maxlength="80" autocomplete="off" @input="emit('update:query', ($event.target as HTMLInputElement).value)">
      <button v-if="query" class="yn-clear" :disabled="disabled" type="button" aria-label="清空搜索" @click="emit('update:query', '')">清空</button>
    </form>
    <div class="yn-filters">
      <div class="yn-area-filters">
        <label>省份 / 地区<select class="yn-region yn-province" aria-label="选择省份或地区" :value="provinceId" :disabled="disabled" @change="emit('update:provinceId', ($event.target as HTMLSelectElement).value)"><option value="">全国总览</option><option v-for="area in provinces" :key="area.id" :value="area.id">{{ area.name }}</option></select></label>
        <label v-if="subregions.length">州市<select class="yn-region" aria-label="按州市筛选" :value="regionId" :disabled="disabled" @change="emit('update:regionId', ($event.target as HTMLSelectElement).value)"><option value="">{{ province?.shortName }}全省</option><option v-for="region in subregions" :key="region.id" :value="region.id">{{ region.name }}</option></select></label>
      </div>
      <div class="yn-visit-filters" aria-label="到访筛选">
        <button type="button" :disabled="disabled" :aria-pressed="!visitedOnly" @click="emit('update:visitedOnly', false)">全部地点</button>
        <button type="button" :disabled="disabled" :aria-pressed="visitedOnly" @click="emit('update:visitedOnly', true)">我去过的</button>
      </div>
    </div>
  </section>
</template>
