<template>
  <button
    class="flex h-7 w-7 items-center justify-center rounded-full text-lg transition-all duration-200 hover:bg-interactive-hover"
    :class="isActive ? 'text-danger' : 'text-foreground-muted hover:text-foreground'"
    @click.stop="toggle"
    :title="isActive ? '取消收藏' : '收藏'"
  >
    <Icon :icon="isActive ? 'mdi:heart' : 'mdi:heart-outline'" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useFavoritesStore } from '../stores/favorites';

const props = defineProps<{
  songId: string;
  platform: string;
  songName: string;
  artist: string;
  coverUrl: string;
}>();

const favoritesStore = useFavoritesStore();
const isActive = computed(() =>
  favoritesStore.isFavorite(props.songId, props.platform)
);

async function toggle() {
  if (isActive.value) {
    const id = favoritesStore.getFavoriteId(props.songId, props.platform);
    if (id !== undefined) {
      await favoritesStore.removeFavorite(id);
    }
  } else {
    await favoritesStore.addFavorite({
      id: props.songId,
      platform: props.platform,
      name: props.songName,
      artist: props.artist,
      coverUrl: props.coverUrl,
    });
  }
}
</script>
