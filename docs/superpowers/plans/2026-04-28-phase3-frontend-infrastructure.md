# Phase 3: Frontend Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Tailwind CSS v4, a reusable component library, unified HTTP client, improved WebSocket handling, route transitions, and split monolithic components into focused sub-components.

**Architecture:** Tailwind v4 CSS-first configuration with semantic design tokens mapped from existing CSS variables. Component library built as atomic Vue SFCs with minimal scoped styles. HTTP client extracts axios interceptors from the player store into a dedicated module. WebSocket uses exponential backoff with exposed reactive connection states. Settings and Home views are decomposed into single-responsibility child components.

**Tech Stack:** Vue 3, Tailwind CSS v4, Vite, Axios, Pinia, Vue Router

---

## File Structure

### New Files

| File | Responsibility |
|------|--------------|
| `web/src/styles/index.css` | Tailwind v4 entry: `@import "tailwindcss"`, `@theme` tokens, dark variant |
| `web/src/utils/http.ts` | Dedicated axios instance with JWT request interceptor and 401 response handler |
| `web/src/stores/toast.ts` | Pinia store managing a queue of toast notifications |
| `web/src/composables/useToast.ts` | Convenience composable exposing `toast()` helper |
| `web/src/components/common/BaseButton.vue` | Unified button: primary / secondary / danger / ghost variants, sm/md/lg sizes |
| `web/src/components/common/BaseCard.vue` | Card container with hover shadow transition |
| `web/src/components/common/BaseModal.vue` | Teleported modal with backdrop click-to-close and enter/leave transitions |
| `web/src/components/common/LoadingSpinner.vue` | SVG/CSS spinner, configurable size |
| `web/src/components/common/EmptyState.vue` | Centered empty placeholder with optional icon and message |
| `web/src/components/common/SkeletonLoader.vue` | Pulse-animated placeholder block |
| `web/src/components/common/ToastContainer.vue` | Fixed-position container rendering `Toast.vue` items from store |
| `web/src/components/common/Toast.vue` | Individual toast item with auto-dismiss and type-based styling |
| `web/src/components/common/index.ts` | Re-export barrel for all common components |
| `web/src/components/settings/SettingsLayout.vue` | Tab layout container with responsive vertical/horizontal nav |
| `web/src/components/settings/SettingsGeneral.vue` | Theme, audio quality, command prefix, idle timeout |
| `web/src/components/settings/SettingsBots.vue` | Bot list, edit modal inline, create form |
| `web/src/components/settings/SettingsPlatforms.vue` | NetEase / QQ / BiliBili QR & cookie login |
| `web/src/components/settings/SettingsTheme.vue` | Theme toggle (extracted from general for design-doc alignment) |
| `web/src/components/home/NowPlaying.vue` | Current song display with cover art |
| `web/src/components/home/QuickActions.vue` | Search bar + FM card |
| `web/src/components/home/RecentHistory.vue` | Daily songs, playlists, BiliBili popular grids |

### Modified Files

| File | Changes |
|------|---------|
| `web/package.json` | Add `tailwindcss`, `@tailwindcss/vite`, `vitest`, `@vue/test-utils` |
| `web/vite.config.ts` | Add `tailwindcss()` Vite plugin |
| `web/src/main.ts` | Import `./styles/index.css` instead of `./styles/global.scss` |
| `web/src/App.vue` | Wrap `<RouterView>` in `<Transition name="fade">`; mount `<ToastContainer>` |
| `web/src/composables/useWebSocket.ts` | Exponential backoff reconnect; expose `connectionState`; validate message types |
| `web/src/stores/player.ts` | Replace global `axios` imports with `http` instance; remove inline interceptors |
| `web/src/views/Login.vue` | Rewrite styles with Tailwind; use `<BaseButton>` |
| `web/src/views/Home.vue` | Delegate sections to `NowPlaying`, `QuickActions`, `RecentHistory` |
| `web/src/views/Settings.vue` | Delegate sections to `SettingsLayout` tabs |
| `web/src/views/Search.vue` | Use `<EmptyState>` and `<SkeletonLoader>`; rewrite styles with Tailwind |
| `web/src/views/NotFound.vue` | Rewrite styles with Tailwind |

---

## Prerequisite Check

Before starting, confirm:

```bash
cd web && npm run dev
```

The dev server starts without errors. If it fails, fix build errors before proceeding.

---

## Task 1: Tailwind CSS v4 Installation & Configuration

**Files:**
- Modify: `web/package.json`
- Modify: `web/vite.config.ts`
- Create: `web/src/styles/index.css`
- Modify: `web/src/main.ts`
- Modify: `web/src/styles/global.scss` (trim to Tailwind-compatible reset only)

- [ ] **Step 1: Install Tailwind CSS v4 and Vite plugin**

```bash
cd web && npm install tailwindcss @tailwindcss/vite
```

Expected: Both packages install without peer dependency errors.

- [ ] **Step 2: Add Vite plugin to `vite.config.ts`**

Replace the contents of `web/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
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

- [ ] **Step 3: Create Tailwind CSS entry `web/src/styles/index.css`**

```css
@import "tailwindcss";

/* ── Theme tokens (migrated from variables.scss) ── */
@theme {
  /* Colors */
  --color-primary: #335eea;
  --color-primary-bg: #eaeffd;
  --color-success: #22c55e;
  --color-warning: #eab308;
  --color-danger: #ef4444;

  /* Surfaces (bound to existing CSS variables for dark/light toggle compatibility) */
  --color-surface: var(--bg-primary);
  --color-surface-elevated: var(--bg-secondary);
  --color-surface-card: var(--bg-card);
  --color-surface-navbar: var(--bg-navbar);

  /* Foreground */
  --color-foreground: var(--text-primary);
  --color-foreground-muted: var(--text-secondary);
  --color-foreground-subtle: var(--text-tertiary);

  /* Border & interactive */
  --color-border-default: var(--border-color);
  --color-interactive-hover: var(--hover-bg);

  /* Font */
  --font-family-sans: 'Barlow', -apple-system, 'PingFang SC', 'Microsoft YaHei', sans-serif;

  /* Radius */
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --radius-xl: 20px;

  /* Animation */
  --transition-fast: 0.2s ease;
  --transition-normal: 0.3s ease;
}

/* Dark mode variant driven by [data-theme="dark"] */
@variant dark (&:where([data-theme="dark"] *));

