import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import pino from "pino";
import type { MusicProvider } from "../../music/provider.js";
import { getDefaultConfig, type JellyfinConfig } from "../../data/config.js";
import { createAuthRouter } from "./auth.js";

function fakeProvider(platform: MusicProvider["platform"]): MusicProvider {
  return { platform } as unknown as MusicProvider;
}

describe("auth router POST /jellyfin/test", () => {
  function mount(
    stored: Partial<JellyfinConfig>,
    user: unknown = { role: "admin" },
  ) {
    const config = getDefaultConfig();
    Object.assign(config.jellyfin, stored);
    const testConnection = vi.fn().mockResolvedValue({ ok: true, serverName: "JF" });
    const jellyfin = { platform: "jellyfin", testConnection } as unknown as MusicProvider;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as { user?: unknown }).user = user; next(); });
    app.use(
      "/api/auth",
      createAuthRouter(
        fakeProvider("netease"), fakeProvider("qq"), fakeProvider("bilibili"),
        pino({ level: "silent" }), undefined, undefined, undefined, jellyfin, config,
      ),
    );
    return { app, testConnection };
  }

  it("fills empty credential fields from the stored config (masked password case)", async () => {
    const { app, testConnection } = mount({
      serverUrl: "https://old.example.com",
      username: "bob",
      password: "stored-pw",
    });
    const res = await request(app)
      .post("/api/auth/jellyfin/test")
      .send({ serverUrl: "https://new.example.com", username: "bob", password: "" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        serverUrl: "https://new.example.com",
        username: "bob",
        password: "stored-pw",
      }),
    );
  });

  it("passes freshly entered credentials through", async () => {
    const { app, testConnection } = mount({});
    await request(app).post("/api/auth/jellyfin/test").send({
      serverUrl: "https://jf.example.com",
      authMode: "apikey",
      apiKey: "key123",
      userId: "u1",
    });
    expect(testConnection).toHaveBeenCalledWith(
      expect.objectContaining({ authMode: "apikey", apiKey: "key123", userId: "u1" }),
    );
  });

  it("is 403 for a member lacking platform.auth", async () => {
    const { app, testConnection } = mount({}, { role: "member", capabilities: new Set([]) });
    const res = await request(app).post("/api/auth/jellyfin/test").send({});
    expect(res.status).toBe(403);
    expect(testConnection).not.toHaveBeenCalled();
  });
});

describe("auth router GET /qrcode/status TTL (bug: poll keeps hitting upstream)", () => {
  function mount(checkQrCodeStatus: ReturnType<typeof vi.fn>) {
    const netease = { platform: "netease", checkQrCodeStatus } as unknown as MusicProvider;
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { (req as { user?: unknown }).user = { role: "member" }; next(); });
    app.use(
      "/api/auth",
      createAuthRouter(
        netease, fakeProvider("qq"), fakeProvider("bilibili"),
        pino({ level: "silent" }),
      ),
    );
    return app;
  }

  it("returns upstream status within the TTL window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const check = vi.fn().mockResolvedValue("waiting");
    const app = mount(check);
    const res = await request(app).get("/api/auth/qrcode/status").query({ key: "k1", platform: "netease" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("waiting");
    expect(check).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("short-circuits to expired once the key exceeds the TTL without hitting upstream", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const check = vi.fn().mockResolvedValue("waiting");
    const app = mount(check);

    await request(app).get("/api/auth/qrcode/status").query({ key: "k2", platform: "netease" });
    expect(check).toHaveBeenCalledTimes(1);

    // 6 分钟后：同一个 key 应被服务端 TTL 拦下，不再转发上游
    vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));
    const res = await request(app).get("/api/auth/qrcode/status").query({ key: "k2", platform: "netease" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("expired");
    expect(check).toHaveBeenCalledTimes(1); // 未再调用上游
    vi.useRealTimers();
  });
});
