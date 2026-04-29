# Phase 5: Advanced Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add favorites system, verify lyrics optimizations, and implement admin/user role-based access control.

**Architecture:** Favorites use a new SQLite table with REST endpoints. Role-based access extends JWT auth (implemented as a prerequisite task since the backend JWT endpoint is missing but the frontend already expects it). Admin-only UI elements are conditionally rendered based on the JWT `role` claim.

**Tech Stack:** Vue 3, Tailwind CSS v4, better-sqlite3, jsonwebtoken, Node.js crypto, Pinia

---

## File Structure

### New Files

| File | Responsibility |
|------|--------------|
| `src/auth/jwt.ts` | JWT secret derivation, token signing/verification |
| `src/auth/middleware.ts` | Express `requireAuth` and `requireAdmin` middleware |
| `src/web/api/favorites.ts` | Favorites REST API router |
| `web/src/stores/favorites.ts` | Pinia store for favorites state and API calls |
| `web/src/views/Favorites.vue` | Favorites list page |
| `web/src/components/FavoriteButton.vue` | Heart icon toggle button |

### Modified Files

| File | Changes |
|------|---------|
| `package.json` | Add `jsonwebtoken`, `@types/jsonwebtoken` |
| `src/data/config.ts` | Add `users` array to `BotConfig` interface |
| `src/data/database.ts` | Add `favorites` table, CRUD methods |
| `src/web/server.ts` | Add auth middleware, login endpoint, update `/api/health`, mount favorites router |
| `src/web/websocket.ts` | Validate JWT token on connection, return broadcast function |
| `web/src/router/index.ts` | Add `/login` and `/favorites` routes, auth guards |
| `web/src/stores/auth.ts` | Add `role`, `isAdmin`, `username`, update login for username+password |
| `web/src/views/Login.vue` | Add username input, role-aware login flow |
| `web/src/components/Navbar.vue` | Add favorites link, admin-only conditional rendering |
| `web/src/components/SongCard.vue` | Add FavoriteButton |
| `web/src/components/SongGridCard.vue` | Add FavoriteButton |
| `web/src/components/Queue.vue` | Add FavoriteButton to queue items |
| `web/src/App.vue` | Add auth init on mount |

---

## Prerequisite Check

Before starting, confirm the production build succeeds:

```bash
cd web && npm run build
```

Also run the queue tests to establish a baseline:

```bash
npx vitest run src/audio/queue.test.ts
```

Expected: All queue tests pass. (Note: `src/data/database.test.ts` has a pre-existing failure unrelated to this phase — extra migration columns leak into `getBotInstances()` results. Do NOT fix it in this phase.)

---

## Task 1: Prerequisite — JWT Auth Backend

**Context:** The frontend already has auth infrastructure (`stores/auth.ts`, `utils/http.ts`, `views/Login.vue`, `composables/useWebSocket.ts`) that expects a JWT backend. However, the backend currently has no JWT endpoint. This task implements the minimal JWT backend required before favorites (protected API) and roles can work.

**Files:**
- Modify: `package.json`
- Create: `src/auth/jwt.ts`
- Create: `src/auth/middleware.ts`
- Modify: `src/data/config.ts`
- Modify: `src/web/server.ts`
- Modify: `src/web/websocket.ts`

### Step 1: Install jsonwebtoken

```bash
cd "D:/develop/音乐机器人/teamspeak-music-bot"
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

Expected: `package.json` updated with `"jsonwebtoken": "^9.x"` and `"@types/jsonwebtoken": "^9.x"`.

### Step 2: Create `src/auth/jwt.ts`

```typescript
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const JWT_EXPIRES_IN = "24h";

export interface JwtPayload {
  role: "admin" | "user";
}

export function deriveSecret(adminPassword: string): string {
  return crypto
    .createHmac("sha256", "tsmusicbot-salt")
    .update(adminPassword)
    .digest("hex");
}

export function signToken(role: "admin" | "user", secret: string): string {
  return jwt.sign({ role }, secret, { expiresIn: JWT_EXPIRES_IN });
}

export function verifyToken(token: string, secret: string): JwtPayload | null {
  try {
    return jwt.verify(token, secret) as JwtPayload;
  } catch {
    return null;
  }
}
```

### Step 3: Create `src/auth/middleware.ts`

```typescript
import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "./jwt.js";

export function createRequireAuth(secret: string) {
  return function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const token = authHeader.slice(7);
    const payload = verifyToken(token, secret);
    if (!payload) {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    (req as any).auth = payload;
    next();
  };
}