/* ── Global reset (from global.scss) ── */
@layer base {
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  html {
    font-size: 16px;
  }

  body {
    font-family: var(--font-family-sans);
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

  /* Scrollbar */
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
}

/* ── Utility classes previously in global.scss ── */
@layer utilities {
  .frosted-glass {
    background: var(--bg-navbar);
    backdrop-filter: saturate(180%) blur(20px);
    -webkit-backdrop-filter: saturate(180%) blur(20px);
  }

  .hover-scale {
    transition: transform var(--transition-fast);
  }
  .hover-scale:hover {
    transform: scale(1.04);
  }
  .hover-scale:active {
    transform: scale(0.96);
  }
}

/* ── Route transition ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 150ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
```

- [ ] **Step 4: Update `web/src/main.ts` to import new CSS**

Replace the contents:

```ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router/index.js';
import './styles/index.css';

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.mount('#app');
```

- [ ] **Step 5: Trim `web/src/styles/global.scss` to avoid double-loading**

Replace the contents of `web/src/styles/global.scss` with only the SCSS variables file reference so legacy components still compile during migration:

```scss
@use 'variables';
```

- [ ] **Step 6: Verify dev server still starts**

```bash
cd web && npm run dev
```

Expected: Vite starts without errors. Open `http://localhost:5173` and confirm the page still renders (styles may look slightly different until components are migrated).

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/vite.config.ts web/src/styles/index.css web/src/styles/global.scss web/src/main.ts
git commit -m "feat(frontend): install and configure Tailwind CSS v4"
```

---

## Task 2: Toast Notification System

**Files:**
- Create: `web/src/stores/toast.ts`
- Create: `web/src/composables/useToast.ts`
- Create: `web/src/components/common/Toast.vue`
- Create: `web/src/components/common/ToastContainer.vue`
- Modify: `web/src/App.vue`

- [ ] **Step 1: Create toast Pinia store `web/src/stores/toast.ts`**

```ts
import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

let idCounter = 0;

export const useToastStore = defineStore('toast', () => {
  const items = ref<ToastItem[]>([]);

  function add(message: string, type: ToastType = 'info', duration = 3000) {
    const id = `${Date.now()}-${++idCounter}`;
    items.value.push({ id, message, type, duration });
  }

  function remove(id: string) {
    items.value = items.value.filter((t) => t.id !== id);
  }

  return { items, add, remove };
});
```

- [ ] **Step 2: Create `web/src/composables/useToast.ts`**

```ts
import { useToastStore, type ToastType } from '../stores/toast.js';

export function useToast() {
  const store = useToastStore();

  return {
    success: (message: string, duration?: number) => store.add(message, 'success', duration),
    error: (message: string, duration?: number) => store.add(message, 'error', duration),
    warning: (message: string, duration?: number) => store.add(message, 'warning', duration),
    info: (message: string, duration?: number) => store.add(message, 'info', duration),
  };
}
```

- [ ] **Step 3: Create `web/src/components/common/Toast.vue`**

```vue
<template>
  <div
    class="flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium shadow-lg"
    :class="typeClasses"
    role="alert"
  >
    <Icon :icon="iconName" class="text-lg" />
    <span>{{ item.message }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import type { ToastItem } from '../../stores/toast.js';

const props = defineProps<{ item: ToastItem }>();

const iconName = computed(() => {
  switch (props.item.type) {
    case 'success': return 'mdi:check-circle';
    case 'error': return 'mdi:alert-circle';
    case 'warning': return 'mdi:alert';
    default: return 'mdi:information';
  }
});

const typeClasses = computed(() => {
  switch (props.item.type) {
    case 'success': return 'bg-green-500/15 text-green-500 border border-green-500/20';
    case 'error': return 'bg-red-500/15 text-red-500 border border-red-500/20';
    case 'warning': return 'bg-yellow-500/15 text-yellow-500 border border-yellow-500/20';
    default: return 'bg-blue-500/15 text-blue-500 border border-blue-500/20';
  }
});
</script>
```

- [ ] **Step 4: Create `web/src/components/common/ToastContainer.vue`**

```vue
<template>
  <Teleport to="body">
    <TransitionGroup
      tag="div"
      name="toast"
      class="fixed top-4 right-4 z-[9999] flex flex-col gap-2"
    >
      <Toast
        v-for="item in store.items"
        :key="item.id"
        :item="item"
        @vnode-mounted="scheduleRemove(item)"
      />
    </TransitionGroup>
  </Teleport>
</template>

<script setup lang="ts">
import { useToastStore } from '../../stores/toast.js';
import Toast from './Toast.vue';

const store = useToastStore();

function scheduleRemove(item: { id: string; duration: number }) {
  setTimeout(() => store.remove(item.id), item.duration);
}
</script>

<style>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.25s ease;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(20px);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(20px);
}
</style>
```

- [ ] **Step 5: Mount ToastContainer in `web/src/App.vue`**

Replace the `<template>` and `<script setup>` of `web/src/App.vue`:

```vue
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
```

- [ ] **Step 6: Verify toast renders**

Temporarily add a test toast to any mounted component (e.g., `Home.vue`):

```ts
import { useToast } from '../composables/useToast.js';
const toast = useToast();
onMounted(() => {
  toast.info('Toast system online');
});
```

Load the page. A blue toast should appear in the top-right corner and auto-dismiss after 3 seconds. Remove the test code after verification.

- [ ] **Step 7: Commit**

```bash
git add web/src/stores/toast.ts web/src/composables/useToast.ts web/src/components/common/Toast.vue web/src/components/common/ToastContainer.vue web/src/App.vue
git commit -m "feat(frontend): add toast notification system"
```

---

## Task 3: Unified HTTP Client

**Files:**
- Create: `web/src/utils/http.ts`
- Modify: `web/src/stores/player.ts`
- Modify: `web/src/stores/auth.ts`

- [ ] **Step 1: Create `web/src/utils/http.ts`**

```ts
import axios from 'axios';
import { useAuthStore } from '../stores/auth.js';
import { useToastStore } from '../stores/toast.js';

export const http = axios.create({
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

http.interceptors.request.use((config) => {
  const authStore = useAuthStore();
  const token = authStore.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const authStore = useAuthStore();
      authStore.logout();
      window.location.href = '/login';
      return Promise.reject(error);
    }

    const toastStore = useToastStore();
    const message = error.response?.data?.error ?? error.message ?? '请求失败';
    toastStore.add(message, 'error', 4000);

    return Promise.reject(error);
  }
);
```

- [ ] **Step 2: Migrate `web/src/stores/player.ts` from global `axios` to `http`**

At the top of `web/src/stores/player.ts`, replace:

```ts
import axios from 'axios';
import { useAuthStore } from './auth.js';
import router from '../router/index.js';

// Request interceptor: attach JWT token to all API requests
axios.interceptors.request.use((config) => {
  const authStore = useAuthStore();
  const token = authStore.getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor: on 401, clear token and redirect to login
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      const authStore = useAuthStore();
      authStore.logout();
      router.push({ name: 'login' });
    }
    return Promise.reject(error);
  },
);
```

With:

```ts
import { http } from '../utils/http.js';
```

Then replace every remaining `axios.` call inside `player.ts` with `http.` (there are roughly 30 occurrences). Use a global search-replace scoped to this file:

```
axios.get → http.get
axios.post → http.post
axios.put → http.put
axios.delete → http.delete
```

Do **not** replace `axios` inside comments unless it refers to the imported instance.

- [ ] **Step 3: Migrate `web/src/stores/auth.ts`**

Replace the top import:

```ts
import axios from 'axios';
```

With:

```ts
import { http } from '../utils/http.js';
```

Then replace the three `axios.` calls inside this file (`axios.get`, `axios.post`) with `http.`.

- [ ] **Step 4: Verify no global axios interceptors remain in stores**

Run a grep to confirm no `axios.interceptors` strings remain in `web/src/stores/`:

```bash
cd web && grep -rn "axios\.interceptors" src/stores/
```

Expected: No output.

- [ ] **Step 5: Verify dev server compiles**

```bash
cd web && npm run build
```

Expected: `vue-tsc --noEmit` and `vite build` both succeed.

- [ ] **Step 6: Commit**

```bash
git add web/src/utils/http.ts web/src/stores/player.ts web/src/stores/auth.ts
git commit -m "refactor(frontend): extract unified HTTP client with toast error handling"
```

---

## Task 4: WebSocket Improvements

**Files:**
- Modify: `web/src/composables/useWebSocket.ts`

- [ ] **Step 1: Rewrite `web/src/composables/useWebSocket.ts`**

Replace the entire file:

```ts
import { ref, onUnmounted } from 'vue';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth.js';
import { useToast } from './useToast.js';

export type ConnectionState = 'connected' | 'reconnecting' | 'disconnected';

interface WsMessage {
  type: string;
  [key: string]: unknown;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const MAX_RETRIES = 10;

function isValidMessage(data: unknown): data is WsMessage {
  return typeof data === 'object' && data !== null && 'type' in data && typeof (data as WsMessage).type === 'string';
}

function getReconnectDelay(retryCount: number): number {
  const jitter = Math.random() * 500;
  const delay = RECONNECT_BASE_MS * Math.pow(2, retryCount) + jitter;
  return Math.min(delay, RECONNECT_MAX_MS);
}

export function useWebSocket() {
  const connected = ref(false);
  const connectionState = ref<ConnectionState>('disconnected');
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let retryCount = 0;
  const toast = useToast();

  function connect() {
    if (ws?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${protocol}//${window.location.host}/ws`;

    const authStore = useAuthStore();
    const token = authStore.getToken();
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }

    connectionState.value = 'reconnecting';
    ws = new WebSocket(url);

    ws.onopen = () => {
      connected.value = true;
      connectionState.value = 'connected';
      retryCount = 0;
      console.log('WebSocket connected');
    };

    ws.onmessage = (event) => {
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        console.warn('WebSocket received invalid JSON');
        return;
      }

      if (!isValidMessage(data)) {
        console.warn('WebSocket received message without type field', data);
        return;
      }

      const store = usePlayerStore();

      switch (data.type) {
        case 'init':
          if (Array.isArray(data.bots)) {
            for (const bot of data.bots) {
              if (bot && typeof bot.id === 'string') {
                store.updateBotStatus(bot.id, bot as any);
              }
            }
          }
          break;
        case 'stateChange':
          if (typeof data.botId === 'string') {
            store.updateBotStatus(data.botId, data.status as any);
            if (Array.isArray(data.queue)) {
              store.setQueue(data.botId, data.queue as any);
            } else {
              store.fetchQueueForBot(data.botId);
            }
          }
          break;
        case 'botConnected':
          if (typeof data.botId === 'string') {
            store.updateBotStatus(data.botId, data.status as any);
          }
          break;
        case 'botDisconnected':
          if (typeof data.botId === 'string') {
            if (data.status) {
              store.updateBotStatus(data.botId, data.status as any);
            } else {
              const existing = store.bots.find((b) => b.id === data.botId);
              if (existing) {
                store.updateBotStatus(data.botId as string, {
                  ...existing,
                  connected: false,
                  playing: false,
                  paused: false,
                  currentSong: null,
                });
              }
            }
          }
          break;
        case 'botRemoved':
          if (typeof data.botId === 'string') {
            store.removeBotStatus(data.botId);
            if (store.activeBotId === data.botId) {
              store.activeBotId = store.bots[0]?.id ?? null;
            }
          }
          break;
        default:
          console.warn('Unknown WebSocket message type:', data.type);
      }
    };

    ws.onclose = (event) => {
      connected.value = false;

      // Auth failure — stop reconnecting
      if (event.code === 4001) {
        connectionState.value = 'disconnected';
        console.warn('WebSocket auth failed, stopping reconnection');
        toast.error('WebSocket 认证失败，请重新登录');
        return;
      }

      // Normal close (e.g., page unload) — don't reconnect
      if (event.wasClean && event.code === 1000) {
        connectionState.value = 'disconnected';
        return;
      }

      if (retryCount >= MAX_RETRIES) {
        connectionState.value = 'disconnected';
        toast.error('WebSocket 连接失败，已达最大重试次数');
        return;
      }

      const delay = getReconnectDelay(retryCount);
      retryCount++;
      console.log(`WebSocket reconnecting in ${Math.round(delay)}ms (attempt ${retryCount})`);
      connectionState.value = 'reconnecting';
      reconnectTimer = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      ws?.close();
    };
  }

  function disconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    retryCount = 0;
    ws?.close();
  }

  onUnmounted(disconnect);

  return { connected, connectionState, connect, disconnect };
}
```

- [ ] **Step 2: Verify WebSocket reconnects on failure**

1. Start the backend (`npm run dev` in project root).
2. Open the web UI and log in.
3. Stop the backend process.
4. Watch browser console: you should see exponentially increasing reconnect delays (e.g., ~1000ms, ~2000ms, ~4000ms ...) capped at 30000ms.
5. Restart the backend: WebSocket should reconnect automatically.

- [ ] **Step 3: Commit**

```bash
git add web/src/composables/useWebSocket.ts
git commit -m "feat(frontend): WebSocket exponential backoff reconnect and message validation"
```

---

## Task 5: Common Component Library — Part 1 (BaseButton, BaseCard, BaseModal)

**Files:**
- Create: `web/src/components/common/BaseButton.vue`
- Create: `web/src/components/common/BaseCard.vue`
- Create: `web/src/components/common/BaseModal.vue`
- Create: `web/src/components/common/index.ts`

- [ ] **Step 1: Create `web/src/components/common/BaseButton.vue`**

```vue
<template>
  <button
    :disabled="disabled || loading"
    :type="type"
    class="inline-flex items-center justify-center rounded-md font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/50"
    :class="[variantClasses, sizeClasses, { 'opacity-50 cursor-not-allowed': disabled || loading }]"
  >
    <LoadingSpinner v-if="loading" size="sm" class="mr-2" />
    <slot />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import LoadingSpinner from './LoadingSpinner.vue';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
type ButtonSize = 'sm' | 'md' | 'lg';

const props = withDefaults(
  defineProps<{
    variant?: ButtonVariant;
    size?: ButtonSize;
    disabled?: boolean;
    loading?: boolean;
    type?: 'button' | 'submit' | 'reset';
  }>(),
  { variant: 'primary', size: 'md', type: 'button' }
);

const variantClasses = computed(() => {
  switch (props.variant) {
    case 'primary':
      return 'bg-primary text-white hover:brightness-110 active:scale-[0.98]';
    case 'secondary':
      return 'bg-interactive-hover text-foreground hover:bg-border-default active:scale-[0.98]';
    case 'danger':
      return 'bg-danger text-white hover:brightness-110 active:scale-[0.98]';
    case 'ghost':
      return 'bg-transparent text-foreground-muted hover:text-foreground hover:bg-interactive-hover';
  }
});

const sizeClasses = computed(() => {
  switch (props.size) {
    case 'sm': return 'px-3 py-1.5 text-xs';
    case 'lg': return 'px-6 py-3 text-base';
    default: return 'px-4 py-2 text-sm';
  }
});
</script>
```

- [ ] **Step 2: Create `web/src/components/common/BaseCard.vue`**

```vue
<template>
  <div
    class="rounded-xl bg-surface-card transition-shadow duration-200"
    :class="{ 'hover:shadow-lg': hoverable }"
  >
    <slot />
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{ hoverable?: boolean }>(), { hoverable: true });
</script>
```

- [ ] **Step 3: Create `web/src/components/common/BaseModal.vue`**

```vue
<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="modelValue" class="fixed inset-0 z-[200] flex items-center justify-center p-4">
        <div
          class="absolute inset-0 bg-black/50 backdrop-blur-sm"
          @click="close"
        />
        <div
          class="relative w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-xl bg-surface-elevated p-6 shadow-xl"
          @click.stop
        >
          <div v-if="title" class="mb-5">
            <h3 class="text-xl font-bold">{{ title }}</h3>
          </div>
          <slot />
          <div v-if="$slots.footer" class="mt-6 flex justify-end gap-3">
            <slot name="footer" :close="close" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; title?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>();

function close() {
  emit('update:modelValue', false);
}
</script>

<style>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
</style>
```

- [ ] **Step 4: Create `web/src/components/common/LoadingSpinner.vue`**

```vue
<template>
  <div
    class="animate-spin rounded-full border-2 border-current border-t-transparent"
    :class="sizeClass"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{ size?: 'xs' | 'sm' | 'md' | 'lg' }>(), { size: 'md' });

const sizeClass = computed(() => {
  switch (props.size) {
    case 'xs': return 'w-3 h-3';
    case 'sm': return 'w-4 h-4';
    case 'lg': return 'w-8 h-8';
    default: return 'w-5 h-5';
  }
});
</script>
```

- [ ] **Step 5: Create barrel export `web/src/components/common/index.ts`**

```ts
export { default as BaseButton } from './BaseButton.vue';
export { default as BaseCard } from './BaseCard.vue';
export { default as BaseModal } from './BaseModal.vue';
export { default as LoadingSpinner } from './LoadingSpinner.vue';
export { default as EmptyState } from './EmptyState.vue';
export { default as SkeletonLoader } from './SkeletonLoader.vue';
export { default as ToastContainer } from './ToastContainer.vue';
```

Note: `EmptyState.vue` and `SkeletonLoader.vue` are created in Task 6, so the barrel will show import errors until that task is done. That's expected.

- [ ] **Step 6: Verify components render in a test page**

Temporarily add to `Home.vue` inside `<template>`:

```vue
<div class="p-4 flex flex-col gap-4">
  <BaseButton>Primary</BaseButton>
  <BaseButton variant="secondary">Secondary</BaseButton>
  <BaseButton variant="danger">Danger</BaseButton>
  <BaseButton variant="ghost">Ghost</BaseButton>
  <BaseButton loading>Loading</BaseButton>
  <BaseCard class="p-4">Card content</BaseCard>
</div>
```

And import `BaseButton` and `BaseCard`. Load the page, confirm buttons and card render correctly with Tailwind styles. Remove the test markup after verification.

- [ ] **Step 7: Commit**

```bash
git add web/src/components/common/BaseButton.vue web/src/components/common/BaseCard.vue web/src/components/common/BaseModal.vue web/src/components/common/LoadingSpinner.vue web/src/components/common/index.ts
git commit -m "feat(frontend): add BaseButton, BaseCard, BaseModal, LoadingSpinner"
```

---

## Task 6: Common Component Library — Part 2 (EmptyState, SkeletonLoader)

**Files:**
- Create: `web/src/components/common/EmptyState.vue`
- Create: `web/src/components/common/SkeletonLoader.vue`

- [ ] **Step 1: Create `web/src/components/common/EmptyState.vue`**

```vue
<template>
  <div class="flex flex-col items-center justify-center py-16 text-foreground-muted">
    <Icon v-if="icon" :icon="icon" class="mb-4 text-4xl opacity-40" />
    <p class="text-sm">{{ message }}</p>
    <p v-if="description" class="mt-1 text-xs opacity-70">{{ description }}</p>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';

defineProps<{
  message: string;
  description?: string;
  icon?: string;
}>();
</script>
```

- [ ] **Step 2: Create `web/src/components/common/SkeletonLoader.vue`**

```vue
<template>
  <div
    class="animate-pulse rounded-md bg-foreground-subtle/10"
    :style="computedStyle"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    width?: string;
    height?: string;
    borderRadius?: string;
  }>(),
  { width: '100%', height: '16px', borderRadius: '6px' }
);

const computedStyle = computed(() => ({
  width: props.width,
  height: props.height,
  borderRadius: props.borderRadius,
}));
</script>
```

- [ ] **Step 3: Update barrel export**

`web/src/components/common/index.ts` already references these files (from Task 5, Step 5). Verify the imports resolve without TypeScript errors by running:

```bash
cd web && npx vue-tsc --noEmit
```

Expected: No new errors related to EmptyState or SkeletonLoader.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/common/EmptyState.vue web/src/components/common/SkeletonLoader.vue
git commit -m "feat(frontend): add EmptyState and SkeletonLoader components"
```

---

## Task 7: Login View Tailwind Migration

**Files:**
- Modify: `web/src/views/Login.vue`

- [ ] **Step 1: Rewrite `Login.vue` with Tailwind + BaseButton**

Replace the entire file:

```vue
<template>
  <div class="flex min-h-screen items-center justify-center bg-surface">
    <div class="w-full max-w-[400px] rounded-xl bg-surface-elevated p-10 shadow-xl">
      <h1 class="mb-2 text-center text-[28px] font-bold text-foreground">TSMusicBot</h1>
      <p class="mb-8 text-center text-sm text-foreground-muted">请输入管理密码</p>
      <form @submit.prevent="handleLogin" class="flex flex-col gap-4">
        <input
          v-model="password"
          type="password"
          class="w-full rounded-lg border border-border-default bg-surface px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
          placeholder="管理密码"
          autocomplete="current-password"
          :disabled="authStore.loading"
          autofocus
        />
        <p v-if="authStore.error" class="text-sm text-danger">{{ authStore.error }}</p>
        <BaseButton type="submit" :loading="authStore.loading" :disabled="!password" class="w-full">
          登录
        </BaseButton>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';
import BaseButton from '../components/common/BaseButton.vue';

const router = useRouter();
const authStore = useAuthStore();
const password = ref('');

async function handleLogin() {
  const success = await authStore.login(password.value);
  if (success) {
    const redirect = (router.currentRoute.value.query.redirect as string) || '/';
    router.push(redirect);
  }
}
</script>
```

- [ ] **Step 2: Verify login page renders**

Navigate to `http://localhost:5173/login`. Confirm:
- The page layout matches the previous centered card design.
- The "登录" button is styled via `BaseButton`.
- Typing a password and clicking login still works (or shows error for wrong password).

- [ ] **Step 3: Commit**

```bash
git add web/src/views/Login.vue
git commit -m "refactor(frontend): migrate Login.vue to Tailwind + BaseButton"
```

---

## Task 8: Search View Tailwind Migration + Common Components

**Files:**
- Modify: `web/src/views/Search.vue`

- [ ] **Step 1: Rewrite `Search.vue` with Tailwind, EmptyState, and SkeletonLoader**

Replace the entire file:

```vue
<template>
  <div class="search-page">
    <button class="mb-4 flex items-center gap-1.5 text-sm text-foreground-muted opacity-70 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>

    <div class="mb-6">
      <div class="flex items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3.5">
        <Icon icon="mdi:magnify" class="mr-3 text-[22px] opacity-40" />
        <input
          ref="searchInput"
          v-model="query"
          class="flex-1 border-none bg-transparent text-base text-foreground outline-none placeholder:text-foreground-subtle"
          placeholder="搜索歌曲、歌手、专辑..."
          @keyup.enter="doSearch"
          autofocus
        />
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex flex-col gap-2">
      <SkeletonLoader v-for="n in 6" :key="n" height="64px" border-radius="10px" />
    </div>

    <!-- Results -->
    <div v-else-if="results.length > 0" class="flex flex-col gap-0.5">
      <SongCard
        v-for="(song, i) in results"
        :key="`${song.platform}-${song.id}`"
        :song="song"
        :index="i + 1"
        :active="store.currentSong?.id === song.id"
        @play="store.playSong(song)"
        @add="store.addSong(song)"
      />
    </div>

    <!-- Empty -->
    <EmptyState
      v-else-if="searched"
      message="未找到相关结果"
      icon="mdi:music-note-off"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../stores/player.js';
import SongCard from '../components/SongCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import SkeletonLoader from '../components/common/SkeletonLoader.vue';

const store = usePlayerStore();
const route = useRoute();

const query = ref((route.query.q as string) || '');
const results = ref<ReturnType<typeof store.currentSong>[]>([]);
const loading = ref(false);
const searched = ref(false);

async function doSearch() {
  if (!query.value.trim()) return;
  loading.value = true;
  searched.value = true;
  try {
    const res = await store.$http?.get('/api/music/search/all', { params: { q: query.value } });
    results.value = res?.data.songs ?? [];
  } catch {
    results.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (query.value) doSearch();
});
</script>
```

Wait — `store.$http` doesn't exist. The store uses `axios` directly (after migration, `http`). I need to import `http` here instead.

Correct Step 1:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http.js';
import { usePlayerStore, type Song } from '../stores/player.js';
import SongCard from '../components/SongCard.vue';
import EmptyState from '../components/common/EmptyState.vue';
import SkeletonLoader from '../components/common/SkeletonLoader.vue';

const store = usePlayerStore();
const route = useRoute();

const query = ref((route.query.q as string) || '');
const results = ref<Song[]>([]);
const loading = ref(false);
const searched = ref(false);

async function doSearch() {
  if (!query.value.trim()) return;
  loading.value = true;
  searched.value = true;
  try {
    const res = await http.get('/api/music/search/all', { params: { q: query.value } });
    results.value = res.data.songs;
  } catch {
    results.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (query.value) doSearch();
});
</script>
```

- [ ] **Step 2: Verify search page**

Navigate to `http://localhost:5173/search`, type a query and press Enter. Confirm:
- Skeleton loaders appear during search.
- Results render in SongCards.
- EmptyState appears when there are no results.

- [ ] **Step 3: Commit**

```bash
git add web/src/views/Search.vue
git commit -m "refactor(frontend): migrate Search.vue to Tailwind + EmptyState + SkeletonLoader"
```

---

## Task 9: NotFound View Tailwind Migration

**Files:**
- Modify: `web/src/views/NotFound.vue`

- [ ] **Step 1: Read existing `NotFound.vue`**

If the file is empty or very simple, replace with:

```vue
<template>
  <div class="flex flex-col items-center justify-center py-24 text-foreground-muted">
    <Icon icon="mdi:alert-circle-outline" class="mb-4 text-6xl opacity-30" />
    <h1 class="mb-2 text-2xl font-bold text-foreground">页面未找到</h1>
    <p class="mb-6 text-sm">您访问的页面不存在或已被移除</p>
    <BaseButton variant="secondary" @click="$router.push('/')">
      返回首页
    </BaseButton>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import BaseButton from '../components/common/BaseButton.vue';
</script>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/views/NotFound.vue
git commit -m "refactor(frontend): migrate NotFound.vue to Tailwind"
```

---

## Task 10: Settings Component Decomposition

**Files:**
- Create: `web/src/components/settings/SettingsLayout.vue`
- Create: `web/src/components/settings/SettingsTheme.vue`
- Create: `web/src/components/settings/SettingsGeneral.vue`
- Create: `web/src/components/settings/SettingsBots.vue`
- Create: `web/src/components/settings/SettingsPlatforms.vue`
- Modify: `web/src/views/Settings.vue`

- [ ] **Step 1: Create `web/src/components/settings/SettingsLayout.vue`**

```vue
<template>
  <div class="flex flex-col gap-6 lg:flex-row">
    <!-- Tab nav -->
    <nav class="flex gap-2 overflow-x-auto lg:flex-col lg:overflow-visible lg:shrink-0 lg:w-44">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        class="px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap text-left"
        :class="activeTab === tab.key
          ? 'bg-primary/10 text-primary'
          : 'text-foreground-muted hover:text-foreground hover:bg-interactive-hover'"
        @click="activeTab = tab.key"
      >
        <Icon v-if="tab.icon" :icon="tab.icon" class="inline-block mr-2 text-base" />
        {{ tab.label }}
      </button>
    </nav>

    <!-- Content -->
    <div class="flex-1 min-w-0">
      <slot :active-tab="activeTab" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { Icon } from '@iconify/vue';

export interface TabDef {
  key: string;
  label: string;
  icon?: string;
}

const props = defineProps<{ tabs: TabDef[]; defaultTab?: string }>();
const activeTab = ref(props.defaultTab ?? props.tabs[0]?.key ?? '');
</script>
```

- [ ] **Step 2: Create `web/src/components/settings/SettingsTheme.vue`**

```vue
<template>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2 text-sm font-medium">
      <Icon icon="mdi:theme-light-dark" class="text-lg opacity-60" />
      主题模式
    </div>
    <BaseButton variant="secondary" size="sm" @click="store.toggleTheme()">
      <Icon :icon="store.theme === 'dark' ? 'mdi:weather-night' : 'mdi:weather-sunny'" class="mr-1" />
      {{ store.theme === 'dark' ? '深色' : '浅色' }}
    </BaseButton>
  </div>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../../stores/player.js';
import BaseButton from '../common/BaseButton.vue';

const store = usePlayerStore();
</script>
```

- [ ] **Step 3: Create `web/src/components/settings/SettingsGeneral.vue`**

This component receives props for quality, prefix, idleTimeout and emits events for changes.

```vue
<template>
  <div class="space-y-6">
    <!-- Audio Quality -->
    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:music-note-eighth" class="text-lg opacity-60" />
        音源质量
      </div>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <button
          v-for="q in qualityLevels"
          :key="q.value"
          class="rounded-lg border-2 p-3 text-center transition-all"
          :class="currentQuality === q.value
            ? 'border-primary bg-primary/10'
            : 'border-transparent bg-interactive-hover hover:border-border-default'"
          @click="$emit('setQuality', q.value)"
        >
          <div class="text-sm font-semibold">{{ q.label }}</div>
          <div class="text-xs text-foreground-subtle mt-0.5">{{ q.desc }}</div>
        </button>
      </div>
    </div>

    <!-- Command Prefix -->
    <div>
      <div class="flex items-center gap-2 mb-3 text-sm font-medium">
        <Icon icon="mdi:console" class="text-lg opacity-60" />
        命令前缀
      </div>
      <div class="flex items-center gap-2">
        <input
          v-model="localPrefix"
          class="w-20 rounded-lg border border-border-default bg-interactive-hover px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
          placeholder="!"
        />
        <BaseButton size="sm" @click="$emit('savePrefix', localPrefix)">保存</BaseButton>
      </div>
    </div>

    <!-- Idle Timeout -->
    <div>
      <div class="flex items-center gap-2 mb-1 text-sm font-medium">
        <Icon icon="mdi:timer-off-outline" class="text-lg opacity-60" />
        闲置自动退出
      </div>
      <p class="text-xs text-foreground-subtle mb-3">频道无人时，机器人自动断开的等待时间（0 = 不退出）</p>
      <div class="flex items-center gap-2">
        <input
          v-model.number="localIdle"
          type="number"
          min="0"
          class="w-20 rounded-lg border border-border-default bg-interactive-hover px-3 py-2 text-sm text-foreground outline-none focus:border-primary"
        />
        <span class="text-sm text-foreground-muted">分钟</span>
        <BaseButton size="sm" @click="$emit('saveIdleTimeout', localIdle)">保存</BaseButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { Icon } from '@iconify/vue';
import BaseButton from '../common/BaseButton.vue';

const qualityLevels = [
  { value: 'standard', label: '标准', desc: '128kbps MP3' },
  { value: 'higher', label: '较高', desc: '192kbps MP3' },
  { value: 'exhigh', label: '极高', desc: '320kbps MP3' },
  { value: 'lossless', label: '无损', desc: 'FLAC' },
  { value: 'hires', label: 'Hi-Res', desc: '高解析度' },
  { value: 'jymaster', label: '超清母带', desc: '最高质量' },
];

const props = defineProps<{
  currentQuality: string;
  commandPrefix: string;
  idleTimeout: number;
}>();

const emit = defineEmits<{
  (e: 'setQuality', value: string): void;
  (e: 'savePrefix', value: string): void;
  (e: 'saveIdleTimeout', value: number): void;
}>();

const localPrefix = ref(props.commandPrefix);
const localIdle = ref(props.idleTimeout);

watch(() => props.commandPrefix, (v) => { localPrefix.value = v; });
watch(() => props.idleTimeout, (v) => { localIdle.value = v; });
</script>
```

- [ ] **Step 4: Create `web/src/components/settings/SettingsBots.vue`**

This is a large component. It receives the bot list and emits events for CRUD operations.

```vue
<template>
  <div class="space-y-4">
    <!-- Bot List -->
    <div class="flex flex-col gap-2">
      <div
        v-for="bot in bots"
        :key="bot.id"
        class="flex items-center justify-between rounded-lg bg-interactive-hover px-4 py-3"
      >
        <div class="flex items-center gap-3">
          <span
            class="w-2.5 h-2.5 rounded-full shrink-0"
            :class="bot.connected ? 'bg-success' : 'bg-foreground-subtle'"
          />
          <div>
            <div class="text-sm font-medium">{{ bot.name }}</div>
            <span
              class="inline-block text-xs px-2 py-0.5 rounded mt-0.5"
              :class="statusClass(bot)"
            >
              {{ statusText(bot) }}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-1.5">
          <BaseButton size="sm" variant="secondary" @click="$emit('toggleBot', bot.id, bot.connected)">
            {{ bot.connected ? '停止' : '启动' }}
          </BaseButton>
          <BaseButton size="sm" variant="ghost" @click="$emit('editBot', bot)">
            <Icon icon="mdi:pencil" />
          </BaseButton>
          <BaseButton size="sm" variant="ghost" class="hover:text-danger" @click="$emit('deleteBot', bot.id, bot.name)">
            <Icon icon="mdi:delete" />
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- Create Bot -->
    <div class="border-t border-border-default pt-4 mt-4">
      <h4 class="text-sm font-semibold mb-3">创建新实例</h4>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="sm:col-span-2">
          <label class="block text-xs font-semibold opacity-70 mb-1">名称</label>
          <input v-model="form.name" class="input" placeholder="我的音乐机器人" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-xs font-semibold opacity-70 mb-1">服务器地址</label>
          <input v-model="form.serverAddress" class="input" placeholder="localhost" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-xs font-semibold opacity-70 mb-1">端口</label>
          <input v-model.number="form.serverPort" type="number" class="input" placeholder="9987" />
        </div>
        <div class="sm:col-span-2">
          <label class="block text-xs font-semibold opacity-70 mb-1">昵称</label>
          <input v-model="form.nickname" class="input" placeholder="MusicBot" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-xs font-semibold opacity-70 mb-1">默认频道（可选）</label>
          <input v-model="form.defaultChannel" class="input" placeholder="音乐频道" />
        </div>
        <div class="sm:col-span-1">
          <label class="block text-xs font-semibold opacity-70 mb-1">服务器密码（可选）</label>
          <input v-model="form.serverPassword" type="password" class="input" />
        </div>
      </div>
      <BaseButton class="mt-3" @click="submitCreate">创建</BaseButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { Icon } from '@iconify/vue';
import type { BotStatus } from '../../stores/player.js';
import BaseButton from '../common/BaseButton.vue';

const props = defineProps<{ bots: BotStatus[] }>();
const emit = defineEmits<{
  (e: 'toggleBot', botId: string, connected: boolean): void;
  (e: 'editBot', bot: BotStatus): void;
  (e: 'deleteBot', botId: string, botName: string): void;
  (e: 'createBot', form: { name: string; serverAddress: string; serverPort: number; nickname: string; defaultChannel: string; serverPassword: string }): void;
}>();

const form = reactive({
  name: '',
  serverAddress: '',
  serverPort: 9987,
  nickname: 'MusicBot',
  defaultChannel: '',
  serverPassword: '',
});

function submitCreate() {
  emit('createBot', { ...form });
  form.name = '';
  form.serverAddress = '';
  form.serverPort = 9987;
  form.nickname = 'MusicBot';
  form.defaultChannel = '';
  form.serverPassword = '';
}

function statusText(bot: BotStatus) {
  if (!bot.connected) return '离线';
  if (bot.playing) return '播放中';
  if (bot.paused) return '已暂停';
  return '在线';
}

function statusClass(bot: BotStatus) {
  if (!bot.connected) return 'bg-foreground-subtle/10 text-foreground-subtle';
  if (bot.playing) return 'bg-success/15 text-success';
  if (bot.paused) return 'bg-warning/15 text-warning';
  return 'bg-primary/15 text-primary';
}
</script>

<style scoped>
.input {
  width: 100%;
  padding: 10px 14px;
  background: var(--hover-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  outline: none;
}
.input:focus { border-color: var(--color-primary); }
</style>
```

- [ ] **Step 5: Create `web/src/components/settings/SettingsPlatforms.vue`**

This is very long due to three platforms × two login methods. I'll create a compact version that delegates per-platform blocks to inline loops where possible, keeping the original behavior.

```vue
<template>
  <div class="space-y-5">
    <div
      v-for="platform in platforms"
      :key="platform.key"
      class="rounded-xl bg-interactive-hover p-5"
    >
      <div class="flex items-center gap-3 mb-4">
        <Icon :icon="platform.icon" class="text-[28px]" :class="platform.iconClass" />
        <div>
          <div class="text-[15px] font-semibold">{{ platform.name }}</div>
          <div class="text-xs" :class="authStates[platform.key].loggedIn ? 'text-success' : 'text-foreground-subtle'">
            {{ authStates[platform.key].loggedIn ? `已登录: ${authStates[platform.key].nickname}` : '未登录' }}
          </div>
        </div>
      </div>

      <div class="flex gap-2 mb-4">
        <BaseButton
          size="sm"
          :variant="loginModes[platform.key] === 'qr' ? 'primary' : 'secondary'"
          @click="$emit('startQr', platform.key)"
        >
          <Icon icon="mdi:qrcode" class="mr-1" /> 扫码登录
        </BaseButton>
        <BaseButton
          size="sm"
          :variant="loginModes[platform.key] === 'cookie' ? 'primary' : 'secondary'"
          @click="loginModes[platform.key] = 'cookie'"
        >
          <Icon icon="mdi:cookie" class="mr-1" /> Cookie登录
        </BaseButton>
      </div>

      <!-- QR -->
      <div v-if="loginModes[platform.key] === 'qr'" class="flex flex-col items-center py-5">
        <div v-if="qrStates[platform.key].loading" class="flex items-center gap-2 text-sm text-foreground-muted">
          <LoadingSpinner size="sm" /> 生成二维码中...
        </div>
        <div v-else-if="qrStates[platform.key].dataUrl" class="flex flex-col items-center gap-4">
          <img :src="qrStates[platform.key].dataUrl" class="w-[200px] h-[200px] rounded-[var(--radius-md)] border-2 border-border-default" alt="QR" />
          <div class="flex items-center gap-1.5 rounded-md bg-surface-card px-4 py-2 text-sm" :class="qrStatusClass(qrStates[platform.key].status)">
            <Icon :icon="qrStatusIcon(qrStates[platform.key].status)" />
            <span>{{ qrStatusText(platform.key, qrStates[platform.key].status) }}</span>
          </div>
        </div>
      </div>

      <!-- Cookie -->
      <div v-if="loginModes[platform.key] === 'cookie'" class="flex flex-col gap-2">
        <textarea
          v-model="cookieInputs[platform.key]"
          rows="3"
          class="w-full rounded-md border border-border-default bg-surface-card px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary resize-y"
          :placeholder="`粘贴${platform.name}Cookie...`"
        />
        <BaseButton size="sm" class="self-end" @click="$emit('saveCookie', platform.key, cookieInputs[platform.key])">
          保存Cookie
        </BaseButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from 'vue';
import { Icon } from '@iconify/vue';
import BaseButton from '../common/BaseButton.vue';
import LoadingSpinner from '../common/LoadingSpinner.vue';

interface QrState {
  loading: boolean;
  dataUrl: string;
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired';
}

interface AuthState {
  loggedIn: boolean;
  nickname: string;
}

const props = defineProps<{
  authStates: Record<string, AuthState>;
  qrStates: Record<string, QrState>;
}>();

const emit = defineEmits<{
  (e: 'startQr', platform: string): void;
  (e: 'saveCookie', platform: string, cookie: string): void;
}>();

const platforms = [
  { key: 'netease', name: '网易云音乐', icon: 'mdi:cloud-outline', iconClass: 'text-primary' },
  { key: 'qq', name: 'QQ音乐', icon: 'mdi:music-circle-outline', iconClass: 'text-primary' },
  { key: 'bilibili', name: '哔哩哔哩', icon: 'mdi:video-outline', iconClass: 'text-[#00a1d6]' },
];

const loginModes = reactive<Record<string, 'qr' | 'cookie'>>({});
const cookieInputs = reactive<Record<string, string>>({ netease: '', qq: '', bilibili: '' });

function qrStatusClass(status: QrState['status']) {
  switch (status) {
    case 'scanned': return 'text-warning bg-warning/10';
    case 'confirmed': return 'text-success bg-success/10';
    case 'expired': return 'text-danger bg-danger/10';
    default: return 'text-foreground-muted bg-surface-card';
  }
}

function qrStatusIcon(status: QrState['status']) {
  switch (status) {
    case 'scanned': return 'mdi:check';
    case 'confirmed': return 'mdi:check-circle';
    case 'expired': return 'mdi:refresh';
    default: return 'mdi:cellphone';
  }
}

function qrStatusText(platform: string, status: QrState['status']) {
  const name = platforms.find(p => p.key === platform)?.name ?? '';
  switch (status) {
    case 'scanned': return '已扫码，请在手机上确认';
    case 'confirmed': return '登录成功!';
    case 'expired': return '二维码已过期';
    default: return `请使用${name}APP扫码`;
  }
}
</script>
```

- [ ] **Step 6: Refactor `web/src/views/Settings.vue`**

Replace the entire file with the container that delegates to sub-components:

```vue
<template>
  <div class="settings-page">
    <button class="mb-4 flex items-center gap-1.5 text-sm text-foreground-muted opacity-70 transition-opacity hover:opacity-100" @click="$router.back()">
      <Icon icon="mdi:arrow-left" />
      返回
    </button>
    <h1 class="text-[28px] font-extrabold mb-8">设置</h1>

    <SettingsLayout :tabs="tabs" default-tab="general">
      <template #default="{ activeTab }">
        <SettingsTheme v-if="activeTab === 'general'" />

        <SettingsGeneral
          v-if="activeTab === 'general'"
          class="mt-6"
          :current-quality="currentQuality"
          :command-prefix="commandPrefix"
          :idle-timeout="idleTimeout"
          @set-quality="setQuality"
          @save-prefix="savePrefix"
          @save-idle-timeout="saveIdleTimeout"
        />

        <SettingsBots
          v-if="activeTab === 'bots'"
          :bots="store.bots"
          @toggle-bot="toggleBot"
          @edit-bot="openEditBot"
          @delete-bot="deleteBot"
          @create-bot="createBot"
        />

        <SettingsPlatforms
          v-if="activeTab === 'platforms'"
          :auth-states="{ netease: neteaseAuth, qq: qqAuth, bilibili: bilibiliAuth }"
          :qr-states="{ netease: neteaseQr, qq: qqQr, bilibili: bilibiliQr }"
          @start-qr="startQrLogin"
          @save-cookie="saveCookie"
        />
      </template>
    </SettingsLayout>

    <!-- Edit Bot Modal -->
    <BaseModal v-model="editModalOpen" title="编辑机器人">
      <div class="space-y-3">
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">名称</label>
          <input v-model="editForm.name" class="input" />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">服务器地址</label>
          <input v-model="editForm.serverAddress" class="input" placeholder="ts.example.com" />
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-1">
            <label class="block text-xs font-semibold opacity-70 mb-1">端口</label>
            <input v-model.number="editForm.serverPort" type="number" class="input" />
          </div>
          <div class="col-span-2">
            <label class="block text-xs font-semibold opacity-70 mb-1">昵称</label>
            <input v-model="editForm.nickname" class="input" />
          </div>
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">默认频道（可选）</label>
          <input v-model="editForm.defaultChannel" class="input" placeholder="音乐频道" />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">频道密码（可选）</label>
          <input v-model="editForm.channelPassword" type="password" class="input" />
        </div>
        <div>
          <label class="block text-xs font-semibold opacity-70 mb-1">服务器密码（可选）</label>
          <input v-model="editForm.serverPassword" type="password" class="input" />
        </div>
      </div>
      <template #footer="{ close }">
        <BaseButton variant="secondary" @click="close">取消</BaseButton>
        <BaseButton @click="saveEditBot">保存</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { http } from '../utils/http.js';
import { usePlayerStore } from '../stores/player.js';
import { useToast } from '../composables/useToast.js';
import SettingsLayout from '../components/settings/SettingsLayout.vue';
import SettingsTheme from '../components/settings/SettingsTheme.vue';
import SettingsGeneral from '../components/settings/SettingsGeneral.vue';
import SettingsBots from '../components/settings/SettingsBots.vue';
import SettingsPlatforms from '../components/settings/SettingsPlatforms.vue';
import BaseModal from '../components/common/BaseModal.vue';
import BaseButton from '../components/common/BaseButton.vue';

const store = usePlayerStore();
const toast = useToast();

const tabs = [
  { key: 'general', label: '通用设置', icon: 'mdi:cog' },
  { key: 'bots', label: '机器人管理', icon: 'mdi:robot' },
  { key: 'platforms', label: '音乐账号', icon: 'mdi:music-box' },
];

// ── General settings state ──
const currentQuality = ref('exhigh');
const commandPrefix = ref('!');
const idleTimeout = ref(0);

// ── Bot edit modal ──
const editModalOpen = ref(false);
const editForm = reactive({
  name: '', serverAddress: '', serverPort: 9987, nickname: '',
  defaultChannel: '', channelPassword: '', serverPassword: '',
});
let editingBotId: string | null = null;

// ── Platform auth state ──
const neteaseAuth = reactive({ loggedIn: false, nickname: '' });
const qqAuth = reactive({ loggedIn: false, nickname: '' });
const bilibiliAuth = reactive({ loggedIn: false, nickname: '' });

interface QrState {
  loading: boolean;
  dataUrl: string;
  key: string;
  status: 'waiting' | 'scanned' | 'confirmed' | 'expired';
  pollTimer: ReturnType<typeof setInterval> | null;
}

const neteaseQr = reactive<QrState>({ loading: false, dataUrl: '', key: '', status: 'waiting', pollTimer: null });
const qqQr = reactive<QrState>({ loading: false, dataUrl: '', key: '', status: 'waiting', pollTimer: null });
const bilibiliQr = reactive<QrState>({ loading: false, dataUrl: '', key: '', status: 'waiting', pollTimer: null });

function getQrState(platform: string): QrState {
  if (platform === 'bilibili') return bilibiliQr;
  return platform === 'netease' ? neteaseQr : qqQr;
}

// ── General handlers ──
async function loadQuality() {
  try {
    const res = await http.get('/api/music/quality');
    currentQuality.value = res.data.netease || 'exhigh';
  } catch { /* ignore */ }
}

