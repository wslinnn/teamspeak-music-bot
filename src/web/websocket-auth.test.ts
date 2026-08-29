import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "node:http";
import { WebSocketServer, WebSocket as WSClient } from "ws";
import { AddressInfo } from "node:net";
import { createDatabase, type BotDatabase } from "../data/database.js";
import { createUserStore } from "../data/users.js";
import { createSessionStore } from "../data/sessions.js";
import { validateSessionFromHeaders, SESSION_COOKIE_NAME } from "./auth/validateSession.js";
import { setupWebSocket } from "./websocket.js";

function buildServer(sessions: ReturnType<typeof createSessionStore>) {
  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (ws) => ws.send("hello"));
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/ws") return socket.destroy();
    const r = validateSessionFromHeaders(req.headers.cookie as string | undefined, sessions);
    if (!r) {
      // 与生产一致（B3）：完成握手后以 4001 关闭，让浏览器端拿到认证失败
      // 关闭码而非裸 401（浏览器只会报 1006）
      wss.handleUpgrade(req, socket, head, (ws) => ws.close(4001, "session expired"));
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });
  return { server, wss };
}

describe("WebSocket auth at upgrade", () => {
  let botDb: BotDatabase;
  let httpServer: http.Server;
  let port: number;
  let validToken: string;

  beforeEach(async () => {
    botDb = createDatabase(":memory:");
    const users = createUserStore(botDb.db);
    const sessions = createSessionStore(botDb.db);
    const u = await users.createUser("alice", "pw-alice", "admin");
    validToken = sessions.createSession(u.id).token;

    const { server } = buildServer(sessions);
    httpServer = server;
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = (httpServer.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    botDb.close();
  });

  it("closes an unauthenticated upgrade with 4001 (auth-failure close code)", async () => {
    const ws = new WSClient(`ws://127.0.0.1:${port}/ws`);
    const result = await new Promise<{ code: number } | string>((resolve) => {
      ws.on("close", (code: number) => resolve({ code }));
      ws.on("unexpected-response", (_req, res) => resolve(`status:${res.statusCode}`));
      ws.on("error", () => resolve("error"));
    });
    // 前端 useWebSocket 以 4001 停止重连并引导重新登录（B3 契约）
    expect(result).toEqual({ code: 4001 });
  });

  it("accepts upgrade with a valid cookie", async () => {
    const ws = new WSClient(`ws://127.0.0.1:${port}/ws`, {
      headers: { Cookie: `${SESSION_COOKIE_NAME}=${validToken}` },
    });
    const msg = await new Promise<string>((resolve, reject) => {
      ws.on("message", (data) => resolve(data.toString()));
      ws.on("error", reject);
    });
    expect(msg).toBe("hello");
    ws.close();
  });
});

describe("WebSocket guest bot scope", () => {
  it("guest init is filtered to the guest bot scope", () => {
    const sent: any[] = [];
    const fakeWs: any = {
      readyState: 1,
      isGuest: true,
      botScope: new Set(["bot1"]),
      send: (m: string) => sent.push(JSON.parse(m)),
      on: () => {},
    };
    const fakeWss: any = {
      on: (ev: string, cb: any) => {
        if (ev === "connection") fakeWss._conn = cb;
      },
    };
    const makeBot = (id: string) => ({
      id,
      getStatus: () => ({ id }),
      getQueue: () => [],
      on: () => {},
      removeListener: () => {},
    });
    const botManager: any = {
      getAllBots: () => [makeBot("bot1"), makeBot("bot2")],
      on: () => {},
      off: () => {},
      removeListener: () => {},
    };
    const { cleanup } = setupWebSocket(fakeWss, botManager, {
      debug() {},
      error() {},
      info() {},
      warn() {},
    } as any);
    fakeWss._conn(fakeWs);
    const init = sent.find((m) => m.type === "init");
    expect(init.bots.map((b: any) => b.id)).toEqual(["bot1"]);
    cleanup();
  });
});

// Regression (security audit SEC-04): member sockets stamped with a bot scope
// (user_bot_access) must be filtered exactly like scoped guests — both in the
// init snapshot and in per-bot broadcasts.
describe("WebSocket member bot scope", () => {
  function makeHarness() {
    const fakeWss: any = {
      on: (ev: string, cb: any) => {
        if (ev === "connection") fakeWss._conn = cb;
      },
    };
    const botManager: any = {
      getAllBots: () => [],
      on: () => {},
      off: () => {},
      removeListener: () => {},
    };
    const logger = { debug() {}, error() {}, info() {}, warn() {} } as any;
    const controller = setupWebSocket(fakeWss, botManager, logger);
    const connect = (ws: any) => fakeWss._conn(ws);
    return { controller, connect };
  }

  function makeMemberWs(botScope: "all" | Set<string>, seen: any[]) {
    return {
      readyState: 1,
      isGuest: false,
      botScope,
      send: (m: string) => seen.push(JSON.parse(m)),
      on: () => {},
      close: () => {},
    };
  }

  it("member init snapshot is filtered to the member bot scope", () => {
    const seen: any[] = [];
    const fakeWss: any = {
      on: (ev: string, cb: any) => {
        if (ev === "connection") fakeWss._conn = cb;
      },
    };
    const makeBot = (id: string) => ({
      id,
      getStatus: () => ({ id }),
      getQueue: () => [],
      on: () => {},
      removeListener: () => {},
    });
    const botManager: any = {
      getAllBots: () => [makeBot("bot1"), makeBot("bot2")],
      on: () => {},
      off: () => {},
      removeListener: () => {},
    };
    const controller = setupWebSocket(fakeWss, botManager, {
      debug() {},
      error() {},
      info() {},
      warn() {},
    } as any);
    fakeWss._conn(makeMemberWs(new Set(["bot1"]), seen));
    const init = seen.find((m) => m.type === "init");
    expect(init.bots.map((b: any) => b.id)).toEqual(["bot1"]);
    controller.cleanup();
  });

  it("scoped member does not receive out-of-scope bot broadcasts", () => {
    const { controller, connect } = makeHarness();
    const scopedSeen: any[] = [];
    const fullSeen: any[] = [];
    connect(makeMemberWs(new Set(["bot1"]), scopedSeen));
    connect(makeMemberWs("all", fullSeen));

    controller.broadcast({ type: "stateChange", botId: "bot2" }, "bot2");
    controller.broadcast({ type: "stateChange", botId: "bot1" }, "bot1");

    const states = (seen: any[]) => seen.filter((m) => m.type === "stateChange");
    expect(states(scopedSeen).map((m) => m.botId)).toEqual(["bot1"]);
    expect(states(fullSeen).map((m) => m.botId)).toEqual(["bot2", "bot1"]);
    controller.cleanup();
  });
});

// Regression (security audit SEC-08): session revocation must close the
// revoked user's sockets, sparing the excepted (still-valid) session.
describe("WebSocket closeUserSessions", () => {
  function makeHarness() {
    const fakeWss: any = {
      on: (ev: string, cb: any) => {
        if (ev === "connection") fakeWss._conn = cb;
      },
    };
    const botManager: any = {
      getAllBots: () => [],
      on: () => {},
      off: () => {},
      removeListener: () => {},
    };
    const controller = setupWebSocket(fakeWss, botManager, { debug() {}, error() {}, info() {}, warn() {} } as any);
    return { controller, fakeWss };
  }

  function makeUserWs(userId: string, tokenHash?: string) {
    const closeCalls: Array<{ code?: number; reason?: string }> = [];
    const ws: any = {
      readyState: 1,
      userId,
      tokenHash,
      send: () => {},
      on: () => {},
      close: (code?: number, reason?: string) => closeCalls.push({ code, reason }),
    };
    return { ws, closeCalls };
  }

  function connect(fakeWss: any, ws: any) {
    fakeWss._conn(ws);
  }

  it("closes only the revoked user's sockets, honouring exceptTokenHash", () => {
    const fakeWss: any = {
      on: (ev: string, cb: any) => {
        if (ev === "connection") fakeWss._conn = cb;
      },
    };
    const { controller, fakeWss: harnessWss } = makeHarness();
    const alice1 = makeUserWs("alice", "hash-1");
    const alice2 = makeUserWs("alice", "hash-2");
    const bob = makeUserWs("bob", "hash-3");
    connect(harnessWss, alice1.ws);
    connect(harnessWss, alice2.ws);
    connect(harnessWss, bob.ws);

    // Revoke all alice sessions except hash-1 (e.g. she changed her password
    // from the alice-1 client).
    controller.closeUserSessions("alice", { exceptTokenHash: "hash-1" });

    expect(alice1.closeCalls.length).toBe(0);
    expect(alice2.closeCalls).toEqual([{ code: 4001, reason: "session revoked" }]);
    expect(bob.closeCalls.length).toBe(0);

    // Full revocation takes both alice sockets.
    controller.closeUserSessions("alice");
    expect(alice1.closeCalls).toEqual([{ code: 4001, reason: "session revoked" }]);
    controller.cleanup();
  });
});

describe("WebSocket refreshGuestPolicy", () => {
  function makeHarness() {
    const clients: any[] = [];
    const fakeWss: any = {
      on: (ev: string, cb: any) => {
        if (ev === "connection") fakeWss._conn = cb;
      },
    };
    const botManager: any = {
      getAllBots: () => [],
      on: () => {},
      off: () => {},
      removeListener: () => {},
    };
    const logger = { debug() {}, error() {}, info() {}, warn() {} } as any;
    const controller = setupWebSocket(fakeWss, botManager, logger);
    // Connect fake sockets via the connection handler so they land in `clients`.
    const connect = (ws: any) => {
      clients.push(ws);
      fakeWss._conn(ws);
    };
    return { controller, connect };
  }

  function makeFakeWs(opts: { isGuest: boolean; botScope?: "all" | Set<string> }) {
    const closeCalls: Array<{ code?: number; reason?: string }> = [];
    const ws: any = {
      readyState: 1,
      isGuest: opts.isGuest,
      botScope: opts.botScope,
      send: () => {},
      on: () => {},
      close: (code?: number, reason?: string) => closeCalls.push({ code, reason }),
    };
    return { ws, closeCalls };
  }

  it("disabling guest mode closes guest sockets but leaves non-guest sockets open", () => {
    const { controller, connect } = makeHarness();
    const guest = makeFakeWs({ isGuest: true, botScope: new Set(["bot1"]) });
    const member = makeFakeWs({ isGuest: false, botScope: "all" });
    connect(guest.ws);
    connect(member.ws);

    controller.refreshGuestPolicy({ enabled: false, bots: "all" });

    expect(guest.closeCalls.length).toBe(1);
    expect(guest.closeCalls[0].code).toBe(4001);
    expect(member.closeCalls.length).toBe(0);
  });

  it("narrowing the guest scope live re-scopes open guest sockets", () => {
    const { controller, connect } = makeHarness();
    const guest = makeFakeWs({ isGuest: true, botScope: new Set(["bot1"]) });
    connect(guest.ws);

    controller.refreshGuestPolicy({ enabled: true, bots: ["bot2"] });

    expect(guest.closeCalls.length).toBe(0);
    expect(guest.ws.botScope instanceof Set).toBe(true);
    expect(guest.ws.botScope.has("bot2")).toBe(true);
    expect(guest.ws.botScope.has("bot1")).toBe(false);
  });
});
