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
import { createRateLimiter } from "../auth/rate-limit.js";
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

  const loginLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 5000 });

  app.post("/api/auth/login", (req, res, next) => {
    const ip = req.ip ?? "unknown";
    if (loginLimiter.isLimited(ip)) {
      res.status(429).json({ success: false, error: "Too many login attempts" });
      return;
    }
    next();
  }, (req, res) => {
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

  app.use(
    "/api/favorites",
    createFavoritesRouter(options.database, (data: object) =>
      wsResult.broadcast(data)
    )
  );

  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api|\/ws)/, (_req, res) => {
      res.sendFile(path.join(options.staticDir!, "index.html"));
    });
  }

  // Global error handler — catches errors thrown in route handlers
  // that weren't caught by try/catch. Must have 4 parameters for Express.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err, path: _req.path }, "Unhandled API error");
    res.status(500).json({ success: false, error: "Internal server error" });
  });

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
