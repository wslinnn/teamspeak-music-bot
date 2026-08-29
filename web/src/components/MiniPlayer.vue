<template>
  <div
    v-if="currentSong"
    class="fixed left-2 right-2 bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+8px)] z-[var(--z-mini-player)] md:hidden"
    @click="onRowClick"
  >
    <div class="flex flex-col h-[var(--mini-player-height)] rounded-[12px] bg-bg-secondary shadow-[0_6px_20px_rgba(0,0,0,0.35)] overflow-hidden">
      <!-- 进度行：已播放/总时长分列两端；点按或拖拽 seek（命中区整行，#143 等价移植） -->
      <div
        ref="seekBarRef"
        class="flex items-center gap-2 px-3 pt-2 pb-0.5 select-none"
        :class="canSeek ? 'cursor-pointer touch-none' : ''"
        @pointerdown="onSeekDown"
        @pointermove="onSeekMove"
        @pointerup="onSeekUp"
        @pointercancel="onSeekCancel"
      >
        <span class="text-[10px] leading-none text-text-secondary tabular-nums">{{ formatTime(displayElapsed) }}</span>
        <div class="relative flex-1 h-1 rounded-full bg-border-color">
          <div class="absolute inset-y-0 left-0 rounded-full bg-primary" :style="{ width: seekBarPct + '%' }" />
          <div
            class="absolute top-1/2 w-2.5 h-2.5 -mt-[5px] -ml-[5px] rounded-full bg-primary shadow-[0_1px_4px_rgba(0,0,0,0.3)] pointer-events-none transition-[opacity,transform] duration-[var(--transition-fast)]"
            :class="seeking ? 'opacity-100 scale-100' : 'opacity-0 scale-0'"
            :style="{ left: seekBarPct + '%' }"
          />
        </div>
        <span class="text-[10px] leading-none text-text-secondary tabular-nums">{{ formatTime(activeDuration) }}</span>
      </div>

      <div class="flex items-center gap-2.5 px-2.5 pb-1 min-h-0">
        <CoverArt :url="currentSong.coverUrl" :size="44" :radius="8" />
        <div class="flex-1 min-w-0 cursor-pointer">
          <div class="text-[13px] font-medium truncate flex items-center">
            <PlayingIndicator v-if="store.isPlaying && !store.isPaused" :is-playing="true" class="mr-1.5 inline-flex shrink-0" />
            <span class="truncate">{{ currentSong.name }}</span>
          </div>
          <div class="text-[11px] text-text-secondary truncate">{{ currentSong.artist }}</div>
        </div>
        <!-- 仅按键区阻断冒泡：点封面/歌名/歌手要冒泡到根节点进歌词页 -->
        <div class="flex items-center gap-0.5 shrink-0" @click.stop>
          <button v-if="canControl" aria-label="上一首" class="mini-ctrl-btn text-[21px] opacity-80 active:scale-95" @click="skipPrev">
            <Icon icon="mdi:skip-previous" />
          </button>
          <button v-if="canTransport" :aria-label="store.isPlaying ? '暂停' : '播放'" class="mini-ctrl-btn text-[24px] text-primary active:scale-95" @click="togglePlay">
            <Icon :icon="store.isPlaying ? 'mdi:pause' : 'mdi:play'" />
          </button>
          <button v-if="canSkip" aria-label="下一首" class="mini-ctrl-btn text-[21px] opacity-80 active:scale-95" @click="skipNext">
            <Icon icon="mdi:skip-next" />
          </button>
          <button v-if="canModeCtl" :aria-label="`播放模式: ${modeLabel}`" :title="modeLabel" class="mini-ctrl-btn text-[19px]" :class="currentMode !== 'seq' ? 'text-primary' : 'opacity-80'" @click="cycleMode">
            <Icon :icon="modeIcon" />
          </button>
          <!-- FM 徽标：运行中可点击退出（保留队列按顺序播完） -->
          <button
            v-if="canModeCtl && activeBot?.fmPlatform"
            class="h-6 shrink-0 px-1.5 rounded-full bg-primary/15 text-primary text-[10px] font-bold active:scale-95 transition-transform"
            title="私人FM运行中，点击退出"
            @click="store.stopFm()"
          >
            FM
          </button>
          <button aria-label="播放队列" class="mini-ctrl-btn text-[19px] opacity-80" :class="{ 'text-primary': queueOpen }" @click="toggleQueue">
            <Icon icon="mdi:playlist-music" />
          </button>
          <button v-if="canTransport" aria-label="音量" class="mini-ctrl-btn text-[19px] opacity-80" @click="toggleVolume">
            <Icon icon="mdi:volume-high" />
          </button>
        </div>
      </div>

      <!-- 音量浮层 -->
      <div v-if="volumeOpen" class="absolute right-2 bottom-[calc(100%+8px)] w-[min(260px,calc(100vw-32px))] rounded-[var(--radius-md)] bg-bg-secondary p-3 shadow-[0_8px_30px_rgba(0,0,0,0.3)]" @click.stop>
        <div class="flex items-center gap-2.5">
          <Icon icon="mdi:volume-low" class="text-lg text-text-tertiary shrink-0" />
          <input
            type="range"
            min="0"
            max="100"
            :value="volumeDisplay"
            class="mini-volume-slider flex-1"
            @input="onVolumeInput"
            @change="onVolumeChange"
            @pointerup="onVolumeRelease"
            @pointercancel="onVolumeRelease"
            @blur="onVolumeRelease"
          />
          <span class="text-xs text-text-secondary tabular-nums shrink-0">{{ volumeDisplay }}</span>
          <Icon icon="mdi:volume-high" class="text-lg text-text-tertiary shrink-0" />
        </div>
      </div>
    </div>

    <Queue :open="queueOpen" @close="queueOpen = false" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth';
