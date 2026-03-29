# TSMusicBot Phase 7: WebUI Frontend (Vue.js SPA)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Vue.js SPA frontend with YesPlayMusic-inspired design. Covers all 6 pages (Home, Search, Playlist, Lyrics, History, Settings), the player bar, navbar, and WebSocket real-time updates.

**Architecture:** Vue 3 + Vite SPA in `web/`. Pinia stores manage player state and WebSocket connection. SCSS variables handle theming (dark/light). The frontend communicates with the backend via REST API (`/api/*`) and WebSocket (`/ws`).

**Tech Stack:** Vue 3, Vite 5, Pinia, Vue Router 4, SCSS, axios, node-vibrant, Iconify

---

### Task 1: Scaffold Vue.js project

**Files:**
- Create: `web/package.json`
- Create: `web/vite.config.ts`
- Create: `web/index.html`
- Create: `web/src/main.ts`
- Create: `web/src/App.vue`
- Create: `web/tsconfig.json`

- [ ] **Step 1: Create Vue project in web/ directory**

```bash
cd "C:/Users/saopig1/Music/teamspeak music bot"
mkdir -p web
cd web
npm init -y
npm install vue vue-router@4 pinia axios node-vibrant @iconify/vue
npm install -D vite @vitejs/plugin-vue typescript sass vue-tsc
```

- [ ] **Step 2: Create web/vite.config.ts**

```typescript
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
```

