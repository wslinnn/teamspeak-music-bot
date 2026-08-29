<template>
  <!-- 移动端由 MiniPlayer + MobileTabBar 接管（App.vue），本栏桌面专用 -->
  <div class="hidden md:block fixed bottom-0 left-0 right-0 z-[var(--z-player)] frosted-glass pb-[env(safe-area-inset-bottom)]" v-if="currentSong">
    <Queue :open="showQueue" @close="showQueue = false" />

    <div class="h-[var(--player-height)] flex items-center px-6 relative">
      <!-- Progress bar -->
      <div
        class="absolute -top-1.5 left-0 right-0 h-3 z-[101] flex items-center px-0 cursor-pointer"
        ref="progressBarRef"
        @click="onProgressClick"
        @mousemove="onProgressHover"
        @mouseleave="progressTooltipVisible = false"
      >
        <div class="w-full h-0.5 bg-border-color transition-[height] duration-150 relative rounded-sm group">
          <div class="absolute top-0 left-0 h-full w-full">
            <div class="h-full bg-primary rounded-sm origin-left" :style="{ transform: `scaleX(${progressPercent / 100})` }" />
          </div>
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

      <div class="flex items-center gap-3 min-w-0 flex-1 sm:flex-none sm:w-[240px] no-underline text-inherit cursor-pointer transition-opacity duration-[var(--transition-fast)] hover:opacity-80" @click="toggleLyrics">
        <CoverArt :url="currentSong.coverUrl" :size="40" :show-shadow="true" />
        <div class="min-w-0">
          <div class="text-[13px] font-medium truncate">
            <PlayingIndicator v-if="store.isPlaying && !store.isPaused" :is-playing="true" class="mr-2 inline-flex" />
            {{ currentSong.name }}
          </div>
          <div class="text-[11px] text-text-secondary flex items-center gap-1">
            <button
              v-if="showBotBadge"
              class="inline-flex items-center gap-0.5 text-[10px] font-semibold px-[5px] bg-primary/15 text-primary rounded-[3px] leading-4 whitespace-nowrap shrink-0 cursor-pointer hover:brightness-110 transition-all"
              @click.stop="openServerTree"
            >
              <Icon icon="mdi:account-voice" class="text-[10px]" />
              {{ activeBot?.name }}
            </button>
            {{ currentSong.artist }}
          </div>
        </div>
      </div>

      <div class="flex justify-center items-center gap-5 sm:flex-1 shrink-0">
        <span class="text-[11px] text-text-tertiary tabular-nums min-w-[36px] text-right hidden sm:inline">{{ formatTime(currentElapsed) }}</span>
        <button v-if="canControl" aria-label="上一首" class="text-xl opacity-70 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" @click="store.prev()">
          <Icon icon="mdi:skip-previous" />
        </button>
        <button v-if="canTransport" :aria-label="store.isPlaying ? '暂停' : '播放'" class="w-8 h-8 bg-primary rounded-full flex items-center justify-center text-lg text-white transition-transform duration-[var(--transition-fast)] hover:scale-[1.08] active:scale-95" @click="togglePlay">
          <Icon :icon="store.isPlaying ? 'mdi:pause' : 'mdi:play'" />
        </button>
        <button v-if="canSkip" aria-label="下一首" class="text-xl opacity-70 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" @click="store.next()">
          <Icon icon="mdi:skip-next" />
        </button>
        <button v-if="canModeCtl" :aria-label="`播放模式: ${modeLabel}`" class="hidden sm:flex items-center gap-1 text-lg opacity-70 transition-opacity duration-[var(--transition-fast)] hover:opacity-100" @click="cycleMode" :title="modeLabel">
          <Icon :icon="modeIcon" />
          <span class="text-[11px] font-medium">{{ modeLabel }}</span>
        </button>
        <!-- FM 徽标：运行中可点击退出（保留队列按顺序播完） -->
        <button
          v-if="canModeCtl && activeBot?.fmPlatform"
          class="hidden sm:flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary transition-colors hover:bg-primary/25"
          title="私人FM运行中，点击退出（保留队列按顺序播完）"
          @click="store.stopFm()"
        >
          <Icon icon="mdi:radio" class="text-[13px]" />
          FM
        </button>
        <span class="text-[11px] text-text-tertiary tabular-nums min-w-[36px] text-left hidden sm:inline">{{ formatTime(activeDuration) }}</span>
      </div>

      <div class="sm:w-[240px] sm:shrink-0 flex items-center justify-end gap-2">
        <!-- Desktop volume：滚轮步进 ±5，数值实时跟随拖动 / 滚轮 -->
        <div v-if="canTransport" class="flex items-center gap-2" @wheel.prevent="onVolumeWheel">
          <Icon icon="mdi:volume-high" class="text-lg opacity-60" />
          <input
            type="range"
            min="0"
            max="100"
            :value="volumeDisplay"
            @input="onVolumeInput"
            @change="onVolumeChange"
            @pointerup="onVolumeRelease"
            @pointercancel="onVolumeRelease"
            @blur="onVolumeRelease"
            class="volume-slider"
          />
          <span class="text-[11px] text-text-secondary tabular-nums w-[24px] text-right select-none">{{ Math.round(volumeDisplay) }}</span>
        </div>
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
import { useAuthStore } from '../stores/auth';
import { useToast } from '../composables/useToast';
import { useDecoupledSlider } from '../composables/useDecoupledSlider.js';
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
const auth = useAuthStore();
const toast = useToast();
const activeBot = computed(() => store.activeBot);
const currentSong = computed(() => store.currentSong);
// 按钮显隐门控（D14）：member 走 capabilities，游客走 guestMode 逐项开关
const canControl = computed(() => auth.can('player.control'));
const canTransport = computed(() => auth.can('player.control') || auth.guestCan('transport'));
const canSkip = computed(() => auth.can('player.control') || auth.guestCan('skip'));
const canModeCtl = computed(() => auth.can('player.control') || auth.guestCan('playMode'));
// 进度条分母与总时长：试听曲优先 effectiveDuration（B1），否则完整曲长
const activeDuration = computed(
  () => activeBot.value?.effectiveDuration ?? currentSong.value?.duration ?? 0,
);
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
let backupTimer: ReturnType<typeof setInterval> | null = null;
let pendingHoverRaf = false;

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  return formatDuration(Math.floor(seconds));
}