async function setQuality(q: string) {
  currentQuality.value = q;
  try {
    await http.post('/api/music/quality', { quality: q });
    toast.success('音质设置已保存');
  } catch {
    toast.error('保存音质设置失败');
  }
}

async function savePrefix() {
  toast.info('命令前缀设置客户端存储');
}

async function loadIdleTimeout() {
  try {
    const res = await http.get('/api/bot/settings');
    idleTimeout.value = res.data.idleTimeoutMinutes ?? 0;
  } catch { /* ignore */ }
}

async function saveIdleTimeout(minutes: number) {
  try {
    await http.post('/api/bot/settings', { idleTimeoutMinutes: minutes });
    toast.success('闲置超时设置已保存');
  } catch {
    toast.error('保存闲置超时设置失败');
  }
}

// ── Bot handlers ──
async function toggleBot(botId: string, connected: boolean) {
  try {
    await http.post(`/api/bot/${botId}/${connected ? 'stop' : 'start'}`);
    await store.fetchBots();
  } catch {
    toast.error('操作失败');
  }
}

async function openEditBot(bot: any) {
  editingBotId = bot.id;
  editForm.name = bot.name;
  try {
    const res = await http.get(`/api/bot/${bot.id}/config`);
    editForm.serverAddress = res.data.serverAddress ?? '';
    editForm.serverPort = res.data.serverPort ?? 9987;
    editForm.nickname = res.data.nickname ?? '';
    editForm.defaultChannel = res.data.defaultChannel ?? '';
    editForm.channelPassword = res.data.channelPassword ?? '';
    editForm.serverPassword = res.data.serverPassword ?? '';
  } catch {
    editForm.serverAddress = '';
    editForm.serverPort = 9987;
    editForm.nickname = bot.name;
    editForm.defaultChannel = '';
    editForm.channelPassword = '';
    editForm.serverPassword = '';
  }
  editModalOpen.value = true;
}

