import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket as WSClient } from "ws";
import { createDatabase, type BotDatabase } from "../data/database.js";
import { createUserStore } from "../data/users.js";
import { getDefaultConfig } from "../data/config.js";
import { createWebServer } from "./server.js";
import type { WebServer } from "./server.js";

// End-to-end over the REAL createWebServer wiring (mount order, bridge hooks,
// upgrade handler) — the unit tests above assemble their own app mirrors and
// would miss a mis-wired server.ts. M1 acceptance ("curl 三连") in test form:
// login -> Bearer REST -> Bearer WS init -> DELETE session -> revoked.
describe("client bearer-token auth over the real web server", () => {
  let botDb: BotDatabase;
  let web: WebServer;
  let port: number;
  let token: string;
  const base = () => `http://127.0.0.1:${port}`;

  beforeAll(async () => {
    botDb = createDatabase(":memory:");
    const users = createUserStore(botDb.db);
    await users.createUser("alice", "pw-alice-123", "admin");

    const provider = { platform: "x", getLyrics: async () => [] } as any;
    const botManager = {
      getAllBots: () => [],
      on: () => {},
      removeListener: () => {},
    } as any;
    const logger = { child: () => logger, debug() {}, info() {}, warn() {}, error() {} } as any;

    port = 30000 + Math.floor(Math.random() * 20000);
    web = createWebServer({
      port,
      botManager,
      neteaseProvider: provider,
      qqProvider: provider,
      bilibiliProvider: provider,
      localProvider: provider,
      kugouProvider: provider,
      spotifyProvider: provider,
      jellyfinProvider: provider,
      database: botDb,
      config: getDefaultConfig(),
      configPath: "data/config.json",
      logger,
      avatarStore: {} as any,
    });
    await web.start();
  });

  afterAll(async () => {
    web.stop();
    botDb.close();
  });

  it("login -> Bearer REST -> Bearer WS init -> DELETE -> revoked everywhere", async () => {
    // 1. login
    const loginRes = await fetch(`${base()}/api/client/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "alice", password: "pw-alice-123" }),
    });
    expect(loginRes.status).toBe(201);
    const body = (await loginRes.json()) as { token: string };
    token = body.token;
    expect(typeof token).toBe("string");

    // 2. protected REST route via Bearer (the desktop client uses GET /api/bot
    //    both to validate its token and to fetch the bot list in one round trip;
    //    /api/session/me stays cookie-only by design)
    const meRes = await fetch(`${base()}/api/bot`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meRes.status).toBe(200);
    expect(await meRes.json()).toEqual({ bots: [] });

    // 3. WS upgrade via Bearer receives the init snapshot
    const init = await new Promise<any>((resolve, reject) => {
      const ws = new WSClient(`ws://127.0.0.1:${port}/ws`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      ws.on("message", (data) => {
        resolve(JSON.parse(data.toString()));
        ws.close();
      });
      ws.on("error", reject);
    });
    expect(init.type).toBe("init");
    expect(Array.isArray(init.bots)).toBe(true);

    // 4. logout: DELETE the token
    const delRes = await fetch(`${base()}/api/client/session`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(delRes.status).toBe(204);

    // 5. revoked: REST 401, WS closed 4001
    const after = await fetch(`${base()}/api/bot`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(after.status).toBe(401);

    const closed = await new Promise<{ code: number | undefined }>((resolve) => {
      const ws = new WSClient(`ws://127.0.0.1:${port}/ws`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      ws.on("close", (code?: number) => resolve({ code }));
      ws.on("unexpected-response", (_req, res) => resolve({ code: res.statusCode }));
    });
    expect(closed.code).toBe(4001);
  });
});
