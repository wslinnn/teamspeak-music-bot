<template>
  <div>
    <!-- Search + batch actions：仅在有记录时渲染（空态下无内容可筛） -->
    <div v-if="!loading && history.length > 0" class="mb-4 flex flex-wrap items-center gap-3">
      <div class="flex flex-1 min-w-[220px] items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3.5">
        <Icon icon="mdi:magnify" class="mr-3 text-[22px] opacity-40" />
        <input
          v-model="query"
          class="flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-foreground-subtle"
          placeholder="在历史记录中筛选歌曲、歌手..."
        />
      </div>
      <BaseButton
        v-if="canDelete"
        variant="ghost"
        :loading="clearing"
        :disabled="clearing || deleting"
        @click="clearAll"
      >
        清空历史
      </BaseButton>
    </div>

    <div v-if="loading" class="flex flex-col gap-2">
      <SkeletonLoader v-for="n in 8" :key="n" height="52px" />
    </div>

    <div v-else-if="history.length === 0" class="text-center py-20 text-text-tertiary text-sm">
      暂无播放记录
    </div>

    <EmptyState v-else-if="filteredHistory.length === 0" message="无筛选结果" icon="mdi:music-note-off" />

    <div v-else class="flex flex-col gap-0.5">
      <SongCard
        v-for="(song, i) in filteredHistory"
        :key="rowKey(song, i)"
        :song="song"
        :index="i + 1"
        :active="i === currentHistoryIndex"
        :removable="canDelete"
        @play="store.playSong(song)"
        @playnext="store.playNextSong(song)"
        @add="store.addSong(song)"
        @remove="removeOne(song)"
      />
    </div>

    <div v-if="!loading && hasMore" class="mt-4 flex justify-center">
      <BaseButton :loading="loadingMore" :disabled="loadingMore" @click="loadMore">
        加载更多
      </BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../../utils/http';
import { usePlayerStore, type Song } from '../../stores/player';
import { useAuthStore } from '../../stores/auth';
import { useToast } from '../../composables/useToast';
import SongCard from '../SongCard.vue';
import SkeletonLoader from '../common/SkeletonLoader.vue';
import EmptyState from '../common/EmptyState.vue';
import BaseButton from '../common/BaseButton.vue';

const store = usePlayerStore();
const auth = useAuthStore();
const toast = useToast();

const PAGE_SIZE = 50;
const MAX_HISTORY = 1000;

/** A history row plus the play_history primary key needed to delete it. The
 *  backend returns it as `rowId`; `id` remains the platform song id so the
 *  player store keeps working unchanged. */
type HistoryRow = Song & { rowId?: number };

const history = ref<HistoryRow[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const hasMore = ref(false);
const query = ref('');
const deleting = ref(false);
const clearing = ref(false);
// Bumped on every mutation so a slow in-flight fetch cannot resurrect a row
// the user just deleted.
let historyVersion = 0;

// Rows without a rowId (older backend) cannot be deleted individually.
const canDelete = computed(
  () => auth.can('player.queue') || auth.guestCan('removeClear'),
);

// 1000 行全量扫描的过滤不宜每键触发：200ms 防抖后再进 computed
const debouncedQuery = ref('');
let queryTimer: ReturnType<typeof setTimeout> | null = null;
watch(query, (v) => {
  if (queryTimer) clearTimeout(queryTimer);
  queryTimer = setTimeout(() => { debouncedQuery.value = v; }, 200);
});
onUnmounted(() => { if (queryTimer) clearTimeout(queryTimer); });

// 当前播放对应"该歌最新的一次播放事件"＝列表中第一条 id+platform 匹配的行
//（播放开始即写入历史、倒序排列）；同曲的更早记录不亮
const currentHistoryIndex = computed(() => {
  const cur = store.currentSong;
  if (!cur) return -1;
  return filteredHistory.value.findIndex(
    (song) => song.id === cur.id && song.platform === cur.platform,
  );
});

const filteredHistory = computed(() => {
  if (!debouncedQuery.value.trim()) return history.value;
  const q = debouncedQuery.value.toLowerCase();
  return history.value.filter(
    (s) => s.name.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
  );
});

/** Rows can repeat (same song played twice), so the platform id is not unique. */
function rowKey(song: HistoryRow, i: number): string {
  return `${song.rowId ?? song.id}-${song.platform}-${i}`;
}

async function fetchHistory(limit: number): Promise<HistoryRow[]> {
  const version = historyVersion;
  const res = await http.get(`/api/player/${store.activeBotId}/history`, {
    params: { limit },
  });
  // A delete happened while this was in flight — drop the stale response.
  if (version !== historyVersion) return history.value;
  const list: HistoryRow[] = res.data.history ?? [];
  // 返回条数达到请求上限且未到渲染上限时，可能还有更早的记录
  hasMore.value = list.length >= limit && limit < MAX_HISTORY;
  return list;
}

async function loadHistory() {
  if (!store.activeBotId) {
    history.value = [];
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    history.value = await fetchHistory(PAGE_SIZE);
  } catch (err) {
    console.warn('Failed to load history:', err);
    history.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadMore() {
  if (loadingMore.value || !store.activeBotId) return;
  loadingMore.value = true;
  try {
    const next = Math.min(history.value.length + 100, MAX_HISTORY);
    history.value = await fetchHistory(next);
  } catch (err) {
    console.warn('Failed to load more history:', err);
  } finally {
    loadingMore.value = false;
  }
}

async function removeOne(song: HistoryRow) {
  if (!store.activeBotId || song.rowId === undefined || deleting.value) return;
  deleting.value = true;
  try {
    await http.delete(`/api/player/${store.activeBotId}/history/${song.rowId}`);
    historyVersion++;
    history.value = history.value.filter((row) => row !== song);
    toast.success('已删除该条播放记录');
  } catch (err) {
    console.warn('Failed to delete history row:', err);
    toast.error('删除失败，请稍后重试');
  } finally {
    deleting.value = false;
  }
}

async function clearAll() {
  if (!store.activeBotId || clearing.value) return;
  if (!window.confirm('确定清空全部播放历史？此操作不可撤销。')) return;
  clearing.value = true;
  try {
    await http.delete(`/api/player/${store.activeBotId}/history`, { data: { all: true } });
    historyVersion++;
    history.value = [];
    hasMore.value = false;
    toast.success('播放历史已清空');
  } catch (err) {
    console.warn('Failed to clear history:', err);
    toast.error('清空失败，请稍后重试');
  } finally {
    clearing.value = false;
  }
}

watch(() => store.activeBotId, loadHistory);

// 面板随 Tab 激活才挂载，挂载即拉取
onMounted(async () => {
  if (!store.activeBotId) {
    await store.fetchBots();
  }
  await loadHistory();
});
</script>

<style scoped>
/* 跳出视口的行不参与渲染/布局（无虚拟化列表的低成本替代，review P3） */
.flex.flex-col > * {
  content-visibility: auto;
  contain-intrinsic-size: auto 64px;
}
</style>
