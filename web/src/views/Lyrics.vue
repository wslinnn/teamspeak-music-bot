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

      <div class="flex-1 overflow-hidden relative w-full lg:w-auto" style="mask-image: linear-gradient(transparent 0%, black 15%, black 85%, transparent 100%); -webkit-mask-image: linear-gradient(transparent 0%, black 15%, black 85%, transparent 100%);">
        <div v-if="loading" class="text-white/50 text-sm text-center py-[60px]">加载歌词中...</div>
        <div v-else-if="lines.length === 0" class="text-white/50 text-sm text-center py-[60px]">暂无歌词</div>
        <div v-else class="h-full overflow-y-auto relative scroll-smooth py-[30vh]" ref="scrollContainer">
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
let syncTimer: ReturnType<typeof setInterval> | null = null;
let userScrolling = false;
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

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
  loading.value = true;
  lines.value = [];
  activeLine.value = -1;

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
  let idx = -1;
  for (let i = 0; i < lines.value.length; i++) {
    if (lines.value[i].time <= elapsed) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}

function scrollToActiveLine(idx: number) {
  if (userScrolling) return;
  const el = lineRefs.value[idx];
  const container = scrollContainer.value;
  if (!el || !container) return;

  const containerHeight = container.clientHeight;
  const lineTop = el.offsetTop;
  const lineHeight = el.offsetHeight;
  const targetScrollTop = lineTop - containerHeight / 2 + lineHeight / 2;
  container.scrollTo({ top: targetScrollTop, behavior: 'smooth' });
}

function syncLyrics() {
  if (!store.isPlaying || lines.value.length === 0) return;
  const elapsed = store.elapsed;
  const idx = findActiveLine(elapsed);
  if (idx !== activeLine.value && idx >= 0) {
    activeLine.value = idx;
    scrollToActiveLine(idx);
  }
}

async function seekToLine(index: number) {
  const time = lines.value[index]?.time;
  if (time !== undefined) {
    await store.seek(time);
  }
  activeLine.value = index;
  scrollToActiveLine(index);
}

function startSync() {
  stopSync();
  syncTimer = setInterval(syncLyrics, 500);
}

function stopSync() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

function onScroll() {
  userScrolling = true;
  if (scrollTimeout) clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    userScrolling = false;
  }, 3000);
}

watch(currentSong, () => {
  fetchLyrics();
  lineRefs.value = {};
});

watch(() => store.isPlaying, (playing) => {
  if (playing) startSync();
  else stopSync();
}, { immediate: true });

onMounted(() => {
  if (currentSong.value) fetchLyrics();
  if (store.isPlaying) startSync();
  scrollContainer.value?.addEventListener('scroll', onScroll, { passive: true });
});

onUnmounted(() => {
  stopSync();
  scrollContainer.value?.removeEventListener('scroll', onScroll);
  if (scrollTimeout) clearTimeout(scrollTimeout);
});
</script>
