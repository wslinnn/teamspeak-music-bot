<template>
  <div class="fixed bottom-0 left-0 right-0 z-[100]" v-if="currentSong">
    <Queue :open="showQueue" @close="showQueue = false" />

    <div class="h-[var(--player-height)] flex items-center px-6 relative frosted-glass">
      <!-- Progress bar -->
      <div
        class="absolute -top-1.5 left-0 right-0 h-3 cursor-pointer z-[101] flex items-center px-0"
        ref="progressBarRef"
        @click="onProgressClick"
        @mousemove="onProgressHover"
        @mouseleave="progressTooltipVisible = false"
      >
        <div class="w-full h-0.5 bg-border-color transition-[height] duration-150 relative rounded-sm group">
          <div class="absolute top-0 left-0 h-full bg-primary rounded-sm" :style="{ width: progressPercent + '%' }" />
          <div class="absolute top-1/2 w-2.5 h-2.5 bg-primary rounded-full -ml-[5px] -mt-[5px] opacity-0 scale-0 transition-all duration-150 group-hover:opacity-100 group-hover:scale-100" :style="{ left: progressPercent + '%' }" />
        </div>
        <div
          v-if="progressTooltipVisible"
          class="absolute -top-7 -translate-x-1/2 bg-bg-secondary border border-border-color rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] text-text-secondary whitespace-nowrap pointer-events-none"
          :style="{ left: progressTooltipX + 'px' }"
        >
          {{ progressTooltipTime }}
        </div>
      </div>

      <div class="flex items-center gap-3 w-[240px] no-underline text-inherit cursor-pointer transition-opacity duration-[var(--transition-fast)] hover:opacity-80" @click="toggleLyrics">
        <CoverArt :url="currentSong.coverUrl" :size="40" :show-shadow="true" />
        <div class="min-w-0">
          <div class="text-[13px] font-medium truncate">
            <PlayingIndicator v-if="store.isPlaying && !store.isPaused" :is-playing="true" class="mr-2 inline-flex" />
            {{ currentSong.name }}
          </div>
          <div class="text-[11px] text-text-secondary flex items-center gap-1">
            <button
              v-if="showBotBadge"
              class="inline-flex items-center gap-0.5 text-[10px] font-semibold px-[5px] bg-[rgba(51,94,234,0.15)] text-primary rounded-[3px] leading-4 whitespace-nowrap shrink-0 cursor-pointer hover:brightness-110 transition-all"
              @click.stop="openServerTree"
            >
              <Icon icon="mdi:account-voice" class="text-[10px]" />
              {{ activeBot?.name }}
            </button>
            {{ currentSong.artist }}
          </div>
        </div>
      </div>

      <div class="flex-1 flex justify-center items-center gap-5">
        <span class="text-[11px] text-text-tertiary tabular-nums min-w-[36px] text-right hidden sm:inline">{{ formatTime(currentElapsed) }}</span>
        <button aria-label="上一首" class="text-xl opacity-70 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" @click="store.prev()">
          <Icon icon="mdi:skip-previous" />
        </button>
        <button :aria-label="store.isPlaying ? '暂停' : '播放'" class="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-lg text-white transition-transform duration-[var(--transition-fast)] hover:scale-[1.08] active:scale-95" @click="togglePlay">
          <Icon :icon="store.isPlaying ? 'mdi:pause' : 'mdi:play'" />
        </button>
        <button aria-label="下一首" class="text-xl opacity-70 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" @click="store.next()">
          <Icon icon="mdi:skip-next" />
        </button>
        <button :aria-label="`播放模式: ${modeLabel}`" class="hidden sm:flex items-center gap-1 text-lg opacity-70 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" @click="cycleMode" :title="modeLabel">
          <Icon :icon="modeIcon" />
          <span class="text-[11px] font-medium">{{ modeLabel }}</span>
        </button>
        <span class="text-[11px] text-text-tertiary tabular-nums min-w-[36px] text-left hidden sm:inline">{{ formatTime(currentSong?.duration ?? 0) }}</span>
      </div>

      <div class="w-[240px] flex items-center justify-end gap-2">
        <Icon icon="mdi:volume-high" class="text-lg opacity-60 hidden sm:block" />
        <input
          type="range"
          min="0"
          max="100"
          :value="activeBot?.volume ?? 75"
          @change="onVolumeChange"
          class="volume-slider hidden sm:block"
        />
        <button class="text-xl opacity-70 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" :class="{ 'opacity-100 text-primary': showQueue }" @click="showQueue = !showQueue">
          <Icon icon="mdi:playlist-music" />
        </button>
      </div>
    </div>
    <ServerTreeDrawer v-model="serverTreeOpen" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlayerStore } from '../stores/player.js';