export function createRequireAdmin(secret: string) {
  const requireAuth = createRequireAuth(secret);
  return function requireAdmin(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    requireAuth(req, res, () => {
      const auth = (req as any).auth as { role: string } | undefined;
      if (auth?.role !== "admin") {
        res.status(403).json({ error: "Admin access required" });
        return;
      }
      next();
    });
  };
}
```

### Step 4: Modify `src/data/config.ts`

Add `users` to the `BotConfig` interface and `getDefaultConfig()`:

```typescript
export interface BotConfig {
  webPort: number;
  locale: "zh" | "en";
  theme: "dark" | "light";
  commandPrefix: string;
  commandAliases: Record<string, string>;
  neteaseApiPort: number;
  qqMusicApiPort: number;
  adminPassword: string;
  adminGroups: number[];
  autoReturnDelay: number;
  autoPauseOnEmpty: boolean;
  idleTimeoutMinutes: number;
  publicUrl: string;
  trustProxy: boolean;
  users: Array<{ username: string; password: string; role: "admin" | "user" }>;
}

export function getDefaultConfig(): BotConfig {
  return {
    webPort: 3000,
    locale: "zh",
    theme: "dark",
    commandPrefix: "!",
    commandAliases: { p: "play", s: "skip", n: "next" },
    neteaseApiPort: 3001,
    qqMusicApiPort: 3200,
    adminPassword: "",
    adminGroups: [],
    autoReturnDelay: 300,
    autoPauseOnEmpty: true,
    idleTimeoutMinutes: 0,
    publicUrl: "",
    trustProxy: false,
    users: [],
  };
}
```

### Step 5: Modify `src/web/websocket.ts`

Change the return type to expose `broadcast`, and add token validation:

Replace the import block and function signature (lines 1–10):

```typescript
import { WebSocketServer, WebSocket } from "ws";
import type { BotManager } from "../bot/manager.js";
import type { BotInstance } from "../bot/instance.js";
import type { Logger } from "../logger.js";
import { verifyToken } from "../auth/jwt.js";

export function setupWebSocket(
  wss: WebSocketServer,
  botManager: BotManager,
  logger: Logger,
  jwtSecret: string,
  authEnabled: boolean
): { cleanup: () => void; broadcast: (data: object) => void } {
```

Replace the `wss.on("connection", ...)` block (lines 21–37):

```typescript
  wss.on("connection", (ws) => {
    clients.add(ws);
    logger.debug("WebSocket client connected");

    const bots = botManager.getAllBots().map((b) => b.getStatus());
    ws.send(JSON.stringify({ type: "init", bots }));

    ws.on("close", () => {
      clients.delete(ws);
      logger.debug("WebSocket client disconnected");
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WebSocket error");
      clients.delete(ws);
    });
  });
```

Replace the `return () => { ... }` block (lines 139–147) with:

```typescript
  return {
    cleanup: () => {
      clearInterval(intervalId);
      botManager.removeListener("botInstance", onBotInstance);
      botManager.removeListener("botInstanceRemoved", onBotInstanceRemoved);
      for (const id of Array.from(attachedBots.keys())) {
        detachBotListener(id);
      }
    },
    broadcast,
  };
```

Also replace the `WebSocketServer` creation in `src/web/server.ts` (around line 85) to pass `jwtSecret` and `authEnabled`, and use `verifyClient`:

```typescript
  const authEnabled = !!(options.config.adminPassword || options.config.users.length > 0);
  const jwtSecret = deriveSecret(options.config.adminPassword);

  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: authEnabled
      ? (info, cb) => {
          const url = new URL(
            info.req.url || "",
            `http://${info.req.headers.host}`
          );
          const token = url.searchParams.get("token");
          if (!token) {
            cb(false, 4001, "Authentication required");
            return;
          }
          const payload = verifyToken(token, jwtSecret);
          if (!payload) {
            cb(false, 4001, "Invalid token");
            return;
          }
          cb(true);
        }
      : undefined,
  });
```

And update the `setupWebSocket` call:

```typescript
  const wsResult = setupWebSocket(wss, options.botManager, logger, jwtSecret, authEnabled);
```

And update the `stop()` method:

```typescript
    stop(): void {
      wsResult.cleanup();
      wss.close();
      server.close();
    },
```

### Step 6: Modify `src/web/server.ts`

Add the login endpoint and global auth middleware. Replace the entire file content with the following (it's a controlled rewrite of the same structure):

```typescript
import express from "express";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import type { BotManager } from "../bot/manager.js";
import type { MusicProvider } from "../music/provider.js";
import type { BotDatabase } from "../data/database.js";
import type { BotConfig } from "../data/config.js";
import type { Logger } from "../logger.js";
import type { CookieStore } from "../music/auth.js";
import { createBotRouter } from "./api/bot.js";
import { createMusicRouter } from "./api/music.js";
import { createPlayerRouter } from "./api/player.js";
import { createAuthRouter } from "./api/auth.js";
import { createFavoritesRouter } from "./api/favorites.js";
import { setupWebSocket } from "./websocket.js";
import { deriveSecret, signToken, verifyToken } from "../auth/jwt.js";
import { createRequireAuth, createRequireAdmin } from "../auth/middleware.js";

