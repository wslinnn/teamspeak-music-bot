<template>
  <div class="fixed inset-0 z-50 flex items-stretch justify-start lg:items-center lg:justify-center" :style="bgStyle">
    <div class="absolute inset-0 bg-black/75 backdrop-blur-[60px]" />
    <button class="absolute top-[calc(12px+env(safe-area-inset-top))] left-[14px] lg:top-6 lg:left-6 z-[2] flex items-center gap-1.5 text-sm text-white/70 transition-colors hover:text-white" @click="goBack">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>

    <div v-if="currentSong" class="relative z-[1] flex flex-col lg:flex-row lg:items-center max-w-[1000px] w-full h-full lg:h-[80vh] gap-4 lg:gap-[60px] px-[18px] sm:px-10 pt-[calc(52px+env(safe-area-inset-top))] lg:pt-0 pb-[calc(var(--player-height)+18px+env(safe-area-inset-bottom))] lg:pb-0">
      <div class="flex items-center gap-3.5 lg:flex-col lg:items-center lg:gap-4 shrink-0 min-w-0">
        <CoverArt :url="currentSong.coverUrl" :size="76" :radius="14" :show-shadow="true" class="!w-[76px] !h-[76px] shrink-0 sm:!w-[240px] sm:!h-[240px] lg:!w-[280px] lg:!h-[280px]" />
        <div class="min-w-0 text-left lg:text-center">
          <div class="text-xl font-bold text-white mb-1 truncate">{{ currentSong.name }}</div>
          <div class="text-sm text-white/60 truncate">{{ currentSong.artist }}</div>
        </div>
      </div>

      <div class="flex-1 min-h-0 overflow-hidden relative w-full lg:w-auto self-stretch" style="mask-image: linear-gradient(transparent 0%, black 15%, black 85%, transparent 100%); -webkit-mask-image: linear-gradient(transparent 0%, black 15%, black 85%, transparent 100%);">
        <div v-if="loading" class="text-white/50 text-sm text-center py-[60px]">加载歌词中...</div>
        <div v-else-if="lines.length === 0" class="text-white/50 text-sm text-center py-[60px]">暂无歌词</div>
        <div v-else class="h-full overflow-y-auto relative scroll-smooth py-[30vh]" ref="scrollContainer" @scroll.passive="onUserScroll">
          <div>
            <div
              v-for="(line, i) in lines"
              :key="i"
              :ref="el => { if (el) lineRefs[i] = el as HTMLElement }"
              class="py-2 cursor-pointer"
              :class="i === activeLine ? 'active' : ''"
              @click="seekToLine(i)"
            >
              <div class="text-base sm:text-lg leading-relaxed transition-[color,font-size] duration-[400ms] ease-[cubic-bezier(0.25,0.1,0.25,1)]" :class="i === activeLine ? 'text-[20px] sm:text-[22px] font-semibold text-white' : 'text-white/30'">{{ line.text }}</div>
              <div v-if="line.translation" class="text-[13px] sm:text-sm leading-snug text-white/15 mt-0.5 transition-colors duration-[400ms]" :class="i === activeLine ? 'text-white/50' : ''">{{ line.translation }}</div>
            </div>
          </div>
        </div>

        <!-- 用户手动滚动期间不自动跟随，提供回到当前行的入口 -->
        <div v-if="userScrolling && lines.length > 0" class="absolute bottom-6 left-1/2 -translate-x-1/2 z-[3]">
          <button class="flex items-center gap-1 rounded-full bg-white/10 px-3.5 py-1.5 text-xs text-white/80 backdrop-blur transition-colors duration-[var(--transition-fast)] hover:bg-white/20" @click="resumeFollow">
            <Icon icon="mdi:arrow-down" /> 回到当前行
          </button>
        </div>
      </div>
    </div>

    <div v-else class="relative z-[1] text-white/50 text-base">
      当前没有正在播放的歌曲
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth';
import CoverArt from '../components/CoverArt.vue';

const router = useRouter();
const store = usePlayerStore();
const auth = useAuthStore();
const currentSong = computed(() => store.currentSong);
// 点击歌词行 seek 与 Player 底栏同口径；无权限时只做本地高亮（对齐上游行为）
const canTransport = computed(() => auth.can('player.control') || auth.guestCan('transport'));

function goBack() {
  if (window.history.length > 1) {
    router.back();
  } else {
    router.push('/');
  }
}

interface LyricLine {
  time: number;
  text: string;
  translation?: string;
}

