# Phase 1: Security Hardening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add JWT-based authentication to all API endpoints, WebSocket connections, and TS channel commands, with a frontend login page.

**Architecture:** A new `src/auth/` module provides JWT sign/verify and Express middleware. The web server applies `requireAuth` to all `/api/*` routes except the login endpoint and public config. WebSocket validates a token query param on connection. TS commands check invoker server groups against `config.adminGroups`.

**Tech Stack:** jsonwebtoken (JWT), Express middleware, Vue 3 Router guards, localStorage

**Spec:** `docs/superpowers/specs/2026-04-28-comprehensive-refactoring-design.md` — Phase 1

---

## File Structure

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/auth/jwt.ts` | JWT sign/verify utility |
| Create | `src/auth/middleware.ts` | Express `requireAuth` middleware |
| Create | `src/auth/rate-limit.ts` | Per-IP login rate limiter |
| Modify | `src/data/config.ts` | Add `jwtSecret` derived field helper |
| Modify | `src/web/server.ts` | Wire auth middleware, add login route |
| Modify | `src/web/api/auth.ts` | Add admin login endpoint |
| Modify | `src/web/websocket.ts` | Validate token on connection |
| Modify | `src/bot/instance.ts` | Implement admin group check for TS commands |
| Create | `web/src/stores/auth.ts` | Frontend auth store (token management) |
| Create | `web/src/views/Login.vue` | Login page |
| Modify | `web/src/router/index.ts` | Add login route, route guard, 404 |
| Modify | `web/src/composables/useWebSocket.ts` | Attach token to WS URL |
| Modify | `web/src/App.vue` | Init auth on mount |

---

### Task 1: Install jsonwebtoken

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install dependency**

Run:
```bash
cd "D:/develop/音乐机器人/teamspeak-music-bot"
npm install jsonwebtoken
npm install -D @types/jsonwebtoken
```

- [ ] **Step 2: Verify installation**

Run: `node -e "require('jsonwebtoken')" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add jsonwebtoken dependency for Phase 1 auth"
```

---

### Task 2: Create JWT utility module

**Files:**
- Create: `src/auth/jwt.ts`
- Create: `src/auth/jwt.test.ts`

- [ ] **Step 1: Write tests for JWT utility**

Create `src/auth/jwt.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "./jwt.js";

const secret = "test-secret-key";