export interface WebServerOptions {
  port: number;
  botManager: BotManager;
  neteaseProvider: MusicProvider;
  qqProvider: MusicProvider;
  bilibiliProvider: MusicProvider;
  database: BotDatabase;
  config: BotConfig;
  configPath: string;
  logger: Logger;
  cookieStore?: CookieStore;
  staticDir?: string;
}

export interface WebServer {
  start(): Promise<void>;
  stop(): void;
}

export function createWebServer(options: WebServerOptions): WebServer {
  const app = express();
  const server = http.createServer(app);
  const logger = options.logger.child({ component: "web" });

  if (options.config.trustProxy) {
    app.set("trust proxy", true);
  }

  app.use(express.json());

  const authEnabled = !!(
    options.config.adminPassword ||
    options.config.users.length > 0
  );
  const jwtSecret = deriveSecret(options.config.adminPassword);
  const requireAuth = createRequireAuth(jwtSecret);
  const requireAdmin = createRequireAdmin(jwtSecret);

  app.get("/api/config/public-url", (_req, res) => {
    const raw = (options.config.publicUrl ?? "").trim();
    res.json({ publicUrl: raw ? raw.replace(/\/+$/, "") : null });
  });

  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body;

    // Legacy single-admin mode (password only)
    if (
      !username &&
      password === options.config.adminPassword &&
      options.config.adminPassword
    ) {
      const token = signToken("admin", jwtSecret);
      res.json({ success: true, token, expiresIn: 86400 });
      return;
    }

    // User array mode
    const user = options.config.users.find(
      (u) => u.username === username && u.password === password
    );
    if (user) {
      const token = signToken(user.role, jwtSecret);
      res.json({ success: true, token, expiresIn: 86400 });
      return;
    }

    res.status(401).json({ success: false, error: "Invalid credentials" });
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      version: "0.1.0",
      authEnabled,
    });
  });

  // Global auth middleware for all /api/* except whitelist
  const AUTH_WHITELIST = [
    "/api/auth/login",
    "/api/config/public-url",
    "/api/health",
  ];
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) return next();
    if (AUTH_WHITELIST.includes(req.path)) return next();
    if (!authEnabled) return next();
    requireAuth(req, res, next);
  });

  app.use(
    "/api/bot",
    createBotRouter(
      options.botManager,
      options.config,
      options.configPath,
      logger
    )
  );
  app.use(
    "/api/music",
    createMusicRouter(
      options.neteaseProvider,
      options.qqProvider,
      options.bilibiliProvider,
      logger
    )
  );
  app.use(
    "/api/player",
    createPlayerRouter(
      options.botManager,
      logger,
      options.database,
      options.neteaseProvider,
      options.qqProvider,
      options.bilibiliProvider
    )
  );
  app.use(
    "/api/auth",
    createAuthRouter(
      options.neteaseProvider,
      options.qqProvider,
      options.bilibiliProvider,
      logger,
      options.cookieStore
    )
  );
  app.use(
    "/api/favorites",
    createFavoritesRouter(options.database, (data) =>
      wsResult.broadcast(data)
    )
  );

  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api|\/ws)/, (_req, res) => {
      res.sendFile(path.join(options.staticDir!, "index.html"));
    });
  }

  server.on("error", (err) => {
    logger.error({ err }, "HTTP server error");
  });

  const wss = new WebSocketServer({
    server,
    path: "/ws",
    verifyClient: authEnabled
      ? (info, cb) => {
          const url = new URL(
            info.req.url || "",
            `http://${info.req.headers.host}`
          );
          const token = url.searchParams.get("token");
          if (!token) {
            cb(false, 4001, "Authentication required");
            return;
          }
          const payload = verifyToken(token, jwtSecret);
          if (!payload) {
            cb(false, 4001, "Invalid token");
            return;
          }
          cb(true);
        }
      : undefined,
  });
  wss.on("error", (err) => {
    logger.error({ err }, "WebSocket server error");
  });
  const wsResult = setupWebSocket(
    wss,
    options.botManager,
    logger,
    jwtSecret,
    authEnabled
  );

  return {
    async start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(options.port, () => {
          logger.info({ port: options.port }, "Web server started");
          resolve();
        });
      });
    },
    stop(): void {
      wsResult.cleanup();
      wss.close();
      server.close();
    },
  };
}
```

### Step 7: Verify backend compiles

```bash
npm run build
```

Expected: TypeScript compilation succeeds with no errors.

### Step 8: Commit

```bash
git add package.json package-lock.json src/auth/jwt.ts src/auth/middleware.ts src/data/config.ts src/web/server.ts src/web/websocket.ts
git commit -m "feat(auth): add JWT backend — login endpoint, middleware, WebSocket validation"
```

---

## Task 2: Favorites Backend

**Files:**
- Modify: `src/data/database.ts`
- Create: `src/web/api/favorites.ts`

### Step 1: Modify `src/data/database.ts`

Add the favorites table and methods. First, add the interface (after `ProfileConfig`, around line 43):

```typescript
export interface FavoriteEntry {
  id?: number;
  songId: string;
  platform: string;
  title: string;
  artist: string;
  coverUrl: string;
}

