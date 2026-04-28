<template>
  <div class="app" :data-theme="theme">
    <Navbar />
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
import { computed, onMounted, onUnmounted } from 'vue';
import { usePlayerStore } from './stores/player.js';
import { useWebSocket } from './composables/useWebSocket.js';
import Navbar from './components/Navbar.vue';
import Player from './components/Player.vue';
import ToastContainer from './components/common/ToastContainer.vue';

const playerStore = usePlayerStore();
const theme = computed(() => playerStore.theme);
const { connect } = useWebSocket();

let syncTimer: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  playerStore.loadTheme();
  connect();
  playerStore.fetchBots();
  syncTimer = setInterval(() => playerStore.syncElapsed(), 3000);
});

onUnmounted(() => {
  if (syncTimer) clearInterval(syncTimer);
});
</script>

<style lang="scss">
.app {
  min-height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.main-content {
  padding: 80px 10vw 80px;

  @media (max-width: 1336px) {
    padding: 80px 5vw 80px;
  }
}
</style>
