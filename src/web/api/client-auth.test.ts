import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import request from "supertest";
import { WebSocketServer, WebSocket as WSClient } from "ws";
import { AddressInfo } from "node:net";
import { createDatabase, type BotDatabase } from "../../data/database.js";
import { createUserStore } from "../../data/users.js";
import { createSessionStore, hashToken } from "../../data/sessions.js";
import {
  createClientTokenStore,
  CLIENT_TOKEN_TTL_MS,
  MAX_CLIENT_TOKENS_PER_USER,
} from "../../data/client-tokens.js";
import { createAuditStore } from "../../data/audit.js";
import { createPermissionStore } from "../../data/permissions.js";
import { createClientTokenRouter } from "./client.js";
import { createRequireAuth } from "../middleware/requireAuth.js";
import { csrfOriginCheck } from "../middleware/csrf.js";
import { setupWebSocket } from "../websocket.js";
import { validateSessionFromHeaders } from "../auth/validateSession.js";

const logger: any = { debug() {}, info() {}, warn() {}, error() {} };

const guestOff = () => ({ enabled: false, bots: "all" as const, permissions: {} as any });

describe("client bearer-token auth (REST)", () => {
  let botDb: BotDatabase;
  let app: express.Express;
  let closedHashes: string[];
  let aliceId: string;

  beforeEach(async () => {
    botDb = createDatabase(":memory:");
    const users = createUserStore(botDb.db);
    const sessions = createSessionStore(botDb.db);
    const clientTokens = createClientTokenStore(botDb.db);
    const audit = createAuditStore(botDb.db);
    const permissions = createPermissionStore(botDb.db);
    const u = await users.createUser("alice", "pw-alice-123", "admin");
    aliceId = u.id;

    // Mirrors server.ts mounting order: client router BEFORE the gates.
    closedHashes = [];
    app = express();
    app.use(express.json());
    app.use(
      "/api/client",
      createClientTokenRouter(users, clientTokens, audit, logger, (h) => closedHashes.push(h))
    );
    app.use("/api", csrfOriginCheck);
    app.use("/api", createRequireAuth(sessions, clientTokens, permissions, guestOff));
    app.get("/api/me", (req, res) => res.json({ id: req.user!.id, username: req.user!.username }));
    app.post("/api/echo", (_req, res) => res.json({ ok: true }));
  });

  afterEach(() => {
    botDb.close();
  });

  it("POST /api/client/login issues a token with a 60-day expiry", async () => {
    const res = await request(app)
      .post("/api/client/login")
      .send({ username: "alice", password: "pw-alice-123", deviceName: "test-device" });
    expect(res.status).toBe(201);
    expect(typeof res.body.token).toBe("string");
    expect(res.body.username).toBe("alice");
    expect(res.body.expiresAt).toBeGreaterThan(Date.now() + CLIENT_TOKEN_TTL_MS - 5_000);
  });

  it("POST /api/client/login rejects a wrong password", async () => {
    const res = await request(app)
      .post("/api/client/login")
      .send({ username: "alice", password: "wrong-password" });
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "invalid credentials" });
  });

  it("a valid bearer token passes requireAuth on protected routes", async () => {
    const login = await request(app)
      .post("/api/client/login")
      .send({ username: "alice", password: "pw-alice-123" });
    const res = await request(app)
      .get("/api/me")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: aliceId, username: "alice" });
  });

  it("csrfOriginCheck lets bearer POSTs through without Origin (desktop path)", async () => {
    const login = await request(app)
      .post("/api/client/login")
      .send({ username: "alice", password: "pw-alice-123" });
    const withBearer = await request(app)
      .post("/api/echo")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(withBearer.status).toBe(200);
    // Non-bearer mutating requests keep the full origin check.
    const noCreds = await request(app).post("/api/echo");
    expect(noCreds.status).toBe(403);
  });

  it("DELETE /api/client/session revokes the token and flags its sockets", async () => {
    const login = await request(app)
      .post("/api/client/login")
      .send({ username: "alice", password: "pw-alice-123" });
    const token = login.body.token as string;

    const res = await request(app)
      .delete("/api/client/session")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(204);
    expect(closedHashes).toEqual([hashToken(token)]);

    const after = await request(app).get("/api/me").set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(401);
  });

  it("DELETE /api/client/session requires a bearer token", async () => {
    const res = await request(app).delete("/api/client/session");
    expect(res.status).toBe(401);
  });
});

