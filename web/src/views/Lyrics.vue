<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center" :style="bgStyle">
    <div class="absolute inset-0 bg-black/75 backdrop-blur-[60px]" />
    <button class="absolute top-6 left-6 z-[2] flex items-center gap-1.5 text-sm text-white/70 transition-colors hover:text-white" @click="goBack">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>

    <div v-if="currentSong" class="relative z-[1] flex flex-col items-center gap-6 lg:flex-row lg:gap-[60px] max-w-[1000px] w-full px-6 sm:px-10 h-[80vh]">
      <div class="flex flex-col items-center gap-4 shrink-0">
        <CoverArt :url="currentSong.coverUrl" :size="180" :radius="14" :show-shadow="true" class="sm:!w-[240px] sm:!h-[240px] lg:!w-[280px] lg:!h-[280px]" />
        <div class="text-center">
          <div class="text-xl font-bold text-white mb-1">{{ currentSong.name }}</div>
          <div class="text-sm text-white/60">{{ currentSong.artist }}</div>
        </div>
      </div>

      <div class="flex-1 overflow-hidden relative w-full lg:w-auto self-stretch" style="mask-image: linear-gradient(transparent 0%, black 15%, black 85%, transparent 100%); -webkit-mask-image: linear-gradient(transparent 0%, black 15%, black 85%, transparent 100%);">
        <div v-if="loading" class="text-white/50 text-sm text-center py-[60px]">加载歌词中...</div>
        <div v-else-if="lines.length === 0" class="text-white/50 text-sm text-center py-[60px]">暂无歌词</div>
        <div v-else class="h-full overflow-y-auto relative scroll-smooth py-[30vh]" ref="scrollContainer" @scroll.passive="onUserScroll">
          <div>
            <div
              v-for="(line, i) in lines"
              :key="i"
              :ref="el => { if (el) lineRefs[i] = el as HTMLElement }"
              class="py-2 cursor-pointer transition-all duration-[400ms]"
              :class="i === activeLine ? 'active' : ''"
              @click="seekToLine(i)"
            >
              <div class="text-lg leading-relaxed transition-all duration-[400ms]" :class="i === activeLine ? 'text-[22px] font-semibold text-white' : 'text-white/30'">{{ line.text }}</div>
              <div v-if="line.translation" class="text-sm leading-snug text-white/15 mt-0.5 transition-all duration-[400ms]" :class="i === activeLine ? 'text-white/50' : ''">{{ line.translation }}</div>
            </div>
          </div>
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
import CoverArt from '../components/CoverArt.vue';

const router = useRouter();
const store = usePlayerStore();
const currentSong = computed(() => store.currentSong);

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
let rafId: number | null = null;
let userScrolling = false;
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
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

/** rAF 循环：每帧检测 elapsed 变化，同步高亮和滚动 */
function tick() {
  if (store.isPlaying && lines.value.length > 0) {
    const idx = findActiveLine(store.elapsed);
    if (idx >= 0 && idx !== activeLine.value) {
      activeLine.value = idx;
      scrollToLine(idx);
    }
  }
  rafId = requestAnimationFrame(tick);
}

async function seekToLine(index: number) {
  activeLine.value = index;
  userScrolling = false;
  scrollToLine(index, 'instant');
  const time = lines.value[index]?.time;
  if (time !== undefined) {
    await store.seek(time);
  }
}

function onUserScroll() {
  userScrolling = true;
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    userScrolling = false;
  }, 1500);
}

watch(() => currentSong.value?.id, (newId, oldId) => {
  if (newId !== oldId) {
    lastFetchedSongId = '';
    nextLineIdx = 0;
    fetchLyrics();
    lineRefs.value = {};
  }
});

watch(() => store.isPlaying, (playing) => {
  if (!playing && lines.value.length > 0) {
    const idx = findActiveLine(store.elapsed);
    if (idx >= 0) {
      activeLine.value = idx;
      userScrolling = false;
      scrollToLine(idx, 'smooth');
    }
  }
});

function onVisibilityChange() {
  if (document.hidden) {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  } else if (rafId === null) {
    rafId = requestAnimationFrame(tick);
  }
}

onMounted(() => {
  if (currentSong.value) fetchLyrics();
  rafId = requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onUnmounted(() => {
  if (rafId !== null) cancelAnimationFrame(rafId);
  if (scrollTimeout) clearTimeout(scrollTimeout);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>