async function saveEditBot() {
  if (!editingBotId) return;
  try {
    await http.put(`/api/bot/${editingBotId}`, editForm);
    editModalOpen.value = false;
    editingBotId = null;
    await store.fetchBots();
    toast.success('机器人配置已保存');
  } catch {
    toast.error('保存失败');
  }
}

async function deleteBot(botId: string, botName: string) {
  if (!confirm(`确认删除机器人 "${botName}"？此操作不可撤销。`)) return;
  try {
    await http.delete(`/api/bot/${botId}`);
    if (store.activeBotId === botId) store.activeBotId = null;
    store.removeBotStatus(botId);
    await store.fetchBots();
    toast.success('机器人已删除');
  } catch {
    toast.error('删除失败');
  }
}

async function createBot(form: { name: string; serverAddress: string; serverPort: number; nickname: string; defaultChannel: string; serverPassword: string }) {
  if (!form.name || !form.serverAddress) return;
  try {
    await http.post('/api/bot', {
      name: form.name,
      serverAddress: form.serverAddress,
      serverPort: form.serverPort || 9987,
      nickname: form.nickname || form.name,
      defaultChannel: form.defaultChannel || undefined,
      serverPassword: form.serverPassword || undefined,
      autoStart: false,
    });
    await store.fetchBots();
    toast.success('机器人已创建');
  } catch {
    toast.error('创建失败');
  }
}

