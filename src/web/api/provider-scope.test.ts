import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createDatabase, type BotDatabase } from "../../data/database.js";
import {
  resolveMusicCookie,
  personalCookieFor,
  grantedCookieFor,
  withSharedPlaybackFallback,
  resolveProviderForRequest,
  maskCookie,
} from "./provider-scope.js";
import type { MusicProvider } from "../../music/provider.js";

let db: BotDatabase;
let dir: string;

function addUser(id: string, role = "member"): void {
  db.db.prepare(
    `INSERT INTO users (id, username, passwordHash, createdAt, updatedAt, role)
     VALUES (?, ?, 'x', ?, ?, ?)`,
  ).run(id, id, Date.now(), Date.now(), role);
}

function fakeProvider(overrides: Partial<MusicProvider> = {}): MusicProvider {
  return {
    platform: "netease",
    search: vi.fn(async () => ({ songs: [], albums: [], playlists: [] })),
    getSongUrl: vi.fn(async () => ({ url: "http://shared/x" })),
    setQuality: vi.fn(),
    getQuality: vi.fn(() => "exhigh"),
    getSongDetail: vi.fn(async () => null),
    getPlaylistSongs: vi.fn(async () => []),
    getRecommendPlaylists: vi.fn(async () => []),
    getAlbumSongs: vi.fn(async () => []),
    getLyrics: vi.fn(async () => []),
    setCookie: vi.fn(),
    getCookie: vi.fn(() => ""),
    getAuthStatus: vi.fn(async () => ({ loggedIn: true })),
    ...overrides,
  } as unknown as MusicProvider;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "scope-"));
  db = createDatabase(path.join(dir, "test.db"));
  addUser("u1");
  addUser("guest1", "guest");
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("resolveMusicCookie — precedence", () => {
  it("returns null (shared) when nothing is linked", () => {
    expect(resolveMusicCookie(db, { id: "u1", role: "member" }, "netease")).toBeNull();
  });

  it("prefers the member's own account", () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    expect(resolveMusicCookie(db, { id: "u1", role: "member" }, "netease")).toBe("OWN");
  });

  it("falls back to an admin-granted account", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "GRANTED" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    expect(resolveMusicCookie(db, { id: "u1", role: "member" }, "netease")).toBe("GRANTED");
  });

  it("prefers the own account over a grant when both exist", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "GRANTED" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    db.setUserMusicCookie("u1", "netease", "OWN");
    expect(resolveMusicCookie(db, { id: "u1", role: "member" }, "netease")).toBe("OWN");
  });

  it("lets the explicit prefer-shared flag win over everything", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "GRANTED" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    db.setUserMusicCookie("u1", "netease", "OWN");
    db.setMusicPref("u1", "netease", true);
    expect(resolveMusicCookie(db, { id: "u1", role: "member" }, "netease")).toBeNull();
  });

  it("restores the own account when the flag is flipped back", () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    db.setMusicPref("u1", "netease", true);
    db.setMusicPref("u1", "netease", false);
    expect(resolveMusicCookie(db, { id: "u1", role: "member" }, "netease")).toBe("OWN");
  });

  it("never scopes a guest", () => {
    db.setUserMusicCookie("guest1", "netease", "GUEST-OWN");
    expect(resolveMusicCookie(db, { id: "guest1", role: "guest" }, "netease")).toBeNull();
  });

  it("returns null for a missing user", () => {
    expect(resolveMusicCookie(db, null, "netease")).toBeNull();
    expect(resolveMusicCookie(db, undefined, "netease")).toBeNull();
  });

  it("is per-platform: a netease cookie does not leak into qq", () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    expect(resolveMusicCookie(db, { id: "u1", role: "member" }, "qq")).toBeNull();
  });
});

describe("personalCookieFor", () => {
  it("ignores admin grants and the shared preference", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "GRANTED" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    db.setMusicPref("u1", "netease", true);
    expect(personalCookieFor(db, { id: "u1", role: "member" }, "netease")).toBeNull();
  });

  it("returns the own cookie even when the shared flag is on", () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    db.setMusicPref("u1", "netease", true);
    expect(personalCookieFor(db, { id: "u1", role: "member" }, "netease")).toBe("OWN");
  });
});

describe("grantedCookieFor", () => {
  it("respects a disabled account (no escape hatch)", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "G" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    // Enabled first, so it resolves…
    expect(grantedCookieFor(db, { id: "u1", role: "member" }, "netease")).toBe("G");

    // …and stops resolving the moment an admin disables it.
    db.updateMusicAccount(a.id, { enabled: false });
    expect(grantedCookieFor(db, { id: "u1", role: "member" }, "netease")).toBeNull();
  });
});