function updateProgress() {
  // liveElapsed()（action，非缓存的 elapsed getter）逐帧从服务器锚点重新插值，
  // 时钟才能每秒平滑推进而不是随轮询台阶跳变（上游 issue #107）
  currentElapsed.value = store.liveElapsed();
  const duration = activeDuration.value;
  progressPercent.value = duration > 0
    ? Math.min((currentElapsed.value / duration) * 100, 100)
    : 0;

  if (store.isPlaying) {
    rafId = requestAnimationFrame(updateProgress);
  } else {
    rafId = null;
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (!backupTimer) {
      backupTimer = setInterval(updateProgress, 250);
    }
  } else {
    if (backupTimer) {
      clearInterval(backupTimer);
      backupTimer = null;
    }
    if (store.isPlaying && rafId === null) {
      rafId = requestAnimationFrame(updateProgress);
    }
  }
}

async function onProgressClick(e: MouseEvent) {
  if (!canTransport.value) {
    toast.warning('暂无播放控制权限');
    return;
  }
  const bar = progressBarRef.value;
  if (!bar) return;
  const rect = bar.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const duration = activeDuration.value;
  // 时长未知（旧播放历史记录等）：禁用点击，否则 ratio*0 恒为 0 会跳回开头
  if (duration <= 0) return;
  const seekTime = ratio * duration;
  await store.seek(seekTime);
}

function onProgressHover(e: MouseEvent) {
  if (pendingHoverRaf) return;
  pendingHoverRaf = true;
  requestAnimationFrame(() => {
    pendingHoverRaf = false;
    const bar = progressBarRef.value;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const duration = currentSong.value?.duration ?? 0;
    progressTooltipVisible.value = true;
    progressTooltipX.value = e.clientX - rect.left;
    progressTooltipTime.value = formatTime(ratio * duration);
  });
}

onMounted(() => {
  rafId = requestAnimationFrame(updateProgress);
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onUnmounted(() => {
  if (rafId !== null) cancelAnimationFrame(rafId);
  if (backupTimer) clearInterval(backupTimer);
  document.removeEventListener('visibilitychange', onVisibilityChange);
});

watch(() => store.isPlaying, (playing) => {
  if (playing && rafId === null && !document.hidden) {
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

// 音量滑块与逐帧 rAF 重渲染解耦（#111）：拖动中绑定本地值不被拽回，
// 松手才提交 store；外部变化（切 bot/其他客户端）在不拖动时照常跟进
function commitVolume(value: number): void {
  store.setVolume(value);
}

const {
  display: volumeDisplay,
  onInput: onVolumeInput,
  onChange: onVolumeChange,
  onRelease: onVolumeRelease,
} = useDecoupledSlider(
  () => activeBot.value?.volume,
  commitVolume
);

// 滚轮步进 ±5：离散步进直接一次提交（无需进入拖动态）
function onVolumeWheel(e: WheelEvent): void {
  const next = Math.min(100, Math.max(0, Math.round(volumeDisplay.value + (e.deltaY < 0 ? 5 : -5))));
  volumeDisplay.value = next;
  commitVolume(next);
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