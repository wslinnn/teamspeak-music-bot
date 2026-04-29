import { defineStore } from 'pinia';
import { ref } from 'vue';
import { http } from '../utils/http';

export interface Favorite {
  id: number;
  songId: string;
  platform: string;
  title: string;
  artist: string;
  coverUrl: string;
  createdAt: string;
}

export const useFavoritesStore = defineStore('favorites', () => {
  const favorites = ref<Favorite[]>([]);
  const loading = ref(false);

  async function fetchFavorites() {
    loading.value = true;
    try {
      const res = await http.get('/api/favorites');
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
  }) {
    try {
      await http.post('/api/favorites', {
        songId: song.id,
        platform: song.platform,
        title: song.name,
        artist: song.artist,
        coverUrl: song.coverUrl,
      });
      await fetchFavorites();
    } catch (err) {
      console.error('Failed to add favorite:', err);
    }
  }

  async function removeFavorite(id: number) {
    try {
      await http.delete(`/api/favorites/${id}`);
      await fetchFavorites();
    } catch (err) {
      console.error('Failed to remove favorite:', err);
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
