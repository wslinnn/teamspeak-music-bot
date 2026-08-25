<template>
  <div class="search-page" @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop">
    <!-- Back button -->
    <button class="mb-4 flex items-center gap-1.5 text-sm text-foreground-muted opacity-70 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>

    <!-- Search input -->
    <div class="mb-4">
      <div class="flex items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3.5">
        <Icon icon="mdi:magnify" class="mr-3 text-[22px] opacity-40" />
        <input
          ref="searchInput"
          v-model="query"
          class="flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-foreground-subtle"
          placeholder="搜索歌曲、歌手、专辑..."
          @keyup.enter="doSearch"
        />
      </div>
    </div>

    <!-- Platform filter tabs + local upload -->
    <div class="mb-6 flex flex-wrap items-center gap-2">
      <button
        v-for="tab in platformTabs"
        :key="tab.key"
        class="rounded-full px-4 py-1.5 text-sm font-medium transition-all"
        :class="activePlatform === tab.key
          ? 'bg-primary text-white'
          : 'bg-surface-card text-foreground-muted hover:bg-interactive-hover hover:text-foreground'"
        @click="activePlatform = tab.key"
      >
        {{ tab.label }}
      </button>

      <div class="ml-auto flex items-center gap-2">
        <span v-if="dragOver" class="text-xs text-primary">松开以上传本地文件</span>
        <button
          class="flex items-center gap-1.5 rounded-full bg-surface-card px-4 py-1.5 text-sm font-medium text-foreground-muted transition-all hover:bg-interactive-hover hover:text-foreground disabled:opacity-60"
          :disabled="uploading"
          title="上传本地音频/视频（视频仅保留音轨）"
          @click="fileInput?.click()"
        >
          <Icon :icon="uploading ? 'mdi:loading' : 'mdi:upload'" :class="{ 'animate-spin': uploading }" />
          {{ uploading ? '上传中' : '本地上传' }}
        </button>
        <input
          ref="fileInput"
          type="file"
          class="hidden"
          accept=".mp3,.flac,.wav,.m4a,.ogg,.opus,.mp4,.mov,.mkv,.avi,.flv,.wmv,.m4v,.mpg,.mpeg,.3gp,.ts,.m2ts,.ogv,audio/*,video/*"
          @change="onFilePicked"
        />
      </div>
    </div>

    <!-- Category tabs（搜索后显示） -->
    <div v-if="searched && !loading" class="mb-4 flex flex-wrap gap-2">
      <button
        v-for="cat in categories"
        :key="cat.key"
        class="rounded-full px-3.5 py-1 text-[13px] font-medium transition-all"
        :class="activeCategory === cat.key
          ? 'bg-foreground text-bg-primary'
          : 'bg-transparent text-foreground-muted hover:bg-interactive-hover hover:text-foreground'"
        @click="activeCategory = cat.key"
      >
        {{ cat.label }}
        <span class="ml-1 opacity-60">{{ cat.count }}</span>
      </button>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <SkeletonLoader v-for="n in 10" :key="n" height="220px" border-radius="10px" />
    </div>

    <!-- Songs results grid -->
    <div v-else-if="activeCategory === 'songs' && results.length > 0">
      <div class="mb-3 text-sm text-foreground-subtle">
        找到 {{ results.length }} 首歌曲
      </div>
      <TransitionGroup
        tag="div"
        name="stagger"
        class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      >
        <SongGridCard
          v-for="song in results"
          :key="`${song.platform}-${song.id}`"
          :song="song"
          @play="store.playSong(song)"
          @playnext="store.playNextSong(song)"
          @add="store.addSong(song)"
        />
      </TransitionGroup>
      <div v-if="songsHasMore" class="mt-6 flex justify-center">
        <BaseButton :loading="loadingMore" :disabled="loadingMore" @click="loadMoreSongs">加载更多</BaseButton>
      </div>
    </div>

    <!-- Playlists results -->
    <div v-else-if="activeCategory === 'playlists' && playlists.length > 0" class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <button
        v-for="pl in playlists"
        :key="`${pl.platform}-${pl.id}`"
        class="group text-left"
        :title="`打开歌单：${pl.name}`"
        @click="openPlaylist(pl)"
      >
        <div class="relative aspect-square overflow-hidden rounded-[10px]">
          <CoverArt :url="pl.coverUrl" :fill="true" :radius="0" />
          <div class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg">
              <Icon icon="mdi:open-in-new" class="text-2xl" />
            </div>
          </div>
          <div class="absolute right-1.5 top-1.5 z-[10]">
            <PlaylistFavoriteButton
              :playlist-id="pl.id"
              :platform="pl.platform"
              :name="pl.name"
              :cover-url="pl.coverUrl"
              :song-count="pl.songCount"
              overlay
            />
          </div>
        </div>
        <div class="mt-2 text-[13px] font-medium truncate">{{ pl.name }}</div>
        <div class="text-xs text-text-tertiary truncate">{{ pl.songCount }} 首</div>
      </button>
    </div>

    <!-- Albums results -->
    <div v-else-if="activeCategory === 'albums' && albums.length > 0" class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <RouterLink
        v-for="ab in albums"
        :key="`${ab.platform ?? activePlatform}-${ab.id}`"
        :to="`/album/${ab.id}?platform=${ab.platform ?? (activePlatform === 'all' ? 'netease' : activePlatform)}`"
        class="group text-left"
        :title="`打开专辑：${ab.name}`"
      >
        <div class="relative aspect-square overflow-hidden rounded-[10px]">
          <CoverArt :url="ab.coverUrl" :fill="true" :radius="0" />
          <div class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg">
              <Icon icon="mdi:open-in-new" class="text-2xl" />
            </div>
          </div>
        </div>
        <div class="mt-2 text-[13px] font-medium truncate">{{ ab.name }}</div>
        <div class="text-xs text-text-tertiary truncate">{{ ab.artist }}</div>
      </RouterLink>
    </div>

    <!-- Empty category -->
    <EmptyState
      v-else-if="searched && activeCategory !== 'songs'"
      :message="activeCategory === 'playlists' ? '未找到相关歌单' : '未找到相关专辑'"
      icon="mdi:playlist-music-outline"
    />

    <!-- Error -->
    <EmptyState
      v-else-if="errorMsg"
      :message="errorMsg"
      icon="mdi:alert-circle-outline"
    />

    <!-- Empty -->
    <EmptyState
      v-else-if="searched"
      message="未找到相关结果"
      icon="mdi:music-note-off"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { getProviderLabel, orderedProviders } from '../utils/platform';
