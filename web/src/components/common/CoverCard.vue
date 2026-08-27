<template>
  <RouterLink :to="to" class="group block" :title="linkTitle ?? name">
    <div class="relative aspect-square overflow-hidden rounded-[10px]">
      <CoverArt :url="coverUrl" :fill="true" :radius="0" />
      <!-- Hover overlay -->
      <div v-if="hoverIcon" class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg">
          <Icon :icon="hoverIcon" class="text-2xl" />
        </div>
      </div>
      <!-- Corner slot（歌单收藏按钮等悬浮角标） -->
      <div v-if="$slots.corner" class="absolute right-1.5 top-1.5 z-[10]">
        <slot name="corner" />
      </div>
    </div>
    <div class="mt-2 text-[13px] font-medium truncate">{{ name }}</div>
    <div v-if="$slots.subtitle" class="text-xs text-text-tertiary truncate">
      <slot name="subtitle" />
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router';
import { Icon } from '@iconify/vue';
import CoverArt from '../CoverArt.vue';

defineProps<{
  to: string;
  coverUrl: string;
  /** 展示名（同时是截断的单行标题） */
  name: string;
  /** 传入则显示 hover 居中圆形按钮（如 mdi:open-in-new） */
  hoverIcon?: string;
  /** 链接 hover tooltip，默认用 name */
  linkTitle?: string;
}>();
</script>
