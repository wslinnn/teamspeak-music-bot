<template>
  <div>

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

    <!-- 本地音视频上传（设置→行为 的 localAudioEnabled 门控） -->
    <div
      v-if="!auth.isGuest && store.localAudioEnabled"
      class="mb-4 flex items-center gap-4 rounded-[var(--radius-lg)] border border-dashed p-4 transition-colors"
      :class="dragOver ? 'border-primary bg-primary/5' : 'border-border-color bg-surface-card'"
      @dragenter.prevent="dragOver = true"
      @dragover.prevent="dragOver = true"
      @dragleave.prevent="dragOver = false"
      @drop.prevent="onDrop"
    >
      <Icon icon="mdi:tray-arrow-up" class="text-2xl shrink-0" :class="[dragOver ? 'text-primary' : 'opacity-50', { 'animate-spin': uploading }]" />
      <div class="flex-1 min-w-0">
        <div class="text-sm font-medium">拖拽本地音频 / 视频到这里上传</div>
        <div class="text-xs text-text-tertiary mt-0.5">音频 mp3/flac/wav/m4a/ogg/opus 等，视频仅保留音轨；上传后可直接播放或加入队列</div>
      </div>
      <button
        class="shrink-0 flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-4 py-2 text-sm font-medium transition-colors hover:bg-primary/20 disabled:opacity-60"
        :disabled="uploading"
        @click="fileInput?.click()"
      >
        <Icon :icon="uploading ? 'mdi:loading' : 'mdi:upload'" :class="{ 'animate-spin': uploading }" />
        {{ uploading ? '上传中…' : '选择文件' }}
      </button>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        multiple
        accept="audio/*,video/*,.mp3,.flac,.wav,.m4a,.ogg,.opus,.mp4,.mov,.mkv,.avi,.flv,.wmv,.m4v,.mpg,.mpeg,.3gp,.ts,.m2ts,.ogv"
        @change="onFilePicked"
      />
    </div>
    <div v-else-if="!auth.isGuest" class="mb-4 flex items-center gap-3 rounded-[var(--radius-lg)] bg-surface-card p-4 opacity-70">
      <Icon icon="mdi:music-off" class="text-xl opacity-50 shrink-0" />
      <div class="text-xs text-text-tertiary">本地上传已关闭：管理员可在「设置 → 行为设置」开启</div>
    </div>

    <!-- Platform filter tabs -->
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
      <div v-if="currentHasMore" class="mt-6 flex justify-center">
        <BaseButton :loading="loadingMore" :disabled="loadingMore" @click="loadMore">加载更多</BaseButton>
      </div>
    </div>

    <!-- Playlists results -->
    <div v-else-if="activeCategory === 'playlists' && playlists.length > 0">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <CoverCard
          v-for="pl in playlists"
          :key="`${pl.platform}-${pl.id}`"
          :to="`/playlist/${pl.id}?platform=${pl.platform}`"
          :cover-url="pl.coverUrl"
          :name="pl.name"
          hover-icon="mdi:open-in-new"
          :link-title="`打开歌单：${pl.name}`"
        >
          <template #corner>
            <PlaylistFavoriteButton
              :playlist-id="pl.id"
              :platform="pl.platform"
              :name="pl.name"
              :cover-url="pl.coverUrl"
              :song-count="pl.songCount"
              overlay
            />
          </template>
          <template #subtitle>{{ pl.songCount }} 首</template>
        </CoverCard>
      </div>
      <div v-if="currentHasMore" class="mt-6 flex justify-center">
        <BaseButton :loading="loadingMore" :disabled="loadingMore" @click="loadMore">加载更多</BaseButton>
      </div>
    </div>

    <!-- Albums results -->
    <div v-else-if="activeCategory === 'albums' && albums.length > 0">
      <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <CoverCard
          v-for="ab in albums"
          :key="`${ab.platform}-${ab.id}`"
          :to="`/album/${ab.id}?platform=${ab.platform}`"
          :cover-url="ab.coverUrl"
          :name="ab.name"
          hover-icon="mdi:open-in-new"
          :link-title="`打开专辑：${ab.name}`"
        >
          <template #subtitle>{{ ab.artist }}</template>
        </CoverCard>
      </div>
      <div v-if="currentHasMore" class="mt-6 flex justify-center">
        <BaseButton :loading="loadingMore" :disabled="loadingMore" @click="loadMore">加载更多</BaseButton>
      </div>
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
import { mergeDedup, hasMore, nextOffset } from '../utils/searchPagination.js';
import { usePlayerStore, type Song } from '../stores/player';
import { useAuthStore } from '../stores/auth';
import { useToast } from '../composables/useToast';
import SongGridCard from '../components/SongGridCard.vue';
import CoverCard from '../components/common/CoverCard.vue';
import PlaylistFavoriteButton from '../components/PlaylistFavoriteButton.vue';
import EmptyState from '../components/common/EmptyState.vue';
import SkeletonLoader from '../components/common/SkeletonLoader.vue';
import BaseButton from '../components/common/BaseButton.vue';