describe("withSharedPlaybackFallback", () => {
  it("uses the member's account when it can serve the track", async () => {
    const view = fakeProvider({ getSongUrl: vi.fn(async () => ({ url: "http://own/x" })) });
    const shared = fakeProvider({ getSongUrl: vi.fn(async () => ({ url: "http://shared/x" })) });
    const wrapped = withSharedPlaybackFallback(view, shared);

    expect((await wrapped.getSongUrl("1"))?.url).toBe("http://own/x");
    expect(shared.getSongUrl).not.toHaveBeenCalled();
  });

  it("falls back to the shared account when the own account has no url", async () => {
    const view = fakeProvider({ getSongUrl: vi.fn(async () => null) });
    const shared = fakeProvider({ getSongUrl: vi.fn(async () => ({ url: "http://shared/x" })) });
    const wrapped = withSharedPlaybackFallback(view, shared);

    expect((await wrapped.getSongUrl("1"))?.url).toBe("http://shared/x");
  });

  it("falls back to the shared account when the own account throws", async () => {
    const view = fakeProvider({
      getSongUrl: vi.fn(async () => {
        throw new Error("no VIP");
      }),
    });
    const shared = fakeProvider({ getSongUrl: vi.fn(async () => ({ url: "http://shared/x" })) });
    const wrapped = withSharedPlaybackFallback(view, shared);

    expect((await wrapped.getSongUrl("1"))?.url).toBe("http://shared/x");
  });

  it("wraps ONLY getSongUrl — metadata stays on the member's account", async () => {
    const view = fakeProvider({ search: vi.fn(async () => ({ songs: [{ id: "own" } as any], albums: [], playlists: [] })) });
    const shared = fakeProvider();
    const wrapped = withSharedPlaybackFallback(view, shared);

    const res = await wrapped.search("q");
    expect(res.songs[0].id).toBe("own");
    expect(shared.search).not.toHaveBeenCalled();
  });
});

describe("resolveProviderForRequest", () => {
  const shared = () => fakeProvider();
  const withCookie = (cookie: string) => fakeProvider({ getCookie: () => cookie });

  function deps(perUser: boolean) {
    const base = fakeProvider({ withCookie: vi.fn(withCookie) });
    return {
      database: db,
      perUserMusicAccounts: perUser,
      shared: () => base,
      __base: base,
    };
  }

  it("uses the shared provider when the feature is off", () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    const d = deps(false);
    const r = resolveProviderForRequest(d, { id: "u1", role: "member" }, "netease");
    expect(r.source).toBe("shared");
    expect(d.__base.withCookie).not.toHaveBeenCalled();
  });

  it("uses the shared provider for a guest even when the feature is on", () => {
    db.setUserMusicCookie("guest1", "netease", "GUEST");
    const d = deps(true);
    const r = resolveProviderForRequest(d, { id: "guest1", role: "guest" }, "netease");
    expect(r.source).toBe("shared");
  });

  it("returns an own-account view when the member linked one", () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    const d = deps(true);
    const r = resolveProviderForRequest(d, { id: "u1", role: "member" }, "netease");
    expect(r.source).toBe("own");
    expect(d.__base.withCookie).toHaveBeenCalledWith("OWN");
  });

  it("returns a granted view when an admin assigned an account", () => {
    const a = db.createMusicAccount({ platform: "netease", cookie: "GRANTED" });
    db.assignMusicAccount("u1", "netease", a.id, "admin");
    const d = deps(true);
    const r = resolveProviderForRequest(d, { id: "u1", role: "member" }, "netease");
    expect(r.source).toBe("granted");
    expect(d.__base.withCookie).toHaveBeenCalledWith("GRANTED");
  });

  it("uses the shared provider when the member chose shared", () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    db.setMusicPref("u1", "netease", true);
    const d = deps(true);
    expect(resolveProviderForRequest(d, { id: "u1", role: "member" }, "netease").source).toBe("shared");
  });

  it("falls back to shared for a platform without per-account login", () => {
    const d = deps(true);
    expect(resolveProviderForRequest(d, { id: "u1", role: "member" }, "youtube").source).toBe("shared");
  });

  it("falls back to shared when the provider has no withCookie", () => {
    db.setUserMusicCookie("u1", "netease", "OWN");
    const plain = fakeProvider();
    const r = resolveProviderForRequest(
      { database: db, perUserMusicAccounts: true, shared: () => plain },
      { id: "u1", role: "member" },
      "netease",
    );
    expect(r.source).toBe("shared");
  });
});

describe("maskCookie", () => {
  it("never returns the full credential", () => {
    const cookie = "MUSIC_U=0123456789abcdefghijklmnop";
    const masked = maskCookie(cookie);
    expect(masked).not.toBe(cookie);
    expect(masked).toContain("…");
    expect(masked).toContain(String(cookie.length));
  });

  it("handles an empty cookie", () => {
    expect(maskCookie("")).toBe("");
  });
});
