import { describe, it, expect, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase, type BotDatabase } from "../../data/database.js";
import { createMyMusicAccountsRouter } from "./personal-music.js";

let db: BotDatabase;
let dir: string;

function makeApp(opts: { enabled?: boolean; role?: string; userId?: string } = {}) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { id: opts.userId ?? "u1", role: opts.role ?? "member" };
    next();
  });
  app.use(
    "/api/me/music-accounts",
    createMyMusicAccountsRouter(db, () => opts.enabled === true, { info() {}, warn() {}, error() {} } as any),
  );
  return app;
}

function addUser(id: string): void {
  db.db.prepare(
    `INSERT INTO users (id, username, passwordHash, createdAt, updatedAt, role)
     VALUES (?, ?, 'x', ?, ?, 'member')`,
  ).run(id, id, Date.now(), Date.now());
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "myacct-"));
  db = createDatabase(path.join(dir, "test.db"));
  addUser("u1");
  addUser("u2");
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("my music accounts — status", () => {
  it("reports shared by default", async () => {
    const res = await request(makeApp({ enabled: true })).get("/api/me/music-accounts/status");
    expect(res.status).toBe(200);
    expect(res.body.perUserMusicAccounts).toBe(true);
    const netease = res.body.platforms.find((p: any) => p.platform === "netease");
    expect(netease.active).toBe("shared");
    expect(netease.linked).toBe(false);
    expect(netease.granted).toBeNull();
  });

  it("reports own when the member linked an account", async () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    const res = await request(makeApp({ enabled: true })).get("/api/me/music-accounts/status");
    const netease = res.body.platforms.find((p: any) => p.platform === "netease");
    expect(netease.active).toBe("own");
    expect(netease.linked).toBe(true);
  });

  it("reports granted with the label but canUnlink false", async () => {
    const a = db.createMusicAccount({ platform: "netease", label: "Room VIP", cookie: "G" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");

    const res = await request(makeApp({ enabled: true })).get("/api/me/music-accounts/status");
    const netease = res.body.platforms.find((p: any) => p.platform === "netease");
    expect(netease.active).toBe("granted");
    expect(netease.granted).toMatchObject({ label: "Room VIP", canUnlink: false });
    // The credential itself is never exposed here.
    expect(JSON.stringify(res.body)).not.toContain('"G"');
  });

  it("reports shared while preferShared is on, keeping the account visible", async () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    db.setMusicPref("u1", "netease", true);
    const res = await request(makeApp({ enabled: true })).get("/api/me/music-accounts/status");
    const netease = res.body.platforms.find((p: any) => p.platform === "netease");
    expect(netease.active).toBe("shared");
    expect(netease.linked).toBe(true); // still linked, just not in use
    expect(netease.preferShared).toBe(true);
  });

  it("reports a disabled grant as not active", async () => {
    const a = db.createMusicAccount({ platform: "netease", label: "X", cookie: "G" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    db.updateMusicAccount(a.id, { enabled: false });

    const res = await request(makeApp({ enabled: true })).get("/api/me/music-accounts/status");
    const netease = res.body.platforms.find((p: any) => p.platform === "netease");
    expect(netease.active).toBe("shared");
    expect(netease.granted.enabled).toBe(false);
  });

  it("ignores accounts entirely when the feature is off", async () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    const res = await request(makeApp({ enabled: false })).get("/api/me/music-accounts/status");
    expect(res.body.perUserMusicAccounts).toBe(false);
    const netease = res.body.platforms.find((p: any) => p.platform === "netease");
    expect(netease.active).toBe("shared");
  });

  it("never shows another member's account", async () => {
    db.setUserMusicCookie("u2", "netease", "OTHER-OWN");
    const a = db.createMusicAccount({ platform: "netease", label: "Assigned to u2", cookie: "X" });
    db.assignMusicAccount("u2", "netease", a.id, "admin");

    const res = await request(makeApp({ enabled: true, userId: "u1" })).get("/api/me/music-accounts/status");
    const netease = res.body.platforms.find((p: any) => p.platform === "netease");
    expect(netease.linked).toBe(false);
    expect(netease.granted).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain("Assigned to u2");
  });
});

describe("my music accounts — preference", () => {
  it("persists preferShared", async () => {
    const app = makeApp({ enabled: true });
    expect(
      (await request(app).put("/api/me/music-accounts/netease/preference").send({ preferShared: true })).status,
    ).toBe(200);
    expect(db.getMusicPref("u1", "netease")).toBe(true);
  });

  it("409s when the feature is off", async () => {
    const res = await request(makeApp({ enabled: false }))
      .put("/api/me/music-accounts/netease/preference")
      .send({ preferShared: true });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("per_user_accounts_disabled");
  });

  it("400s a non-boolean value", async () => {
    const res = await request(makeApp({ enabled: true }))
      .put("/api/me/music-accounts/netease/preference")
      .send({ preferShared: "yes" });
    expect(res.status).toBe(400);
  });

  it("404s an unsupported platform", async () => {
    const res = await request(makeApp({ enabled: true }))
      .put("/api/me/music-accounts/youtube/preference")
      .send({ preferShared: true });
    expect(res.status).toBe(404);
  });

  it("only writes the caller's own preference", async () => {
    await request(makeApp({ enabled: true }))
      .put("/api/me/music-accounts/netease/preference")
      .send({ preferShared: true });
    expect(db.getMusicPref("u2", "netease")).toBe(false);
  });
});