const store = usePlayerStore();
const auth = useAuthStore();
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
  /** applyResult/loadMore 已按当前音源归一化，恒有值 */
  platform: string;
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

// 分页（上游 searchPagination 模型）：hasMore 按 (类目, 音源) 记录；
// 返回条数 === PAGE_SIZE 视为可能还有下一页
const hasMoreMap = ref<Record<string, boolean>>({});

function pageKey(type: 'songs' | 'playlists' | 'albums', source: string): string {
  return `${type}:${source}`;
}

// DOM 无虚拟化，累积结果封顶（review P3）：达到上限后不再渲染“加载更多”
const MAX_RENDER_RESULTS = 300;
const currentCount = computed(() =>
  activeCategory.value === 'albums' ? albums.value.length
    : activeCategory.value === 'playlists' ? playlists.value.length
    : results.value.length
);
const currentHasMore = computed(
  () =>
    activePlatform.value !== 'all' &&
    currentCount.value < MAX_RENDER_RESULTS &&
    (hasMoreMap.value[pageKey(activeCategory.value, activePlatform.value)] ?? false)
);

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
  // 单源模式下补齐专辑缺失的 platform（分页去重键与详情页跳转都依赖它）
  albums.value = (data.albums ?? []).map((ab) => ({
    ...ab,
    platform: ab.platform ?? (activePlatform.value === 'all' ? 'netease' : activePlatform.value),
  }));
  hasMoreMap.value = {};
  // /search/all 为多源合并首屏（无 offset 分页）；单平台 /search 三类目逐项记录
  if (activePlatform.value !== 'all') {
    hasMoreMap.value = {
      [pageKey('songs', activePlatform.value)]: hasMore(results.value.length, SEARCH_PAGE),
      [pageKey('playlists', activePlatform.value)]: hasMore(playlists.value.length, SEARCH_PAGE),
      [pageKey('albums', activePlatform.value)]: hasMore(albums.value.length, SEARCH_PAGE),
    };
  }
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
    hasMoreMap.value = {};
  } finally {
    loading.value = false;
  }
}

/** 当前类目追加一页：offset 对齐页边界，mergeDedup 防重叠/重复 */
async function loadMore() {
  if (loadingMore.value || activePlatform.value === 'all') return;
  const type = activeCategory.value;
  const source = activePlatform.value;
  const current = type === 'albums' ? albums.value : type === 'playlists' ? playlists.value : results.value;
  // DOM 无虚拟化，累积结果封顶（review P3）：超出后隐藏“加载更多”
  if (current.length >= MAX_RENDER_RESULTS) return;
  loadingMore.value = true;
  try {
    const res = await http.get('/api/music/search', {
      params: { q: query.value, platform: source, limit: SEARCH_PAGE, offset: nextOffset(current.length, SEARCH_PAGE) },
    });
    const incoming = res.data ?? {};
    if (type === 'albums') {
      albums.value = mergeDedup(
        albums.value,
        ((incoming.albums ?? []) as AlbumHit[]).map((ab) => ({ ...ab, platform: ab.platform ?? source })),
      );
      hasMoreMap.value = { ...hasMoreMap.value, [pageKey(type, source)]: hasMore((incoming.albums ?? []).length, SEARCH_PAGE) };
    } else if (type === 'playlists') {
      playlists.value = mergeDedup(playlists.value, (incoming.playlists ?? []) as PlaylistHit[]);
      hasMoreMap.value = { ...hasMoreMap.value, [pageKey(type, source)]: hasMore((incoming.playlists ?? []).length, SEARCH_PAGE) };
    } else {
      results.value = mergeDedup(results.value, (incoming.songs ?? []) as Song[]);
      hasMoreMap.value = { ...hasMoreMap.value, [pageKey(type, source)]: hasMore((incoming.songs ?? []).length, SEARCH_PAGE) };
    }
  } catch {
    toast.error('加载更多失败');
  } finally {
    loadingMore.value = false;
  }
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

async function onFilePicked(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  for (const f of files) await uploadFile(f);
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

<style scoped>
/* 跳出视口的网格卡片不参与渲染/布局（review P3） */
.grid > * {
  content-visibility: auto;
  contain-intrinsic-size: auto 260px;
}
</style>
