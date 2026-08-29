<template>
  <div class="lyrics-page" :style="rootStyle">
    <div class="lyrics-overlay" />
    <button class="back-btn" @click="goBack">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>

    <div v-if="currentSong" class="lyrics-content">
      <div class="lyrics-left">
        <CoverArt :url="currentSong.coverUrl" :size="280" :radius="14" :show-shadow="true" />
        <div class="song-meta">
          <div class="song-name">{{ currentSong.name }}</div>
          <div class="song-artist">{{ currentSong.artist }}</div>
        </div>
      </div>

      <div class="lyrics-right">
        <div v-if="loading" class="lyrics-loading">加载歌词中...</div>
        <div v-else-if="lines.length === 0" class="lyrics-empty">暂无歌词</div>
        <template v-else>
          <div class="lyrics-actions">
            <button v-if="hasTranslation" class="lyrics-toggle" :class="{ on: showTranslation }" @click="showTranslation = !showTranslation">译文</button>
            <button
              class="lyrics-toggle"
              :title="`歌词字号：${fontScaleLabel}（点击切换）`"
              @click="cycleFontScale"
            >Aa</button>
          </div>
          <div class="lyrics-stage">
            <div class="lyrics-scroll" ref="scrollContainer" @scroll="onUserScroll">
              <div class="lyrics-inner">
                <div class="lyrics-spacer" />
                <div
                  v-for="(line, i) in lines"
                  :key="i"
                  :ref="el => { if (el) lineRefs[i] = el as HTMLElement }"
                  class="lyrics-line"
                  :class="{ active: i === activeLine, 'manual-target': browsing && i === manualLine }"
                  @click="seekToLine(i)"
                >
                  <div class="lyrics-text">{{ line.text }}</div>
                  <div v-if="showTranslation && line.translation" class="lyrics-translation">{{ line.translation }}</div>
                </div>
                <div class="lyrics-spacer" />
              </div>
            </div>
            <!-- 位置指示层：仅手动浏览时显示（自二开版复刻）。停在视口中央指向最近的
                 行，胶囊可点击 seek，无 transport 权限时置灰 -->
            <div v-if="browsing" class="lyrics-position-overlay">
              <div class="lyrics-position-dash" />
              <button class="lyrics-position-play" :disabled="!canTransport" @click="seekToPositionLine">
                <Icon icon="mdi:play" class="text-[11px]" /> {{ positionTime }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>

    <div v-else class="no-song">
      当前没有正在播放的歌曲
    </div>
  </div>
</template>

<script setup lang="ts">
// 结构自上游 Lyrics.vue 移植，滚动架构改为对手二开的纯原生滚动单轴：
// 自动跟随与用户手动滚动共用容器 scrollTop（transform 双轴会让上方歌词
// 滚不回去）。同步源用 liveElapsed()（#107）；点击歌词行/位置胶囊在有
// transport 权限时执行真实 seek。
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth';
import { useLyricsFontScale } from '../composables/useLyricsFontScale';
import CoverArt from '../components/CoverArt.vue';

const router = useRouter();
const store = usePlayerStore();
const auth = useAuthStore();
const currentSong = computed(() => store.currentSong);
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
// 程序化滚动（scrollTo）期间容器会连续触发 scroll 事件，需与用户手动滚动
// 区分：置抑制标志，平滑滚动 520ms / 瞬时定位 80ms 后解除（自二开版复刻）
let scrollSuppressed = false;
let scrollSuppressTimer: ReturnType<typeof setTimeout> | null = null;
// 手动浏览状态：用户滚动列表时暂停自动跟随，高亮视口中央最近的行（自二开版复刻）
const browsing = ref(false);
const manualLine = ref(-1);
let browsingTimer: ReturnType<typeof setTimeout> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;

// 译文显隐开关（localStorage 记忆；默认开）
const showTranslation = ref(readPref("lyrics.showTranslation", true));
const hasTranslation = computed(() => lines.value.some((l) => l.translation));

watch(showTranslation, (v) => writePref("lyrics.showTranslation", v));

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function writePref(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

function formatTime(seconds: number): string {
  if (!seconds || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const bgStyle = computed(() => {
  if (currentSong.value?.coverUrl) {
    return {
      backgroundImage: `url("${encodeURI(currentSong.value.coverUrl)}")`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
    };
  }
  return {};
});

// 歌词字号三档（设置 → 通用 / 歌词页顶栏 Aa，localStorage lyrics.fontScale）：
// CSS 变量缩放正文/活跃行/译文全部字号；共享 composable 单例，任一处修改实时联动
const { fontScale, cycleFontScale } = useLyricsFontScale();

const fontScaleLabel = computed(() =>
  fontScale.value === 0.85 ? '紧凑' : fontScale.value === 1.25 ? '特大' : '标准'
);

const rootStyle = computed(() => ({
  ...bgStyle.value,
  '--lyrics-font-scale': String(fontScale.value),
}));

async function fetchLyrics() {
  // 请求序号守卫：快速连续切歌时旧响应不得覆盖新歌状态
  const requestId = ++lyricsRequestId;
  if (!currentSong.value) return;
  loading.value = true;
  lines.value = [];
  activeLine.value = -1;

  try {
    const res = await http.get(`/api/music/lyrics/${currentSong.value.id}`, {
      params: { platform: currentSong.value.platform },
    });
    if (requestId !== lyricsRequestId) return;
    lines.value = res.data.lyrics || [];
  } catch (err) {
    console.warn('Failed to load lyrics:', err);
    if (requestId !== lyricsRequestId) return;
    lines.value = [];
  } finally {
    if (requestId === lyricsRequestId) loading.value = false;
  }
  await positionAfterFetch();
}

function findActiveLine(elapsed: number): number {
  if (lines.value.length === 0) return -1;
  // 找到最后一个 time <= elapsed 的行
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

function scrollToActiveLine(idx: number, behavior: 'smooth' | 'auto' = 'smooth') {
  const el = lineRefs.value[idx];
  const container = scrollContainer.value;
  if (!el || !container) return;

  // 纯原生滚动单轴：跟随与手动滚动共用 scrollTop，天然无漂移、上方始终可回滚
  const target = Math.max(0, el.offsetTop - container.clientHeight / 2 + el.offsetHeight / 2);
  scrollSuppressed = true;
  if (scrollSuppressTimer) clearTimeout(scrollSuppressTimer);
  scrollSuppressTimer = setTimeout(() => {
    scrollSuppressed = false;
  }, behavior === 'auto' ? 80 : 520);
  container.scrollTo({ top: target, behavior });
}

function syncLyrics() {
  if (!store.isPlaying || lines.value.length === 0) return;
  const elapsed = store.liveElapsed();
  const idx = findActiveLine(elapsed);
  // 浏览中仍静默跟踪真实活跃行（恢复时无需重算），仅暂停自动滚动
  if (idx !== activeLine.value && idx >= 0) {
    activeLine.value = idx;
    if (!browsing.value) scrollToActiveLine(idx);
  }
}

let seekInFlight = false;

// 歌词请求序号：旧响应不得覆盖新歌状态（见 fetchLyrics 守卫）
let lyricsRequestId = 0;

async function seekToLine(index: number) {
  resetBrowsing();
  activeLine.value = index;
  scrollToActiveLine(index);
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

// ── 手动浏览与位置指示（自二开版 Lyrics 复刻）────────────────────────
const positionTime = computed(
  () => formatTime(lines.value[browsing.value ? manualLine.value : activeLine.value]?.time ?? 0)
);

/** 边距 = 滚动容器高度一半：首尾行也能滚动到正中（替代固定 32vh 的近似值） */
function updateEdgePadding() {
  const container = scrollContainer.value;
  if (!container) return;
  container.style.setProperty('--lyrics-edge-padding', `${Math.max(0, container.clientHeight / 2)}px`);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/** 进页/切歌后瞬时定位到当前行（对手 E(t,'auto')；避免每次从顶部滑入） */
async function positionAfterFetch() {
  await nextTick();
  await nextFrame();
  await nextFrame();
  updateEdgePadding();
  if (lines.value.length === 0) return;
  const idx = findActiveLine(store.liveElapsed());
  if (idx >= 0) {
    activeLine.value = idx;
    scrollToActiveLine(idx, 'auto');
  }
}

/** 视口中央最近的行（自二开版 ct() 同款：比较行中心与 scrollTop+半高） */
function nearestLineToCenter(): number {
  const container = scrollContainer.value;
  if (!container) return -1;
  const center = container.scrollTop + container.clientHeight / 2;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < lines.value.length; i++) {
    const el = lineRefs.value[i];
    if (!el) continue;
    const mid = el.offsetTop + el.offsetHeight / 2;
    const dist = Math.abs(mid - center);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function onUserScroll() {
  if (scrollSuppressed || lines.value.length === 0) return;
  browsing.value = true;
  manualLine.value = nearestLineToCenter();
  if (browsingTimer) clearTimeout(browsingTimer);
  browsingTimer = setTimeout(resumeFollow, 2000);
}

function resetBrowsing() {
  browsing.value = false;
  manualLine.value = -1;
  if (browsingTimer) {
    clearTimeout(browsingTimer);
    browsingTimer = null;
  }
}

/** 停止滚动 2s 后恢复自动跟随：瞬时间到真实活跃行 */
function resumeFollow() {
  resetBrowsing();
  if (activeLine.value >= 0) scrollToActiveLine(activeLine.value, 'auto');
}

async function seekToPositionLine() {
  const line = lines.value[browsing.value ? manualLine.value : activeLine.value];
  if (!line) return;
  resetBrowsing();
  if (!canTransport.value || seekInFlight) return;
  seekInFlight = true;
  try {
    await store.seek(line.time);
  } finally {
    seekInFlight = false;
  }
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

// 按内容键监听而非对象引用：stateChange 广播会整体替换 bot 对象导致
// currentSong 引用翻转（同一首歌），浅 watch 会误触发重新拉取歌词
watch(() => {
  const song = currentSong.value;
  return song ? `${song.platform}:${song.id}` : null;
}, () => {
  resetBrowsing();
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
  window.addEventListener('resize', updateEdgePadding);
});

onUnmounted(() => {
  stopSync();
  window.removeEventListener('resize', updateEdgePadding);
  if (scrollSuppressTimer) clearTimeout(scrollSuppressTimer);
  resetBrowsing();
});
</script>

<style scoped>
/* 自上游 Lyrics.vue <style lang="scss"> 与 mobile.scss 歌词段转译（SCSS 嵌套展开为平铺） */
.lyrics-page {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
}

.lyrics-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(60px);
  -webkit-backdrop-filter: blur(60px);
}

.back-btn {
  position: absolute;
  top: 24px;
  left: 24px;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: rgba(255, 255, 255, 0.7);
  transition: color var(--transition-fast);
}
.back-btn:hover {
  color: white;
}

.lyrics-content {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 60px;
  max-width: 1000px;
  width: 100%;
  padding: 40px;
  height: 80vh;
}

.lyrics-left {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  flex-shrink: 0;
}

.song-meta {
  text-align: center;
}

.song-name {
  font-size: 20px;
  font-weight: 700;
  color: white;
  margin-bottom: 4px;
}

.song-artist {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.6);
}

.lyrics-right {
  flex: 1;
  overflow: hidden;
  position: relative;
  display: flex;
  flex-direction: column;
}

.lyrics-actions {
  display: flex;
  gap: 8px;
  padding-bottom: 16px;
  flex-shrink: 0;
}

.lyrics-toggle {
  padding: 5px 12px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.65);
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.14);
  cursor: pointer;
  transition: all 0.2s ease;
}
.lyrics-toggle:hover {
  color: white;
  background: rgba(255, 255, 255, 0.12);
}
.lyrics-toggle.on {
  background: rgba(255, 255, 255, 0.92);
  border-color: transparent;
  color: #1a1a1a;
}

/* 舞台容器：滚动区与位置指示层的共同定位父级（自二开版结构复刻） */
.lyrics-stage {
  flex: 1;
  min-height: 0;
  position: relative;
}

.lyrics-scroll {
  /* 边距由 JS 按容器高度一半写入（updateEdgePadding），首尾行可滚到正中。
     mask 只挂滚动区：挂在右栏会把顶部开关按钮一起淡掉 */
  --lyrics-edge-padding: 0px;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  scrollbar-width: none;
  overscroll-behavior: contain;
  mask-image: linear-gradient(transparent 0%, black 15%, black 85%, transparent 100%);
  -webkit-mask-image: linear-gradient(transparent 0%, black 15%, black 85%, transparent 100%);
}
.lyrics-scroll::-webkit-scrollbar {
  display: none;
}

.lyrics-inner {
  min-width: 0;
}

.lyrics-spacer {
  height: var(--lyrics-edge-padding);
}

.lyrics-line {
  position: relative;
  padding: 8px 0;
  cursor: pointer;
}

/* 浏览中视口中央的行：整行提亮并压在分割线之上（z-index 高于指示层的 1），
   保证 dash 穿过时文字清晰；译文同步提亮 */
.lyrics-line.manual-target:not(.active) {
  z-index: 2;
}

.lyrics-line.manual-target:not(.active) .lyrics-text {
  color: rgba(255, 255, 255, 0.9);
}

.lyrics-line.manual-target:not(.active) .lyrics-translation {
  color: rgba(255, 255, 255, 0.55);
}

/* 位置指示层：常驻视口中央。跟随正常时与活跃行重合；浏览时指向最近行 */
.lyrics-position-overlay {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 12px;
  transform: translateY(-50%);
  pointer-events: none;
}

.lyrics-position-dash {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, rgba(255, 255, 255, 0.08), rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.08));
}

.lyrics-position-play {
  height: 30px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  border-radius: 999px;
  color: #fff;
  background: rgba(255, 255, 255, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  pointer-events: auto;
  cursor: pointer;
}
.lyrics-position-play:disabled {
  opacity: 0.45;
  cursor: default;
}

.lyrics-text {
  font-size: calc(18px * var(--lyrics-font-scale, 1));
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.3);
  transition: all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
}

.lyrics-translation {
  font-size: calc(14px * var(--lyrics-font-scale, 1));
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.15);
  margin-top: 2px;
  transition: all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
}

.lyrics-line.active .lyrics-text {
  font-size: calc(22px * var(--lyrics-font-scale, 1));
  font-weight: 600;
  color: white;
}

.lyrics-line.active .lyrics-translation {
  color: rgba(255, 255, 255, 0.5);
}

.lyrics-line:hover:not(.active) .lyrics-text {
  color: rgba(255, 255, 255, 0.78);
}

.lyrics-line:hover:not(.active) .lyrics-translation {
  color: rgba(255, 255, 255, 0.45);
}

.lyrics-loading,
.lyrics-empty {
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  text-align: center;
  padding: 60px 0;
}

.no-song {
  position: relative;
  z-index: 1;
  color: rgba(255, 255, 255, 0.5);
  font-size: 16px;
}

/* ── 移动端（自上游 mobile.scss 歌词段转译）── */
@media (max-width: 768px) {
  .lyrics-page {
    align-items: stretch;
    justify-content: flex-start;
    overflow: hidden;
  }

  /* 移动端有 tabbar + 胶囊切换回歌词，返回按钮冗余，隐藏 */
  .back-btn {
    display: none;
  }

  .lyrics-content {
    flex-direction: column;
    gap: 20px;
    width: 100%;
    height: 100vh;
    padding: calc(56px + env(safe-area-inset-top)) 18px
      calc(var(--tabbar-height) + var(--mini-player-height) + env(safe-area-inset-bottom) + 18px);
  }

  .lyrics-left {
    flex-direction: row;
    justify-content: flex-start;
    gap: 14px;
  }

  .lyrics-left .cover-art {
    width: 76px !important;
    height: 76px !important;
  }

  .lyrics-left .song-meta {
    min-width: 0;
    text-align: left;
  }

  .lyrics-left .song-name,
  .lyrics-left .song-artist {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .lyrics-right {
    flex: 1 1 auto;
    min-height: 0;
  }

  .lyrics-line .lyrics-text {
    font-size: calc(16px * var(--lyrics-font-scale, 1));
  }

  .lyrics-line.active .lyrics-text {
    font-size: calc(20px * var(--lyrics-font-scale, 1));
  }

  .lyrics-line .lyrics-translation {
    font-size: calc(13px * var(--lyrics-font-scale, 1));
  }
}
</style>
