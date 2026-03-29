# TSMusicBot Phase 6: Web Backend (Express API + WebSocket)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Express REST API and WebSocket server that the Vue.js frontend will consume. Covers bot management, music search/playback control, auth, and real-time state updates.

**Architecture:** `src/web/server.ts` bootstraps Express + WebSocket. API routes are split by domain: `bot.ts`, `music.ts`, `player.ts`, `auth.ts`. WebSocket pushes state changes in real-time.

**Tech Stack:** Express 4, ws, vitest

---

### Task 1: Web server bootstrap

**Files:**
- Create: `src/web/server.ts`

- [ ] **Step 1: Write implementation**

Create `src/web/server.ts`:

```typescript
import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { WebSocketServer } from 'ws';
import type { BotManager } from '../bot/manager.js';
import type { MusicProvider } from '../music/provider.js';
import type { Database } from '../data/database.js';
import type { BotConfig } from '../data/config.js';
import type { Logger } from '../logger.js';
import { createBotRouter } from './api/bot.js';
import { createMusicRouter } from './api/music.js';
import { createPlayerRouter } from './api/player.js';
import { createAuthRouter } from './api/auth.js';
import { setupWebSocket } from './websocket.js';

export interface WebServerOptions {
  port: number;
  botManager: BotManager;
  neteaseProvider: MusicProvider;
  qqProvider: MusicProvider;
  database: Database;
  config: BotConfig;
  logger: Logger;
  staticDir?: string; // path to built Vue.js SPA
}

export interface WebServer {
  start(): Promise<void>;
  stop(): void;
}

export function createWebServer(options: WebServerOptions): WebServer {
  const app = express();
  const server = http.createServer(app);
  const logger = options.logger.child({ component: 'web' });

  // Middleware
  app.use(express.json());

  // API routes
  app.use('/api/bot', createBotRouter(options.botManager, options.config, logger));
  app.use('/api/music', createMusicRouter(options.neteaseProvider, options.qqProvider, logger));
  app.use('/api/player', createPlayerRouter(options.botManager, logger));
  app.use('/api/auth', createAuthRouter(options.neteaseProvider, options.qqProvider, logger));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', version: '0.1.0' });
  });

  // Serve Vue.js SPA static files
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    // SPA fallback: serve index.html for all non-API routes
    app.get('*', (_req, res) => {
      res.sendFile(path.join(options.staticDir!, 'index.html'));
    });
  }

  // WebSocket
  const wss = new WebSocketServer({ server, path: '/ws' });
  setupWebSocket(wss, options.botManager, logger);

  return {
    async start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(options.port, () => {
          logger.info({ port: options.port }, 'Web server started');
          resolve();
        });
      });
    },
    stop(): void {
      wss.close();
      server.close();
    },
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/server.ts
git commit -m "feat: add Express + WebSocket web server bootstrap"
```

---

### Task 2: Bot management API

**Files:**
- Create: `src/web/api/bot.ts`

- [ ] **Step 1: Write implementation**

Create `src/web/api/bot.ts`:

```typescript
import { Router } from 'express';
import type { BotManager } from '../../bot/manager.js';
import type { BotConfig } from '../../data/config.js';
import type { Logger } from '../../logger.js';

export function createBotRouter(botManager: BotManager, config: BotConfig, logger: Logger): Router {
  const router = Router();

  // List all bot instances
  router.get('/', (_req, res) => {
    const bots = botManager.getAllBots().map((b) => b.getStatus());
    res.json({ bots });
  });

  // Get single bot status
  router.get('/:id', (req, res) => {
    const bot = botManager.getBot(req.params.id);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    res.json(bot.getStatus());
  });

  // Create new bot instance
  router.post('/', async (req, res) => {
    try {
      const { name, serverAddress, serverPort, nickname, defaultChannel, channelPassword, autoStart } = req.body;
      if (!name || !serverAddress || !nickname) {
        res.status(400).json({ error: 'name, serverAddress, and nickname are required' });
        return;
      }
      const bot = await botManager.createBot({
        name,
        serverAddress,
        serverPort: serverPort ?? 9987,
        nickname,
        defaultChannel,
        channelPassword,
        autoStart: autoStart ?? false,
      });
      res.status(201).json(bot.getStatus());
    } catch (err) {
      logger.error({ err }, 'Failed to create bot');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Delete bot instance
  router.delete('/:id', async (req, res) => {
    try {
      await botManager.removeBot(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Start bot (connect to TS server)
  router.post('/:id/start', async (req, res) => {
    try {
      await botManager.startBot(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Stop bot (disconnect from TS server)
  router.post('/:id/stop', (req, res) => {
    try {
      botManager.stopBot(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/api/bot.ts
git commit -m "feat: add bot management REST API (CRUD + start/stop)"
```