// ── Platform handlers ──
async function checkAuthStatus() {
  try {
    const [nRes, qRes, bRes] = await Promise.all([
      http.get('/api/auth/status', { params: { platform: 'netease' } }),
      http.get('/api/auth/status', { params: { platform: 'qq' } }),
      http.get('/api/auth/status', { params: { platform: 'bilibili' } }),
    ]);
    Object.assign(neteaseAuth, nRes.data);
    Object.assign(qqAuth, qRes.data);
    Object.assign(bilibiliAuth, bRes.data);
  } catch { /* ignore */ }
}

async function startQrLogin(platform: string) {
  const qr = getQrState(platform);
  if (qr.pollTimer) clearInterval(qr.pollTimer);
  qr.loading = true;
  qr.dataUrl = '';
  qr.status = 'waiting';

  try {
    const res = await http.post('/api/auth/qrcode', { platform });
    qr.key = res.data.key;
    qr.dataUrl = res.data.qrImg || '';
    qr.loading = false;
    qr.pollTimer = setInterval(() => pollQrStatus(platform), 2000);
  } catch {
    qr.loading = false;
    toast.error('二维码生成失败');
  }
}

async function pollQrStatus(platform: string) {
  const qr = getQrState(platform);
  if (!qr.key) return;
  try {
    const res = await http.get('/api/auth/qrcode/status', { params: { key: qr.key, platform } });
    qr.status = res.data.status;
    if (qr.status === 'confirmed') {
      if (qr.pollTimer) clearInterval(qr.pollTimer);
      qr.pollTimer = null;
      await checkAuthStatus();
    } else if (qr.status === 'expired') {
      if (qr.pollTimer) clearInterval(qr.pollTimer);
      qr.pollTimer = null;
    }
  } catch { /* ignore */ }
}