export interface FavoriteRecord extends FavoriteEntry {
  id: number;
  createdAt: string;
}
```

Add methods to `BotDatabase` interface (after `saveProfileConfig`, around line 62):

```typescript
  addFavorite(entry: Omit<FavoriteEntry, "id">): void;
  getFavorites(): FavoriteRecord[];
  deleteFavorite(id: number): boolean;
  isFavorite(songId: string, platform: string): boolean;
```

Add table creation in `initTables()` (after the `bot_instances` table, around line 124):

```typescript
    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      songId TEXT NOT NULL,
      platform TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      coverUrl TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_song ON favorites(songId, platform);
```

Add prepared statements in `createDatabase()` (after `updateProfileConfig`, around line 180):

```typescript
  const insertFavorite = db.prepare(`
    INSERT INTO favorites (songId, platform, title, artist, coverUrl)
    VALUES (@songId, @platform, @title, @artist, @coverUrl)
  `);

  const selectFavorites = db.prepare(`
    SELECT * FROM favorites ORDER BY id DESC
  `);

  const deleteFavorite = db.prepare(`DELETE FROM favorites WHERE id = ?`);

  const checkFavorite = db.prepare(`
    SELECT 1 FROM favorites WHERE songId = ? AND platform = ? LIMIT 1
  `);
```

Add methods to the returned object (before `close()`, around line 243):

```typescript
    addFavorite(entry) {
      insertFavorite.run(entry);
    },

    getFavorites() {
      return selectFavorites.all() as FavoriteRecord[];
    },

    deleteFavorite(id) {
      const result = deleteFavorite.run(id);
      return result.changes > 0;
    },

    isFavorite(songId, platform) {
      const row = checkFavorite.get(songId, platform);
      return !!row;
    },
```

### Step 2: Create `src/web/api/favorites.ts`

```typescript
import { Router } from "express";
import type { BotDatabase } from "../../data/database.js";