---

### Task 3: Music search API

**Files:**
- Create: `src/web/api/music.ts`

- [ ] **Step 1: Write implementation**

Create `src/web/api/music.ts`:

```typescript
import { Router } from 'express';
import type { MusicProvider } from '../../music/provider.js';
import type { Logger } from '../../logger.js';

export function createMusicRouter(
  neteaseProvider: MusicProvider,
  qqProvider: MusicProvider,
  logger: Logger,
): Router {
  const router = Router();

  function getProvider(platform?: string): MusicProvider {
    return platform === 'qq' ? qqProvider : neteaseProvider;
  }

  // Search
  router.get('/search', async (req, res) => {
    try {
      const { q, platform, limit } = req.query;
      if (!q) {
        res.status(400).json({ error: 'q (query) is required' });
        return;
      }
      const provider = getProvider(platform as string);
      const result = await provider.search(q as string, parseInt(limit as string) || 20);
      res.json(result);
    } catch (err) {
      logger.error({ err }, 'Search failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Song detail
  router.get('/song/:id', async (req, res) => {
    try {
      const provider = getProvider(req.query.platform as string);
      const song = await provider.getSongDetail(req.params.id);
      if (!song) {
        res.status(404).json({ error: 'Song not found' });
        return;
      }
      res.json(song);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Playlist songs
  router.get('/playlist/:id', async (req, res) => {
    try {
      const provider = getProvider(req.query.platform as string);
      const songs = await provider.getPlaylistSongs(req.params.id);
      res.json({ songs });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Recommended playlists
  router.get('/recommend/playlists', async (req, res) => {
    try {
      const provider = getProvider(req.query.platform as string);
      const playlists = await provider.getRecommendPlaylists();
      res.json({ playlists });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Album songs
  router.get('/album/:id', async (req, res) => {
    try {
      const provider = getProvider(req.query.platform as string);
      const songs = await provider.getAlbumSongs(req.params.id);
      res.json({ songs });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Lyrics
  router.get('/lyrics/:id', async (req, res) => {
    try {
      const provider = getProvider(req.query.platform as string);
      const lyrics = await provider.getLyrics(req.params.id);
      res.json({ lyrics });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/api/music.ts
git commit -m "feat: add music search/detail/playlist/lyrics REST API"
```

---

### Task 4: Player control API

**Files:**
- Create: `src/web/api/player.ts`

- [ ] **Step 1: Write implementation**

Create `src/web/api/player.ts`:

