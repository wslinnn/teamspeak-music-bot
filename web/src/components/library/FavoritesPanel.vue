<template>
  <div>
    <!-- Search：仅在有收藏时渲染（空态下无内容可筛） -->
    <div v-if="!store.loading && store.favorites.length > 0" class="mb-4">
      <div class="flex items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3.5">
        <Icon icon="mdi:magnify" class="mr-3 text-[22px] opacity-40" />
        <input
          v-model="query"
          class="flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-foreground-subtle"
          placeholder="在收藏中筛选歌曲、歌手..."
        />
      </div>
    </div>

    <SkeletonLoader v-if="store.loading" />

    <template v-else-if="store.favorites.length > 0">
      <!-- 批量操作：按当前筛选结果整批追加（上限 100 首防误触洪泛） -->
      <div v-if="filteredFavorites.length > 0 && canAddQueue" class="mb-3 flex justify-end">
        <button
          class="flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-4 py-1.5 text-[13px] font-medium transition-colors hover:bg-primary/20 disabled:opacity-60"
          :disabled="bulkAdding"
          @click="addAllToQueue"
        >
          <Icon :icon="bulkAdding ? 'mdi:loading' : 'mdi:playlist-plus'" :class="{ 'animate-spin': bulkAdding }" />
          {{ bulkAdding ? '加入中…' : '全部加进队列' }}
        </button>
      </div>

      <EmptyState v-if="filteredFavorites.length === 0" message="无筛选结果" icon="mdi:music-note-off" />

      <div v-else class="flex flex-col gap-0.5">
        <SongCard
          v-for="(item, i) in filteredFavorites"
          :key="item.id"
          :song="toSong(item)"
          :index="i + 1"
          :active="playerStore.currentSong?.id === item.songId && playerStore.currentSong?.platform === item.platform"
          @play="play(item)"
          @playnext="playerStore.playNextSong(toSong(item))"
          @add="add(item)"
        />
      </div>
    </template>

    <EmptyState v-else message="暂无收藏歌曲" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { useFavoritesStore, type Favorite } from '../../stores/favorites';
import { usePlayerStore, type Song } from '../../stores/player';
import { useAuthStore } from '../../stores/auth';
import { useToast } from '../../composables/useToast';
import type { Platform } from '../../utils/platform';
import SongCard from '../SongCard.vue';
import EmptyState from '../common/EmptyState.vue';
import SkeletonLoader from '../common/SkeletonLoader.vue';

const store = useFavoritesStore();
const playerStore = usePlayerStore();
const auth = useAuthStore();
const toast = useToast();
// 批量入队需入队权（与 SongGridCard.showAdd 同口径）
const canAddQueue = computed(() => auth.can('player.queue') || auth.guestCan('addToQueue'));
const query = ref('');
// 收藏无上限，全量过滤按 200ms 防抖后再进 computed
const debouncedQuery = ref('');
let queryTimer: ReturnType<typeof setTimeout> | null = null;
watch(query, (v) => {
  if (queryTimer) clearTimeout(queryTimer);
  queryTimer = setTimeout(() => { debouncedQuery.value = v; }, 200);
});
onUnmounted(() => { if (queryTimer) clearTimeout(queryTimer); });

const filteredFavorites = computed(() => {
  if (!debouncedQuery.value.trim()) return store.favorites;
  const q = debouncedQuery.value.toLowerCase();
  return store.favorites.filter(
    (f) => f.title.toLowerCase().includes(q) || f.artist.toLowerCase().includes(q)
  );
});

function toSong(item: Favorite): Song {
  return {
    id: item.songId,
    name: item.title,
    artist: item.artist,
    album: '',
    duration: item.duration,
    coverUrl: item.coverUrl,
    platform: item.platform as Platform,
  };
}

function play(item: Favorite) {
  playerStore.playSong(toSong(item));
}

function add(item: Favorite) {
  playerStore.addSong(toSong(item));
}

// ── 批量加入队列：顺序提交（/add 单首接口），上限 100 首防误触洪泛 ──
const BULK_ADD_LIMIT = 100;
const bulkAdding = ref(false);

async function addAllToQueue() {
  if (bulkAdding.value) return;
  const items = filteredFavorites.value.slice(0, BULK_ADD_LIMIT);
  bulkAdding.value = true;
  let ok = 0;
  try {
    for (const item of items) {
      // PERF-08：静默提交，整批只拉一次队列（原来每首 add + fetchQueue
      // = 最多 200 个串行请求）
      if (await playerStore.addSongSilent(toSong(item))) {
        ok += 1;
      }
      // 单首失败（下架/版权等）不中断整批
    }
    if (ok > 0) await playerStore.fetchQueue();
  } finally {
    bulkAdding.value = false;
  }
  const capped = filteredFavorites.value.length > BULK_ADD_LIMIT
    ? `（仅取前 ${BULK_ADD_LIMIT} 首）`
    : '';
  toast.success(`已加入队列 ${ok} 首${capped}`);
}

// 面板随 Tab 激活才挂载，挂载即拉取（favorites store 全站共享，重复调用幂等）
onMounted(() => {
  store.fetchFavorites();
});
</script>

<style scoped>
/* 跳出视口的行不参与渲染/布局（无虚拟化列表的低成本替代，review P3） */
.flex.flex-col > * {
  content-visibility: auto;
  contain-intrinsic-size: auto 64px;
}
</style>