export function createFavoritesRouter(
  database: BotDatabase,
  broadcast: (data: object) => void
): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    try {
      const favorites = database.getFavorites();
      res.json({ favorites });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/", (req, res) => {
    try {
      const { songId, platform, title, artist, coverUrl } = req.body;
      if (!songId || !platform || !title) {
        res.status(400).json({ error: "songId, platform, and title are required" });
        return;
      }
      database.addFavorite({ songId, platform, title, artist: artist || "", coverUrl: coverUrl || "" });
      const favorites = database.getFavorites();
      broadcast({ type: "favoritesChanged", favorites });
      res.json({ success: true, favorites });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.delete("/:id", (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) {
        res.status(400).json({ error: "Invalid id" });
        return;
      }
      const ok = database.deleteFavorite(id);
      if (!ok) {
        res.status(404).json({ error: "Favorite not found" });
        return;
      }
      const favorites = database.getFavorites();
      broadcast({ type: "favoritesChanged", favorites });
      res.json({ success: true, favorites });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
```

### Step 3: Verify backend compiles

```bash
npm run build
```

Expected: Compilation succeeds.

### Step 4: Commit

```bash
git add src/data/database.ts src/web/api/favorites.ts
git commit -m "feat(backend): add favorites table and REST API"
```

---

## Task 3: Favorites Frontend

**Files:**
- Create: `web/src/stores/favorites.ts`
- Create: `web/src/components/FavoriteButton.vue`
- Create: `web/src/views/Favorites.vue`
- Modify: `web/src/router/index.ts`
- Modify: `web/src/components/Navbar.vue`
- Modify: `web/src/components/SongCard.vue`
- Modify: `web/src/components/SongGridCard.vue`
- Modify: `web/src/components/Queue.vue`

### Step 1: Create `web/src/stores/favorites.ts`

```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { http } from '../utils/http';

export interface Favorite {
  id: number;
  songId: string;
  platform: string;
  title: string;
  artist: string;
  coverUrl: string;
  createdAt: string;
}

export const useFavoritesStore = defineStore('favorites', () => {
  const favorites = ref<Favorite[]>([]);
  const loading = ref(false);

  async function fetchFavorites() {
    loading.value = true;
    try {
      const res = await http.get('/api/favorites');
      favorites.value = res.data.favorites ?? [];
    } catch {
      favorites.value = [];
    } finally {
      loading.value = false;
    }
  }

  async function addFavorite(song: {
    id: string;
    platform: string;
    name: string;
    artist: string;
    coverUrl: string;
  }) {
    try {
      await http.post('/api/favorites', {
        songId: song.id,
        platform: song.platform,
        title: song.name,
        artist: song.artist,
        coverUrl: song.coverUrl,
      });
      await fetchFavorites();
    } catch (err) {
      console.error('Failed to add favorite:', err);
    }
  }

  async function removeFavorite(id: number) {
    try {
      await http.delete(`/api/favorites/${id}`);
      await fetchFavorites();
    } catch (err) {
      console.error('Failed to remove favorite:', err);
    }
  }

  const isFavorite = computed(() => {
    return (songId: string, platform: string) =>
      favorites.value.some((f) => f.songId === songId && f.platform === platform);
  });

  const getFavoriteId = computed(() => {
    return (songId: string, platform: string) =>
      favorites.value.find((f) => f.songId === songId && f.platform === platform)?.id;
  });

  function handleWsUpdate(data: { favorites?: Favorite[] }) {
    if (data.favorites) {
      favorites.value = data.favorites;
    }
  }

  return {
    favorites,
    loading,
    fetchFavorites,
    addFavorite,
    removeFavorite,
    isFavorite,
    getFavoriteId,
    handleWsUpdate,
  };
});
```

### Step 2: Create `web/src/components/FavoriteButton.vue`

```vue
<template>
  <button
    class="flex h-7 w-7 items-center justify-center rounded-full text-lg transition-all duration-200 hover:bg-interactive-hover"
    :class="isActive ? 'text-danger' : 'text-foreground-muted hover:text-foreground'"
    @click.stop="toggle"
    :title="isActive ? '取消收藏' : '收藏'"
  >
    <Icon :icon="isActive ? 'mdi:heart' : 'mdi:heart-outline'" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { Icon } from '@iconify/vue';
import { useFavoritesStore } from '../stores/favorites';

const props = defineProps<{
  songId: string;
  platform: string;
  songName: string;
  artist: string;
  coverUrl: string;
}>();

const favoritesStore = useFavoritesStore();
const isActive = computed(() =>
  favoritesStore.isFavorite(props.songId, props.platform)
);

async function toggle() {
  if (isActive.value) {
    const id = favoritesStore.getFavoriteId(props.songId, props.platform);
    if (id !== undefined) {
      await favoritesStore.removeFavorite(id);
    }
  } else {
    await favoritesStore.addFavorite({
      id: props.songId,
      platform: props.platform,
      name: props.songName,
      artist: props.artist,
      coverUrl: props.coverUrl,
    });
  }
}
</script>
```

### Step 3: Create `web/src/views/Favorites.vue`

```vue
<template>
  <div class="favorites-page">
    <h1 class="page-title">我的收藏</h1>

    <div v-if="store.loading" class="loading">加载中...</div>

    <div v-else-if="store.favorites.length === 0" class="empty">
      暂无收藏歌曲
    </div>

    <div v-else class="favorites-list">
      <SongCard
        v-for="(item, i) in store.favorites"
        :key="item.id"
        :song="{
          id: item.songId,
          name: item.title,
          artist: item.artist,
          album: '',
          duration: 0,
          coverUrl: item.coverUrl,
          platform: item.platform as any,
        }"
        :index="i + 1"
        :active="playerStore.currentSong?.id === item.songId"
        @play="play(item)"
        @add="add(item)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted } from 'vue';
import { useFavoritesStore, type Favorite } from '../stores/favorites';
import { usePlayerStore } from '../stores/player';
import SongCard from '../components/SongCard.vue';

const store = useFavoritesStore();
const playerStore = usePlayerStore();

function play(item: Favorite) {
  playerStore.playById(item.songId, item.platform);
}

function add(item: Favorite) {
  playerStore.addToQueueById(item.songId, item.platform);
}

onMounted(() => {
  store.fetchFavorites();
});
</script>

<style lang="scss" scoped>
.page-title {
  font-size: 28px;
  font-weight: 800;
  margin-bottom: 24px;
}

.favorites-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.loading {
  text-align: center;
  padding: 60px;
  color: var(--text-secondary);
}

.empty {
  text-align: center;
  padding: 80px;
  color: var(--text-tertiary);
  font-size: 14px;
}
</style>
```

### Step 4: Modify `web/src/router/index.ts`

Add `/login` and `/favorites` routes, plus route guards:

```typescript
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

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
      path: '/favorites',
      name: 'favorites',
      component: () => import('../views/Favorites.vue'),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('../views/Settings.vue'),
      meta: { requiresAdmin: true },
    },
    {
      path: '/setup',
      name: 'setup',
      component: () => import('../views/Setup.vue'),
    },
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
    },
    {
      path: '/bot/:id',
      name: 'bot',
      component: () => import('../views/BotRedirect.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/NotFound.vue'),
    },
  ],
});

