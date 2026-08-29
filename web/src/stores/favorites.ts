import { defineStore } from 'pinia';
import { ref } from 'vue';
import { http } from '../utils/http';
import { useToast } from '../composables/useToast';

export interface Favorite {
  id: number;
  songId: string;
  platform: string;
  title: string;
  artist: string;
  coverUrl: string;
  duration: number;
  createdAt: string;
}

export const useFavoritesStore = defineStore('favorites', () => {
  const favorites = ref<Favorite[]>([]);
  const loading = ref(false);

  // 审计 PERF-10：本地点收藏后 fetchFavorites() 与后端 favoritesChanged
  // 广播触发的 handleWsUpdate() 会背靠背各拉一次全量列表。500ms 去重窗口
  // 把回声折叠掉；窗口内真实变更丢失的风险由下一次任意拉取兜底。
  let lastFetchAt = 0;

  async function fetchFavorites() {
    if (Date.now() - lastFetchAt < 500) return;
    lastFetchAt = Date.now();
    loading.value = true;
    try {
      const res = await http.get('/api/song-favorites');
      favorites.value = res.data.favorites ?? [];
    } catch (err) {
      console.warn('fetchFavorites failed:', err);
      favorites.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function addFavorite(song: {
    id: string;
    platform: string;
    name: string;
    artist: string;
    coverUrl: string;
    duration?: number;
  }) {
    const toast = useToast();
    try {
      await http.post('/api/song-favorites', {
        songId: song.id,
        platform: song.platform,
        title: song.name,
        artist: song.artist,
        coverUrl: song.coverUrl,
        duration: song.duration ?? 0,
      });
      await fetchFavorites();
      toast.success('已添加到收藏');
    } catch (err) {
      console.error('Failed to add favorite:', err);
      toast.error('收藏失败');
    }
  }

  async function removeFavorite(id: number) {
    const toast = useToast();
    try {
      await http.delete(`/api/song-favorites/${id}`);
      await fetchFavorites();
      toast.success('已取消收藏');
    } catch (err) {
      console.error('Failed to remove favorite:', err);
      toast.error('取消收藏失败');
    }
  }

  function isFavorite(songId: string, platform: string): boolean {
    return favorites.value.some((f) => f.songId === songId && f.platform === platform);
  }

  function getFavoriteId(songId: string, platform: string): number | undefined {
    return favorites.value.find((f) => f.songId === songId && f.platform === platform)?.id;
  }

  function handleWsUpdate() {
    // Re-fetch from server to ensure we show the current user's favorites
    fetchFavorites();
  }

  return {
    favorites,
    loading,
    fetchFavorites,
    addFavorite,
    removeFavorite,
    isFavorite,
    getFavoriteId,
    handleWsUpdate,
  };
});