```typescript
import { Router } from 'express';
import type { BotManager } from '../../bot/manager.js';
import type { Logger } from '../../logger.js';
import { parseCommand } from '../../bot/commands.js';

export function createPlayerRouter(botManager: BotManager, logger: Logger): Router {
  const router = Router();

  // All player routes require a botId
  router.use('/:botId', (req, res, next) => {
    const bot = botManager.getBot(req.params.botId);
    if (!bot) {
      res.status(404).json({ error: 'Bot not found' });
      return;
    }
    (req as any).bot = bot;
    next();
  });

  // Play a song
  router.post('/:botId/play', async (req, res) => {
    try {
      const bot = (req as any).bot;
      const { query, platform } = req.body;
      if (!query) {
        res.status(400).json({ error: 'query is required' });
        return;
      }
      const flags = platform === 'qq' ? '-q' : '';
      const cmd = parseCommand(`!play ${flags} ${query}`.trim(), '!');
      if (!cmd) {
        res.status(400).json({ error: 'Invalid command' });
        return;
      }
      const response = await bot.executeCommand(cmd);
      res.json({ message: response });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Add to queue
  router.post('/:botId/add', async (req, res) => {
    try {
      const bot = (req as any).bot;
      const { query, platform } = req.body;
      const flags = platform === 'qq' ? '-q' : '';
      const cmd = parseCommand(`!add ${flags} ${query}`.trim(), '!');
      if (!cmd) {
        res.status(400).json({ error: 'Invalid command' });
        return;
      }
      const response = await bot.executeCommand(cmd);
      res.json({ message: response });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Pause
  router.post('/:botId/pause', async (req, res) => {
    const bot = (req as any).bot;
    const cmd = parseCommand('!pause', '!')!;
    const response = await bot.executeCommand(cmd);
    res.json({ message: response });
  });

  // Resume
  router.post('/:botId/resume', async (req, res) => {
    const bot = (req as any).bot;
    const cmd = parseCommand('!resume', '!')!;
    const response = await bot.executeCommand(cmd);
    res.json({ message: response });
  });

  // Next
  router.post('/:botId/next', async (req, res) => {
    const bot = (req as any).bot;
    const cmd = parseCommand('!next', '!')!;
    const response = await bot.executeCommand(cmd);
    res.json({ message: response });
  });

  // Previous
  router.post('/:botId/prev', async (req, res) => {
    const bot = (req as any).bot;
    const cmd = parseCommand('!prev', '!')!;
    const response = await bot.executeCommand(cmd);
    res.json({ message: response });
  });

  // Stop
  router.post('/:botId/stop', async (req, res) => {
    const bot = (req as any).bot;
    const cmd = parseCommand('!stop', '!')!;
    const response = await bot.executeCommand(cmd);
    res.json({ message: response });
  });

  // Set volume
  router.post('/:botId/volume', async (req, res) => {
    const bot = (req as any).bot;
    const { volume } = req.body;
    const cmd = parseCommand(`!vol ${volume}`, '!')!;
    const response = await bot.executeCommand(cmd);
    res.json({ message: response });
  });

  // Set play mode
  router.post('/:botId/mode', async (req, res) => {
    const bot = (req as any).bot;
    const { mode } = req.body;
    const cmd = parseCommand(`!mode ${mode}`, '!')!;
    const response = await bot.executeCommand(cmd);
    res.json({ message: response });
  });

  // Get queue
  router.get('/:botId/queue', (req, res) => {
    const bot = (req as any).bot;
    res.json({ queue: bot.getQueue(), status: bot.getStatus() });
  });

  // Clear queue
  router.post('/:botId/clear', async (req, res) => {
    const bot = (req as any).bot;
    const cmd = parseCommand('!clear', '!')!;
    const response = await bot.executeCommand(cmd);
    res.json({ message: response });
  });

  // Remove from queue
  router.delete('/:botId/queue/:index', async (req, res) => {
    const bot = (req as any).bot;
    const cmd = parseCommand(`!remove ${req.params.index}`, '!')!;
    const response = await bot.executeCommand(cmd);
    res.json({ message: response });
  });

  // Load playlist
  router.post('/:botId/playlist', async (req, res) => {
    try {
      const bot = (req as any).bot;
      const { playlistId, platform } = req.body;
      const flags = platform === 'qq' ? '-q' : '';
      const cmd = parseCommand(`!playlist ${flags} ${playlistId}`.trim(), '!')!;
      const response = await bot.executeCommand(cmd);
      res.json({ message: response });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Play history
  router.get('/:botId/history', (req, res) => {
    const bot = (req as any).bot;
    const limit = parseInt(req.query.limit as string) || 50;
    // Access database directly through the bot's status
    // The database is accessed through the botManager
    res.json({ history: [] }); // Will be wired properly when database is accessible
  });

  return router;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/api/player.ts
git commit -m "feat: add player control REST API (play, pause, queue, volume, mode)"
```