async function saveCookie(platform: string, cookie: string) {
  if (!cookie) return;
  try {
    await http.post('/api/auth/cookie', { platform, cookie });
    await checkAuthStatus();
    toast.success('Cookie 已保存');
  } catch {
    toast.error('保存 Cookie 失败');
  }
}

onMounted(() => {
  store.fetchBots();
  checkAuthStatus();
  loadQuality();
  loadIdleTimeout();
});

onUnmounted(() => {
  [neteaseQr, qqQr, bilibiliQr].forEach((qr) => {
    if (qr.pollTimer) clearInterval(qr.pollTimer);
  });
});
</script>

<style scoped>
.input {
  width: 100%;
  padding: 10px 14px;
  background: var(--hover-bg);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 13px;
  outline: none;
}
.input:focus { border-color: var(--color-primary); }
</style>
```

- [ ] **Step 7: Verify Settings page renders and tabs switch**

Navigate to `http://localhost:5173/settings`. Confirm:
- Three tabs are visible: "通用设置", "机器人管理", "音乐账号".
- Clicking each tab shows the corresponding sub-component.
- Theme toggle works.
- Bot list renders if bots exist.
- Platform cards render.

- [ ] **Step 8: Commit**

```bash
git add web/src/components/settings/ web/src/views/Settings.vue
git commit -m "refactor(frontend): decompose Settings.vue into tabbed sub-components"
```

