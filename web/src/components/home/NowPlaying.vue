<template>
  <section v-if="store.currentSong" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">正在播放</h2>
    <div
      class="flex items-center gap-5 rounded-[var(--radius-lg)] bg-surface-card p-5 cursor-pointer transition-colors hover:bg-interactive-hover"
      role="button"
      tabindex="0"
      title="查看歌词"
      @click="$router.push('/lyrics')"
      @keydown.enter="$router.push('/lyrics')"
    >
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
import { useRouter } from 'vue-router';
import { usePlayerStore } from '../../stores/player';
import CoverArt from '../CoverArt.vue';

const router = useRouter();
const store = usePlayerStore();
</script>
