<template>
  <div class="p-6">
    <button class="flex items-center gap-1.5 text-sm opacity-70 mb-4 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>
    <h1 class="text-[28px] font-extrabold mb-6">播放历史</h1>

    <div v-if="loading" class="text-center py-[60px] text-text-secondary">加载中...</div>

    <div v-else-if="history.length === 0" class="text-center py-20 text-text-tertiary text-sm">
      暂无播放记录
    </div>

    <div v-else class="flex flex-col gap-0.5">
      <SongCard
        v-for="(song, i) in history"
        :key="`${song.id}-${i}`"
        :song="song"
        :index="i + 1"
        :active="store.currentSong?.id === song.id"
        @play="store.playSong(song)"
        @add="store.addSong(song)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore } from '../stores/player.js';
import SongCard from '../components/SongCard.vue';

const store = usePlayerStore();

import { Song } from '../stores/player.js';

const history = ref<Song[]>([]);
const loading = ref(true);

onMounted(async () => {
  if (!store.activeBotId) {
    await store.fetchBots();
  }

  if (store.activeBotId) {
    try {
      const res = await http.get(`/api/player/${store.activeBotId}/history`);
      history.value = res.data.history;
    } catch (err) {
      console.warn('Failed to load history:', err);
    }
  }

  loading.value = false;
});
</script>