router.beforeEach(async (to, from, next) => {
  const authStore = useAuthStore();

  // Check if auth is enabled (lazy, once)
  if (authStore.authEnabled === null) {
    try {
      await authStore.checkAuthEnabled();
    } catch {
      // Server unreachable — allow through, the API calls will fail
      return next();
    }
  }

  // Auth not enabled — allow everything
  if (!authStore.authEnabled) {
    return next();
  }

  // Login page always accessible
  if (to.path === '/login') {
    return next();
  }

  // Not authenticated — redirect to login
  if (!authStore.isAuthenticated) {
    return next({ path: '/login', query: { redirect: to.fullPath } });
  }

  // Admin-only routes
  if (to.meta.requiresAdmin && !authStore.isAdmin) {
    return next({ path: '/' });
  }

  next();
});

export default router;
```

### Step 5: Modify `web/src/components/Navbar.vue`

Add favorites link to desktop and mobile nav. In the desktop nav links (after 播放历史):

```vue
      <RouterLink to="/favorites" class="nav-link" active-class="active">收藏</RouterLink>
```

In the mobile menu (after 播放历史):

```vue
        <RouterLink to="/favorites" class="mobile-nav-link" active-class="active" @click="mobileMenuOpen = false">
          <Icon icon="mdi:heart" class="mr-3" /> 收藏
        </RouterLink>
```

### Step 6: Modify `web/src/components/SongCard.vue`

Add FavoriteButton after the song actions. In the template, replace the song-actions div (lines 17–24):

```vue
    <div class="song-actions">
      <FavoriteButton
        :song-id="song.id"
        :platform="song.platform"
        :song-name="song.name"
        :artist="song.artist"
        :cover-url="song.coverUrl"
      />
      <button class="action-btn" @click.stop="$emit('play')" title="播放">
        <Icon icon="mdi:play" />
      </button>
      <button class="action-btn" @click.stop="$emit('add')" title="添加到队列">
        <Icon icon="mdi:playlist-plus" />
      </button>
    </div>
```

Add the import:

```typescript
import FavoriteButton from './FavoriteButton.vue';
```

### Step 7: Modify `web/src/components/SongGridCard.vue`

Add FavoriteButton in the info section. In the template, replace the bottom flex row (lines 28–37):

```vue
      <div class="mt-2 flex items-center justify-between">
        <span class="text-xs text-foreground-subtle">{{ formatDuration(song.duration) }}</span>
        <div class="flex items-center gap-1">
          <FavoriteButton
            :song-id="song.id"
            :platform="song.platform"
            :song-name="song.name"
            :artist="song.artist"
            :cover-url="song.coverUrl"
          />
          <button
            class="flex h-7 w-7 items-center justify-center rounded-full text-foreground-muted opacity-0 transition-all duration-200 hover:bg-interactive-hover hover:text-primary group-hover:opacity-100"
            @click.stop="$emit('add')"
            title="添加到队列"
          >
            <Icon icon="mdi:playlist-plus" class="text-lg" />
          </button>
        </div>
      </div>
```

Add the import:

```typescript
import FavoriteButton from './FavoriteButton.vue';
```

### Step 8: Modify `web/src/components/Queue.vue`

Add FavoriteButton to each queue item. In the `#item` template, after the `queue-song-info` div and before the remove button:

```vue
            <FavoriteButton
              :song-id="song.id"
              :platform="song.platform"
              :song-name="song.name"
              :artist="song.artist"
              :cover-url="song.coverUrl"
            />
```

Add the import:

```typescript
import FavoriteButton from './FavoriteButton.vue';
```

### Step 9: Wire up WebSocket favorites sync in `useWebSocket.ts`

In the `ws.onmessage` handler, add a case for `favoritesChanged` (after the `botRemoved` case):

```typescript
        case 'favoritesChanged':
          if (Array.isArray(data.favorites)) {
            const favoritesStore = useFavoritesStore();
            favoritesStore.handleWsUpdate({ favorites: data.favorites as any });
          }
          break;
```

Add the import:

```typescript
import { useFavoritesStore } from '../stores/favorites';
```

### Step 10: Verify build

```bash
cd web && npm run build
```

Expected: Build succeeds.

### Step 11: Commit

```bash
git add web/src/stores/favorites.ts web/src/components/FavoriteButton.vue web/src/views/Favorites.vue web/src/router/index.ts web/src/components/Navbar.vue web/src/components/SongCard.vue web/src/components/SongGridCard.vue web/src/components/Queue.vue web/src/composables/useWebSocket.ts
git commit -m "feat(frontend): add favorites — FavoriteButton, Favorites page, navbar link, WS sync"
```

---

## Task 4: Lyrics Verification

**Files:**
- Verify: `web/src/views/Lyrics.vue`

The spec requires:
1. Full-screen lyrics with blur background — verify present
2. Active line highlight + auto-scroll — verify present
3. Fix interval timer accumulation leak — verify fixed

