<template>
  <div>
    <h1 class="text-[28px] font-extrabold mb-6">我的</h1>

    <!-- 子 Tab：query 驱动（?tab=），刷新/分享不丢位置 -->
    <div class="mb-6 flex flex-wrap gap-2">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="rounded-full px-4 py-1.5 text-sm font-medium transition-all"
        :class="activeTab === t.key
          ? 'bg-primary text-white'
          : 'bg-surface-card text-foreground-muted hover:bg-interactive-hover hover:text-foreground'"
        @click="switchTab(t.key)"
      >
        {{ t.label }}
      </button>
    </div>

    <!-- 歌单：歌单收藏 + 我的歌单（多音源） -->
    <template v-if="activeTab === 'playlists'">
      <section v-if="store.favoritedPlaylists.length > 0" class="mb-9">
        <h2 class="mb-4 text-[22px] font-bold flex items-center gap-2">
          <Icon icon="mdi:heart" class="text-xl text-primary" />
          我的收藏
          <span class="text-sm font-medium text-text-tertiary">{{ store.favoritedPlaylists.length }}</span>
        </h2>
        <div class="cv-grid grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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

      <section v-if="playlistSources.length > 0" class="mb-9">
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
        <div v-else class="cv-grid grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
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

      <!-- 全空引导：没有收藏歌单也没有可用音源歌单时指路 -->
      <EmptyState
        v-if="store.favoritedPlaylists.length === 0 && playlistSources.length === 0"
        message="登录网易云或 QQ 音乐后，这里将显示你的歌单和收藏"
        icon="mdi:music-box-multiple"
      />
    </template>

    <!-- 收藏歌曲 / 播放历史：面板随 Tab 激活挂载、自取数据 -->
    <FavoritesPanel v-else-if="activeTab === 'favorites'" />
    <HistoryPanel v-else-if="activeTab === 'history'" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import { useRoute, useRouter } from 'vue-router';
import { http } from '../utils/http';
import { usePlayerStore, type PlaylistItem } from '../stores/player';
import { getProviderLabel } from '../utils/platform';
import CoverCard from '../components/common/CoverCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import FavoritesPanel from '../components/library/FavoritesPanel.vue';
import HistoryPanel from '../components/library/HistoryPanel.vue';

const store = usePlayerStore();
const route = useRoute();
const router = useRouter();

// ── 子 Tab（query 同步，非法值回退默认）──
const tabs = [
  { key: 'playlists', label: '歌单' },
  { key: 'favorites', label: '收藏歌曲' },
  { key: 'history', label: '播放历史' },
] as const;
type TabKey = (typeof tabs)[number]['key'];

const activeTab = computed<TabKey>(() => {
  const v = route.query.tab;
  return tabs.some((t) => t.key === v) ? (v as TabKey) : 'playlists';
});

function switchTab(key: TabKey) {
  // replace：Tab 切换不污染前进/后退历史
  router.replace({ query: { ...route.query, tab: key } });
}

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
  // 审计 C8：QQ/酷狗未登录时该请求必然失败/为空——先查登录态再拉，
  // 避免每次进页面的无效请求（对齐上游 fetchHomeData 的预检）。
  if (activeSource.value === 'qq' || activeSource.value === 'kugou') {
    await store.fetchAuthStatus();
    if (!store.authStatus[activeSource.value]?.loggedIn) {
      playlists.value = [];
      return;
    }
  }
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

onMounted(async () => {
  store.fetchFavoritedPlaylists();
  try {
    // 审计 PERF-10：改走 store 的共享缓存
    enabledProviders.value = await store.fetchEnabledProviders();
    if (playlistSources.value.length) await loadPlaylists();
  } catch {
    // providers 拉不到时我的歌单区块隐藏
  }
});
</script>

<style scoped>
/* 审计 PERF-10：跳出视口的卡片不参与渲染/布局（同 Playlist.vue 的做法）。
 * 老账号歌单可达数百个，长尾滚动全量布局代价高。 */
.cv-grid > * {
  content-visibility: auto;
  contain-intrinsic-size: auto 240px;
}
</style>