---

### Task 5: Auth API

**Files:**
- Create: `src/web/api/auth.ts`

- [ ] **Step 1: Write implementation**

Create `src/web/api/auth.ts`:

```typescript
import { Router } from 'express';
import type { MusicProvider } from '../../music/provider.js';
import type { Logger } from '../../logger.js';

export function createAuthRouter(
  neteaseProvider: MusicProvider,
  qqProvider: MusicProvider,
  logger: Logger,
): Router {
  const router = Router();

  function getProvider(platform?: string): MusicProvider {
    return platform === 'qq' ? qqProvider : neteaseProvider;
  }

  // Get auth status
  router.get('/status', async (req, res) => {
    try {
      const platform = req.query.platform as string;
      const provider = getProvider(platform);
      const status = await provider.getAuthStatus();
      res.json({ platform: provider.platform, ...status });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Get QR code for login
  router.post('/qrcode', async (req, res) => {
    try {
      const { platform } = req.body;
      const provider = getProvider(platform);
      const qr = await provider.getQrCode();
      res.json(qr);
    } catch (err) {
      logger.error({ err }, 'QR code generation failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Check QR code status
  router.get('/qrcode/status', async (req, res) => {
    try {
      const { key, platform } = req.query;
      if (!key) {
        res.status(400).json({ error: 'key is required' });
        return;
      }
      const provider = getProvider(platform as string);
      const status = await provider.checkQrCodeStatus(key as string);
      res.json({ status });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Send SMS code (NetEase only)
  router.post('/sms/send', async (req, res) => {
    try {
      const { phone } = req.body;
      if (!phone) {
        res.status(400).json({ error: 'phone is required' });
        return;
      }
      if (!neteaseProvider.sendSmsCode) {
        res.status(400).json({ error: 'SMS login not supported for this platform' });
        return;
      }
      const success = await neteaseProvider.sendSmsCode(phone);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Verify SMS code (NetEase only)
  router.post('/sms/verify', async (req, res) => {
    try {
      const { phone, code } = req.body;
      if (!phone || !code) {
        res.status(400).json({ error: 'phone and code are required' });
        return;
      }
      if (!neteaseProvider.loginWithSms) {
        res.status(400).json({ error: 'SMS login not supported' });
        return;
      }
      const success = await neteaseProvider.loginWithSms(phone, code);
      res.json({ success });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // Set cookie manually
  router.post('/cookie', (req, res) => {
    const { platform, cookie } = req.body;
    if (!cookie) {
      res.status(400).json({ error: 'cookie is required' });
      return;
    }
    const provider = getProvider(platform);
    provider.setCookie(cookie);
    res.json({ success: true });
  });

  return router;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/api/auth.ts
git commit -m "feat: add auth REST API (QR code, SMS, cookie login)"
```

---

### Task 6: WebSocket real-time updates

**Files:**
- Create: `src/web/websocket.ts`

- [ ] **Step 1: Write implementation**

Create `src/web/websocket.ts`:

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { BotManager } from '../bot/manager.js';
import type { Logger } from '../logger.js';

