<template>
  <template v-if="jellyfinEnabled">
    <!-- 最近添加 -->
    <section v-if="latestAlbums.length > 0" class="mb-9">
      <h2 class="mb-4 text-[22px] font-bold flex items-center gap-2">
        <Icon icon="mdi:jellyfish" class="text-xl opacity-70" />
        最近添加
      </h2>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        <button
          v-for="al in latestAlbums"
          :key="al.id"
          class="group text-left"
          :title="`播放专辑：${al.name}`"
          @click="playAlbum(al)"
        >
          <div class="relative aspect-square overflow-hidden rounded-[10px]">
            <CoverArt :url="al.coverUrl" :fill="true" :radius="0" />
            <div class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg">
                <Icon icon="mdi:play" class="text-2xl" />
              </div>
            </div>
          </div>
          <div class="mt-2 text-[13px] font-medium truncate">{{ al.name }}</div>
          <div class="text-xs text-text-tertiary truncate">{{ al.artist }}</div>
        </button>
      </div>
    </section>

    <!-- 播放最多 -->
    <section v-if="mostPlayed.length > 0" class="mb-9">
      <h2 class="mb-4 text-[22px] font-bold">播放最多</h2>
      <div class="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        <button
          v-for="song in mostPlayed"
          :key="song.id"
          class="text-left"
          :title="`播放：${song.name}`"
          @click="store.playSong(song)"
        >
          <div class="aspect-square overflow-hidden rounded-[10px]">
            <CoverArt :url="song.coverUrl" :fill="true" :radius="0" />
          </div>
          <div class="mt-2 text-[13px] font-medium truncate">{{ song.name }}</div>
          <div class="text-xs text-text-tertiary truncate">{{ song.artist }}</div>
        </button>
      </div>
    </section>

    <!-- Jellyfin 收藏 -->
    <section v-if="!authStore.isGuest && favorites.length > 0" class="mb-9">
      <h2 class="mb-4 text-[22px] font-bold flex items-center gap-2">
        <Icon icon="mdi:star" class="text-xl opacity-70" />
        Jellyfin 收藏
      </h2>
      <div class="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        <button
          v-for="song in favorites"
          :key="song.id"
          class="text-left"
          :title="`播放：${song.name}`"
          @click="store.playSong(song)"
        >
          <div class="aspect-square overflow-hidden rounded-[10px]">
            <CoverArt :url="song.coverUrl" :fill="true" :radius="0" />
          </div>
          <div class="mt-2 text-[13px] font-medium truncate">{{ song.name }}</div>
          <div class="text-xs text-text-tertiary truncate">{{ song.artist }}</div>
        </button>
      </div>
    </section>

    <!-- 流派 -->
    <section v-if="genres.length > 0" class="mb-9">
      <h2 class="mb-4 text-[22px] font-bold">流派</h2>
      <div class="flex flex-wrap gap-2">
        <button
          v-for="g in genres"
          :key="g.id"
          class="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-surface-card text-[13px] font-medium transition-colors hover:bg-interactive-hover hover:text-primary"
          :title="`播放流派：${g.name}`"
          @click="store.playJellyfinGenre(g.id)"
        >
          <Icon icon="mdi:music-note" class="text-sm opacity-60" />
          {{ g.name }}
        </button>
      </div>
    </section>
  </template>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { usePlayerStore, type Song } from '../../stores/player';
import { useAuthStore } from '../../stores/auth';
import { useToast } from '../../composables/useToast';
import CoverArt from '../CoverArt.vue';

interface AlbumItem {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
}

interface GenreItem {
  id: string;
  name: string;
}

const store = usePlayerStore();
const authStore = useAuthStore();
const toast = useToast();

const jellyfinEnabled = ref(false);
const latestAlbums = ref<AlbumItem[]>([]);
const mostPlayed = ref<Song[]>([]);
const favorites = ref<Song[]>([]);
const genres = ref<GenreItem[]>([]);

async function playAlbum(al: AlbumItem) {
  if (!store.activeBotId) {
    toast.error('请先选择机器人');
    return;
  }
  try {
    await http.post(`/api/player/${store.activeBotId}/play-album`, { albumId: al.id, platform: 'jellyfin' });
    toast.success(`正在播放专辑：${al.name}`);
  } catch {
    // 错误信息由 http 拦截器统一 toast
  }
}

onMounted(async () => {
  try {
    const res = await http.get('/api/music/providers');
    jellyfinEnabled.value = (res.data.enabled ?? []).includes('jellyfin');
  } catch {
    return;
  }
  if (!jellyfinEnabled.value) return;

  const tasks: Promise<void>[] = [
    http.get('/api/music/jellyfin/latest-albums', { params: { limit: 12 } })
      .then((r) => { latestAlbums.value = r.data.albums ?? []; })
      .catch(() => {}),
    http.get('/api/music/jellyfin/most-played', { params: { limit: 12 } })
      .then((r) => { mostPlayed.value = r.data.songs ?? []; })
      .catch(() => {}),
    http.get('/api/music/jellyfin/genres', { params: { limit: 20 } })
      .then((r) => { genres.value = r.data.genres ?? []; })
      .catch(() => {}),
  ];
  // 收藏是账号级数据，游客无权访问（对应后端 requireNotGuest）
  if (!authStore.isGuest) {
    tasks.push(
      http.get('/api/music/jellyfin/favorites', { params: { limit: 12 } })
        .then((r) => { favorites.value = r.data.songs ?? []; })
        .catch(() => {})
    );
  }
  await Promise.all(tasks);
});
</script>
