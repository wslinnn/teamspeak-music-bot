<template>
  <section v-if="store.currentSong" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">正在播放</h2>
    <div class="flex items-center gap-5 rounded-[var(--radius-lg)] bg-surface-card p-5">
      <CoverArt :url="store.currentSong.coverUrl" :size="80" :radius="10" :show-shadow="true" />
      <div>
        <div class="text-[17px] font-semibold">{{ store.currentSong.name }}</div>
        <div class="text-[13px] text-foreground-muted">
          {{ store.currentSong.artist }} · {{ store.currentSong.album }}
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { usePlayerStore } from '../../stores/player';
import CoverArt from '../CoverArt.vue';

const store = usePlayerStore();
</script>