const lines = ref<LyricLine[]>([]);
const activeLine = ref(-1);
const loading = ref(false);
const scrollContainer = ref<HTMLElement | null>(null);
const lineRefs = ref<Record<number, HTMLElement>>({});
const userScrolling = ref(false);
let lastFetchedSongId = '';
let nextLineIdx = 0;

const bgStyle = computed(() => {
  if (currentSong.value?.coverUrl) {
    return {
      backgroundImage: `url(${currentSong.value.coverUrl})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return {};
});

async function fetchLyrics() {
  if (!currentSong.value) return;
  if (currentSong.value.id === lastFetchedSongId && lines.value.length > 0) return;
  lastFetchedSongId = currentSong.value.id;
  loading.value = true;
  lines.value = [];
  activeLine.value = -1;
  nextLineIdx = 0;

  try {
    const res = await http.get(`/api/music/lyrics/${currentSong.value.id}`, {
      params: { platform: currentSong.value.platform },
    });
    lines.value = res.data.lyrics || [];
  } catch (err) {
    console.warn('Failed to load lyrics:', err);
    lines.value = [];
  } finally {
    loading.value = false;
  }
}

function findActiveLine(elapsed: number): number {
  if (lines.value.length === 0) return -1;
  // Reset if user seeked backwards (current time is before the previous active line)
  if (nextLineIdx > 0 && lines.value[nextLineIdx - 1].time > elapsed) {
    nextLineIdx = 0;
  }
  while (nextLineIdx < lines.value.length && lines.value[nextLineIdx].time <= elapsed) {
    nextLineIdx++;
  }
  return nextLineIdx - 1;
}

/** 滚动到指定行并居中，centerRatio 控制垂直位置（0.5=正中，<0.5=偏上） */
function scrollToLine(idx: number, behavior: ScrollBehavior = 'smooth', centerRatio = 0.38) {
  const el = lineRefs.value[idx];
  const container = scrollContainer.value;
  if (!el || !container) return;
  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const offset = elRect.top - containerRect.top + container.scrollTop - container.clientHeight * centerRatio + elRect.height / 2;
  container.scrollTo({ top: offset, behavior });
}

// 300ms 轮询足够（行号游标 O(1)），替代此前常驻 rAF；暂停时彻底停表省电
const TICK_MS = 300;
let tickTimer: ReturnType<typeof setInterval> | null = null;

function tick() {
  if (!store.isPlaying || lines.value.length === 0) return;
  const idx = findActiveLine(store.liveElapsed());
  if (idx >= 0 && idx !== activeLine.value) {
    activeLine.value = idx;
    // 用户手动翻阅期间只推进高亮，不抢滚动条
    if (!userScrolling.value) scrollToLine(idx);
  }
}

function startTick() {
  if (tickTimer !== null) return;
  tick();
  tickTimer = setInterval(tick, TICK_MS);
}

function stopTick() {
  if (tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

let seekInFlight = false;

async function seekToLine(index: number) {
  activeLine.value = index;
  userScrolling.value = false;
  scrollToLine(index, 'instant');
  if (!canTransport.value || seekInFlight) return;
  const time = lines.value[index]?.time;
  if (time === undefined) return;
  seekInFlight = true;
  try {
    await store.seek(time);
  } finally {
    seekInFlight = false;
  }
}

function onUserScroll() {
  userScrolling.value = true;
}

function resumeFollow() {
  userScrolling.value = false;
  if (activeLine.value >= 0) scrollToLine(activeLine.value);
}

watch(() => currentSong.value?.id, (newId, oldId) => {
  if (newId !== oldId) {
    lastFetchedSongId = '';
    nextLineIdx = 0;
    userScrolling.value = false;
    fetchLyrics();
    lineRefs.value = {};
  }
});

watch(() => store.isPlaying, (playing) => {
  if (playing) {
    // 重新播放视为恢复跟随
    userScrolling.value = false;
    startTick();
  } else {
    stopTick();
    if (lines.value.length > 0) {
      const idx = findActiveLine(store.liveElapsed());
      if (idx >= 0) {
        activeLine.value = idx;
        scrollToLine(idx, 'smooth');
      }
    }
  }
});

function onVisibilityChange() {
  if (document.hidden) {
    stopTick();
  } else if (tickTimer === null) {
    startTick();
  }
}

onMounted(() => {
  if (currentSong.value) fetchLyrics();
  startTick();
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onUnmounted(() => {
  stopTick();
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>
