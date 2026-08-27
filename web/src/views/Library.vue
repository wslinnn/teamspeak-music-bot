<template>
  <div>
    <h1 class="text-[28px] font-extrabold mb-8">音乐库</h1>

    <!-- 我的收藏（歌单收藏） -->
    <section v-if="!authStore.isGuest && store.favoritedPlaylists.length > 0" class="mb-9">
      <h2 class="mb-4 text-[22px] font-bold flex items-center gap-2">
        <Icon icon="mdi:heart" class="text-xl text-primary" />
        我的收藏
        <span class="text-sm font-medium text-text-tertiary">{{ store.favoritedPlaylists.length }}</span>
      </h2>
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <CoverCard
          v-for="fav in store.favoritedPlaylists"
          :key="fav.id"
          :to="`/playlist/${fav.playlistId}?platform=${fav.platform}`"
          :cover-url="fav.coverUrl"
          :name="fav.name"
          :link-title="`打开歌单：${fav.name}`"
        >
          <template #subtitle>{{ getProviderLabel(fav.platform) }} · {{ fav.songCount }} 首</template>
        </CoverCard>
      </div>
    </section>

    <!-- 我的歌单（多音源） -->
    <section v-if="!authStore.isGuest && playlistSources.length > 0" class="mb-9">
      <h2 class="mb-4 text-[22px] font-bold flex items-center gap-3 flex-wrap">
        我的歌单
        <span v-if="playlistSources.length === 1" class="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-interactive-hover text-foreground-subtle">数据来自{{ getProviderLabel(playlistSources[0]) }}</span>
        <div v-else class="flex gap-1.5">
          <button
            v-for="src in playlistSources"
            :key="src"
            class="px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors"
            :class="activeSource === src ? 'bg-primary/15 text-primary' : 'bg-interactive-hover text-foreground-muted hover:text-foreground'"
            @click="activeSource = src"
          >{{ getProviderLabel(src) }}</button>
        </div>
      </h2>
      <div v-if="playlistsLoading" class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <div v-for="n in 5" :key="n" class="aspect-square rounded-[10px] bg-surface-card animate-pulse" />
      </div>
      <EmptyState v-else-if="playlists.length === 0" :message="`未获取到${getProviderLabel(activeSource)}歌单（可能需要先在设置里登录账号）`" icon="mdi:playlist-music-outline" />
      <div v-else class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <CoverCard
          v-for="pl in playlists"
          :key="pl.id"
          :to="`/playlist/${pl.id}?platform=${pl.platform}`"
          :cover-url="pl.coverUrl"
          :name="pl.name"
          :link-title="`打开歌单：${pl.name}`"
        >
          <template #subtitle>{{ pl.songCount }} 首</template>
        </CoverCard>
      </div>
    </section>

    <!-- 全空引导：没有收藏歌单、没有可用音源歌单、也没有播放记录时指路 -->
    <EmptyState
      v-if="!authStore.isGuest && store.favoritedPlaylists.length === 0 && playlistSources.length === 0 && !historyLoading && history.length === 0"
      message="登录网易云或 QQ 音乐后，这里将显示你的歌单和播放记录"
      icon="mdi:music-box-multiple"
    />

    <!-- 最近播放 -->
    <section class="mb-9">
      <h2 class="mb-4 text-[22px] font-bold">最近播放</h2>
      <div v-if="historyLoading" class="py-10 text-center text-text-tertiary text-sm">加载中...</div>
      <EmptyState v-else-if="history.length === 0" message="暂无播放记录" icon="mdi:history" />
      <div v-else class="flex flex-col gap-0.5">
        <SongCard
          v-for="(song, i) in recentHistory"
          :key="`hist-${song.id}-${i}`"
          :song="song"
          :index="i + 1"
          :active="i === currentRecentIndex"
          @play="store.playSong(song)"
          @playnext="store.playNextSong(song)"
          @add="store.addSong(song)"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore, type Song, type PlaylistItem } from '../stores/player';
import { useAuthStore } from '../stores/auth';
import { getProviderLabel } from '../utils/platform';
import CoverCard from '../components/common/CoverCard.vue';
import SongCard from '../components/SongCard.vue';
import EmptyState from '../components/common/EmptyState.vue';

const store = usePlayerStore();
const authStore = useAuthStore();

// ── 我的歌单：多音源切换（仅启用且支持 getUserPlaylists 的源）──
const PLAYLIST_CAPABLE = ['netease', 'qq', 'kugou', 'jellyfin'];
const enabledProviders = ref<string[]>([]);
const playlistSources = computed(() => PLAYLIST_CAPABLE.filter((p) => enabledProviders.value.includes(p)));
const activeSource = ref('netease');
const playlists = ref<PlaylistItem[]>([]);
const playlistsLoading = ref(false);

watch(playlistSources, (sources) => {
  if (sources.length && !sources.includes(activeSource.value)) {
    activeSource.value = sources[0];
  }
}, { immediate: true });

watch(activeSource, loadPlaylists, { immediate: false });

async function loadPlaylists() {
  if (!activeSource.value) return;
  playlistsLoading.value = true;
  try {
    const res = await http.get('/api/music/user/playlists', { params: { platform: activeSource.value } });
    playlists.value = (res.data.playlists ?? []).map((pl: any) => ({ ...pl, platform: pl.platform ?? activeSource.value }));
  } catch {
    playlists.value = [];
  } finally {
    playlistsLoading.value = false;
  }
}

// ── 最近播放 ──
const history = ref<Song[]>([]);
const recentHistory = computed(() => history.value.slice(0, 10));
// 只亮"当前这轮播放"对应的事件行＝首条匹配（同曲更早记录不亮），与 History 页同口径
const currentRecentIndex = computed(() => {
  const cur = store.currentSong;
  if (!cur) return -1;
  return recentHistory.value.findIndex(
    (song) => song.id === cur.id && song.platform === cur.platform,
  );
});
const historyLoading = ref(true);

onMounted(async () => {
  if (!authStore.isGuest) {
    store.fetchFavoritedPlaylists();
    try {
      const res = await http.get('/api/music/providers');
      enabledProviders.value = res.data.enabled ?? [];
      if (playlistSources.value.length) await loadPlaylists();
    } catch {
      // providers 拉不到时我的歌单区块隐藏
    }
  }
  if (!store.activeBotId) {
    await store.fetchBots();
  }
  if (store.activeBotId) {
    try {
      const res = await http.get(`/api/player/${store.activeBotId}/history`, { params: { limit: 10 } });
      history.value = res.data.history ?? [];
    } catch {
      history.value = [];
    }
  }
  historyLoading.value = false;
});
</script>