import CoverArt from './CoverArt.vue';
import Queue from './Queue.vue';
import PlayingIndicator from './PlayingIndicator.vue';
import ServerTreeDrawer from './ServerTreeDrawer.vue';
import { formatDuration } from '../utils/format';

const route = useRoute();
const router = useRouter();
const showQueue = ref(false);
const serverTreeOpen = ref(false);

function openServerTree() {
  serverTreeOpen.value = true;
}

const store = usePlayerStore();
const activeBot = computed(() => store.activeBot);
const currentSong = computed(() => store.currentSong);
const showBotBadge = computed(() => store.bots.length > 1);

function toggleLyrics() {
  if (route.path === '/lyrics') {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push('/');
    }
  } else {
    router.push('/lyrics');
  }
}

const currentElapsed = ref(0);
const progressPercent = ref(0);
const progressTooltipVisible = ref(false);
const progressTooltipX = ref(0);
const progressTooltipTime = ref('0:00');
const progressBarRef = ref<HTMLElement | null>(null);
let rafId: number | null = null;

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  return formatDuration(Math.floor(seconds));
}

function updateProgress() {
  currentElapsed.value = store.elapsed;
  const duration = currentSong.value?.duration ?? 0;
  progressPercent.value = duration > 0
    ? Math.min((currentElapsed.value / duration) * 100, 100)
    : 0;

  if (store.isPlaying) {
    rafId = requestAnimationFrame(updateProgress);
  } else {
    rafId = null;
  }
}

async function onProgressClick(e: MouseEvent) {
  const bar = progressBarRef.value;
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const duration = currentSong.value?.duration ?? 0;
  const seekTime = ratio * duration;
  await store.seek(seekTime);
}

function onProgressHover(e: MouseEvent) {
  const bar = progressBarRef.value;
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const duration = currentSong.value?.duration ?? 0;
  progressTooltipVisible.value = true;
  progressTooltipX.value = e.clientX - rect.left;
  progressTooltipTime.value = formatTime(ratio * duration);
}

onMounted(() => {
  rafId = requestAnimationFrame(updateProgress);
});

onUnmounted(() => {
  if (rafId !== null) cancelAnimationFrame(rafId);
});

watch(() => store.isPlaying, (playing) => {
  if (playing && rafId === null) {
    rafId = requestAnimationFrame(updateProgress);
  }
});

function togglePlay() {
  if (store.isPlaying) {
    store.pause();
  } else {
    store.resume();
  }
}

function onVolumeChange(e: Event) {
  const target = e.target as HTMLInputElement;
  store.setVolume(parseInt(target.value));
}

const modeOrder = ['seq', 'loop', 'random', 'rloop'] as const;
const modeIcons: Record<string, string> = {
  seq: 'mdi:arrow-right',
  loop: 'mdi:repeat',
  random: 'mdi:shuffle',
  rloop: 'mdi:shuffle-variant',
};
const modeLabels: Record<string, string> = {
  seq: '顺序',
  loop: '循环',
  random: '随机',
  rloop: '随机循环',
};

const currentMode = computed(() => activeBot.value?.playMode ?? 'seq');
const modeIcon = computed(() => modeIcons[currentMode.value] ?? modeIcons.seq);
const modeLabel = computed(() => modeLabels[currentMode.value] ?? modeLabels.seq);

function cycleMode() {
  const idx = modeOrder.indexOf(currentMode.value as typeof modeOrder[number]);
  const next = modeOrder[(idx + 1) % modeOrder.length];
  store.setMode(next);
}
</script>

<style scoped>
.volume-slider {
  width: 5rem;
  height: 3px;
  appearance: none;
  background: var(--hover-bg);
  border-radius: 4px;
  outline: none;
}
.volume-slider::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  background: var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
}
</style>