<template>
  <button
    v-if="!auth.isGuest"
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
import { useAuthStore } from '../stores/auth';

const props = defineProps<{
  songId: string;
  platform: string;
  songName: string;
  artist: string;
  coverUrl: string;
  duration?: number;
}>();

const favoritesStore = useFavoritesStore();
// 歌曲收藏按 WebUI 用户隔离，游客无此接口权限——红心直接不显示
const auth = useAuthStore();
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
      duration: props.duration ?? 0,
    });
  }
}
</script>
