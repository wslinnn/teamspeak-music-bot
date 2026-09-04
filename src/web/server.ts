import express from "express";
import http from "node:http";
import path from "node:path";
import cookieParser from "cookie-parser";
import { WebSocketServer } from "ws";
import type { BotManager } from "../bot/manager.js";
import type { MusicProvider } from "../music/provider.js";
import type { BotDatabase } from "../data/database.js";
import type { BotConfig, GuestModeConfig } from "../data/config.js";
import type { Logger } from "../logger.js";
import type { CookieStore } from "../music/auth.js";
import type { AvatarStore } from "../data/avatars.js";
import { createBotRouter } from "./api/bot.js";
import { createMusicRouter } from "./api/music.js";
import { createPlayerRouter } from "./api/player.js";
import { createAuthRouter } from "./api/auth.js";
import { createSessionRouter } from "./api/session.js";
import { createClientTokenRouter } from "./api/client.js";
import { createUsersRouter } from "./api/users.js";
import { createAuditStore } from "../data/audit.js";
import { createAuditRouter } from "./api/audit.js";
import { createFavoritesRouter } from "./api/favorites.js";
import { createSongFavoritesRouter } from "./api/song-favorites.js";
import { createSavedQueuesRouter } from "./api/saved-queues.js";
import { createSpotifyRouter } from "./api/spotify.js";
import type { SpotifyOAuth } from "../music/spotify/spotify-oauth.js";
import type { SpotifyProvider } from "../music/spotify/provider.js";
import type { JellyfinProvider } from "../music/jellyfin.js";
import { resolveSpotifyBackendKind } from "../music/spotify/backend-select.js";
import {
  isGoLibrespotPresent,
  isLibrespotPresent,
} from "../music/spotify/binary.js";
import { setupWebSocket } from "./websocket.js";
import { createUserStore } from "../data/users.js";
import { createSessionStore } from "../data/sessions.js";
import { createClientTokenStore } from "../data/client-tokens.js";
import { createPermissionStore } from "../data/permissions.js";
import { createRequireAuth } from "./middleware/requireAuth.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import { requireNotGuest } from "./middleware/requireNotGuest.js";
import { csrfOriginCheck } from "./middleware/csrf.js";
import { createRateLimit } from "./middleware/rateLimit.js";
import { validateSessionFromHeaders, extractSessionToken } from "./auth/validateSession.js";
import { resolvePermissionContext } from "../data/permissions.js";
import { hashToken } from "../data/sessions.js";

