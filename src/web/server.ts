import express from "express";
import http from "node:http";
import path from "node:path";
import { WebSocketServer } from "ws";
import type { BotManager } from "../bot/manager.js";
import type { MusicProvider } from "../music/provider.js";
import type { BotDatabase } from "../data/database.js";
import type { BotConfig } from "../data/config.js";
import { getJwtSecret } from "../data/config.js";
import type { Logger } from "../logger.js";
import type { CookieStore } from "../music/auth.js";
import { createBotRouter } from "./api/bot.js";
import { createMusicRouter } from "./api/music.js";
import { createPlayerRouter } from "./api/player.js";
import { createAuthRouter } from "./api/auth.js";
import { createAdminLoginHandler } from "../auth/login.js";
import { createRequireAuth } from "../auth/middleware.js";
import { setupAuthenticatedWebSocket } from "./websocket.js";

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
  const jwtSecret = getJwtSecret(options.config.adminPassword);
  const authEnabled = jwtSecret.length > 0;

  if (options.config.trustProxy) {
    app.set("trust proxy", true);
  }

  app.use(express.json());

  // --- Public routes (no auth required, per spec) ---
  // These MUST be registered BEFORE the auth middleware below.
  // Do NOT move them after the createRequireAuth() calls.
  app.get("/api/config/public-url", (_req, res) => {
    const raw = (options.config.publicUrl ?? "").trim();
    res.json({ publicUrl: raw ? raw.replace(/\/+$/, "") : null });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0", authEnabled });
  });

  // Login endpoint — always public (registered before auth middleware)
  if (authEnabled) {
    app.post(
      "/api/auth/login",
      createAdminLoginHandler(options.config.adminPassword, jwtSecret, logger),
    );
  }

  // --- Protected routes (auth required when enabled) ---
  // IMPORTANT: All routes below this point require JWT authentication when
  // adminPassword is set. To add a new public endpoint, register it ABOVE.
  if (authEnabled) {
    app.use("/api/bot", createRequireAuth(jwtSecret));
    app.use("/api/music", createRequireAuth(jwtSecret));
    app.use("/api/player", createRequireAuth(jwtSecret));
    app.use("/api/auth", createRequireAuth(jwtSecret));
    logger.info("Authentication enabled — all API endpoints require JWT");
  } else {
    logger.warn("No adminPassword set — authentication DISABLED, all endpoints are public");
  }

  // Route handlers
  app.use(
    "/api/bot",
    createBotRouter(options.botManager, options.config, options.configPath, logger),
  );
  app.use(
    "/api/music",
    createMusicRouter(options.neteaseProvider, options.qqProvider, options.bilibiliProvider, logger),
  );
  app.use("/api/player", createPlayerRouter(
    options.botManager, logger, options.database,
    options.neteaseProvider, options.qqProvider, options.bilibiliProvider,
  ));
  app.use(
    "/api/auth",
    createAuthRouter(options.neteaseProvider, options.qqProvider, options.bilibiliProvider, logger, options.cookieStore),
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

  server.on("error", (err) => {
    logger.error({ err }, "HTTP server error");
  });

  const wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("error", (err) => {
    logger.error({ err }, "WebSocket server error");
  });
  const cleanupWs = setupAuthenticatedWebSocket(
    wss, options.botManager, logger, jwtSecret,
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
      cleanupWs();
      wss.close();
      server.close();
    },
  };
}
