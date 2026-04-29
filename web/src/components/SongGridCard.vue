<template>
  <div
    class="group relative cursor-pointer overflow-hidden rounded-[var(--radius-md)] bg-surface-card transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
    @click="$emit('play')"
  >
    <!-- Cover -->
    <div class="relative aspect-square overflow-hidden">
      <CoverArt :url="song.coverUrl" :size="200" :radius="0" />
      <!-- Hover play overlay -->
      <div class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg">
          <Icon icon="mdi:play" class="text-2xl" />
        </div>
      </div>
      <!-- Platform badge -->
      <div
        class="absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-semibold"
        :class="platformBadgeClass"
      >
        {{ platformLabel }}
      </div>
    </div>

    <!-- Info -->
    <div class="p-3">
      <div class="truncate text-sm font-medium">{{ song.name }}</div>
      <div class="mt-0.5 truncate text-xs text-foreground-muted">{{ song.artist }}</div>
      <div class="mt-2 flex items-center justify-between">
        <span class="text-xs text-foreground-subtle">{{ formatDuration(song.duration) }}</span>
        <button
          class="flex h-7 w-7 items-center justify-center rounded-full text-foreground-muted opacity-0 transition-all duration-200 hover:bg-interactive-hover hover:text-primary group-hover:opacity-100"
          @click.stop="$emit('add')"
          title="添加到队列"
        >
          <Icon icon="mdi:playlist-plus" class="text-lg" />
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { Song } from '../stores/player.js';
import CoverArt from './CoverArt.vue';

const props = defineProps<{ song: Song }>();
defineEmits<{ play: []; add: [] }>();

const platformLabel = computed(() => {
  switch (props.song.platform) {
    case 'bilibili': return 'B站';
    case 'qq': return 'QQ';
    case 'youtube': return 'YouTube';
    default: return '网易云';
  }
});

const platformBadgeClass = computed(() => {
  switch (props.song.platform) {
    case 'bilibili': return 'bg-[#00a1d6]/90 text-white';
    case 'qq': return 'bg-[#12b76a]/90 text-white';
    case 'youtube': return 'bg-[#ff0000]/90 text-white';
    default: return 'bg-[#e81123]/90 text-white';
  }
});

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
</script>
