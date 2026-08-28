<template>
  <!-- Daily Songs -->
  <section v-if="dailyList.length > 0" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold flex items-center gap-3 flex-wrap">
      每日推荐
      <span v-if="recommendSources.length === 1" class="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-interactive-hover text-foreground-subtle">数据来自{{ getProviderLabel(recommendSources[0]) }}</span>
      <div v-if="recommendSources.length > 1" class="flex gap-1.5">
        <button
          v-for="src in recommendSources"
          :key="`daily-${src}`"
          class="px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors"
          :class="dailySource === src ? 'bg-primary/15 text-primary' : 'bg-interactive-hover text-foreground-muted hover:text-foreground'"
          @click="dailySource = src"
        >{{ getProviderLabel(src) }}</button>
      </div>
    </h2>
    <div class="grid grid-cols-2 gap-4 min-[380px]:grid-cols-3 min-[380px]:gap-5 sm:grid-cols-4 lg:grid-cols-6">
      <div
        v-for="song in dailyList.slice(0, 12)"
        :key="song.id"
        class="cursor-pointer hover-scale"
        @click="store.playSong(song)"
      >
        <div class="relative aspect-square overflow-hidden rounded-[10px]">
          <CoverArt :url="song.coverUrl" :fill="true" :radius="0" />
        </div>
        <div class="mt-2 text-[13px] font-medium truncate">{{ song.name }}</div>
        <div class="text-xs text-foreground-muted truncate">{{ song.artist }}</div>
      </div>
    </div>
  </section>

  <!-- Recommend Playlists -->
  <section v-if="recommendList.length > 0" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold flex items-center gap-3 flex-wrap">
      推荐歌单
      <span v-if="recommendSources.length === 1" class="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-interactive-hover text-foreground-subtle">数据来自{{ getProviderLabel(recommendSources[0]) }}</span>
      <div v-if="recommendSources.length > 1" class="flex gap-1.5">
        <button
          v-for="src in recommendSources"
          :key="`rec-${src}`"
          class="px-2.5 py-0.5 rounded-full text-xs font-medium transition-colors"
          :class="recommendSource === src ? 'bg-primary/15 text-primary' : 'bg-interactive-hover text-foreground-muted hover:text-foreground'"
          @click="recommendSource = src"
        >{{ getProviderLabel(src) }}</button>
      </div>
    </h2>
    <div class="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <RouterLink
        v-for="playlist in recommendList"
        :key="playlist.id"
        :to="`/playlist/${playlist.id}?platform=${playlist.platform}`"
        class="block cursor-pointer text-inherit no-underline hover-scale"
      >
        <div class="relative aspect-square overflow-hidden rounded-[10px]">
          <CoverArt :url="playlist.coverUrl" :fill="true" :radius="0" />
        </div>
        <div class="mt-2 text-[13px] font-medium line-clamp-2">{{ playlist.name }}</div>
      </RouterLink>
    </div>
  </section>

  <!-- Bilibili Popular -->
  <section v-if="store.bilibiliPopular.length > 0" class="mb-9">
    <h2 class="mb-4 flex items-center gap-2 text-[22px] font-bold">
      <span class="inline-flex h-6 w-6 items-center justify-center rounded bg-[#00a1d6] text-sm font-extrabold text-white">B</span>
      B站热门
    </h2>
    <div class="grid grid-cols-2 gap-4 min-[380px]:grid-cols-3 min-[380px]:gap-5 sm:grid-cols-4 lg:grid-cols-6">
      <div
        v-for="song in store.bilibiliPopular.slice(0, 12)"
        :key="song.id"
        class="cursor-pointer hover-scale"
        @click="store.playSong(song)"
      >
        <div class="relative aspect-square overflow-hidden rounded-[10px]">
          <CoverArt :url="song.coverUrl" :fill="true" :radius="0" />
        </div>
        <div class="mt-2 text-[13px] font-medium truncate">{{ song.name }}</div>
        <div class="text-xs text-foreground-muted truncate">{{ song.artist }}</div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { usePlayerStore, type Song, type PlaylistItem } from '../../stores/player';
import { useAuthStore } from '../../stores/auth';
import { http } from '../../utils/http';
import { getProviderLabel } from '../../utils/platform';
import CoverArt from '../CoverArt.vue';

const store = usePlayerStore();
const auth = useAuthStore();

// ── 每日推荐/推荐歌单多源切换（上游语义）：网易云匿名可用，QQ/酷狗需登录 ──
const recommendSources = computed(() => {
  const enabled = store.enabledProviders;
  const out: string[] = [];
  if (enabled.includes('netease')) out.push('netease');
  if (enabled.includes('qq') && store.authStatus.qq?.loggedIn) out.push('qq');
  if (enabled.includes('kugou') && store.authStatus.kugou?.loggedIn) out.push('kugou');
  return out;
});

function loadTab(key: string): string {
  try {
    return localStorage.getItem(key) || 'netease';
  } catch {
    return 'netease';
  }
}

function saveTab(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

const dailySource = ref(loadTab('home.daily'));
const recommendSource = ref(loadTab('home.recommend'));
watch(dailySource, (v) => saveTab('home.daily', v));
watch(recommendSource, (v) => saveTab('home.recommend', v));

// 激活源失效（被禁用/登出）时回退到首个可用源
watch(recommendSources, (sources) => {
  if (sources.length && !sources.includes(dailySource.value)) dailySource.value = sources[0];
  if (sources.length && !sources.includes(recommendSource.value)) recommendSource.value = sources[0];
});

// 各源数据按需拉取缓存；未加载/不可用时回退 store 的默认源数据
const dailyByPlatform = ref<Record<string, Song[]>>({});
const recommendByPlatform = ref<Record<string, PlaylistItem[]>>({});

const dailyList = computed(() => dailyByPlatform.value[dailySource.value] ?? store.dailySongs);
const recommendList = computed(
  () => recommendByPlatform.value[recommendSource.value] ?? store.recommendPlaylists,
);

async function loadDaily(platform: string) {
  if (dailyByPlatform.value[platform] || auth.isGuest) return;
  try {
    const res = await http.get('/api/music/recommend/songs', { params: { platform } });
    dailyByPlatform.value = { ...dailyByPlatform.value, [platform]: res.data.songs ?? [] };
  } catch {
    // 拉不到保持回退
  }
}

async function loadRecommend(platform: string) {
  if (recommendByPlatform.value[platform]) return;
  try {
    const res = await http.get('/api/music/recommend/playlists', { params: { platform } });
    recommendByPlatform.value = { ...recommendByPlatform.value, [platform]: res.data.playlists ?? [] };
  } catch {
    // 拉不到保持回退
  }
}

watch(dailySource, (p) => loadDaily(p), { immediate: true });
watch(recommendSource, (p) => loadRecommend(p), { immediate: true });
</script>
