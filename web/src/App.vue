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
import { useRoute } from 'vue-router';
import { usePlayerStore } from './stores/player.js';
import { useAuthStore } from './stores/auth';
import { useWebSocket } from './composables/useWebSocket.js';
import Navbar from './components/Navbar.vue';
import Player from './components/Player.vue';
import ToastContainer from './components/common/ToastContainer.vue';

const route = useRoute();
const playerStore = usePlayerStore();
const authStore = useAuthStore();
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

onMounted(() => {
  authStore.checkAuthEnabled().catch((err) => console.warn('checkAuthEnabled failed:', err));
  playerStore.loadTheme();
  connect();
  playerStore.fetchBots();
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