- [ ] **Step 3: Create web/tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "jsx": "preserve",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"]
    },
    "baseUrl": "."
  },
  "include": ["src/**/*.ts", "src/**/*.vue"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 4: Create web/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TSMusicBot</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;600;700;800&display=swap" rel="stylesheet">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 5: Create web/src/main.ts**

```typescript
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router/index.js';
import './styles/global.scss';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
```

- [ ] **Step 6: Create web/src/App.vue**

```vue
<template>
  <div class="app" :data-theme="theme">
    <Navbar />
    <main class="main-content">
      <RouterView />
    </main>
    <Player />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { usePlayerStore } from './stores/player.js';
import Navbar from './components/Navbar.vue';
import Player from './components/Player.vue';

const playerStore = usePlayerStore();
const theme = computed(() => playerStore.theme);
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
```

- [ ] **Step 7: Commit**

```bash
cd "C:/Users/saopig1/Music/teamspeak music bot"
git add web/
git commit -m "feat: scaffold Vue.js frontend project with Vite, Pinia, and Vue Router"
```

---

### Task 2: Global styles and theming

**Files:**
- Create: `web/src/styles/variables.scss`
- Create: `web/src/styles/global.scss`

- [ ] **Step 1: Create variables.scss**

```scss
// YesPlayMusic-inspired design tokens

:root {
  // Fonts
  --font-primary: 'Barlow', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;

  // Spacing
  --navbar-height: 56px;
  --player-height: 56px;

  // Radius
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;

  // Transitions
  --transition-fast: 0.2s ease;
  --transition-normal: 0.3s ease;

  // Accent
  --color-primary: #335eea;
  --color-primary-bg: #eaeffd;
}

[data-theme='dark'] {
  --bg-primary: #222222;
  --bg-secondary: #323232;
  --bg-card: rgba(255, 255, 255, 0.04);
  --bg-navbar: rgba(34, 34, 34, 0.86);
  --text-primary: #ffffff;
  --text-secondary: rgba(255, 255, 255, 0.58);
  --text-tertiary: rgba(255, 255, 255, 0.38);
  --border-color: rgba(255, 255, 255, 0.06);
  --hover-bg: rgba(255, 255, 255, 0.08);
}

[data-theme='light'] {
  --bg-primary: #ffffff;
  --bg-secondary: #f5f5f7;
  --bg-card: rgba(0, 0, 0, 0.02);
  --bg-navbar: rgba(255, 255, 255, 0.86);
  --text-primary: #000000;
  --text-secondary: rgba(0, 0, 0, 0.58);
  --text-tertiary: rgba(0, 0, 0, 0.38);
  --border-color: rgba(0, 0, 0, 0.06);
  --hover-bg: rgba(0, 0, 0, 0.04);
}
```

- [ ] **Step 2: Create global.scss**

```scss
@use 'variables';

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  font-size: 16px;
}

body {
  font-family: var(--font-primary);
  background: var(--bg-primary);
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

a {
  text-decoration: none;
  color: inherit;
}

button {
  border: none;
  background: none;
  cursor: pointer;
  font-family: inherit;
  color: inherit;
}

// Scrollbar
::-webkit-scrollbar {
  width: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--text-tertiary);
  border-radius: 4px;
}

// Shared utility classes
.frosted-glass {
  background: var(--bg-navbar);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
}

.hover-scale {
  transition: transform var(--transition-fast);

  &:hover {
    transform: scale(1.04);
  }

  &:active {
    transform: scale(0.96);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/styles/
git commit -m "feat: add YesPlayMusic-inspired SCSS theme with dark/light mode"
```

---

### Task 3: Pinia stores (player + WebSocket)

**Files:**
- Create: `web/src/stores/player.ts`
- Create: `web/src/composables/useWebSocket.ts`

- [ ] **Step 1: Create player store**

Create `web/src/stores/player.ts`:

```typescript
import { defineStore } from 'pinia';
import axios from 'axios';

export interface Song {
  id: string;
  name: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  platform: 'netease' | 'qq';
}

export interface BotStatus {
  id: string;
  name: string;
  connected: boolean;
  playing: boolean;
  paused: boolean;
  currentSong: Song | null;
  queueSize: number;
  volume: number;
  playMode: string;
}

export const usePlayerStore = defineStore('player', {
  state: () => ({
    bots: [] as BotStatus[],
    activeBotId: null as string | null,
    queue: [] as Song[],
    theme: 'dark' as 'dark' | 'light',
  }),

  getters: {
    activeBot(): BotStatus | null {
      return this.bots.find((b) => b.id === this.activeBotId) ?? this.bots[0] ?? null;
    },
    currentSong(): Song | null {
      return this.activeBot?.currentSong ?? null;
    },
    isPlaying(): boolean {
      return this.activeBot?.playing ?? false;
    },
    isPaused(): boolean {
      return this.activeBot?.paused ?? false;
    },
  },

  actions: {
    setActiveBotId(id: string) {
      this.activeBotId = id;
    },

    updateBotStatus(botId: string, status: BotStatus) {
      const index = this.bots.findIndex((b) => b.id === botId);
      if (index >= 0) {
        this.bots[index] = status;
      } else {
        this.bots.push(status);
      }
    },

    removeBotStatus(botId: string) {
      this.bots = this.bots.filter((b) => b.id !== botId);
    },

    setQueue(queue: Song[]) {
      this.queue = queue;
    },

    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', this.theme);
    },

    loadTheme() {
      const saved = localStorage.getItem('theme') as 'dark' | 'light' | null;
      if (saved) this.theme = saved;
    },

    async fetchBots() {
      const res = await axios.get('/api/bot');
      this.bots = res.data.bots;
      if (!this.activeBotId && this.bots.length > 0) {
        this.activeBotId = this.bots[0].id;
      }
    },

    async play(query: string, platform = 'netease') {
      if (!this.activeBotId) return;
      await axios.post(`/api/player/${this.activeBotId}/play`, { query, platform });
    },

    async addToQueue(query: string, platform = 'netease') {
      if (!this.activeBotId) return;
      await axios.post(`/api/player/${this.activeBotId}/add`, { query, platform });
    },

    async pause() {
      if (!this.activeBotId) return;
      await axios.post(`/api/player/${this.activeBotId}/pause`);
    },

    async resume() {
      if (!this.activeBotId) return;
      await axios.post(`/api/player/${this.activeBotId}/resume`);
    },

    async next() {
      if (!this.activeBotId) return;
      await axios.post(`/api/player/${this.activeBotId}/next`);
    },

    async prev() {
      if (!this.activeBotId) return;
      await axios.post(`/api/player/${this.activeBotId}/prev`);
    },

    async stop() {
      if (!this.activeBotId) return;
      await axios.post(`/api/player/${this.activeBotId}/stop`);
    },

    async setVolume(volume: number) {
      if (!this.activeBotId) return;
      await axios.post(`/api/player/${this.activeBotId}/volume`, { volume });
    },

    async setMode(mode: string) {
      if (!this.activeBotId) return;
      await axios.post(`/api/player/${this.activeBotId}/mode`, { mode });
    },
  },
});
```

- [ ] **Step 2: Create WebSocket composable**

Create `web/src/composables/useWebSocket.ts`:

```typescript
import { ref, onUnmounted } from 'vue';
import { usePlayerStore } from '../stores/player.js';

export function useWebSocket() {
  const connected = ref(false);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const url = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(url);

    ws.onopen = () => {
      connected.value = true;
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      const store = usePlayerStore();

      switch (data.type) {
        case 'init':
          for (const bot of data.bots) {
            store.updateBotStatus(bot.id, bot);
          }
          break;
        case 'stateChange':
          store.updateBotStatus(data.botId, data.status);
          if (data.queue) store.setQueue(data.queue);
          break;
        case 'botConnected':
          store.updateBotStatus(data.botId, data.status);
          break;
        case 'botDisconnected':
          store.removeBotStatus(data.botId);
          break;
      }
    };

    ws.onclose = () => {
      connected.value = false;
      // Reconnect after 3 seconds
      reconnectTimer = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function disconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  }

  onUnmounted(disconnect);

  return { connected, connect, disconnect };
}
```

- [ ] **Step 3: Commit**

```bash
git add web/src/stores/ web/src/composables/
git commit -m "feat: add Pinia player store and WebSocket composable"
```

---

### Task 4: Router setup

**Files:**
- Create: `web/src/router/index.ts`

- [ ] **Step 1: Create router**

Create `web/src/router/index.ts`:

```typescript
import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/Home.vue'),
    },
    {
      path: '/search',
      name: 'search',
      component: () => import('../views/Search.vue'),
    },
    {
      path: '/playlist/:id',
      name: 'playlist',
      component: () => import('../views/Playlist.vue'),
    },
    {
      path: '/lyrics',
      name: 'lyrics',
      component: () => import('../views/Lyrics.vue'),
    },
    {
      path: '/history',
      name: 'history',
      component: () => import('../views/History.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/Settings.vue'),
    },
  ],
});

export default router;
```

- [ ] **Step 2: Commit**

```bash
git add web/src/router/
git commit -m "feat: add Vue Router with all page routes"
```

---

### Task 5: Navbar component

**Files:**
- Create: `web/src/components/Navbar.vue`

- [ ] **Step 1: Create Navbar**

Create `web/src/components/Navbar.vue`:

```vue
<template>
  <nav class="navbar frosted-glass">
    <RouterLink to="/" class="logo">TSMusicBot</RouterLink>

    <div class="nav-links">
      <RouterLink to="/" class="nav-link" active-class="active">发现</RouterLink>
      <RouterLink to="/search" class="nav-link" active-class="active">搜索</RouterLink>
      <RouterLink to="/history" class="nav-link" active-class="active">播放历史</RouterLink>
    </div>

    <div class="nav-right">
      <div v-if="activeBot" class="bot-status" :class="{ online: activeBot.connected }">
        {{ activeBot.name }} {{ activeBot.connected ? '在线' : '离线' }}
      </div>
      <RouterLink to="/settings" class="settings-btn">
        <Icon icon="mdi:cog" />
      </RouterLink>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../stores/player.js';

const store = usePlayerStore();
const activeBot = computed(() => store.activeBot);
</script>

<style lang="scss" scoped>
.navbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--navbar-height);
  display: flex;
  align-items: center;
  padding: 0 10vw;
  z-index: 100;
  border-bottom: 1px solid var(--border-color);

  @media (max-width: 1336px) {
    padding: 0 5vw;
  }
}

.logo {
  font-size: 18px;
  font-weight: 700;
  color: var(--color-primary);
  margin-right: 40px;
}

.nav-links {
  display: flex;
  gap: 24px;
}

.nav-link {
  font-size: 14px;
  font-weight: 600;
  opacity: 0.6;
  transition: opacity var(--transition-fast);

  &:hover { opacity: 0.8; }
  &.active { opacity: 1; color: var(--color-primary); }
}

.nav-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 16px;
}

.bot-status {
  padding: 4px 12px;
  background: var(--hover-bg);
  border-radius: var(--radius-sm);
  font-size: 12px;
  opacity: 0.6;

  &.online {
    background: rgba(51, 94, 234, 0.15);
    color: var(--color-primary);
    opacity: 1;
  }
}

.settings-btn {
  font-size: 20px;
  opacity: 0.6;
  transition: opacity var(--transition-fast);
  &:hover { opacity: 1; }
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/Navbar.vue
git commit -m "feat: add frosted-glass Navbar component"
```

---

### Task 6: Player bar component

**Files:**
- Create: `web/src/components/Player.vue`

- [ ] **Step 1: Create Player**

Create `web/src/components/Player.vue`:

```vue
<template>
  <div class="player-bar frosted-glass" v-if="currentSong">
    <div class="player-left">
      <CoverArt :url="currentSong.coverUrl" :size="40" />
      <div class="song-info">
        <div class="song-name">{{ currentSong.name }}</div>
        <div class="song-artist">{{ currentSong.artist }}</div>
      </div>
    </div>

    <div class="player-center">
      <button class="control-btn" @click="store.prev()">
        <Icon icon="mdi:skip-previous" />
      </button>
      <button class="play-btn" @click="togglePlay">
        <Icon :icon="store.isPlaying ? 'mdi:pause' : 'mdi:play'" />
      </button>
      <button class="control-btn" @click="store.next()">
        <Icon icon="mdi:skip-next" />
      </button>
    </div>

    <div class="player-right">
      <Icon icon="mdi:volume-high" class="volume-icon" />
      <input
        type="range"
        min="0"
        max="100"
        :value="activeBot?.volume ?? 75"
        @input="onVolumeChange"
        class="volume-slider"
      />
      <RouterLink to="/lyrics" class="control-btn lyrics-btn">
        <Icon icon="mdi:microphone" />
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../stores/player.js';
import CoverArt from './CoverArt.vue';

const store = usePlayerStore();
const activeBot = computed(() => store.activeBot);
const currentSong = computed(() => store.currentSong);

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
</script>

<style lang="scss" scoped>
.player-bar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: var(--player-height);
  display: flex;
  align-items: center;
  padding: 0 24px;
  z-index: 100;
  border-top: 1px solid var(--border-color);
}

.player-left {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 240px;
}

.song-info {
  min-width: 0;
}

.song-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-artist {
  font-size: 11px;
  color: var(--text-secondary);
}

.player-center {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 20px;
}

.control-btn {
  font-size: 20px;
  opacity: 0.7;
  transition: opacity var(--transition-fast);
  &:hover { opacity: 1; }
}

.play-btn {
  width: 32px;
  height: 32px;
  background: var(--color-primary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  color: white;
  transition: transform var(--transition-fast);
  &:hover { transform: scale(1.08); }
  &:active { transform: scale(0.95); }
}

.player-right {
  width: 240px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.volume-icon {
  font-size: 18px;
  opacity: 0.6;
}

.volume-slider {
  width: 80px;
  height: 3px;
  appearance: none;
  background: var(--border-color);
  border-radius: 2px;
  outline: none;

  &::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    background: var(--color-primary);
    border-radius: 50%;
    cursor: pointer;
  }
}

.lyrics-btn {
  margin-left: 8px;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/Player.vue
git commit -m "feat: add frosted-glass Player bar with playback controls and volume"
```

---

### Task 7: CoverArt component (with colored shadow)

**Files:**
- Create: `web/src/components/CoverArt.vue`

- [ ] **Step 1: Create CoverArt**

Create `web/src/components/CoverArt.vue`:

```vue
<template>
  <div class="cover-art" :style="{ width: size + 'px', height: size + 'px' }">
    <img
      :src="url"
      :alt="alt"
      class="cover-img"
      :style="{ borderRadius: radius + 'px' }"
      @load="onImageLoad"
      crossorigin="anonymous"
    />
    <div
      v-if="showShadow"
      class="cover-shadow"
      :style="{
        backgroundImage: `url(${url})`,
        borderRadius: radius + 'px',
      }"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(defineProps<{
  url: string;
  size?: number;
  radius?: number;
  alt?: string;
  showShadow?: boolean;
}>(), {
  size: 48,
  radius: 8,
  alt: 'Cover',
  showShadow: false,
});

const loaded = ref(false);

function onImageLoad() {
  loaded.value = true;
}
</script>

<style lang="scss" scoped>
.cover-art {
  position: relative;
  flex-shrink: 0;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: relative;
  z-index: 1;
}

.cover-shadow {
  position: absolute;
  top: 12px;
  left: 0;
  width: 100%;
  height: 100%;
  background-size: cover;
  background-position: center;
  filter: blur(16px);
  opacity: 0.6;
  transform: scale(0.92);
  z-index: 0;
  transition: opacity 0.3s ease;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/CoverArt.vue
git commit -m "feat: add CoverArt component with YesPlayMusic-style colored shadow"
```

---

### Task 8: Home page

**Files:**
- Create: `web/src/views/Home.vue`

- [ ] **Step 1: Create Home view**

Create `web/src/views/Home.vue`:

```vue
<template>
  <div class="home">
    <!-- Bot Instance Selector -->
    <div class="bot-selector" v-if="store.bots.length > 1">
      <button
        v-for="bot in store.bots"
        :key="bot.id"
        class="bot-tab"
        :class="{ active: bot.id === store.activeBotId }"
        @click="store.setActiveBotId(bot.id)"
      >
        {{ bot.name }}
      </button>
    </div>

    <!-- Search Bar -->
    <div class="search-bar" @click="$router.push('/search')">
      <Icon icon="mdi:magnify" class="search-icon" />
      <span class="search-placeholder">搜索歌曲、歌单、专辑...</span>
    </div>

    <!-- Now Playing -->
    <section v-if="store.currentSong" class="section">
      <h2 class="section-title">正在播放</h2>
      <div class="now-playing">
        <CoverArt :url="store.currentSong.coverUrl" :size="80" :radius="10" :show-shadow="true" />
        <div class="now-playing-info">
          <div class="now-playing-name">{{ store.currentSong.name }}</div>
          <div class="now-playing-artist">{{ store.currentSong.artist }} · {{ store.currentSong.album }}</div>
        </div>
      </div>
    </section>

    <!-- Recommended Playlists -->
    <section class="section">
      <h2 class="section-title">推荐歌单</h2>
      <div class="playlist-grid">
        <div
          v-for="playlist in playlists"
          :key="playlist.id"
          class="playlist-card hover-scale"
          @click="$router.push(`/playlist/${playlist.id}?platform=${playlist.platform}`)"
        >
          <CoverArt :url="playlist.coverUrl" :size="160" :radius="10" :show-shadow="true" />
          <div class="playlist-name">{{ playlist.name }}</div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Icon } from '@iconify/vue';
import axios from 'axios';
import { usePlayerStore } from '../stores/player.js';
import { useWebSocket } from '../composables/useWebSocket.js';
import CoverArt from '../components/CoverArt.vue';

const store = usePlayerStore();
const { connect } = useWebSocket();

interface Playlist {
  id: string;
  name: string;
  coverUrl: string;
  platform: string;
}

const playlists = ref<Playlist[]>([]);

onMounted(async () => {
  store.loadTheme();
  connect();
  await store.fetchBots();

  try {
    const res = await axios.get('/api/music/recommend/playlists');
    playlists.value = res.data.playlists;
  } catch {
    // Ignore if API not ready
  }
});
</script>

<style lang="scss" scoped>
.bot-selector {
  display: flex;
  gap: 12px;
  margin-bottom: 28px;
}

.bot-tab {
  padding: 8px 20px;
  border-radius: var(--radius-md);
  font-size: 13px;
  font-weight: 600;
  background: var(--hover-bg);
  opacity: 0.6;
  transition: all var(--transition-fast);

  &.active {
    background: var(--color-primary);
    color: white;
    opacity: 1;
  }
}

.search-bar {
  display: flex;
  align-items: center;
  padding: 12px 20px;
  background: var(--bg-card);
  border-radius: var(--radius-md);
  margin-bottom: 32px;
  cursor: pointer;
  transition: background var(--transition-fast);

  &:hover { background: var(--hover-bg); }
}

.search-icon {
  font-size: 20px;
  opacity: 0.4;
  margin-right: 12px;
}

.search-placeholder {
  opacity: 0.3;
  font-size: 14px;
}

.section {
  margin-bottom: 36px;
}

.section-title {
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 16px;
}

.now-playing {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 20px;
  background: var(--bg-card);
  border-radius: var(--radius-lg);
}

.now-playing-name {
  font-size: 17px;
  font-weight: 600;
  margin-bottom: 4px;
}

.now-playing-artist {
  font-size: 13px;
  color: var(--text-secondary);
}

.playlist-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 24px;

  @media (max-width: 1200px) { grid-template-columns: repeat(4, 1fr); }
  @media (max-width: 900px) { grid-template-columns: repeat(3, 1fr); }
}

.playlist-card {
  cursor: pointer;
}

.playlist-name {
  margin-top: 8px;
  font-size: 13px;
  font-weight: 500;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/views/Home.vue
git commit -m "feat: add Home page with bot selector, search bar, now playing, and playlists"
```

---

### Task 9: Search, Playlist, Lyrics, History, Settings pages

**Files:**
- Create: `web/src/views/Search.vue`
- Create: `web/src/views/Playlist.vue`
- Create: `web/src/views/Lyrics.vue`
- Create: `web/src/views/History.vue`
- Create: `web/src/views/Settings.vue`
- Create: `web/src/components/SongCard.vue`
- Create: `web/src/components/Queue.vue`

These pages follow the same patterns established in Task 8. Each page:
- Uses the Pinia store for state
- Calls REST API endpoints for data
- Uses shared components (CoverArt, SongCard)
- Follows the YesPlayMusic design tokens (SCSS variables, frosted glass, hover-scale, etc.)

Due to the size, each view file should be implemented following these specs:

- [ ] **Step 1: Create SongCard component**

Create `web/src/components/SongCard.vue` — a reusable song row with cover, name, artist, duration, and play/add buttons. Used in search results, playlist detail, and queue.

```vue
<template>
  <div class="song-card" :class="{ active }" @dblclick="$emit('play')">
    <div class="song-index">{{ index }}</div>
    <CoverArt :url="song.coverUrl" :size="36" :radius="6" />
    <div class="song-info">
      <div class="song-name">{{ song.name }}</div>
      <div class="song-artist">{{ song.artist }}</div>
    </div>
    <div class="song-album">{{ song.album }}</div>
    <div class="song-duration">{{ formatDuration(song.duration) }}</div>
    <div class="song-actions">
      <button class="action-btn" @click.stop="$emit('play')" title="播放">
        <Icon icon="mdi:play" />
      </button>
      <button class="action-btn" @click.stop="$emit('add')" title="添加到队列">
        <Icon icon="mdi:playlist-plus" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import CoverArt from './CoverArt.vue';

defineProps<{
  song: { id: string; name: string; artist: string; album: string; duration: number; coverUrl: string; platform: string };
  index: number;
  active?: boolean;
}>();

defineEmits<{
  play: [];
  add: [];
}>();

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
</script>

<style lang="scss" scoped>
.song-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  transition: background var(--transition-fast);
  cursor: pointer;

  &:hover {
    background: var(--hover-bg);
    .song-actions { opacity: 1; }
  }

  &.active {
    background: rgba(51, 94, 234, 0.1);
  }
}

.song-index {
  width: 24px;
  text-align: center;
  font-size: 13px;
  color: var(--text-tertiary);
}

.song-info {
  flex: 1;
  min-width: 0;
}

.song-name {
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-artist {
  font-size: 12px;
  color: var(--text-secondary);
}

.song-album {
  width: 160px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.song-duration {
  width: 48px;
  font-size: 12px;
  color: var(--text-tertiary);
  text-align: right;
}

.song-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.action-btn {
  font-size: 18px;
  padding: 4px;
  border-radius: var(--radius-sm);
  opacity: 0.7;
  transition: opacity var(--transition-fast);
  &:hover { opacity: 1; }
}
</style>
```

- [ ] **Step 2: Create Search view**

Create `web/src/views/Search.vue` — search input, platform toggle (netease/qq), results as SongCard list.

- [ ] **Step 3: Create Playlist view**

Create `web/src/views/Playlist.vue` — hero header with cover art, playlist name, play all button, song list.

- [ ] **Step 4: Create Lyrics view**

Create `web/src/views/Lyrics.vue` — full-screen with dynamic blurred album art background, scrolling lyrics with active line highlighting. Uses `node-vibrant` for color extraction.

- [ ] **Step 5: Create History view**

Create `web/src/views/History.vue` — play history list from `/api/player/:botId/history`.

- [ ] **Step 6: Create Settings view**

Create `web/src/views/Settings.vue` — bot instance management (create/delete/start/stop), TS server connection config, music account login (QR code display, SMS form, cookie paste), command prefix, theme toggle.

- [ ] **Step 7: Create Queue component**

Create `web/src/components/Queue.vue` — sidebar queue panel showing current queue with drag-to-reorder and remove buttons.

- [ ] **Step 8: Commit**

```bash
git add web/src/views/ web/src/components/
git commit -m "feat: add all page views (Search, Playlist, Lyrics, History, Settings) and shared components"
```

---

### Task 10: Build and verify

- [ ] **Step 1: Build frontend**

```bash
cd web && npm run build
```

Expected: `web/dist/` is created with `index.html` and JS/CSS assets.

- [ ] **Step 2: Add frontend build script to root package.json**

Add to root `package.json` scripts:

```json
{
  "scripts": {
    "build:web": "cd web && npm run build",
    "build": "tsc && npm run build:web"
  }
}
```

- [ ] **Step 3: Commit**

```bash
cd "C:/Users/saopig1/Music/teamspeak music bot"
git add -A
git commit -m "chore: Phase 7 complete — Vue.js WebUI with YesPlayMusic-inspired design"
```