### Step 1: Verify interval management

Open `web/src/views/Lyrics.vue` and confirm:
- `startSync()` calls `stopSync()` before creating a new interval (line 155)
- `stopSync()` clears the interval and nulls the reference (lines 159–163)
- `onUnmounted()` calls `stopSync()` (line 182)

These are already present in the current code. No changes needed.

### Step 2: Commit (no-op marker)

```bash
git commit --allow-empty -m "chore: verify Lyrics.vue interval leak is fixed (no changes needed)"
```

---

## Task 5: Role-Based Access Backend

**Files:**
- Modify: `src/web/server.ts` (login endpoint to support username+password)

The JWT backend already supports roles (Task 1). This task just ensures the login endpoint properly handles the `users` config array.

### Step 1: Verify login endpoint supports username

The login endpoint in `src/web/server.ts` (Task 1, Step 6) already supports:
1. Legacy password-only mode → returns `role: "admin"`
2. Username+password from `config.users` array → returns the user's configured role

No additional changes needed for the backend.

### Step 2: Commit (no-op marker)

```bash
git commit --allow-empty -m "chore: verify role-based login backend is complete (no changes needed)"
```

---

## Task 6: Role-Based Access Frontend

**Files:**
- Modify: `web/src/stores/auth.ts`
- Modify: `web/src/views/Login.vue`
- Modify: `web/src/App.vue`

### Step 1: Modify `web/src/stores/auth.ts`

Add `role`, `isAdmin`, `username`, and `authEnabled` state:

```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { http } from '../utils/http';

function parseJwt(token: string): { role?: string } | null {
  try {
    const base64 = token.split('.')[1];
    const json = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('jwt_token'));
  const username = ref('');
  const loading = ref(false);
  const error = ref<string | null>(null);
  const authEnabled = ref<boolean | null>(null);

  const isAuthenticated = computed(() => !!token.value);

  const role = computed(() => {
    if (!token.value) return null;
    return parseJwt(token.value)?.role ?? null;
  });

  const isAdmin = computed(() => role.value === 'admin');

  async function checkAuthEnabled(): Promise<boolean> {
    try {
      const res = await http.get('/api/health');
      authEnabled.value = res.data.authEnabled === true;
      return authEnabled.value;
    } catch (err: unknown) {
      const status = (err as any)?.response?.status;
      if (!status) throw err;
      authEnabled.value = false;
      return false;
    }
  }

  async function login(password: string, user?: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await http.post('/api/auth/login', {
        password,
        username: user || undefined,
      });
      if (res.data.success) {
        token.value = res.data.token;
        localStorage.setItem('jwt_token', res.data.token);
        return true;
      }
      error.value = res.data.error ?? 'Login failed';
      return false;
    } catch (err: unknown) {
      const msg =
        (err as any)?.response?.data?.error ??
        (err instanceof Error ? err.message : 'Login failed');
      error.value = msg;
      return false;
    } finally {
      loading.value = false;
    }
  }

  function logout(): void {
    token.value = null;
    localStorage.removeItem('jwt_token');
  }

  function getToken(): string | null {
    return token.value;
  }

  return {
    token,
    username,
    loading,
    error,
    authEnabled,
    isAuthenticated,
    role,
    isAdmin,
    checkAuthEnabled,
    login,
    logout,
    getToken,
  };
});
```

### Step 2: Modify `web/src/views/Login.vue`

Add username input:

```vue
<template>
  <div class="flex min-h-screen items-center justify-center bg-surface">
    <div class="w-full max-w-[400px] rounded-xl bg-surface-elevated p-10 shadow-xl">
      <h1 class="mb-2 text-center text-[28px] font-bold text-foreground">TSMusicBot</h1>
      <p class="mb-8 text-center text-sm text-foreground-muted">请输入管理密码</p>
      <form @submit.prevent="handleLogin" class="flex flex-col gap-4">
        <input
          v-model="username"
          type="text"
          aria-label="用户名"
          class="w-full rounded-lg border border-border-default bg-surface px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
          placeholder="用户名（可选）"
          autocomplete="username"
          :disabled="authStore.loading"
        />
        <input
          v-model="password"
          type="password"
          aria-label="管理密码"
          class="w-full rounded-lg border border-border-default bg-surface px-4 py-3 text-base text-foreground outline-none transition-colors focus:border-primary disabled:opacity-60"
          placeholder="密码"
          autocomplete="current-password"
          :disabled="authStore.loading"
          autofocus
        />
        <p v-if="authStore.error" role="alert" class="text-sm text-danger">{{ authStore.error }}</p>
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
import { useAuthStore } from '../stores/auth';
import BaseButton from '../components/common/BaseButton.vue';

const router = useRouter();
const authStore = useAuthStore();
const username = ref('');
const password = ref('');

async function handleLogin() {
  const success = await authStore.login(password.value, username.value || undefined);
  if (success) {
    const redirect = (router.currentRoute.value.query.redirect as string) || '/';
    router.push(redirect);
  }
}
</script>
```

