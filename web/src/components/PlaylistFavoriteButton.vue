<template>
  <button
    v-if="visible"
    class="flex h-7 w-7 items-center justify-center rounded-full text-lg transition-all duration-200 hover:bg-interactive-hover"
    :class="isActive ? 'text-danger' : 'text-foreground-muted hover:text-foreground'"
    :style="overlay ? 'background: rgba(0,0,0,0.45)' : undefined"
    @click.stop="toggle"
    :title="isActive ? '取消收藏歌单' : '收藏歌单'"
  >
    <Icon :icon="isActive ? 'mdi:heart' : 'mdi:heart-outline'" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth';

const props = defineProps<{
  playlistId: string;
  platform: string;
  name: string;
  coverUrl: string;
  songCount?: number;
  /** 深色封面上悬浮展示时加深色底 */
  overlay?: boolean;
}>();

const store = usePlayerStore();
const auth = useAuthStore();
// 游客无 /api/favorites 权限，直接隐藏入口
const visible = computed(() => !auth.isGuest);
const isActive = computed(() => store.isPlaylistFavorited(props.playlistId, props.platform));

async function toggle() {
  if (isActive.value) {
    const fav = store.favoritedPlaylists.find(
      (f) => f.playlistId === props.playlistId && f.platform === props.platform
    );
    if (fav) await store.removePlaylistFavorite(fav.id);
  } else {
    await store.addPlaylistFavorite({
      platform: props.platform,
      playlistId: props.playlistId,
      name: props.name,
      coverUrl: props.coverUrl,
      songCount: props.songCount ?? 0,
    });
  }
}
</script>
