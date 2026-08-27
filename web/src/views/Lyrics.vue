<template>
  <div class="lyrics-page" :style="bgStyle">
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
        <div v-else class="lyrics-scroll" ref="scrollContainer">
          <div class="lyrics-inner" :style="{ transform: `translateY(${scrollOffset}px)`, transition: 'transform 0.6s cubic-bezier(0.25, 0.1, 0.25, 1)' }">
            <div class="lyrics-spacer" />
            <div
              v-for="(line, i) in lines"
              :key="i"
              :ref="el => { if (el) lineRefs[i] = el as HTMLElement }"
              class="lyrics-line"
              :class="{ active: i === activeLine }"
              @click="seekToLine(i)"
            >
              <div class="lyrics-text">{{ line.text }}</div>
              <div v-if="line.translation" class="lyrics-translation">{{ line.translation }}</div>
            </div>
            <div class="lyrics-spacer" />
          </div>
        </div>
      </div>
    </div>

    <div v-else class="no-song">
      当前没有正在播放的歌曲
    </div>
  </div>
</template>

<script setup lang="ts">
// 结构与交互自上游 web/src/views/Lyrics.vue 移植（transform 平滑滚动 + 500ms 同步），
// 两处本地适配：①同步源用 liveElapsed()（#107，上游同款修法）；②点击歌词行在
// 有 transport 权限时执行真实 seek（上游后端不支持 seek，只做高亮）。
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
const scrollOffset = ref(0);
let syncTimer: ReturnType<typeof setInterval> | null = null;

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

function scrollToActiveLine(idx: number) {
  const el = lineRefs.value[idx];
  const container = scrollContainer.value;
  if (!el || !container) return;

  // 用 transform 定位实现无卡顿平滑滚动
  const containerHeight = container.clientHeight;
  const lineTop = el.offsetTop;
  const lineHeight = el.offsetHeight;
  const targetOffset = -(lineTop - containerHeight / 2 + lineHeight / 2);
  scrollOffset.value = targetOffset;
}

function syncLyrics() {
  if (!store.isPlaying || lines.value.length === 0) return;
  const elapsed = store.liveElapsed();
  const idx = findActiveLine(elapsed);
  // 仅在活跃行真正变化时更新
  if (idx !== activeLine.value && idx >= 0) {
    activeLine.value = idx;
    scrollToActiveLine(idx);
  }
}

let seekInFlight = false;

async function seekToLine(index: number) {
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
});

onUnmounted(() => {
  stopSync();
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
  mask-image: linear-gradient(transparent 0%, black 15%, black 85%, transparent 100%);
  -webkit-mask-image: linear-gradient(transparent 0%, black 15%, black 85%, transparent 100%);
}

.lyrics-scroll {
  height: 100%;
  overflow: hidden;
  position: relative;
}

.lyrics-inner {
  will-change: transform;
}

/* 上游为 height: 40%，但父容器高度 auto 时百分比塌缩为 0（上游隐性 bug）；
   这里给 32vh（≈ 容器 80vh 的四成）实现首尾行可居中的设计意图 */
.lyrics-spacer {
  height: 32vh;
}

.lyrics-line {
  padding: 8px 0;
  cursor: pointer;
}

.lyrics-text {
  font-size: 18px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.3);
  transition: all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
}

.lyrics-translation {
  font-size: 14px;
  line-height: 1.4;
  color: rgba(255, 255, 255, 0.15);
  margin-top: 2px;
  transition: all 0.4s cubic-bezier(0.25, 0.1, 0.25, 1);
}

.lyrics-line.active .lyrics-text {
  font-size: 22px;
  font-weight: 600;
  color: white;
}

.lyrics-line.active .lyrics-translation {
  color: rgba(255, 255, 255, 0.5);
}

.lyrics-line:hover:not(.active) .lyrics-text {
  color: rgba(255, 255, 255, 0.5);
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

  .back-btn {
    top: calc(12px + env(safe-area-inset-top));
    left: 14px;
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
    font-size: 16px;
  }

  .lyrics-line.active .lyrics-text {
    font-size: 20px;
  }

  .lyrics-line .lyrics-translation {
    font-size: 13px;
  }
}
</style>