---

## Task 11: Home View Decomposition

**Files:**
- Create: `web/src/components/home/NowPlaying.vue`
- Create: `web/src/components/home/QuickActions.vue`
- Create: `web/src/components/home/RecentHistory.vue`
- Modify: `web/src/views/Home.vue`

- [ ] **Step 1: Create `web/src/components/home/NowPlaying.vue`**

```vue
<template>
  <section v-if="store.currentSong" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">正在播放</h2>
    <div class="flex items-center gap-5 rounded-[var(--radius-lg)] bg-surface-card p-5">
      <CoverArt :url="store.currentSong.coverUrl" :size="80" :radius="10" :show-shadow="true" />
      <div>
        <div class="text-[17px] font-semibold">{{ store.currentSong.name }}</div>
        <div class="text-[13px] text-foreground-muted">
          {{ store.currentSong.artist }} · {{ store.currentSong.album }}
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { usePlayerStore } from '../../stores/player.js';
import CoverArt from '../CoverArt.vue';

const store = usePlayerStore();
</script>
```

- [ ] **Step 2: Create `web/src/components/home/QuickActions.vue`**

```vue
<template>
  <!-- Search Bar -->
  <div
    class="flex items-center rounded-[var(--radius-md)] bg-surface-card px-5 py-3 mb-8 cursor-pointer transition-colors hover:bg-interactive-hover"
    @click="$router.push('/search')"
  >
    <Icon icon="mdi:magnify" class="mr-3 text-xl opacity-40" />
    <span class="text-sm opacity-30">搜索歌曲、歌单、专辑...</span>
  </div>

  <!-- FM -->
  <section class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">私人FM</h2>
    <div
      class="flex items-center gap-5 rounded-[var(--radius-lg)] bg-surface-card p-5 cursor-pointer transition-colors hover:bg-interactive-hover"
      @click="playFm"
    >
      <div class="flex h-14 w-14 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-gradient-to-br from-primary to-indigo-500">
        <Icon icon="mdi:radio" class="text-[28px] text-white" />
      </div>
      <div class="flex-1">
        <div class="text-base font-semibold">开启私人FM</div>
        <div class="text-[13px] text-foreground-muted">根据你的口味推荐音乐</div>
      </div>
      <Icon icon="mdi:play-circle" class="text-4xl text-primary opacity-80 transition-opacity group-hover:opacity-100" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue';
import { useRouter } from 'vue-router';
import { http } from '../../utils/http.js';
import { usePlayerStore, type Song } from '../../stores/player.js';

const router = useRouter();
const store = usePlayerStore();

async function playFm() {
  try {
    const res = await http.get('/api/music/personal/fm');
    const songs: Song[] = res.data.songs;
    if (songs.length > 0) {
      await store.play(songs[0].name, songs[0].platform);
      for (let i = 1; i < songs.length; i++) {
        await store.addToQueue(songs[i].name, songs[i].platform);
      }
    }
  } catch { /* ignore */ }
}
</script>
```

- [ ] **Step 3: Create `web/src/components/home/RecentHistory.vue`**

