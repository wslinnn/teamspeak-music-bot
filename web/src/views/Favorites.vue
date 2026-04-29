<template>
  <div class="favorites-page">
    <h1 class="page-title">我的收藏</h1>

    <SkeletonLoader v-if="store.loading" />

    <EmptyState v-else-if="store.favorites.length === 0" message="暂无收藏歌曲" />

    <div v-else class="favorites-list">
      <SongCard
        v-for="(item, i) in store.favorites"
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
import { onMounted } from 'vue';
import { useFavoritesStore, type Favorite } from '../stores/favorites';
import { usePlayerStore, type Song } from '../stores/player';
import type { Platform } from '../utils/platform';
import SongCard from '../components/SongCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import SkeletonLoader from '../components/common/SkeletonLoader.vue';

const store = useFavoritesStore();
const playerStore = usePlayerStore();

function toSong(item: Favorite): Song {
  return {
    id: item.songId,
    name: item.title,
    artist: item.artist,
    album: '',
    duration: 0,
    coverUrl: item.coverUrl,
    platform: item.platform as Platform,
  };
}

function play(item: Favorite) {
  playerStore.playById(item.songId, item.platform);
}

function add(item: Favorite) {
  playerStore.addToQueueById(item.songId, item.platform);
}

onMounted(() => {
  store.fetchFavorites();
});
</script>

<style lang="scss" scoped>
.page-title {
  font-size: 28px;
  font-weight: 800;
  margin-bottom: 24px;
}

.favorites-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
</style>
