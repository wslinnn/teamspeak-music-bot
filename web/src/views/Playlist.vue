<template>
  <div class="p-6">
    <button class="flex items-center gap-1.5 text-sm opacity-70 mb-4 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>
    <div v-if="loading" class="text-center py-[60px] text-text-secondary">加载中...</div>

    <template v-else-if="playlist">
      <!-- Hero Header -->
      <div class="flex gap-8 mb-9">
        <CoverArt :url="playlist.coverUrl" :size="200" :radius="14" :show-shadow="true" />
        <div class="flex flex-col justify-center">
          <h1 class="text-[28px] font-extrabold mb-2">{{ playlist.name }}</h1>
          <p class="text-sm text-text-secondary mb-2 line-clamp-3" v-if="playlist.description">{{ playlist.description }}</p>
          <div class="text-xs text-text-tertiary mb-4">
            {{ songs.length }} 首歌曲
          </div>
          <button class="flex items-center gap-1.5 px-7 py-2.5 bg-primary text-white rounded-[var(--radius-lg)] text-sm font-semibold w-fit transition-transform hover:scale-[1.04] active:scale-[0.96]" @click="playAll">
            <Icon icon="mdi:play" />
            播放全部
          </button>
        </div>
      </div>

      <!-- Song List -->
      <div class="flex flex-col gap-0.5">
        <SongCard
          v-for="(song, i) in songs"
          :key="song.id"
          :song="song"
          :index="i + 1"
          :active="store.currentSong?.id === song.id"
          @play="store.playSong(song)"
          @add="store.addSong(song)"
        />
      </div>
    </template>

    <div v-else class="text-center py-[60px] text-text-secondary">歌单不存在或加载失败</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore } from '../stores/player.js';
import CoverArt from '../components/CoverArt.vue';
import SongCard from '../components/SongCard.vue';

const store = usePlayerStore();
const route = useRoute();

import { Song } from '../stores/player.js';

interface PlaylistDetail {
  id: string;
  name: string;
  description: string;
  coverUrl: string;
  songCount: number;
}

const playlist = ref<PlaylistDetail | null>(null);
const songs = ref<Song[]>([]);
const loading = ref(true);

async function playAll() {
  const id = route.params.id as string;
  const platform = (route.query.platform as string) || 'netease';
  await store.playPlaylist(id, platform);
}

onMounted(async () => {
  const id = route.params.id as string;
  const platform = (route.query.platform as string) || 'netease';

  try {
    const [detailRes, songsRes] = await Promise.all([
      http.get(`/api/music/playlist/${id}/detail`, { params: { platform } }),
      http.get(`/api/music/playlist/${id}`, { params: { platform } }),
    ]);
    playlist.value = detailRes.data.playlist;
    songs.value = songsRes.data.songs;
  } catch (err: any) {
    console.error('Failed to load playlist:', err?.response?.status, err?.message);
    playlist.value = null;
    songs.value = [];
  } finally {
    loading.value = false;
  }
});
</script>