import { useToast } from '../composables/useToast';
import { useDecoupledSlider } from '../composables/useDecoupledSlider.js';
import { haptic } from '../utils/haptic';
import CoverArt from './CoverArt.vue';
import PlayingIndicator from './PlayingIndicator.vue';
import Queue from './Queue.vue';

const route = useRoute();
const router = useRouter();

const store = usePlayerStore();
const auth = useAuthStore();
const toast = useToast();
const activeBot = computed(() => store.activeBot);
const currentSong = computed(() => store.currentSong);

// 权限门控与桌面 Player 完全同口径（D14）
const canControl = computed(() => auth.can('player.control'));
const canTransport = computed(() => auth.can('player.control') || auth.guestCan('transport'));
const canSkip = computed(() => auth.can('player.control') || auth.guestCan('skip'));
const canModeCtl = computed(() => auth.can('player.control') || auth.guestCan('playMode'));

/** 分母与桌面一致：试听曲优先 effectiveDuration（B1） */
const activeDuration = computed(
  () => activeBot.value?.effectiveDuration ?? currentSong.value?.duration ?? 0,
);

const queueOpen = ref(false);
const volumeOpen = ref(false);

function toggleLyrics() {
  if (route.path === '/lyrics') {
    if (window.history.length > 1) router.back();
    else router.push('/');
  } else {
    router.push('/lyrics');
  }
}

/** 整行点击进歌词页；seek 手势结束后的尾部 click 不应触发跳转 */
function onRowClick() {
  if (Date.now() - seekEndedAt < 400) return;
  toggleLyrics();
}

function togglePlay() {
  if (store.isPlaying) store.pause();
  else store.resume();
}

// 切歌带触感确认（Android 生效，iOS 静默）；播放/暂停是高频操作不加震动
function skipPrev() {
  store.prev();
  haptic(10);
}

function skipNext() {
  store.next();
  haptic(10);
}

function toggleQueue() {
  queueOpen.value = !queueOpen.value;
  if (queueOpen.value) volumeOpen.value = false;
}

function toggleVolume() {
  volumeOpen.value = !volumeOpen.value;
  if (volumeOpen.value) queueOpen.value = false;
}

// 音量滑块与 rAF 重渲染解耦（#111）：拖动中不被时钟拽回，松手才提交
const {
  display: volumeDisplay,
  onInput: onVolumeInput,
  onChange: onVolumeChange,
  onRelease: onVolumeRelease,
} = useDecoupledSlider(
  () => activeBot.value?.volume,
  (v) => store.setVolume(v)
);

// ── 进度显示（rAF + liveElapsed，#107）───────────────────────────────
const mobileProgressPct = ref(0);
const mobileElapsed = ref(0);
let rafId: number | null = null;

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function updateProgress() {
  // 拖动期间跳过写入：手指拥有进度条，不让时钟每帧把它拽回去
  if (!seeking.value) {
    const duration = activeDuration.value;
    mobileElapsed.value = store.liveElapsed();
    mobileProgressPct.value = duration > 0
      ? Math.min((mobileElapsed.value / duration) * 100, 100)
      : 0;
  }
  // 审计 PERF-07：与桌面 Player 相同的门控——只在播放中续帧，暂停/无歌
  // 不再空转 60fps；页面隐藏时降级为 250ms 轮询（onVisibilityChange）。
  if (store.isPlaying) {
    rafId = requestAnimationFrame(updateProgress);
  } else {
    rafId = null;
  }
}

let backupTimer: ReturnType<typeof setInterval> | null = null;

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

// ── 点按/拖拽 seek（#143 等价移植）──────────────────────────────────
const seekBarRef = ref<HTMLElement | null>(null);
const seeking = ref(false);
const seekPct = ref(0);
let seekPointerId: number | null = null;
// 手势开始时的歌。currentSong 可能在拖动中切歌（播完了），比例对别的歌无意义
let seekSongId: string | null = null;
// 每次手势自增：慢 seek POST 在途时不能被新手势的 finally 提前解除覆盖
let seekGeneration = 0;
// 手势结束时间戳，用于吞掉随后的尾部 click（见 onRowClick）
let seekEndedAt = 0;