describe("client token store", () => {
  let botDb: BotDatabase;

  beforeEach(() => {
    botDb = createDatabase(":memory:");
  });

  afterEach(() => {
    botDb.close();
  });

  it("validate returns null for an expired token and deletes the row", async () => {
    const users = createUserStore(botDb.db);
    const clientTokens = createClientTokenStore(botDb.db);
    const u = await users.createUser("bob", "pw-bob-12345", "member");
    const { token } = clientTokens.createToken(u.id);

    botDb.db
      .prepare("UPDATE client_tokens SET expiresAt = ? WHERE id = ?")
      .run(1, hashToken(token));

    expect(clientTokens.validate(token)).toBeNull();
    const rows = botDb.db.prepare("SELECT COUNT(*) AS n FROM client_tokens").get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it("caps tokens per user, evicting the oldest", async () => {
    const users = createUserStore(botDb.db);
    const clientTokens = createClientTokenStore(botDb.db);
    const u = await users.createUser("carol", "pw-carol-123", "member");

    const first = clientTokens.createToken(u.id).token;
    for (let i = 1; i < MAX_CLIENT_TOKENS_PER_USER; i++) {
      clientTokens.createToken(u.id, `device-${i}`);
    }
    // Slot 11 evicts the first token.
    clientTokens.createToken(u.id, "device-overflow");

    expect(clientTokens.validate(first)).toBeNull();
    const rows = botDb.db.prepare("SELECT COUNT(*) AS n FROM client_tokens").get() as { n: number };
    expect(rows.n).toBe(MAX_CLIENT_TOKENS_PER_USER);
  });
});

describe("client bearer-token auth (WebSocket upgrade)", () => {
  let botDb: BotDatabase;
  let httpServer: http.Server;
  let wss: WebSocketServer;
  let port: number;
  let controller: ReturnType<typeof setupWebSocket>;
  let aliceToken: string;

  beforeEach(async () => {
    botDb = createDatabase(":memory:");
    const users = createUserStore(botDb.db);
    const sessions = createSessionStore(botDb.db);
    const clientTokens = createClientTokenStore(botDb.db);
    const u = await users.createUser("alice", "pw-alice-123", "admin");
    aliceToken = clientTokens.createToken(u.id).token;

    // Mirrors server.ts upgrade auth: bearer takes precedence, invalid bearer
    // completes the handshake then closes 4001 (B3), sockets carry tokenHash.
    const server = http.createServer();
    wss = new WebSocketServer({ noServer: true });
    controller = setupWebSocket(wss, { getAllBots: () => [], on() {}, removeListener() {} } as any, logger);
    // setupWebSocket also emits an `init` frame; "hello" marks ours.
    wss.on("connection", (ws) => ws.send("hello"));
    server.on("upgrade", (req, socket, head) => {
      if (req.url !== "/ws") return socket.destroy();
      const authHeader = req.headers.authorization;
      let result: ReturnType<typeof validateSessionFromHeaders>;
      let bearerHash: string | undefined;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        const raw = authHeader.slice(7);
        result = clientTokens.validate(raw);
        if (result) bearerHash = hashToken(raw);
      } else {
        result = validateSessionFromHeaders(req.headers.cookie as string | undefined, sessions);
      }
      if (!result) {
        wss.handleUpgrade(req, socket, head, (ws) => ws.close(4001, "invalid token"));
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        (ws as any).tokenHash = bearerHash;
        wss.emit("connection", ws, req);
      });
    });
    httpServer = server;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    controller.cleanup();
    // Terminate stragglers so httpServer.close() can't hang on open sockets.
    for (const c of wss.clients) {
      try {
        c.terminate();
      } catch {
        /* already closing */
      }
    }
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    botDb.close();
  });

  it("accepts an upgrade with a valid bearer token", async () => {
    const ws = new WSClient(`ws://127.0.0.1:${port}/ws`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const msg = await new Promise<string>((resolve, reject) => {
      ws.on("message", (data) => {
        if (data.toString() === "hello") resolve(data.toString());
      });
      ws.on("error", reject);
    });
    expect(msg).toBe("hello");
    ws.close();
  });

  it("closes an invalid bearer upgrade with 4001", async () => {
    const ws = new WSClient(`ws://127.0.0.1:${port}/ws`, {
      headers: { Authorization: "Bearer garbage" },
    });
    const result = await new Promise<{ code: number } | string>((resolve) => {
      ws.on("close", (code: number) => resolve({ code }));
      ws.on("unexpected-response", (_req, res) => resolve(`status:${res.statusCode}`));
      ws.on("error", () => resolve("error"));
    });
    expect(result).toEqual({ code: 4001 });
  });

  it("closeSocketsByTokenHash closes only that token's sockets (DELETE /session wiring)", async () => {
    const users = createUserStore(botDb.db);
    const clientTokens = createClientTokenStore(botDb.db);
    const carol = await users.createUser("carol", "pw-carol-123", "member");
    const carolToken = clientTokens.createToken(carol.id).token;

    // Register the close listener up-front so a fast 4001 can't race the await.
    const connect = (token: string) =>
      new Promise<{ ws: WSClient; closed: Promise<number | null> }>((resolve, reject) => {
        const ws = new WSClient(`ws://127.0.0.1:${port}/ws`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const closed = new Promise<number | null>((resolveClose) =>
          ws.on("close", (code: number) => resolveClose(code))
        );
        ws.on("message", () => resolve({ ws, closed }));
        ws.on("error", reject);
      });

    const a1 = await connect(aliceToken);
    const a2 = await connect(aliceToken);
    const other = await connect(carolToken); // different token, must survive

    controller.closeSocketsByTokenHash(hashToken(aliceToken));

    expect(await a1.closed).toBe(4001);
    expect(await a2.closed).toBe(4001);
    await new Promise((r) => setTimeout(r, 150));
    expect(other.ws.readyState).toBe(WSClient.OPEN);
    other.ws.close();
  });
});