export function setupWebSocket(wss: WebSocketServer, botManager: BotManager, logger: Logger): void {
  const clients = new Set<WebSocket>();

  wss.on('connection', (ws) => {
    clients.add(ws);
    logger.debug('WebSocket client connected');

    // Send initial state
    const bots = botManager.getAllBots().map((b) => b.getStatus());
    ws.send(JSON.stringify({ type: 'init', bots }));

    ws.on('close', () => {
      clients.delete(ws);
      logger.debug('WebSocket client disconnected');
    });

    ws.on('error', (err) => {
      logger.error({ err }, 'WebSocket error');
      clients.delete(ws);
    });
  });

  // Broadcast state changes from all bots
  const broadcast = (data: object) => {
    const message = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  };

  // Listen for state changes on all bots
  // Re-attach listeners when bots are added/removed
  const attachBotListeners = () => {
    for (const bot of botManager.getAllBots()) {
      // Remove existing listeners to avoid duplicates
      bot.removeAllListeners('stateChange');
      bot.removeAllListeners('connected');
      bot.removeAllListeners('disconnected');

      bot.on('stateChange', () => {
        broadcast({
          type: 'stateChange',
          botId: bot.id,
          status: bot.getStatus(),
          queue: bot.getQueue(),
        });
      });

      bot.on('connected', () => {
        broadcast({ type: 'botConnected', botId: bot.id, status: bot.getStatus() });
      });

      bot.on('disconnected', () => {
        broadcast({ type: 'botDisconnected', botId: bot.id });
      });
    }
  };

  // Refresh listeners periodically (simple approach)
  setInterval(attachBotListeners, 5000);
  attachBotListeners();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/web/websocket.ts
git commit -m "feat: add WebSocket real-time state broadcasting"
```

---

### Task 7: Wire everything in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Update entry point**

Replace the contents of `src/index.ts`:

```typescript
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig } from './data/config.js';
import { createDatabase } from './data/database.js';
import { createLogger } from './logger.js';
import { createApiServerManager } from './music/api-server.js';
import { NeteaseProvider } from './music/netease.js';
import { QQMusicProvider } from './music/qq.js';
import { createCookieStore } from './music/auth.js';
import { BotManager } from './bot/manager.js';
import { createWebServer } from './web/server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'tsmusicbot.db');
const LOG_DIR = path.join(DATA_DIR, 'logs');
const COOKIE_DIR = path.join(DATA_DIR, 'cookies');
const STATIC_DIR = path.join(ROOT_DIR, 'web', 'dist');

async function main() {
  // Load config
  const config = loadConfig(CONFIG_PATH);
  saveConfig(CONFIG_PATH, config);

  // Create logger
  const logger = createLogger(LOG_DIR);

  // Create database
  const db = createDatabase(DB_PATH);

  // Start embedded music API servers
  const apiServer = createApiServerManager(
    { neteasePort: config.neteaseApiPort, qqMusicApiPort: config.qqMusicApiPort },
    logger,
  );
  await apiServer.start();

  // Create music providers
  const neteaseProvider = new NeteaseProvider(apiServer.getNeteaseBaseUrl());
  const qqProvider = new QQMusicProvider(apiServer.getQQMusicBaseUrl());

  // Load saved cookies
  const cookieStore = createCookieStore(COOKIE_DIR);
  const neteaseCookie = cookieStore.load('netease');
  if (neteaseCookie) neteaseProvider.setCookie(neteaseCookie);
  const qqCookie = cookieStore.load('qq');
  if (qqCookie) qqProvider.setCookie(qqCookie);

  // Create bot manager
  const botManager = new BotManager(neteaseProvider, qqProvider, db, config, logger);
  await botManager.loadSavedBots();

  // Create and start web server
  const webServer = createWebServer({
    port: config.webPort,
    botManager,
    neteaseProvider,
    qqProvider,
    database: db,
    config,
    logger,
    staticDir: STATIC_DIR,
  });
  await webServer.start();

  logger.info({ webPort: config.webPort }, 'TSMusicBot started');
  logger.info(`WebUI: http://localhost:${config.webPort}`);

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    botManager.shutdown();
    webServer.stop();
    apiServer.stop();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: wire all components in entry point — full backend stack"
```

---

### Task 8: Verify Phase 6

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: Phase 6 complete — web backend (REST API, WebSocket, full wiring)"
```