describe("JWT utility", () => {
  it("signs and verifies a token", () => {
    const token = signToken({ role: "admin" }, secret, "1h");
    const payload = verifyToken(token, secret);
    expect(payload.role).toBe("admin");
  });

  it("rejects a token signed with wrong secret", () => {
    const token = signToken({ role: "admin" }, secret, "1h");
    expect(() => verifyToken(token, "wrong-secret")).toThrow();
  });

  it("rejects an expired token", () => {
    const token = signToken({ role: "admin" }, secret, "0s");
    // Wait briefly for expiration
    const payload = verifyToken(token, secret);
    // jsonwebtoken may still return payload briefly; verify with longer wait
    expect(() => {
      // Force check by verifying a clearly expired token
      const expiredToken = signToken({ role: "admin" }, secret, "-1s");
      verifyToken(expiredToken, secret);
    }).toThrow();
  });

  it("includes role in payload", () => {
    const token = signToken({ role: "user" }, secret, "1h");
    const payload = verifyToken(token, secret);
    expect(payload.role).toBe("user");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/auth/jwt.test.ts`
Expected: FAIL — module `./jwt.js` not found

- [ ] **Step 3: Create JWT utility**

Create `src/auth/jwt.ts`:

```typescript
import jwt from "jsonwebtoken";

export interface JwtPayload {
  role: "admin" | "user";
}

/**
 * Sign a JWT with the given payload.
 * @param payload - Data to embed in the token
 * @param secret - HMAC secret key
 * @param expiresIn - e.g. "24h", "1h", "0s"
 */
export function signToken(
  payload: JwtPayload,
  secret: string,
  expiresIn: string,
): string {
  return jwt.sign(payload, secret, { expiresIn });
}

/**
 * Verify and decode a JWT. Throws on invalid/expired tokens.
 */
export function verifyToken(token: string, secret: string): JwtPayload {
  const decoded = jwt.verify(token, secret);
  return decoded as JwtPayload;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/auth/jwt.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/jwt.ts src/auth/jwt.test.ts
git commit -m "feat(auth): add JWT sign/verify utility with tests"
```

---

### Task 3: Create per-IP login rate limiter

**Files:**
- Create: `src/auth/rate-limit.ts`
- Create: `src/auth/rate-limit.test.ts`

- [ ] **Step 1: Write tests for rate limiter**

Create `src/auth/rate-limit.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createRateLimiter } from "./rate-limit.js";

describe("Rate limiter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("allows requests within the limit", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 5000 });
    expect(limiter.check("1.2.3.4")).toBe(true);
    expect(limiter.check("1.2.3.4")).toBe(true);
    expect(limiter.check("1.2.3.4")).toBe(true);
  });

  it("blocks requests exceeding the limit", () => {
    const limiter = createRateLimiter({ maxAttempts: 3, windowMs: 5000 });
    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");
    expect(limiter.check("1.2.3.4")).toBe(false);
  });

  it("resets after the window expires", () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 5000 });
    limiter.check("1.2.3.4");
    limiter.check("1.2.3.4");
    expect(limiter.check("1.2.3.4")).toBe(false);
    vi.advanceTimersByTime(5001);
    expect(limiter.check("1.2.3.4")).toBe(true);
  });

  it("tracks IPs independently", () => {
    const limiter = createRateLimiter({ maxAttempts: 2, windowMs: 5000 });
    limiter.check("1.1.1.1");
    limiter.check("1.1.1.1");
    expect(limiter.check("2.2.2.2")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/auth/rate-limit.test.ts`
Expected: FAIL

- [ ] **Step 3: Create rate limiter**

Create `src/auth/rate-limit.ts`:

```typescript
export interface RateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
}

interface AttemptRecord {
  count: number;
  windowStart: number;
}

export interface RateLimiter {
  check(ip: string): boolean;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const records = new Map<string, AttemptRecord>();

  function check(ip: string): boolean {
    const now = Date.now();
    const record = records.get(ip);

    if (!record || now - record.windowStart >= options.windowMs) {
      records.set(ip, { count: 1, windowStart: now });
      return true;
    }

    record.count++;
    if (record.count > options.maxAttempts) {
      return false;
    }
    return true;
  }

  return { check };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/auth/rate-limit.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/rate-limit.ts src/auth/rate-limit.test.ts
git commit -m "feat(auth): add per-IP login rate limiter with tests"
```

---

### Task 4: Create auth middleware

**Files:**
- Create: `src/auth/middleware.ts`
- Create: `src/auth/middleware.test.ts`

- [ ] **Step 1: Write tests for auth middleware**

Create `src/auth/middleware.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createRequireAuth } from "./middleware.js";
import { signToken } from "./jwt.js";
import type { Request, Response, NextFunction } from "express";

const secret = "test-secret";

function mockReq(headers: Record<string, string> = {}): Partial<Request> {
  return { headers };
}

function mockRes(): { statusCode: number; body: unknown } {
  const result = { statusCode: 200, body: null };
  return {
    statusCode: result.statusCode,
    body: result.body,
    status(code: number) {
      result.statusCode = code;
      return this;
    },
    json(data: unknown) {
      result.body = data;
      return this;
    },
  } as unknown as Response;
}

describe("requireAuth middleware", () => {
  const requireAuth = createRequireAuth(secret);

  it("passes through with valid token", () => {
    const token = signToken({ role: "admin" }, secret, "1h");
    const req = mockReq({ authorization: `Bearer ${token}` });
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireAuth(req as Request, res as Response, next);
    expect(nextCalled).toBe(true);
  });

  it("rejects request with no authorization header", () => {
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireAuth(req as Request, res as Response, next);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("rejects request with invalid token", () => {
    const req = mockReq({ authorization: "Bearer invalid-token" });
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireAuth(req as Request, res as Response, next);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it("rejects request with wrong scheme", () => {
    const token = signToken({ role: "admin" }, secret, "1h");
    const req = mockReq({ authorization: `Token ${token}` });
    const res = mockRes();
    let nextCalled = false;
    const next: NextFunction = () => { nextCalled = true; };

    requireAuth(req as Request, res as Response, next);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/auth/middleware.test.ts`
Expected: FAIL

- [ ] **Step 3: Create auth middleware**

Create `src/auth/middleware.ts`:

```typescript
import type { Request, Response, NextFunction } from "express";
import { verifyToken, type JwtPayload } from "./jwt.js";

/**
 * Create an Express middleware that requires a valid JWT
 * in the Authorization: Bearer header.
 */
export function createRequireAuth(secret: string) {
  return function requireAuth(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ success: false, error: "Missing or invalid authorization header" });
      return;
    }

    const token = header.slice(7);
    try {
      const payload: JwtPayload = verifyToken(token, secret);
      // Attach user info to request for downstream handlers
      (req as Request & { user: JwtPayload }).user = payload;
      next();
    } catch {
      res.status(401).json({ success: false, error: "Invalid or expired token" });
    }
  };
}

/** Augment Express Request to include user payload after auth */
declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayload;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/auth/middleware.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/auth/middleware.ts src/auth/middleware.test.ts
git commit -m "feat(auth): add Express requireAuth middleware with tests"
```

---

### Task 5: Add login endpoint to auth router

**Files:**
- Modify: `src/web/api/auth.ts`

This task adds a `POST /api/auth/login` endpoint that validates the admin password and returns a JWT. The existing music platform auth endpoints remain untouched.

- [ ] **Step 1: Read current auth.ts**

Read `src/web/api/auth.ts` (already reviewed above). The current file exports `createAuthRouter` which handles music platform auth. We will add a new exported function `createAdminLoginHandler` and integrate it in `server.ts`.

- [ ] **Step 2: Create admin login handler**

Create `src/auth/login.ts`:

```typescript
import { signToken } from "./jwt.js";
import { createRateLimiter, type RateLimiter } from "./rate-limit.js";
import type { Logger } from "../logger.js";

interface LoginBody {
  password?: string;
}

/**
 * Create an Express handler for POST /api/auth/login.
 * Validates the password against config, returns JWT on success.
 */
export function createAdminLoginHandler(
  adminPassword: string,
  jwtSecret: string,
  logger: Logger,
) {
  const limiter: RateLimiter = createRateLimiter({
    maxAttempts: 5,
    windowMs: 5000,
  });

  return function handleLogin(req: import("express").Request, res: import("express").Response): void {
    const ip = req.ip ?? "unknown";

    if (!limiter.check(ip)) {
      logger.warn({ ip }, "Login rate limited");
      res.status(429).json({ success: false, error: "Too many login attempts" });
      return;
    }

    const { password } = req.body as LoginBody;
    if (!password) {
      res.status(400).json({ success: false, error: "Password is required" });
      return;
    }

    if (password !== adminPassword) {
      logger.warn({ ip }, "Login failed: wrong password");
      res.status(401).json({ success: false, error: "Invalid password" });
      return;
    }

    const token = signToken({ role: "admin" }, jwtSecret, "24h");
    logger.info({ ip }, "Admin login successful");
    res.json({ success: true, token, expiresIn: "24h" });
  };
}
```

- [ ] **Step 3: Commit**

```bash
git add src/auth/login.ts
git commit -m "feat(auth): add admin login handler with rate limiting"
```

---

### Task 6: Derive JWT secret from admin password and wire everything into server

**Files:**
- Modify: `src/data/config.ts` — add `getJwtSecret()` helper
- Modify: `src/web/server.ts` — wire auth middleware, login route

- [ ] **Step 1: Add JWT secret helper to config**

Modify `src/data/config.ts` — add after the `saveConfig` function:

```typescript
import { createHmac } from "node:crypto";

/**
 * Derive a stable JWT secret from the admin password.
 * If adminPassword is empty, returns an empty string (auth disabled).
 */
export function getJwtSecret(adminPassword: string): string {
  if (!adminPassword) return "";
  return createHmac("sha256", "tsmusicbot-jwt-salt").update(adminPassword).digest("hex");
}
```

- [ ] **Step 2: Modify server.ts to wire auth**

The key changes to `src/web/server.ts`:

1. Import auth modules
2. If `adminPassword` is set, apply `requireAuth` middleware to all `/api/*` except login and public-url
3. Add `POST /api/auth/login` route

Replace the entire `createWebServer` function body. Here's the new `src/web/server.ts`:

```typescript
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

  // --- Public routes (no auth required) ---
  app.get("/api/config/public-url", (_req, res) => {
    const raw = (options.config.publicUrl ?? "").trim();
    res.json({ publicUrl: raw ? raw.replace(/\/+$/, "") : null });
  });

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0", authEnabled });
  });

  // Login endpoint — always public
  if (authEnabled) {
    app.post(
      "/api/auth/login",
      createAdminLoginHandler(options.config.adminPassword, jwtSecret, logger),
    );
  }

  // --- Protected routes (auth required when enabled) ---
  if (authEnabled) {
    app.use("/api/bot", createRequireAuth(jwtSecret));
    app.use("/api/music", createRequireAuth(jwtSecret));
    app.use("/api/player", createRequireAuth(jwtSecret));
    app.use("/api/auth", createRequireAuth(jwtSecret));
    logger.info("Authentication enabled — all API endpoints require JWT");
  } else {
    logger.warn("No adminPassword set — authentication DISABLED, all endpoints are public");
  }

  // Route handlers (unchanged)
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
```

- [ ] **Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors (may need to update websocket.ts import first — see Task 7)

- [ ] **Step 4: Commit**

```bash
git add src/data/config.ts src/web/server.ts
git commit -m "feat(auth): wire JWT middleware into web server with opt-in auth"
```

---

### Task 7: Add WebSocket token validation

**Files:**
- Modify: `src/web/websocket.ts`

The WebSocket server must validate the JWT token on connection. Unauthenticated connections are rejected with close code 4001.

- [ ] **Step 1: Modify websocket.ts**

Rename the function from `setupWebSocket` to `setupAuthenticatedWebSocket` and add token validation on connection. The function signature gains a `jwtSecret` parameter (empty string means auth disabled).

Replace `src/web/websocket.ts` with:

```typescript
import { WebSocketServer, WebSocket } from "ws";
import type { BotManager } from "../bot/manager.js";
import type { BotInstance } from "../bot/instance.js";
import type { Logger } from "../logger.js";
import { verifyToken } from "../auth/jwt.js";

export function setupAuthenticatedWebSocket(
  wss: WebSocketServer,
  botManager: BotManager,
  logger: Logger,
  jwtSecret: string,
): () => void {
  const clients = new Set<WebSocket>();

  const attachedBots = new Map<string, {
    bot: BotInstance;
    stateChange: () => void;
    connected: () => void;
    disconnected: () => void;
  }>();

  wss.on("connection", (ws, req) => {
    // --- Token validation ---
    if (jwtSecret) {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const token = url.searchParams.get("token");
      if (!token) {
        logger.warn("WebSocket connection rejected: no token");
        ws.close(4001, "Authentication required");
        return;
      }
      try {
        verifyToken(token, jwtSecret);
      } catch {
        logger.warn("WebSocket connection rejected: invalid token");
        ws.close(4001, "Invalid or expired token");
        return;
      }
    }

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

  const broadcast = (data: object) => {
    const message = JSON.stringify(data);
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
        } catch {
          clients.delete(client);
        }
      }
    }
  };

  function detachBotListener(id: string): void {
    const existing = attachedBots.get(id);
    if (!existing) return;
    existing.bot.removeListener("stateChange", existing.stateChange);
    existing.bot.removeListener("connected", existing.connected);
    existing.bot.removeListener("disconnected", existing.disconnected);
    attachedBots.delete(id);
  }

  function attachBotListener(bot: BotInstance): void {
    const existing = attachedBots.get(bot.id);
    if (existing) {
      if (existing.bot === bot) return;
      detachBotListener(bot.id);
    }

    const onStateChange = () => {
      broadcast({
        type: "stateChange",
        botId: bot.id,
        status: bot.getStatus(),
        queue: bot.getQueue(),
      });
    };

    const onConnected = () => {
      broadcast({
        type: "botConnected",
        botId: bot.id,
        status: bot.getStatus(),
      });
    };

    const onDisconnected = () => {
      broadcast({
        type: "botDisconnected",
        botId: bot.id,
        status: bot.getStatus(),
      });
    };

    bot.on("stateChange", onStateChange);
    bot.on("connected", onConnected);
    bot.on("disconnected", onDisconnected);

    attachedBots.set(bot.id, {
      bot,
      stateChange: onStateChange,
      connected: onConnected,
      disconnected: onDisconnected,
    });
  }

  function ensureAllBotsAttached(): void {
    for (const bot of botManager.getAllBots()) {
      attachBotListener(bot);
    }
  }

  const onBotInstance = (bot: BotInstance) => attachBotListener(bot);
  botManager.on("botInstance", onBotInstance);

  const onBotInstanceRemoved = (id: string) => {
    detachBotListener(id);
    broadcast({ type: "botRemoved", botId: id });
  };
  botManager.on("botInstanceRemoved", onBotInstanceRemoved);

  function reconcileAttachedBots(): void {
    const liveIds = new Set(botManager.getAllBots().map((b) => b.id));
    for (const id of Array.from(attachedBots.keys())) {
      if (!liveIds.has(id)) detachBotListener(id);
    }
  }

  const intervalId = setInterval(() => {
    reconcileAttachedBots();
    ensureAllBotsAttached();
  }, 5000);
  ensureAllBotsAttached();

  return () => {
    clearInterval(intervalId);
    botManager.removeListener("botInstance", onBotInstance);
    botManager.removeListener("botInstanceRemoved", onBotInstanceRemoved);
    for (const id of Array.from(attachedBots.keys())) {
      detachBotListener(id);
    }
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/web/websocket.ts
git commit -m "feat(auth): add WebSocket token validation on connection"
```

---

### Task 8: Implement TS command admin group check

**Files:**
- Modify: `src/bot/instance.ts`

The `handleTextMessage` method currently has a TODO for checking if the invoker is in `adminGroups`. We implement this by querying the TS3 client for the invoker's server groups.

- [ ] **Step 1: Add helper method to query invoker groups**

In `src/bot/instance.ts`, add a private method to `BotInstance` class. Find the `handleTextMessage` method (around line 210) and add this new method before it:

```typescript
  /**
   * Check if a TS user (by client database ID) belongs to any of the
   * configured admin server groups.
   * Returns true if adminGroups is empty (no restriction) or the user
   * is in one of the configured groups.
   */
  private async isInvokerAdmin(invokerDbId: string): Promise<boolean> {
    const groups = this.config.adminGroups;
    if (groups.length === 0) return true;

    try {
      // Use clientinfo command to get server groups for the invoker.
      // TS3 returns client_servergroups as a comma-separated list of IDs.
      const results = await this.tsClient.execCommandWithResponse(
        `clientinfo clid=${invokerDbId}`,
      );
      if (!results.length) return false;

      const serverGroupsStr = results[0]["client_servergroups"] ?? "";
      const userGroups = serverGroupsStr
        .split(",")
        .map((g: string) => parseInt(g, 10))
        .filter((g: number) => !isNaN(g));

      return userGroups.some((g: number) => groups.includes(g));
    } catch (err) {
      this.logger.error({ err, invokerDbId }, "Failed to check invoker groups");
      // On error, allow access — fail open to avoid locking out all users
      return true;
    }
  }
```

- [ ] **Step 2: Replace the TODO with actual check**

In `src/bot/instance.ts`, find the `handleTextMessage` method and replace the admin check block. Change from:

```typescript
    if (isAdminCommand(parsed.name)) {
      // TODO: Check if invoker is in adminGroups
    }
```

To:

```typescript
    if (isAdminCommand(parsed.name)) {
      const isAdmin = await this.isInvokerAdmin(msg.invokerId);
      if (!isAdmin) {
        await this.tsClient.sendTextMessage("Permission denied: admin only command");
        return;
      }
    }
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/bot/instance.ts
git commit -m "feat(auth): implement admin group check for TS channel commands"
```

---

### Task 9: Create frontend auth store

**Files:**
- Create: `web/src/stores/auth.ts`

This Pinia store manages the JWT token in localStorage and provides login/logout actions.

- [ ] **Step 1: Create auth store**

Create `web/src/stores/auth.ts`:

```typescript
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import axios from 'axios';

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('jwt_token'));
  const loading = ref(false);
  const error = ref<string | null>(null);

  const isAuthenticated = computed(() => !!token.value);

  /** Check if auth is enabled on the server */
  async function checkAuthEnabled(): Promise<boolean> {
    try {
      const res = await axios.get('/api/health');
      return res.data.authEnabled === true;
    } catch {
      return false;
    }
  }

  async function login(password: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const res = await axios.post('/api/auth/login', { password });
      if (res.data.success) {
        token.value = res.data.token;
        localStorage.setItem('jwt_token', res.data.token);
        return true;
      }
      error.value = res.data.error ?? 'Login failed';
      return false;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed';
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

  /** Get the token, or null if not authenticated */
  function getToken(): string | null {
    return token.value;
  }

  return { token, loading, error, isAuthenticated, login, logout, getToken, checkAuthEnabled };
});
```

- [ ] **Step 2: Commit**

```bash
git add web/src/stores/auth.ts
git commit -m "feat(auth): add frontend Pinia auth store with login/logout"
```

---

### Task 10: Create Login.vue page

**Files:**
- Create: `web/src/views/Login.vue`

- [ ] **Step 1: Create login page**

Create `web/src/views/Login.vue`:

```vue
<template>
  <div class="login-page">
    <div class="login-card">
      <h1 class="login-title">TSMusicBot</h1>
      <p class="login-subtitle">请输入管理密码</p>
      <form @submit.prevent="handleLogin">
        <input
          v-model="password"
          type="password"
          class="login-input"
          placeholder="管理密码"
          autocomplete="current-password"
          :disabled="authStore.loading"
          autofocus
        />
        <p v-if="authStore.error" class="login-error">{{ authStore.error }}</p>
        <button type="submit" class="login-btn" :disabled="authStore.loading || !password">
          {{ authStore.loading ? '登录中...' : '登录' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const router = useRouter();
const authStore = useAuthStore();
const password = ref('');

async function handleLogin() {
  const success = await authStore.login(password.value);
  if (success) {
    router.push('/');
  }
}
</script>

<style scoped lang="scss">
.login-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--bg-primary);
}

.login-card {
  background: var(--bg-secondary);
  border-radius: 12px;
  padding: 48px 40px;
  width: 100%;
  max-width: 400px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
}

.login-title {
  text-align: center;
  font-size: 28px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 8px;
}

.login-subtitle {
  text-align: center;
  color: var(--text-secondary);
  margin: 0 0 32px;
  font-size: 14px;
}

.login-input {
  width: 100%;
  padding: 12px 16px;
  border: 1px solid var(--border-color, #444);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 16px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.2s;

  &:focus {
    border-color: var(--accent, #6366f1);
  }

  &:disabled {
    opacity: 0.6;
  }
}

.login-error {
  color: #ef4444;
  font-size: 13px;
  margin: 8px 0 0;
}

.login-btn {
  width: 100%;
  padding: 12px;
  margin-top: 20px;
  background: var(--accent, #6366f1);
  color: #fff;
  border: none;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;

  &:hover:not(:disabled) {
    opacity: 0.9;
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
}
</style>
```

- [ ] **Step 2: Commit**

```bash
git add web/src/views/Login.vue
git commit -m "feat(auth): add Login.vue page"
```

---

### Task 11: Add route guard and login route

**Files:**
- Modify: `web/src/router/index.ts`

- [ ] **Step 1: Update router with login route, 404 route, and auth guard**

Replace `web/src/router/index.ts`:

```typescript
import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth.js';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/Login.vue'),
      meta: { public: true },
    },
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
    {
      path: '/setup',
      name: 'setup',
      component: () => import('../views/Setup.vue'),
    },
    {
      path: '/bot/:id',
      name: 'bot',
      component: () => import('../views/BotRedirect.vue'),
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('../views/Home.vue'),
    },
  ],
});

// Track whether we've checked if auth is enabled
let authCheckDone = false;
let serverAuthEnabled = false;

router.beforeEach(async (to) => {
  // Login page is always accessible
  if (to.meta.public) return true;

  const authStore = useAuthStore();

  // Check once if the server has auth enabled
  if (!authCheckDone) {
    serverAuthEnabled = await authStore.checkAuthEnabled();
    authCheckDone = true;
  }

  // If server doesn't require auth, let all routes through
  if (!serverAuthEnabled) return true;

  // Server requires auth — check if user is logged in
  if (authStore.isAuthenticated) return true;

  // Not logged in, redirect to login
  return { name: 'login', query: { redirect: to.fullPath } };
});

export default router;
```

- [ ] **Step 2: Handle redirect after login**

Modify `web/src/views/Login.vue` — update the `handleLogin` function:

Change:
```typescript
  async function handleLogin() {
    const success = await authStore.login(password.value);
    if (success) {
      router.push('/');
    }
  }
```

To:
```typescript
  async function handleLogin() {
    const success = await authStore.login(password.value);
    if (success) {
      const redirect = (router.currentRoute.value.query.redirect as string) || '/';
      router.push(redirect);
    }
  }
```

- [ ] **Step 3: Commit**

```bash
git add web/src/router/index.ts web/src/views/Login.vue
git commit -m "feat(auth): add login route, 404 route, and auth guard"
```

---

### Task 12: Update WebSocket composable to attach token

**Files:**
- Modify: `web/src/composables/useWebSocket.ts`

- [ ] **Step 1: Update useWebSocket to attach JWT token**

Replace `web/src/composables/useWebSocket.ts`:

```typescript
import { ref, onUnmounted } from 'vue';
import { usePlayerStore } from '../stores/player.js';
import { useAuthStore } from '../stores/auth.js';

export function useWebSocket() {
  const connected = ref(false);
  let ws: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${protocol}//${window.location.host}/ws`;

    // Attach JWT token if available
    const authStore = useAuthStore();
    const token = authStore.getToken();
    if (token) {
      url += `?token=${encodeURIComponent(token)}`;
    }

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
          if (data.queue) {
            store.setQueue(data.botId, data.queue);
          } else {
            store.fetchQueueForBot(data.botId);
          }
          break;
        case 'botConnected':
          store.updateBotStatus(data.botId, data.status);
          break;
        case 'botDisconnected':
          if (data.status) {
            store.updateBotStatus(data.botId, data.status);
          } else {
            const existing = store.bots.find((b) => b.id === data.botId);
            if (existing) {
              store.updateBotStatus(data.botId, {
                ...existing,
                connected: false,
                playing: false,
                paused: false,
                currentSong: null,
              });
            }
          }
          break;
        case 'botRemoved':
          store.removeBotStatus(data.botId);
          if (store.activeBotId === data.botId) {
            store.activeBotId = store.bots[0]?.id ?? null;
          }
          break;
      }
    };

    ws.onclose = (event) => {
      connected.value = false;
      // If closed with auth error (4001), don't reconnect — user needs to re-login
      if (event.code === 4001) {
        console.warn('WebSocket auth failed, stopping reconnection');
        return;
      }
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

- [ ] **Step 2: Commit**

```bash
git add web/src/composables/useWebSocket.ts
git commit -m "feat(auth): attach JWT token to WebSocket connections"
```

---

### Task 13: Add JWT token to all axios requests

**Files:**
- Modify: `web/src/stores/player.ts` — add axios interceptor

- [ ] **Step 1: Add axios interceptor for JWT token and 401 handling**

Read `web/src/stores/player.ts`. At the top of the file, after the existing imports, add an axios interceptor. Find the import of axios and add after it:

```typescript
import { useAuthStore } from './auth.js';
import router from '../router/index.js';

// Request interceptor: attach JWT token to all API requests
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('jwt_token');
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

- [ ] **Step 2: Verify frontend builds**

Run: `cd web && npx vue-tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/stores/player.ts
git commit -m "feat(auth): add JWT token to all axios requests via interceptor"
```

---

### Task 14: Build and integration test

- [ ] **Step 1: Build backend**

Run: `npx tsc`
Expected: Clean build, no errors

- [ ] **Step 2: Build frontend**

Run: `cd web && npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Run all existing tests**

Run: `npx vitest run`
Expected: All existing tests pass (no regressions)

- [ ] **Step 4: Run new auth tests**

Run: `npx vitest run src/auth/`
Expected: All auth tests pass

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: resolve any build/test issues from Phase 1 auth integration"
```

---

### Task 15: Set default admin password in config

**Files:**
- Modify: `src/data/config.ts`

The default config has `adminPassword: ""`. To make auth work out of the box for new installations, we should warn the user. But we should NOT set a default password — that would be a security risk.

Instead, modify the `loadConfig` function to log a warning when `adminPassword` is empty.

- [ ] **Step 1: No code change needed for this — the server already logs a warning**

The `server.ts` from Task 6 already includes:
```typescript
logger.warn("No adminPassword set — authentication DISABLED, all endpoints are public");
```

This is sufficient. Skip this task.

- [ ] **Step 2: Mark as done, no commit needed**

---

## Self-Review Checklist

After all tasks are implemented, verify:

- [ ] All `/api/*` endpoints (except login and public-url) require JWT when `adminPassword` is set
- [ ] `POST /api/auth/login` returns JWT on correct password, 401 on wrong password
- [ ] WebSocket rejects connections without valid token (close code 4001)
- [ ] TS admin commands check invoker server groups against `adminGroups`
- [ ] When `adminPassword` is empty, auth is completely disabled (backward compatible)
- [ ] Frontend login page works, stores token, redirects after login
- [ ] Route guard redirects to login when auth is enabled and no token exists
- [ ] 401 responses clear token and redirect to login
- [ ] All existing tests pass
- [ ] Build succeeds (backend + frontend)
