<template>
  <div class="app">
    <Navbar v-if="!route.meta.hideNavbar" />
    <ConnectionBanner :state="connectionState" @reconnect="reconnect" />
    <main class="main-content">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <Player />
    <!-- 移动端（md 以下）：胶囊迷你播放器悬浮于底部导航之上 -->
    <MiniPlayer />
    <MobileTabBar />
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlayerStore } from './stores/player.js';
import { useAuthStore } from './stores/auth';
import { useFavoritesStore } from './stores/favorites';
import { useWebSocket } from './composables/useWebSocket.js';
import { useToast } from './composables/useToast';
import Navbar from './components/Navbar.vue';
import Player from './components/Player.vue';
import MiniPlayer from './components/MiniPlayer.vue';
import MobileTabBar from './components/MobileTabBar.vue';
import ConnectionBanner from './components/ConnectionBanner.vue';
import ToastContainer from './components/common/ToastContainer.vue';

const route = useRoute();
const router = useRouter();
const playerStore = usePlayerStore();
const authStore = useAuthStore();
const favoritesStore = useFavoritesStore();
const toast = useToast();
const theme = computed(() => playerStore.theme);
const { connect, disconnect, connectionState } = useWebSocket();

// 手动重连：disconnect 会清零重试计数（自动重连 10 次失败后不再重试），再重新建连
function reconnect() {
  disconnect();
  connect();
}

watch(theme, (t) => {
  document.documentElement.setAttribute('data-theme', t);
  // 手机状态栏/PWA 标题栏颜色跟随主题（index.html 里的静态值只是初始深色）
  document.querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', t === 'dark' ? '#222222' : '#ffffff');
}, { immediate: true });

let syncTimer: ReturnType<typeof setInterval> | null = null;
let pausedTicks = 0;

function startSyncTimer() {
  if (syncTimer) return;
  syncTimer = setInterval(() => {
    const bot = playerStore.activeBot;
    // 没有选中 bot 或空闲（无当前曲目）→ 无可同步的进度，跳过本次请求
    if (!bot || !bot.currentSong) return;
    if (!bot.playing) {
      // 暂停态进度静止，轮询只为自愈错过的 WS 状态事件——降到 ~15s 一次
      pausedTicks = (pausedTicks + 1) % 5;
      if (pausedTicks !== 0) return;
    } else {
      pausedTicks = 0;
    }
    playerStore.syncElapsed();
  }, 3000);
}

function stopSyncTimer() {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}

function onVisibilityChange() {
  if (document.hidden) {
    stopSyncTimer();
  } else {
    startSyncTimer();
  }
}

onMounted(async () => {
  authStore.init().catch((err) => console.warn('auth init failed:', err));
  playerStore.loadTheme();
  connect();
  // 先拿到 bot 列表再校验 ?bot= 专属锁定（路由守卫只是先记录，这里才决定锁不锁）
  await playerStore.fetchBots();
  const routeBot = route.query.bot;
  playerStore.applyScopeFromQuery(typeof routeBot === 'string' ? routeBot : null);
  // 非游客预取歌曲收藏（全站红心即时可用，不必先进收藏页）与歌单收藏/功能开关
  if (!authStore.isGuest) {
    favoritesStore.fetchFavorites();
    playerStore.fetchFavoritedPlaylists();
    playerStore.fetchBotSettings();
    playerStore.fetchAuthStatus();
  }
  // 音源启用状态（首页 FM/推荐多源显隐等）
  playerStore.fetchEnabledProviders();
  // Spotify OAuth 回跳结果（/?spotify=success|error）：提示并清掉查询参数
  const spotifyResult = route.query.spotify;
  if (spotifyResult === 'success' || spotifyResult === 'error') {
    if (spotifyResult === 'success') {
      toast.success('Spotify 授权成功');
    } else {
      toast.error('Spotify 授权失败，请重试');
    }
    router.replace({ query: { ...route.query, spotify: undefined } });
  }
  startSyncTimer();
  document.addEventListener('visibilitychange', onVisibilityChange);
});

onUnmounted(() => {
  stopSyncTimer();
  document.removeEventListener('visibilitychange', onVisibilityChange);
});
</script>

<style>
.app {
  min-height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.main-content {
  padding: 80px 10vw 80px;
}

@media (max-width: 1336px) {
  .main-content {
    padding: 80px 5vw 80px;
  }
}

/* 移动端：导航交给底部 TabBar，底部预留 TabBar + 胶囊高度 + 安全区 */
@media (max-width: 767px) {
  .main-content {
    padding: calc(var(--navbar-height) + 12px) 18px
      calc(var(--tabbar-height) + var(--mini-player-height) + env(safe-area-inset-bottom) + 18px);
  }
}
</style>
