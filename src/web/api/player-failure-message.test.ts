import { describe, it, expect, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createPlayerRouter } from "./player.js";
import type { PlayFailure } from "../../music/provider.js";

/** A minimal bot whose single-song start always fails, so the route has to
 *  choose a message. The point of these tests: that message must come from the
 *  classified failure, never from a hardcoded 「区域/版权限制」. */

function makeApp(failure: PlayFailure | undefined) {
  const queue = {
    clear: vi.fn(),
    add: vi.fn(),
    play: () => ({ id: "s1", name: "Song", artist: "Artist", platform: "netease" }),
    getCurrentIndex: () => -1,
    getMode: () => "seq",
    size: () => 1,
    current: () => ({ id: "s1", name: "Song", artist: "Artist", platform: "netease" }),
    addNext: vi.fn(),
    playAt: () => ({ id: "s1", name: "Song", artist: "Artist", platform: "netease" }),
    getCurrentIndexValue: () => -1,
    isEmpty: () => true,
  };

  const bot = {
    runExclusive: (fn: any) => fn(),
    getPlayer: () => ({ stop: vi.fn(), resetFailures: vi.fn(), getState: () => "idle" }),
    getQueueManager: () => queue,
    cleanupQueuedLocalSongs: vi.fn(),
    isLocalAudioEnabled: () => true,
    playSingleSong: async (_song: any, _requester: any, onFailure?: (f: PlayFailure) => void) => {
      if (failure && onFailure) onFailure(failure);
      return false;
    },
    resolveAndPlay: async (_song: any, onFailure?: (f: PlayFailure) => void) => {
      if (failure && onFailure) onFailure(failure);
      return false;
    },
    playNext: async () => false,
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = { role: "admin" };
    (req as any).bot = bot;
    next();
  });
  app.use("/api/player", createPlayerRouter({ getBot: () => bot } as any, { error: vi.fn(), warn: vi.fn(), info: vi.fn() } as any));
  return app;
}

describe("play routes name the real failure cause", () => {
  it("play-song reports the classified message, not 区域/版权限制", async () => {
    const app = makeApp({
      platform: "netease",
      songId: "s1",
      code: "vip_required",
      message: "需要会员（exhigh）",
    });
    const res = await request(app)
      .post("/api/player/b/play-song")
      .send({ song: { id: "s1", name: "Song", artist: "Artist", platform: "netease" } });

    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain("需要会员");
    expect(res.body.message).not.toContain("区域/版权限制");
  });

  it("play-now-song surfaces a risk-control cause", async () => {
    const app = makeApp({
      platform: "netease",
      songId: "s1",
      code: "risk_control",
      message: "网易云暂时拒绝播放请求（-460），请稍后重试",
    });
    const res = await request(app)
      .post("/api/player/b/play-now-song")
      .send({ song: { id: "s1", name: "Song", artist: "Artist", platform: "netease" } });

    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain("-460");
    expect(res.body.message).not.toContain("区域/版权限制");
  });

  it("still fails cleanly when the bot supplies no reason", async () => {
    const app = makeApp(undefined);
    const res = await request(app)
      .post("/api/player/b/play-song")
      .send({ song: { id: "s1", name: "Song", artist: "Artist", platform: "netease" } });

    expect(res.body.ok).toBe(false);
    expect(res.body.message).toContain("无法播放");
    expect(res.body.message).not.toContain("区域/版权限制");
  });
});