```vue
<template>
  <!-- Daily Songs -->
  <section v-if="store.dailySongs.length > 0" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">每日推荐</h2>
    <div class="grid grid-cols-3 gap-5 sm:grid-cols-4 lg:grid-cols-6">
      <div
        v-for="song in store.dailySongs.slice(0, 12)"
        :key="song.id"
        class="cursor-pointer hover-scale"
        @click="store.playSong(song)"
      >
        <CoverArt :url="song.coverUrl" :size="120" :radius="10" :show-shadow="true" />
        <div class="mt-2 text-[13px] font-medium truncate">{{ song.name }}</div>
        <div class="text-xs text-foreground-muted truncate">{{ song.artist }}</div>
      </div>
    </div>
  </section>

  <!-- Recommend Playlists -->
  <section v-if="store.recommendPlaylists.length > 0" class="mb-9">
    <h2 class="mb-4 text-[22px] font-bold">推荐歌单</h2>
    <div class="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <RouterLink
        v-for="playlist in store.recommendPlaylists"
        :key="playlist.id"
        :to="`/playlist/${playlist.id}?platform=${playlist.platform}`"
        class="block cursor-pointer text-inherit no-underline hover-scale"
      >
        <CoverArt :url="playlist.coverUrl" :size="160" :radius="10" :show-shadow="true" />
        <div class="mt-2 text-[13px] font-medium line-clamp-2">{{ playlist.name }}</div>
      </RouterLink>
    </div>
  </section>

  <!-- User Playlists -->
  <section v-if="store.userPlaylists.length > 0" class="mb-9">
    <h2 class="mb-4 flex items-center gap-2 text-[22px] font-bold">
      我的歌单
      <span class="text-[13px] font-medium text-foreground-subtle">{{ store.userPlaylists.length }}</span>
    </h2>
    <div class="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      <RouterLink
        v-for="pl in visibleUserPlaylists"
        :key="pl.id"
        :to="`/playlist/${pl.id}?platform=${pl.platform}`"
        class="block cursor-pointer text-inherit no-underline hover-scale"
      >
        <CoverArt :url="pl.coverUrl" :size="160" :radius="10" :show-shadow="true" />
        <div class="mt-2 text-[13px] font-medium line-clamp-2">{{ pl.name }}</div>
        <div class="mt-0.5 text-xs text-foreground-subtle">{{ pl.songCount }} 首</div>
      </RouterLink>
    </div>
    <button
      v-if="store.userPlaylists.length > USER_PLAYLIST_LIMIT"
      class="mt-3 flex w-full items-center justify-center gap-1 rounded-[var(--radius-md)] bg-surface-card py-2.5 text-[13px] font-medium text-foreground-muted transition-colors hover:bg-interactive-hover hover:text-primary"
      @click="userPlaylistsExpanded = !userPlaylistsExpanded"
    >
      <Icon :icon="userPlaylistsExpanded ? 'mdi:chevron-up' : 'mdi:chevron-down'" />
      {{ userPlaylistsExpanded ? '收起' : `展开全部 ${store.userPlaylists.length} 个歌单` }}
    </button>
  </section>

  <!-- Bilibili Popular -->
  <section v-if="store.bilibiliPopular.length > 0" class="mb-9">
    <h2 class="mb-4 flex items-center gap-2 text-[22px] font-bold">
      <span class="inline-flex h-6 w-6 items-center justify-center rounded bg-[#00a1d6] text-sm font-extrabold text-white">B</span>
      B站热门
    </h2>
    <div class="grid grid-cols-3 gap-5 sm:grid-cols-4 lg:grid-cols-6">
      <div
        v-for="song in store.bilibiliPopular.slice(0, 12)"
        :key="song.id"
        class="cursor-pointer hover-scale"
        @click="store.playSong(song)"
      >
        <CoverArt :url="song.coverUrl" :size="120" :radius="10" :show-shadow="true" />
        <div class="mt-2 text-[13px] font-medium truncate">{{ song.name }}</div>
        <div class="text-xs text-foreground-muted truncate">{{ song.artist }}</div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import { Icon } from '@iconify/vue';
import { usePlayerStore } from '../../stores/player.js';
import CoverArt from '../CoverArt.vue';

const store = usePlayerStore();
const USER_PLAYLIST_LIMIT = 20;
const userPlaylistsExpanded = ref(false);

const visibleUserPlaylists = computed(() =>
  userPlaylistsExpanded.value
    ? store.userPlaylists
    : store.userPlaylists.slice(0, USER_PLAYLIST_LIMIT)
);
</script>
```

- [ ] **Step 4: Refactor `web/src/views/Home.vue`**

Replace the entire file:

```vue
<template>
  <div class="home">
    <QuickActions />
    <NowPlaying />
    <RecentHistory />
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { usePlayerStore } from '../stores/player.js';
import QuickActions from '../components/home/QuickActions.vue';
import NowPlaying from '../components/home/NowPlaying.vue';
import RecentHistory from '../components/home/RecentHistory.vue';

const store = usePlayerStore();

onMounted(() => {
  store.fetchHomeData();
});
</script>
```

- [ ] **Step 5: Verify Home page renders**

Navigate to `http://localhost:5173/`. Confirm:
- Search bar and FM card render.
- "正在播放" section appears if a song is active.
- Daily songs, playlists, and Bilibili sections render when data is available.
- No visual regressions compared to the pre-migration version.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/home/ web/src/views/Home.vue
git commit -m "refactor(frontend): decompose Home.vue into NowPlaying, QuickActions, RecentHistory"
```

---

## Task 12: Final Verification & Cleanup

**Files:**
- Modify: `web/package.json` (remove `sass` if no `.scss` files remain in active use)

- [ ] **Step 1: Run full frontend type check**

```bash
cd web && npx vue-tsc --noEmit
```

Expected: Zero errors. Fix any remaining import path or type issues.

- [ ] **Step 2: Run production build**

```bash
cd web && npm run build
```

Expected: `vite build` completes successfully.

- [ ] **Step 3: Check for remaining empty catch blocks**

```bash
cd web && grep -rn "catch\s*{" src/ | grep -v "catch (err" | grep -v "catch {" | head -20
```

Expected: Any remaining `catch {}` blocks are identified. Replace with at least a `console.warn` or `toast.error` where appropriate. Focus on the files modified in this phase.

- [ ] **Step 4: Check for remaining `axios` direct imports (excluding `http.ts`)**

```bash
cd web && grep -rn "from 'axios'" src/ | grep -v "utils/http.ts"
```

Expected: Only `http.ts` imports from `'axios'`. If any view/component still imports `axios` directly, migrate it to `http`.

- [ ] **Step 5: Remove `sass` devDependency if safe**

If **all** `.vue` files have removed `lang="scss"` scoped styles (they haven't yet — Navbar, Player, etc. still use SCSS), do **not** remove `sass` yet. Leave it for Phase 4. Skip this step.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(frontend): complete Phase 3 frontend infrastructure"
```

---

## Self-Review Checklist

Run this yourself after the plan is written — not a subagent task.

### 1. Spec Coverage

| Design Doc Requirement | Task |
|------------------------|------|
| Tailwind CSS v4 via Vite plugin | Task 1 |
| Design token migration (colors, spacing, radius, font) | Task 1 (index.css `@theme`) |
| `variables.scss` preserved as reference | Task 1 (not deleted, still imported in global.scss) |
| Toast component | Task 2 |
| LoadingSpinner | Task 5 |
| EmptyState | Task 6 |
| BaseButton | Task 5 |
| BaseCard | Task 5 |
| BaseModal | Task 5 |
| SkeletonLoader | Task 6 |
| Unified HTTP client (axios instance + interceptors) | Task 3 |
| WebSocket exponential backoff | Task 4 |
| WebSocket connection state exposed | Task 4 (`connectionState`) |
| WebSocket message type validation | Task 4 (`isValidMessage`) |
| Route transitions | Task 1 (fade CSS in index.css) + Task 2 (App.vue `<Transition>`) |
| Route lazy loading | Already implemented pre-Phase 3 (no change needed) |
| Settings.vue → 5 sub-components | Task 10 |
| Home.vue → 3 sub-components | Task 11 |
| 401 auto-redirect | Task 3 (http.ts) |
| Eliminate empty catch blocks | Task 12 (cleanup) |

**Gap:** None identified.

### 2. Placeholder Scan

Search the plan for these red flags:

- [ ] No "TBD", "TODO", "implement later", "fill in details"
- [ ] No "Add appropriate error handling" without code
- [ ] No "Write tests for the above" without test code
- [ ] No "Similar to Task N" — each task is self-contained
- [ ] Every step that changes code shows the code

### 3. Type Consistency

- [ ] `useWebSocket` returns `{ connected, connectionState, connect, disconnect }` — consistent across Task 4 and App.vue usage.
- [ ] `http` instance exported from `utils/http.ts` — consistent across Tasks 3, 8, 10, 11.
- [ ] Toast store uses `ToastItem` interface — consistent across Tasks 2, 3, and 5.
- [ ] Settings sub-components emit events with correct payload types — verified in Task 10.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-28-phase3-frontend-infrastructure.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints for review

**Which approach?**
