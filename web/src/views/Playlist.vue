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
          <h1 class="text-[28px] font-extrabold mb-2 flex items-center gap-3">{{ playlist.name }}
            <PlaylistFavoriteButton
              v-if="kind === 'playlist'"
              :playlist-id="(route.params.id as string)"
              :platform="(route.query.platform as string) || 'netease'"
              :name="playlist.name"
              :cover-url="playlist.coverUrl"
              :song-count="songs.length"
            />
          </h1>
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
          @playnext="store.playNextSong(song)"
          @add="store.addSong(song)"
        />
      </div>
    </template>

    <div v-else class="text-center py-[60px]">
      <Icon icon="mdi:playlist-remove" class="text-4xl text-text-tertiary mb-3" />
      <p class="text-text-secondary text-sm">{{ kind === 'album' ? '专辑' : '歌单' }}不存在或加载失败</p>
      <button class="mt-4 px-5 py-2 text-sm font-medium rounded-[var(--radius-md)] bg-primary text-white cursor-pointer transition-colors hover:brightness-110" @click="retryLoad">重试</button>
    </div>
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
import PlaylistFavoriteButton from '../components/PlaylistFavoriteButton.vue';

const store = usePlayerStore();
const route = useRoute();

import { Song } from '../stores/player';

// 路由 meta 再定形态：/playlist/:id = 歌单，/album/:id = 专辑（共用本页）
const kind = (route.meta.kind as string) ?? 'playlist';

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
  if (kind === 'album') {
    await store.playAlbum(id, platform);
  } else {
    await store.playPlaylist(id, platform);
  }
}

async function loadPlaylist() {
  const id = route.params.id as string;
  const platform = (route.query.platform as string) || 'netease';
  loading.value = true;
  // allSettled：详情挂了但歌曲列表正常时仍展示歌曲（专辑无 detail 端点，走歌曲兜底）
  const [detailRes, songsRes] = await Promise.allSettled([
    kind === 'album'
      ? Promise.resolve({ data: { playlist: null } })
      : http.get(`/api/music/playlist/${id}/detail`, { params: { platform } }),
    http.get(kind === 'album' ? `/api/music/album/${id}` : `/api/music/playlist/${id}`, { params: { platform } }),
  ]);
  const detail = detailRes.status === 'fulfilled' ? detailRes.value.data?.playlist : null;
  const songList = songsRes.status === 'fulfilled' ? (songsRes.value.data?.songs ?? []) : [];
  if (detail) {
    playlist.value = detail;
  } else if (songList.length > 0) {
    // 用路由信息 + 首歌兜底：专辑模式下每首歌的 album 字段就是专辑名
    playlist.value = {
      id,
      name: kind === 'album' ? (songList[0]?.album || '专辑') : '歌单',
      description: '',
      coverUrl: songList[0]?.coverUrl ?? '',
      songCount: songList.length,
    };
  } else {
    playlist.value = null;
    songs.value = [];
    loading.value = false;
    return;
  }
  songs.value = songList;
  loading.value = false;
}

function retryLoad() {
  loadPlaylist();
}

onMounted(() => {
  loadPlaylist();
});
</script>
