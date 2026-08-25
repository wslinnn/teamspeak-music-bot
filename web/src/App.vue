<template>
  <div class="app">
    <Navbar v-if="!route.meta.hideNavbar" />
    <main class="main-content">
      <RouterView v-slot="{ Component }">
        <Transition name="fade" mode="out-in">
          <component :is="Component" />
        </Transition>
      </RouterView>
    </main>
    <Player />
    <ToastContainer />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePlayerStore } from './stores/player.js';
import { useAuthStore } from './stores/auth';
import { useWebSocket } from './composables/useWebSocket.js';
import { useToast } from './composables/useToast';
import Navbar from './components/Navbar.vue';
import Player from './components/Player.vue';
import ToastContainer from './components/common/ToastContainer.vue';

const route = useRoute();
const router = useRouter();
const playerStore = usePlayerStore();
const authStore = useAuthStore();
const toast = useToast();
const theme = computed(() => playerStore.theme);
const { connect } = useWebSocket();

watch(theme, (t) => {
  document.documentElement.setAttribute('data-theme', t);
}, { immediate: true });

let syncTimer: ReturnType<typeof setInterval> | null = null;

function startSyncTimer() {
  if (syncTimer) return;
  syncTimer = setInterval(() => playerStore.syncElapsed(), 3000);
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
  // 非游客预取歌单收藏（搜索/歌单页红心与 Library 页共用）与功能开关（已存清单显隐）
  if (!authStore.isGuest) {
    playerStore.fetchFavoritedPlaylists();
    playerStore.fetchBotSettings();
  }
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
</style>
