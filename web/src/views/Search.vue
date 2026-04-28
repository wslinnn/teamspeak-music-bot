<template>
  <div class="search-page">
    <button class="mb-4 flex items-center gap-1.5 text-sm text-foreground-muted opacity-70 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>

    <div class="mb-6">
      <div class="flex items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3.5">
        <Icon icon="mdi:magnify" class="mr-3 text-[22px] opacity-40" />
        <input
          ref="searchInput"
          v-model="query"
          class="flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-foreground-subtle"
          placeholder="搜索歌曲、歌手、专辑..."
          @keyup.enter="doSearch"
          autofocus
        />
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-col gap-2">
      <SkeletonLoader v-for="n in 6" :key="n" height="64px" border-radius="10px" />
    </div>

    <!-- Results -->
    <div v-else-if="results.length > 0" class="flex flex-col gap-0.5">
      <SongCard
        v-for="(song, i) in results"
        :key="`${song.platform}-${song.id}`"
        :song="song"
        :index="i + 1"
        :active="store.currentSong?.id === song.id"
        @play="store.playSong(song)"
        @add="store.addSong(song)"
      />
    </div>

    <!-- Empty -->
    <EmptyState
      v-else-if="searched"
      message="未找到相关结果"
      icon="mdi:music-note-off"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore, type Song } from '../stores/player';
import SongCard from '../components/SongCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import SkeletonLoader from '../components/common/SkeletonLoader.vue';

const store = usePlayerStore();
const route = useRoute();

const query = ref((route.query.q as string) || '');
const results = ref<Song[]>([]);
const loading = ref(false);
const searched = ref(false);

async function doSearch() {
  if (!query.value.trim()) return;
  loading.value = true;
  searched.value = true;
  try {
    const res = await http.get('/api/music/search/all', { params: { q: query.value } });
    results.value = res.data.songs;
  } catch {
    results.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (query.value) doSearch();
});
</script>
