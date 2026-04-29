<template>
  <div class="favorites-page">
    <h1 class="page-title">我的收藏</h1>

    <div v-if="store.loading" class="loading">加载中...</div>

    <div v-else-if="store.favorites.length === 0" class="empty">
      暂无收藏歌曲
    </div>

    <div v-else class="favorites-list">
      <SongCard
        v-for="(item, i) in store.favorites"
        :key="item.id"
        :song="{
          id: item.songId,
          name: item.title,
          artist: item.artist,
          album: '',
          duration: 0,
          coverUrl: item.coverUrl,
          platform: item.platform as any,
        }"
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
import { usePlayerStore } from '../stores/player';
import SongCard from '../components/SongCard.vue';

const store = useFavoritesStore();
const playerStore = usePlayerStore();

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

.loading {
  text-align: center;
  padding: 60px;
  color: var(--text-secondary);
}

.empty {
  text-align: center;
  padding: 80px;
  color: var(--text-tertiary);
  font-size: 14px;
}
</style>
