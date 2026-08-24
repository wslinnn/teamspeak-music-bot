<template>
  <div
    class="group flex items-center gap-3 px-3 py-2 rounded-[var(--radius-md)] transition-colors cursor-pointer hover:bg-hover-bg"
    :class="{ 'bg-[rgba(51,94,234,0.1)]': active }"
    @dblclick="$emit('play')"
  >
    <div class="w-6 text-center text-[13px] text-text-tertiary">{{ index }}</div>
    <CoverArt :url="song.coverUrl" :size="36" :radius="6" />
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-1.5 min-w-0">
        <span class="text-sm font-medium truncate">{{ song.name }}</span>
        <span
          class="shrink-0 text-[10px] font-semibold px-[5px] py-px rounded-[3px] leading-[1.4]"
          :class="getPlatformTailwindClass(song.platform)"
        >{{ getPlatformLabel(song.platform) }}</span>
      </div>
      <div class="text-xs text-text-secondary">{{ song.artist }}</div>
    </div>
    <div class="w-40 text-xs text-text-secondary truncate hidden md:block">{{ song.album }}</div>
    <div class="w-12 text-xs text-text-tertiary text-right hidden sm:block">{{ formatDuration(song.duration) }}</div>
    <div class="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
      <FavoriteButton
        :song-id="song.id"
        :platform="song.platform"
        :song-name="song.name"
        :artist="song.artist"
        :cover-url="song.coverUrl"
        :duration="song.duration"
      />
      <button class="text-lg p-1 rounded-[var(--radius-sm)] opacity-70 transition-opacity hover:opacity-100" @click.stop="$emit('play')" title="播放">
        <Icon icon="mdi:play" />
      </button>
      <button class="text-lg p-1 rounded-[var(--radius-sm)] opacity-70 transition-opacity hover:opacity-100" @click.stop="$emit('add')" title="添加到队列">
        <Icon icon="mdi:playlist-plus" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import CoverArt from './CoverArt.vue';
import FavoriteButton from './FavoriteButton.vue';
import { Song } from '../stores/player.js';
import { formatDuration } from '../utils/format';
import { getPlatformLabel, getPlatformTailwindClass } from '../utils/platform';

defineProps<{
  song: Song;
  index: number;
  active?: boolean;
}>();

defineEmits<{
  play: [];
  add: [];
}>();

</script>