const SESSION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export interface WebServerOptions {
  port: number;
  /** Bind address; defaults to all interfaces when omitted. */
  host?: string;
  botManager: BotManager;
  neteaseProvider: MusicProvider;
  qqProvider: MusicProvider;
  bilibiliProvider: MusicProvider;
  localProvider: MusicProvider;
  kugouProvider: MusicProvider;
  spotifyProvider: MusicProvider;
  jellyfinProvider: MusicProvider;
  database: BotDatabase;
  config: BotConfig;
  configPath: string;
  logger: Logger;
  cookieStore?: CookieStore;
  avatarStore: AvatarStore;
  staticDir?: string;
  /** Process-wide shared Spotify OAuth (single account, Stage 3). When set, the
   *  /api/spotify {login,callback,status} router is mounted. */
  spotifyOAuth?: SpotifyOAuth;
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

  // Security headers:
  //  • X-Frame-Options / CSP frame-ancestors — prevent the WebUI from being
  //    embedded in a third-party iframe (clickjacking defence). CSP
  //    frame-ancestors is the modern equivalent of X-Frame-Options; both are
  //    set for compatibility across browsers.
  //  • X-Robots-Tag — keep deployed instances out of search-engine indexes
  //    (issue #128: searching "TsmusicBot" surfaced strangers' WebUI URLs).
  //    Set on EVERY response so JSON/API responses and the SPA shell are all
  //    covered; complements /robots.txt and the <meta name="robots"> tag.
  app.use((req, res, next) => {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    // Audit SEC-09: harden the remaining baseline headers. HSTS only makes
    // sense once the request is actually TLS (behind a proxy with
    // trustProxy or terminated locally); harmless to omit otherwise.
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    if (req.secure) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  app.use(express.json({ limit: "400kb" }));
  app.use(cookieParser());

  const users = createUserStore(options.database.db);
  const sessions = createSessionStore(options.database.db);
  const clientTokens = createClientTokenStore(options.database.db);
  const audit = createAuditStore(options.database.db);
  const permissions = createPermissionStore(options.database.db);

  // ─── Public routes (no auth, no CSRF) ───────────────────────────────────
  // Disallow every crawler (issue #128). Declared before the static SPA
  // fallback so this wins over index.html for /robots.txt. Belt-and-braces
  // with the X-Robots-Tag header above and the <meta name="robots"> tag.
  app.get("/robots.txt", (_req, res) => {
    res.type("text/plain").send("User-agent: *\nDisallow: /\n");
  });

  app.get("/api/health", (_req, res) => {
    // Audit SEC-11: version number omitted — this endpoint is unauthenticated
    // and version disclosure helps attackers target known issues.
    res.json({ status: "ok" });
  });

  app.get("/api/config/public-url", (_req, res) => {
    const raw = (options.config.publicUrl ?? "").trim();
    res.json({ publicUrl: raw ? raw.replace(/\/+$/, "") : null });
  });

  // Anti-DoS: throttle expensive (bcrypt) auth endpoints.
  // 5 req per minute per IP for /login (capacity 5, refill 5/60 = ~0.083/sec).
  // 3 req per minute per IP for /setup (more limited; first-run is rare).
  // Login additionally keys on the submitted username so a distributed /
  // XFF-rotating attack still trips a bucket per targeted account instead of
  // getting a fresh IP-keyed bucket per request.
  const loginLimit = createRateLimit({
    capacity: 5,
    refillPerSec: 5 / 60,
    keyFn: (req) => {
      const body = (req.body ?? {}) as { username?: unknown };
      const username = typeof body.username === "string" ? body.username.toLowerCase() : "";
      return `${req.ip ?? "unknown"}|${username}`;
    },
  });
  const setupLimit = createRateLimit({ capacity: 3, refillPerSec: 3 / 60 });
  app.use("/api/session/login", loginLimit);
  app.use("/api/session/setup", setupLimit);
  // Guest sessions are anonymous and uncounted — without a limiter an attacker
  // can mint 1-day session rows at line speed and bloat the sessions table.
  const guestLimit = createRateLimit({ capacity: 10, refillPerSec: 10 / 60 });
  app.use("/api/session/guest", guestLimit);
  // Client bearer-token login shares the login limiter (same bcrypt cost, and
  // brute-forcing one route must not get a fresh bucket on the other).
  app.use("/api/client/login", loginLimit);

  app.use(
    "/api/session",
    createSessionRouter(
      users, sessions, clientTokens, audit, logger, permissions,
      () => options.config.guestMode,
      (userId, exceptHash) => onSessionsRevoked(userId, exceptHash)
    )
  );

  // ─── Client bearer-token routes (credentials in body / Authorization      ───
  // header — no cookie semantics) mount before the gates, mirroring session.  ───
  // Same no-op bridge pattern: wired to the WS hub once it exists.
  let closeSocketsByTokenHash: (tokenHash: string) => void = () => {};
  app.use(
    "/api/client",
    createClientTokenRouter(users, clientTokens, audit, logger, (hash) => closeSocketsByTokenHash(hash))
  );

  // ─── Gates for everything else under /api ───────────────────────────────
  const requireAuth = createRequireAuth(sessions, clientTokens, permissions, () => options.config.guestMode);
  app.use("/api", csrfOriginCheck);
  app.use("/api", requireAuth);

  // ─── Protected routes ───────────────────────────────────────────────────
  // The bot router is mounted BEFORE setupWebSocket runs, but its /settings
  // handler needs to trigger a guest-policy refresh on the (later-created) WS
  // controller. Bridge the two with a mutable indirection that starts as a
  // no-op and is wired to the real refreshGuestPolicy once the WS is set up.
  let onGuestPolicyChanged: (cfg: GuestModeConfig) => void = () => {};
  // Mutable indirection (same bridge pattern as onGuestPolicyChanged): the
  // session/users routers are mounted before the WS hub exists, so the hook
  // starts as a no-op and is wired to closeUserSessions once setupWebSocket ran.
  let onSessionsRevoked: (userId: string, exceptTokenHash?: string) => void = () => {};
  app.use(
    "/api/bot",
    createBotRouter(
      options.botManager,
      options.config,
      options.configPath,
      logger,
      options.database,
      options.avatarStore,
      (cfg) => onGuestPolicyChanged(cfg),
      // I2: so saving a Client ID in Settings re-configures the live OAuth
      // (no restart needed for the UI-entered-creds -> Connect flow).
      options.spotifyOAuth,
      // R2-4: so saving Spotify creds in Settings also refreshes the live Web API
      // search provider (search + getAuthStatus) without a process restart. The
      // runtime object is a SpotifyProvider (see index.ts); WebServerOptions types
      // it as the wider MusicProvider, so narrow it here for the setCreds contract.
      options.spotifyProvider as SpotifyProvider,
      // Same live-reconfigure contract for Jellyfin: a Settings save re-points
      // the connection without a restart. Runtime object is a JellyfinProvider
      // (see index.ts); WebServerOptions types it as the wider MusicProvider.
      options.jellyfinProvider as JellyfinProvider,
    )
  );
  app.use(
    "/api/music",
    createMusicRouter(options.neteaseProvider, options.qqProvider, options.bilibiliProvider, logger, options.localProvider, options.config, options.kugouProvider, options.spotifyProvider, options.jellyfinProvider, options.configPath)
  );
  app.use("/api/player", createPlayerRouter(
    options.botManager, logger, options.database,
    options.neteaseProvider, options.qqProvider, options.bilibiliProvider,
  ));
  app.use(
    "/api/auth",
    createAuthRouter(options.neteaseProvider, options.qqProvider, options.bilibiliProvider, logger, options.cookieStore, options.kugouProvider, options.spotifyProvider, options.jellyfinProvider, options.config)
  );
  if (options.spotifyOAuth) {
    app.use(
      "/api/spotify",
      createSpotifyRouter({
        oauth: options.spotifyOAuth,
        logger,
        getBackendInfo: () => {
          // PATH-aware presence (Bug m1): a PATH-installed binary (bare name)
          // is resolved against $PATH, not existsSync()'d against cwd.
          const goPresent = isGoLibrespotPresent();
          const rustPresent = isLibrespotPresent();
          const resolved = resolveSpotifyBackendKind(
            options.config.spotify.backend,
            goPresent,
            rustPresent,
          );
          return {
            backend: resolved ?? "none",
            deviceName: options.config.spotify.deviceName,
            binaryAvailable: resolved !== null,
          };
        },
        webUiRedirect: "/",
      }),
    );
  }
  app.use("/api/favorites", requireNotGuest, createFavoritesRouter(options.database, logger));
  // Fork: song favorites (cross-client), broadcast via WS like on legacy main.
  // The WS controller is created later — bridge with a no-op indirection.
  let broadcastToClients: (data: object) => void = () => {};
  app.use(
    "/api/song-favorites",
    requireNotGuest,
    createSongFavoritesRouter(options.database, (data) => broadcastToClients(data), logger)
  );
  // Saved queues (Feature 1, #119). Members + admins only (requireNotGuest);
  // the router itself 403s every route unless savedQueuesEnabled is on.
  app.use(
    "/api/saved-queues",
    requireNotGuest,
    createSavedQueuesRouter(
      options.database,
      options.botManager,
      () => options.config.savedQueuesEnabled,
      logger,
    ),
  );

  // admin-only routes
  app.use(
    "/api/users",
    requireAdmin,
    createUsersRouter(users, sessions, clientTokens, audit, logger, permissions, (userId, exceptHash) =>
      onSessionsRevoked(userId, exceptHash)
    )
  );
  app.use("/api/audit", requireAdmin, createAuditRouter(audit));

  // ─── Static SPA (public) ────────────────────────────────────────────────
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api|\/ws)/, (_req, res) => {
      res.sendFile(path.join(options.staticDir!, "index.html"));
    });
  }

  server.on("error", (err) => {
    logger.error({ err }, "HTTP server error");
  });

  // ─── WebSocket with manual upgrade auth ────────────────────────────────
  const wss = new WebSocketServer({ noServer: true });
  wss.on("error", (err) => {
    logger.error({ err }, "WebSocket server error");
  });

  // ─── WS 心跳 ───────────────────────────────────────────────────────────
  // 广播是事件驱动的：无人操作时连接可以长时间完全静默，nginx 的
  // proxy_read_timeout（默认 60s）/ 移动 NAT 会把空闲连接掐断，客户端
  // 陷入"断开 → 秒级重连"循环（断线横幅频繁闪烁）。25s 一次 ping 保活
  // 穿越所有中间层（浏览器在协议层自动回 pong，前端零改动）；连续两轮
  // 无 pong 的半开连接 terminate 清理。
  const HEARTBEAT_INTERVAL_MS = 25_000;
  // WeakSet<object>：@types/ws 与 ws 包的 WebSocket 类型双声明不兼容，
  // 这里只关心对象身份，不依赖其类型成员
  const alive = new WeakSet<object>();
  wss.on("connection", (ws) => {
    alive.add(ws);
    ws.on("pong", () => alive.add(ws));
  });
  // Keep the handle so stop() can clear it (audit PERF-09) — an uncleared
  // interval kept breaking hot restarts in tests.
  const heartbeatTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.has(ws)) {
        ws.terminate();
        continue;
      }
      alive.delete(ws);
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") {
      socket.destroy();
      return;
    }
    const reqHost = req.headers.host;
    const originHeader = req.headers.origin;
    if (originHeader) {
      let originHost: string | null = null;
      try {
        originHost = new URL(originHeader).host;
      } catch {
        // fall through; treat as missing/invalid origin
      }
      if (!originHost || originHost !== reqHost) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }
    }
    // Bearer auth (non-browser clients, e.g. tsmb-desktop) takes precedence
    // over the cookie path; an explicit header credential fails loudly.
    const authHeader = req.headers.authorization;
    let result: ReturnType<typeof validateSessionFromHeaders>;
    let bearerHash: string | undefined;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      const raw = authHeader.slice(7);
      result = clientTokens.validate(raw);
      if (!result) {
        wss.handleUpgrade(req, socket, head, (ws) => ws.close(4001, "invalid token"));
        return;
      }
      bearerHash = hashToken(raw);
    } else {
      result = validateSessionFromHeaders(req.headers.cookie as string | undefined, sessions);
      if (!result) {
        // 认证失败：完成握手后以 4001 关闭（B3）。前端 useWebSocket 以 4001
        // 判定"请重新登录"并停止重连；裸 401 拒绝只会让浏览器报 1006，前端
        // 陷入无效重连循环、与 HTTP 401 跳转互相打架。
        wss.handleUpgrade(req, socket, head, (ws) => ws.close(4001, "session expired"));
        return;
      }
    }
    // Guest sessions are only valid while guest mode is enabled.
    if (result.role === "guest" && !options.config.guestMode.enabled) {
      wss.handleUpgrade(req, socket, head, (ws) => ws.close(4001, "guest mode disabled"));
      return;
    }
    // Resolve the bot scope through the same permission context the HTTP
    // middlewares use, so members restricted via user_bot_access are ALSO
    // scoped here — previously members always got "all" and kept receiving
    // every bot's status/queue broadcasts over WS.
    const guestCfg = options.config.guestMode;
    const permCtx = resolvePermissionContext(
      result.role,
      result.userId,
      permissions,
      result.role === "guest" ? { bots: guestCfg.bots, permissions: guestCfg.permissions } : undefined
    );
    const botScope: "all" | Set<string> = permCtx.bots ?? "all";
    wss.handleUpgrade(req, socket, head, (ws) => {
      const w = ws as unknown as { userId: string; isGuest: boolean; botScope: "all" | Set<string>; tokenHash?: string };
      w.userId = result.userId;
      w.isGuest = result.role === "guest";
      w.botScope = botScope;
      // Audit SEC-08: remember which credential this socket belongs to so a
      // later logout/revocation can close exactly it (cookie sessions and
      // client bearer tokens alike) and spare other devices' live logins.
      if (bearerHash) {
        w.tokenHash = bearerHash;
      } else {
        const upgradeToken = extractSessionToken(req.headers.cookie as string | undefined);
        if (upgradeToken) w.tokenHash = hashToken(upgradeToken);
      }
      wss.emit("connection", ws, req);
    });
  });
  const controller = setupWebSocket(wss, options.botManager, logger);
  onGuestPolicyChanged = controller.refreshGuestPolicy;
  broadcastToClients = (data) => controller.broadcast(data);
  onSessionsRevoked = (userId, exceptHash) => controller.closeUserSessions(userId, { exceptTokenHash: exceptHash });
  closeSocketsByTokenHash = controller.closeSocketsByTokenHash;

  // ─── Session cleanup interval ──────────────────────────────────────────
  let cleanupTimer: ReturnType<typeof setInterval> | null = null;

  return {
    async start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(options.port, options.host ?? "0.0.0.0", () => {
          logger.info({ port: options.port, host: options.host ?? "0.0.0.0" }, "Web server started");
          cleanupTimer = setInterval(() => {
            try {
              sessions.cleanupExpired();
              clientTokens.cleanupExpired();
            } catch (err) {
              logger.error({ err }, "session cleanup failed");
            }
          }, SESSION_CLEANUP_INTERVAL_MS);
          resolve();
        });
      });
    },
    stop(): void {
      if (cleanupTimer) {
        clearInterval(cleanupTimer);
        cleanupTimer = null;
      }
      clearInterval(heartbeatTimer);
      controller.cleanup();
      wss.close();
      server.close();
    },
  };
}