import { usePlayerStore, type Song } from '../stores/player';
import { useToast } from '../composables/useToast';
import SongGridCard from '../components/SongGridCard.vue';
import CoverArt from '../components/CoverArt.vue';
import PlaylistFavoriteButton from '../components/PlaylistFavoriteButton.vue';
import EmptyState from '../components/common/EmptyState.vue';
import SkeletonLoader from '../components/common/SkeletonLoader.vue';
import BaseButton from '../components/common/BaseButton.vue';

const store = usePlayerStore();
const toast = useToast();
const route = useRoute();
const router = useRouter();

interface PlaylistHit {
  id: string;
  name: string;
  coverUrl: string;
  songCount: number;
  platform: string;
}

interface AlbumHit {
  id: string;
  name: string;
  artist: string;
  coverUrl: string;
  songCount: number;
  platform?: string;
}

const searchInput = ref<HTMLInputElement | null>(null);
const query = ref((route.query.q as string) || '');
const results = ref<Song[]>([]);
const playlists = ref<PlaylistHit[]>([]);
const albums = ref<AlbumHit[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const searched = ref(false);
const errorMsg = ref('');
const activeCategory = ref<'songs' | 'playlists' | 'albums'>('songs');
const songsHasMore = ref(false);

const categories = computed(() => [
  { key: 'songs' as const, label: '歌曲', count: results.value.length },
  { key: 'playlists' as const, label: '歌单', count: playlists.value.length },
  { key: 'albums' as const, label: '专辑', count: albums.value.length },
]);

// 音源标签动态化（B2/D4）：消费 /api/music/providers 的 enabled 列表，
// 与后端启用状态联动——禁用的源不再显示（此前硬编码含 youtube 等固定 5 项，
// 禁用后点击只会报"音源未启用"；kugou/jellyfin 等则完全没有入口）
const enabledProviders = ref<string[]>([]);
const platformTabs = computed(() => [
  { key: 'all', label: '全部' },
  ...orderedProviders(enabledProviders.value).map((p) => ({
    key: p,
    label: getProviderLabel(p),
  })),
]);
const activePlatform = ref('all');
// 当前源在运行中被禁用（标签消失）时回退"全部"
watch(platformTabs, (tabs) => {
  if (!tabs.some((t) => t.key === activePlatform.value)) activePlatform.value = 'all';
});

const SEARCH_PAGE = 30;

function applyResult(data: { songs?: Song[]; playlists?: PlaylistHit[]; albums?: AlbumHit[] }) {
  results.value = data.songs ?? [];
  playlists.value = data.playlists ?? [];
  albums.value = data.albums ?? [];
  // /search/all 为多源合并首屏（无 offset 分页）；单平台 /search 支持 offset
  songsHasMore.value = activePlatform.value !== 'all' && results.value.length >= SEARCH_PAGE;
}

async function doSearch() {
  if (!query.value.trim()) return;
  loading.value = true;
  searched.value = true;
  errorMsg.value = '';
  activeCategory.value = 'songs';
  try {
    let res;
    if (activePlatform.value === 'all') {
      res = await http.get('/api/music/search/all', { params: { q: query.value } });
    } else {
      res = await http.get('/api/music/search', {
        params: { q: query.value, platform: activePlatform.value, limit: SEARCH_PAGE },
      });
    }
    applyResult(res.data);
  } catch (err: unknown) {
    console.error('Search failed:', err);
    errorMsg.value = '搜索失败，请稍后重试';
    results.value = [];
    playlists.value = [];
    albums.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadMoreSongs() {
  if (loadingMore.value || activePlatform.value === 'all') return;
  loadingMore.value = true;
  try {
    const res = await http.get('/api/music/search', {
      params: {
        q: query.value,
        platform: activePlatform.value,
        limit: SEARCH_PAGE,
        offset: results.value.length,
      },
    });
    const incoming = (res.data.songs ?? []) as Song[];
    const seen = new Set(results.value.map((s) => `${s.platform}-${s.id}`));
    const fresh = incoming.filter((s) => !seen.has(`${s.platform}-${s.id}`));
    results.value = [...results.value, ...fresh];
    songsHasMore.value = incoming.length >= SEARCH_PAGE && fresh.length > 0;
  } catch {
    toast.error('加载更多失败');
  } finally {
    loadingMore.value = false;
  }
}

function openPlaylist(pl: PlaylistHit) {
  router.push({ path: `/playlist/${pl.id}`, query: { platform: pl.platform } });
}

// Re-search when platform filter changes and we already have a query
watch(activePlatform, () => {
  if (query.value.trim() && searched.value) {
    doSearch();
  }
});

// ── 本地音视频上传（受 设置→行为 的 localAudioEnabled 门控）──
const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const dragOver = ref(false);

function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  if (input.files?.length) uploadFile(input.files[0]);
  input.value = '';
}

function onDrop(e: DragEvent) {
  dragOver.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file) uploadFile(file);
}

async function uploadFile(file: File) {
  if (uploading.value) return;
  uploading.value = true;
  try {
    const res = await http.post('/api/music/local/upload', file, {
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'x-filename': encodeURIComponent(file.name),
      },
      timeout: 0,
    });
    const song = res.data.song as Song | undefined;
    if (song) {
      results.value = [song, ...results.value];
      searched.value = true;
      toast.success(`已上传：${song.name}`);
    }
  } catch (err: unknown) {
    const status = (err as any)?.response?.status;
    const msg = (err as any)?.response?.data?.error ?? '';
    if (status === 403 || String(msg).includes('关闭')) {
      toast.error('本地播放已关闭：到 设置 → 行为设置 开启「本地音视频上传播放」');
    }
    // 其余错误信息由 http 拦截器统一 toast
  } finally {
    uploading.value = false;
  }
}

onMounted(async () => {
  searchInput.value?.focus();
  if (query.value) doSearch();
  // 拉取启用音源驱动标签；失败（旧后端/网络）退回主流四源，不阻塞搜索
  try {
    const res = await http.get('/api/music/providers');
    enabledProviders.value = res.data.enabled ?? ['netease', 'qq', 'bilibili', 'youtube'];
  } catch {
    enabledProviders.value = ['netease', 'qq', 'bilibili', 'youtube'];
  }
});
</script>
