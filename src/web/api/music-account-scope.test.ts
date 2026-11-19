import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MusicProvider, SearchResult } from "../../music/provider.js";
import { getDefaultConfig } from "../../data/config.js";
import { createDatabase, type BotDatabase } from "../../data/database.js";
import { createMusicRouter } from "./music.js";

/**
 * Per-user music accounts: the route-level behaviour that the account pool
 * exists for.
 *
 * These tests drive the REAL router with a REAL database, so they cover the
 * wiring that a pure unit test of provider-scope.ts cannot: that
 * resolveProvider actually consults the scope, and that the 30s search cache
 * keys on the account.
 */

const empty: SearchResult = { songs: [], albums: [], playlists: [] };

/** Every provider instance created by withCookie shares one search spy, so
 *  assertions count upstream calls regardless of which view made them. */
function fakeProvider(
  platform: MusicProvider["platform"],
  cookie = "",
  sharedSearch?: ReturnType<typeof vi.fn>,
): MusicProvider {
  const search = sharedSearch ?? vi.fn().mockResolvedValue(empty);
  const provider: MusicProvider = {
    platform,
    search,
    getCookie: () => cookie,
    // withSharedPlaybackFallback wraps getSongUrl, so the fixture must have it
    // or the wrapper throws when the route touches playback-related helpers.
    getSongUrl: vi.fn().mockResolvedValue(null),
    withCookie: vi.fn((c: string) => fakeProvider(platform, c, search)),
  } as unknown as MusicProvider;
  return provider;
}

let db: BotDatabase;
let dir: string;

function addUser(id: string): void {
  db.db.prepare(
    `INSERT INTO users (id, username, passwordHash, createdAt, updatedAt, role)
     VALUES (?, ?, 'x', ?, ?, 'member')`,
  ).run(id, id, Date.now(), Date.now());
}

function makeApp(opts: {
  perUser: boolean;
  netease: MusicProvider;
  user?: { id: string; role: string } | null;
}) {
  const config = { ...getDefaultConfig(), perUserMusicAccounts: opts.perUser };
  const app = express();
  app.use((req, _res, next) => {
    if (opts.user !== null) (req as any).user = opts.user ?? { id: "u1", role: "member" };
    next();
  });
  app.use(
    "/api/music",
    createMusicRouter({
      neteaseProvider: opts.netease,
      qqProvider: fakeProvider("qq"),
      bilibiliProvider: fakeProvider("bilibili"),
      logger: pino({ level: "silent" }),
      config,
      database: db,
    }),
  );
  return app;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "musicscope-"));
  db = createDatabase(join(dir, "test.db"));
  addUser("u1");
  addUser("u2");
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("music routes — per-user account wiring", () => {
  it("reads through the member's own account when the feature is on", async () => {
    db.setUserMusicCookie("u1", "netease", "MUSIC_U=own-cookie");
    const netease = fakeProvider("netease");
    const app = makeApp({ perUser: true, netease, user: { id: "u1", role: "member" } });

    await request(app).get("/api/music/search?platform=netease&q=hello");

    expect(netease.withCookie).toHaveBeenCalledWith("MUSIC_U=own-cookie");
  });

  it("reads the shared login when the feature is off", async () => {
    db.setUserMusicCookie("u1", "netease", "MUSIC_U=own-cookie");
    const netease = fakeProvider("netease");
    const app = makeApp({ perUser: false, netease, user: { id: "u1", role: "member" } });

    await request(app).get("/api/music/search?platform=netease&q=hello");

    expect(netease.withCookie).not.toHaveBeenCalled();
    expect(netease.search).toHaveBeenCalled();
  });

  it("honours an admin-assigned account", async () => {
    const acct = db.createMusicAccount({ platform: "netease", cookie: "MUSIC_U=granted" });
    db.assignMusicAccount("u1", "netease", acct.id, "admin");
    const netease = fakeProvider("netease");
    const app = makeApp({ perUser: true, netease, user: { id: "u1", role: "member" } });

    await request(app).get("/api/music/search?platform=netease&q=hello");

    expect(netease.withCookie).toHaveBeenCalledWith("MUSIC_U=granted");
  });

  it("falls back to shared when the member chose the shared login", async () => {
    db.setUserMusicCookie("u1", "netease", "MUSIC_U=own");
    db.setMusicPref("u1", "netease", true);
    const netease = fakeProvider("netease");
    const app = makeApp({ perUser: true, netease, user: { id: "u1", role: "member" } });

    await request(app).get("/api/music/search?platform=netease&q=hello");

    expect(netease.withCookie).not.toHaveBeenCalled();
  });

  it("never scopes a guest", async () => {
    db.setUserMusicCookie("u1", "netease", "MUSIC_U=own");
    const netease = fakeProvider("netease");
    const app = makeApp({ perUser: true, netease, user: { id: "u1", role: "guest" } });

    await request(app).get("/api/music/search?platform=netease&q=hello");

    expect(netease.withCookie).not.toHaveBeenCalled();
  });
});

describe("music routes — search cache is account-scoped", () => {
  it("does NOT serve one account's cached search to another", async () => {
    // The leak this guards: with an unscoped 30s cache, member B's identical
    // query would hit member A's entry and return A's library.
    const spy = vi.fn().mockResolvedValue(empty);
    const netease = fakeProvider("netease", "", spy);
    db.setUserMusicCookie("u1", "netease", "MUSIC_U=a");
    db.setUserMusicCookie("u2", "netease", "MUSIC_U=b");

    const appU1 = makeApp({ perUser: true, netease, user: { id: "u1", role: "member" } });
    const appU2 = makeApp({ perUser: true, netease, user: { id: "u2", role: "member" } });

    const r1 = await request(appU1).get("/api/music/search?platform=netease&q=hi");
    const r2 = await request(appU2).get("/api/music/search?platform=netease&q=hi");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Two different accounts → two upstream calls, not one cache hit.
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("serves the same account's repeat query from cache", async () => {
    const spy = vi.fn().mockResolvedValue(empty);
    const netease = fakeProvider("netease", "", spy);
    db.setUserMusicCookie("u1", "netease", "MUSIC_U=a");
    const app = makeApp({ perUser: true, netease, user: { id: "u1", role: "member" } });

    const r1 = await request(app).get("/api/music/search?platform=netease&q=hi");
    const r2 = await request(app).get("/api/music/search?platform=netease&q=hi");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("keeps the shared-login cache working as before (empty scope)", async () => {
    const netease = fakeProvider("netease");
    const app = makeApp({ perUser: true, netease, user: { id: "u1", role: "member" } });

    const r1 = await request(app).get("/api/music/search?platform=netease&q=hi");
    const r2 = await request(app).get("/api/music/search?platform=netease&q=hi");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(netease.search).toHaveBeenCalledTimes(1);
  });
});

describe("music routes — without a database (unit-test routers)", () => {
  it("behaves exactly as before: shared provider, no withCookie", async () => {
    const netease = fakeProvider("netease");
    const app = express();
    app.use("/api/music", createMusicRouter({
      neteaseProvider: netease,
      qqProvider: fakeProvider("qq"),
      bilibiliProvider: fakeProvider("bilibili"),
      logger: pino({ level: "silent" }),
    }));

    const res = await request(app).get("/api/music/search?platform=netease&q=hi");

    expect(res.status).toBe(200);
    expect(netease.search).toHaveBeenCalledTimes(1);
    expect(netease.withCookie).not.toHaveBeenCalled();
  });
});
