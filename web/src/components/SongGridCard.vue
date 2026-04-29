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
        <div class="flex items-center gap-1">
          <FavoriteButton
            :song-id="song.id"
            :platform="song.platform"
            :song-name="song.name"
            :artist="song.artist"
            :cover-url="song.coverUrl"
          />
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { Song } from '../stores/player.js';
import CoverArt from './CoverArt.vue';
import FavoriteButton from './FavoriteButton.vue';
import { formatDuration } from '../utils/format';
import { getPlatformLabel, getPlatformTailwindClass } from '../utils/platform';

const props = defineProps<{ song: Song }>();
defineEmits<{ play: []; add: [] }>();

const platformLabel = computed(() => getPlatformLabel(props.song.platform));
const platformBadgeClass = computed(() => getPlatformTailwindClass(props.song.platform));
</script>
