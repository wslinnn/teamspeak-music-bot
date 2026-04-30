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
import { createAuthRouterWithConfig } from "./api/auth.js";
import { createFavoritesRouter } from "./api/favorites.js";
import { setupWebSocket } from "./websocket.js";
import { deriveSecret, verifyToken } from "../auth/jwt.js";
import { createRequireAuth, createRequireAdmin } from "../auth/middleware.js";
import { COOKIE_NAME } from "./api/auth.js";
import { saveConfig } from "../data/config.js";

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

  const authEnabled = !!options.config.adminPassword && !!options.config.userPassword;
  const jwtSecret = deriveSecret(options.config.adminPassword);
  const requireAuth = createRequireAuth(jwtSecret);
  const requireAdmin = createRequireAdmin(jwtSecret);

  app.get("/api/config/public-url", (_req, res) => {
    const raw = (options.config.publicUrl ?? "").trim();
    res.json({ publicUrl: raw ? raw.replace(/\/+$/, "") : null });
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      version: "0.1.0",
      authEnabled,
      needsSetup: !options.config.adminPassword || !options.config.userPassword,
    });
  });

  // Setup endpoint: set admin and user passwords on first run
  app.post("/api/setup", (req, res) => {
    if (options.config.adminPassword && options.config.userPassword) {
      res.status(403).json({ success: false, error: "Setup already completed" });
      return;
    }
    const { adminPassword, userPassword } = req.body;
    if (!adminPassword || typeof adminPassword !== "string" || adminPassword.trim().length === 0) {
      res.status(400).json({ success: false, error: "Admin password is required" });
      return;
    }
    if (!userPassword || typeof userPassword !== "string" || userPassword.trim().length === 0) {
      res.status(400).json({ success: false, error: "User password is required" });
      return;
    }
    options.config.adminPassword = adminPassword;
    options.config.userPassword = userPassword;
    try {
      saveConfig(options.configPath, options.config);
    } catch (err) {
      logger.error({ err }, "Failed to save config during setup");
      res.status(500).json({ success: false, error: "Failed to save configuration" });
      return;
    }
    logger.info("Admin and user passwords set via setup");
    res.json({ success: true });
  });

  // Global auth middleware for all /api/* except whitelist
  const AUTH_WHITELIST = new Set([
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/config/public-url",
    "/api/health",
    "/api/setup",
  ]);
  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) return next();
    if (AUTH_WHITELIST.has(req.path)) return next();
    if (!authEnabled) return next();
    requireAuth(req, res, next);
  });

  app.use(
    "/api/bot",
    createBotRouter(
      options.botManager,
      options.config,
      options.configPath,
      logger,
      requireAuth,
      requireAdmin
    )
  );
  app.use(
    "/api/music",
    createMusicRouter(
      options.neteaseProvider,
      options.qqProvider,
      options.bilibiliProvider,
      logger,
      requireAdmin
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
      options.bilibiliProvider,
      requireAdmin
    )
  );
  app.use(
    "/api/auth",
    createAuthRouterWithConfig(
      options.neteaseProvider,
      options.qqProvider,
      options.bilibiliProvider,
      logger,
      options.config,
      jwtSecret,
      options.config.jwtExpiresIn,
      options.cookieStore,
      requireAdmin
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
          // Read token from cookie instead of URL param
          const cookieHeader = info.req.headers.cookie;
          let token: string | undefined;
          if (cookieHeader) {
            for (const part of cookieHeader.split(";")) {
              const [key, ...rest] = part.split("=");
              if (key?.trim() === COOKIE_NAME) {
                token = rest.join("=").trim();
                break;
              }
            }
          }
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