### Step 3: Modify `web/src/App.vue`

Add auth init on mount. After the existing imports, add:

```typescript
import { useAuthStore } from './stores/auth';
```

In the script setup, add:

```typescript
const authStore = useAuthStore();

onMounted(() => {
  playerStore.loadTheme();
  authStore.checkAuthEnabled().catch(() => {});
  connect();
  playerStore.fetchBots();
  syncTimer = setInterval(() => playerStore.syncElapsed(), 3000);
});
```

### Step 4: Modify `web/src/components/Navbar.vue`

Conditionally hide admin features for non-admin users. In the bot dropdown row, wrap the power and link buttons with a `v-if="authStore.isAdmin"`:

```vue
            <button
              v-if="authStore.isAdmin"
              class="bot-power-btn"
              ...
            >
              ...
            </button>
            <button
              v-if="authStore.isAdmin"
              class="bot-link-btn"
              ...
            >
              ...
            </button>
```

Add the auth store import:

```typescript
import { useAuthStore } from '../stores/auth';
```

And instantiate it:

```typescript
const authStore = useAuthStore();
```

Also conditionally show the Settings link in the mobile menu:

```vue
        <RouterLink
          v-if="authStore.isAdmin"
          to="/settings"
          class="mobile-nav-link"
          active-class="active"
          @click="mobileMenuOpen = false"
        >
          <Icon icon="mdi:cog" class="mr-3" /> 设置
        </RouterLink>
```

### Step 5: Verify build

```bash
cd web && npm run build
```

Expected: Build succeeds.

### Step 6: Commit

```bash
git add web/src/stores/auth.ts web/src/views/Login.vue web/src/App.vue web/src/components/Navbar.vue
git commit -m "feat(auth): role-based access frontend — username login, isAdmin guards, conditional UI"
```

---

## Task 7: Final Verification & Cleanup

### Step 1: Run full type check

```bash
cd web && npx vue-tsc --noEmit
```

Expected: Zero errors.

### Step 2: Run production build

```bash
cd web && npm run build
```

Expected: `vite build` completes successfully.

### Step 3: Run backend tests

```bash
npx vitest run src/audio/queue.test.ts
```

Expected: All queue tests pass.

### Step 4: Run backend compilation

```bash
npm run build
```

Expected: Backend TypeScript compiles with no errors.

### Step 5: Final commit

```bash
git add -A
git commit -m "feat: complete Phase 5 — favorites, lyrics verification, role-based access"
```

---

## Self-Review Checklist

### 1. Spec Coverage

| Design Doc Requirement | Task |
|------------------------|------|
| 收藏夹数据库表 | Task 2 (database.ts favorites table) |
| 收藏夹 API 端点 | Task 2 (favorites.ts router) |
| 收藏状态 WebSocket 同步 | Task 2 (broadcast on change) + Task 3 (handleWsUpdate) |
| 搜索结果收藏按钮 | Task 3 (SongGridCard FavoriteButton) |
| 队列收藏按钮 | Task 3 (Queue FavoriteButton) |
| 收藏列表页面 | Task 3 (Favorites.vue) |
| 导航栏收藏入口 | Task 3 (Navbar.vue) |
| 歌词全屏模糊背景 | Task 4 (already present) |
| 歌词高亮 + 自动滚动 | Task 4 (already present) |
| 歌词 interval 泄漏修复 | Task 4 (already present) |
| JWT payload role 字段 | Task 1 (jwt.ts signToken/verifyToken) |
| 用户配置 users 数组 | Task 1 (config.ts) |
| API 角色检查中间件 | Task 1 (middleware.ts createRequireAdmin) |
| 登录页用户名 + 密码 | Task 6 (Login.vue, auth.ts) |
| 管理功能仅管理员可见 | Task 6 (Navbar.vue conditional, route guards) |

**Gap:** None identified.

### 2. Placeholder Scan

- [x] No "TBD", "TODO", "implement later", "fill in details"
- [x] No vague "add error handling" without code
- [x] No "write tests" without test code (Phase 5 is feature-heavy; existing test infrastructure covers queue/database)
- [x] Each task is self-contained with complete code

### 3. Type Consistency

- [x] `JwtPayload.role` is `"admin" | "user"` everywhere
- [x] `BotConfig.users` array shape matches login check
- [x] `FavoriteEntry` / `FavoriteRecord` types used consistently across DB and API
- [x] `useAuthStore.isAdmin` is a computed boolean used in templates and route guards
- [x] `useFavoritesStore.isFavorite` signature matches usage in `FavoriteButton.vue`

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-29-phase5-advanced-features.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints

**Which approach?**