const seekBarPct = computed(() => (seeking.value ? seekPct.value : mobileProgressPct.value));
const displayElapsed = computed(() =>
  seeking.value ? (seekPct.value / 100) * seekableDuration() : mobileElapsed.value,
);

/** 指针 x → 0..1；量不到（元素不可测）时返回 null */
function seekRatio(e: PointerEvent): number | null {
  const el = seekBarRef.value;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0) return null;
  return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
}

/** 时长守卫：直播/未知时长会得到 0 → ratio*0 恒回开头，NaN 会被 API 拒收 */
function seekableDuration(): number {
  const duration = activeDuration.value;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

const canSeek = computed(() => canTransport.value && seekableDuration() > 0);

function endSeekGesture() {
  const el = seekBarRef.value;
  if (el && seekPointerId !== null && el.hasPointerCapture?.(seekPointerId)) {
    el.releasePointerCapture(seekPointerId);
  }
  seekPointerId = null;
  seekEndedAt = Date.now();
}

function onSeekDown(e: PointerEvent) {
  if (!canSeek.value) {
    // 无 transport 权限：提示一次，并吞掉随行的 click（防止冒泡又跳进歌词页）；
    // 时长未知（直播/未知曲长）保持静默
    if (!canTransport.value) {
      toast.warning('暂无播放控制权限');
      seekEndedAt = Date.now();
    }
    return;
  }
  // 单手势：第二根手指落下会抢走 seekPointerId，导致第一根永久捕获
  if (seekPointerId !== null) return;
  const ratio = seekRatio(e);
  if (ratio === null) return;
  // seek 过程中不允许行的 router.push('/lyrics') 触发
  e.stopPropagation();
  e.preventDefault(); // 抑制拖动中的文本选择/兼容鼠标事件
  seekPointerId = e.pointerId;
  seekSongId = currentSong.value?.id ?? null;
  seekGeneration += 1;
  seekBarRef.value?.setPointerCapture?.(e.pointerId);
  seeking.value = true;
  seekPct.value = ratio * 100;
}

function onSeekMove(e: PointerEvent) {
  if (!seeking.value || e.pointerId !== seekPointerId) return;
  const ratio = seekRatio(e);
  if (ratio === null) return;
  e.stopPropagation();
  seekPct.value = ratio * 100;
}

async function onSeekUp(e: PointerEvent) {
  if (!seeking.value || e.pointerId !== seekPointerId) return;
  e.stopPropagation();
  // 点按（未拖动）同样在 pointerup 提交
  const ratio = seekRatio(e) ?? seekPct.value / 100;
  seekPct.value = ratio * 100;
  const duration = seekableDuration();
  const generation = seekGeneration;
  // 拖动中切歌了：这个比例属于已停播的歌，丢弃而不是 seek 到新歌
  const sameSong = currentSong.value?.id === seekSongId;
  endSeekGesture(); // 必须在 await 之前同步执行
  try {
    if (duration > 0 && sameSong) {
      await store.seek(ratio * duration);
      haptic(8); // seek 提交成功的物理确认
    }
  } catch {
    // seek 被拒（403/400/离线）——交还服务器时钟即可
  } finally {
    // store.seek() 已在同一 tick 内把锚点移到目标位置，liveElapsed 已是新值，
    // 松手即从手指位置继续；若此刻立刻解除覆盖会先闪回旧位置再跳一次
    if (generation === seekGeneration) seeking.value = false;
  }
}

function onSeekCancel(e: PointerEvent) {
  if (e.pointerId !== seekPointerId) return;
  // 手势被系统抢走（来电等）：放弃 seek，直接交还时钟
  endSeekGesture();
  seeking.value = false;
}

// 整个胶囊都在 v-if="currentSong" 内：播放中途停止会销毁细条，
// pointerup/cancel 永远到不了——此时 seeking 覆盖必须解除，否则进度条冻死
watch(currentSong, () => {
  if (!seeking.value) return;
  seekGeneration += 1;
  seekPointerId = null;
  seekSongId = null;
  seeking.value = false;
});

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

// ── 播放模式（与桌面 Player 同一套序列）────────────────────────────
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
  volumeOpen.value = false;
  queueOpen.value = false;
  store.setMode(next);
}
</script>

<style scoped>
/* 胶囊控制键：44px 高触控目标（Apple HIG 下限），≤380px 小屏收窄保歌名空间 */
.mini-ctrl-btn {
  width: 32px;
  height: 44px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
@media (max-width: 380px) {
  .mini-ctrl-btn {
    width: 26px;
    height: 38px;
  }
}
.mini-volume-slider {
  height: 6px;
  appearance: none;
  background: var(--hover-bg);
  border-radius: 999px;
  outline: none;
}
.mini-volume-slider::-webkit-slider-thumb {
  appearance: none;
  width: 20px;
  height: 20px;
  background: var(--color-primary);
  border-radius: 50%;
  cursor: pointer;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}
.mini-volume-slider::-moz-range-thumb {
  width: 20px;
  height: 20px;
  background: var(--color-primary);
  border-radius: 50%;
  border: none;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
}
</style>
