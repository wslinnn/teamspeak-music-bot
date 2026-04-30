<template>
  <div class="favorites-page">
    <button class="mb-4 flex items-center gap-1.5 text-sm text-foreground-muted opacity-70 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>
    <h1 class="text-[28px] font-extrabold mb-6">我的收藏</h1>

    <!-- Search -->
    <div v-if="!store.loading && store.favorites.length > 0" class="mb-4">
      <div class="flex items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3.5">
        <Icon icon="mdi:magnify" class="mr-3 text-[22px] opacity-40" />
        <input
          v-model="query"
          class="flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-foreground-subtle"
          placeholder="搜索歌曲、歌手..."
        />
      </div>
    </div>

    <SkeletonLoader v-if="store.loading" />

    <EmptyState v-else-if="store.favorites.length === 0" message="暂无收藏歌曲" />

    <EmptyState v-else-if="filteredFavorites.length === 0" message="无搜索结果" icon="mdi:music-note-off" />

    <div v-else class="flex flex-col gap-0.5">
      <SongCard
        v-for="(item, i) in filteredFavorites"
        :key="item.id"
        :song="toSong(item)"
        :index="i + 1"
        :active="playerStore.currentSong?.id === item.songId"
        @play="play(item)"
        @add="add(item)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { useFavoritesStore, type Favorite } from '../stores/favorites';
import { usePlayerStore, type Song } from '../stores/player';
import type { Platform } from '../utils/platform';
import SongCard from '../components/SongCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import SkeletonLoader from '../components/common/SkeletonLoader.vue';

const store = useFavoritesStore();
const playerStore = usePlayerStore();
const query = ref('');

const filteredFavorites = computed(() => {
  if (!query.value.trim()) return store.favorites;
  const q = query.value.toLowerCase();
  return store.favorites.filter(
    (f) => f.title.toLowerCase().includes(q) || f.artist.toLowerCase().includes(q)
  );
});

function toSong(item: Favorite): Song {
  return {
    id: item.songId,
    name: item.title,
    artist: item.artist,
    album: '',
    duration: item.duration,
    coverUrl: item.coverUrl,
    platform: item.platform as Platform,
  };
}

function play(item: Favorite) {
  playerStore.playSong(toSong(item));
}

function add(item: Favorite) {
  playerStore.addSong(toSong(item));
}

onMounted(() => {
  store.fetchFavorites();
});
</script>
