<template>
  <div class="history-page">
    <button class="mb-4 flex items-center gap-1.5 text-sm text-foreground-muted opacity-70 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>
    <h1 class="text-[28px] font-extrabold mb-6">播放历史</h1>

    <!-- Search -->
    <div class="mb-4">
      <div class="flex items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3.5">
        <Icon icon="mdi:magnify" class="mr-3 text-[22px] opacity-40" />
        <input
          v-model="query"
          class="flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-foreground-subtle"
          placeholder="搜索歌曲、歌手..."
        />
      </div>
    </div>

    <div v-if="loading" class="flex flex-col gap-2">
      <SkeletonLoader v-for="n in 8" :key="n" height="52px" />
    </div>

    <div v-else-if="history.length === 0" class="text-center py-20 text-text-tertiary text-sm">
      暂无播放记录
    </div>

    <EmptyState v-else-if="filteredHistory.length === 0" message="无搜索结果" icon="mdi:music-note-off" />

    <div v-else class="flex flex-col gap-0.5">
      <SongCard
        v-for="(song, i) in filteredHistory"
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
import { ref, computed, watch, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore, type Song } from '../stores/player.js';
import SongCard from '../components/SongCard.vue';
import SkeletonLoader from '../components/common/SkeletonLoader.vue';
import EmptyState from '../components/common/EmptyState.vue';

const store = usePlayerStore();

const history = ref<Song[]>([]);
const loading = ref(true);
const query = ref('');

const filteredHistory = computed(() => {
  if (!query.value.trim()) return history.value;
  const q = query.value.toLowerCase();
  return history.value.filter(
    (s) => s.name.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
  );
});

async function loadHistory() {
  if (!store.activeBotId) {
    history.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const res = await http.get(`/api/player/${store.activeBotId}/history`);
    history.value = res.data.history ?? [];
  } catch (err) {
    console.warn('Failed to load history:', err);
    history.value = [];
  } finally {
    loading.value = false;
  }
}

watch(() => store.activeBotId, loadHistory);

onMounted(async () => {
  if (!store.activeBotId) {
    await store.fetchBots();
  }
  await loadHistory();
});
</script>
