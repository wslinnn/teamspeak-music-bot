<template>
  <div class="search-page">
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

    <!-- Platform filter tabs -->
    <div class="mb-6 flex flex-wrap gap-2">
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

    <!-- Loading -->
    <div v-if="loading" class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
      <SkeletonLoader v-for="n in 10" :key="n" height="220px" border-radius="10px" />
    </div>

    <!-- Results grid -->
    <div v-else-if="results.length > 0">
      <div class="mb-3 text-sm text-foreground-subtle">
        找到 {{ results.length }} 首歌曲
      </div>
      <TransitionGroup
        tag="div"
        name="stagger"
        class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
      >
        <SongGridCard
          v-for="(song, i) in results"
          :key="`${song.platform}-${song.id}`"
          :song="song"
          :style="{ animationDelay: `${Math.min(i * 40, 400)}ms` }"
          @play="store.playSong(song)"
          @add="store.addSong(song)"
        />
      </TransitionGroup>
    </div>

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
import { ref, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore, type Song } from '../stores/player';
import SongGridCard from '../components/SongGridCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import SkeletonLoader from '../components/common/SkeletonLoader.vue';

const store = usePlayerStore();
const route = useRoute();

const searchInput = ref<HTMLInputElement | null>(null);
const query = ref((route.query.q as string) || '');
const results = ref<Song[]>([]);
const loading = ref(false);
const searched = ref(false);
const errorMsg = ref('');

const platformTabs = [
  { key: 'all', label: '全部' },
  { key: 'netease', label: '网易云' },
  { key: 'qq', label: 'QQ' },
  { key: 'bilibili', label: 'B站' },
  { key: 'youtube', label: 'YouTube' },
];
const activePlatform = ref('all');

async function doSearch() {
  if (!query.value.trim()) return;
  loading.value = true;
  searched.value = true;
  errorMsg.value = '';
  try {
    let res;
    if (activePlatform.value === 'all') {
      res = await http.get('/api/music/search/all', { params: { q: query.value } });
    } else {
      res = await http.get('/api/music/search', { params: { q: query.value, platform: activePlatform.value } });
    }
    results.value = res.data.songs ?? [];
  } catch (err: unknown) {
    console.error('Search failed:', err);
    errorMsg.value = '搜索失败，请稍后重试';
    results.value = [];
  } finally {
    loading.value = false;
  }
}

// Re-search when platform filter changes and we already have a query
watch(activePlatform, () => {
  if (query.value.trim() && searched.value) {
    doSearch();
  }
});

onMounted(() => {
  searchInput.value?.focus();
  if (query.value) doSearch();
});
</script>
