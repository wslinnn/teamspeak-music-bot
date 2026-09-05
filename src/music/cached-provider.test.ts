import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { withContentCache } from "./cached-provider.js";
import { TtlLruCache } from "./cache.js";
import type { LyricLine, MusicProvider, Playlist, SearchResult, Song } from "./provider.js";

const empty: SearchResult = { songs: [], albums: [], playlists: [] };

function fakeProvider(): MusicProvider {
  return {
    platform: "netease",
    search: vi.fn(async (): Promise<SearchResult> => empty),
    getSongUrl: vi.fn(async () => ({ url: "http://stream/x", trialDuration: 0 })),
    setQuality: vi.fn(),
    getQuality: vi.fn(() => "original"),
    getSongDetail: vi.fn(async (): Promise<Song | null> => null),
    getPlaylistSongs: vi.fn(async (): Promise<Song[]> => []),
    getRecommendPlaylists: vi.fn(async (): Promise<Playlist[]> => []),
    getAlbumSongs: vi.fn(async (): Promise<Song[]> => []),
    getLyrics: vi.fn(async (): Promise<LyricLine[]> => [{ time: 0, text: "a" }]),
    setCookie: vi.fn(),
    getCookie: vi.fn(() => ""),
    getAuthStatus: vi.fn(async () => ({ loggedIn: true })),
  } as unknown as MusicProvider;
}

describe("withContentCache", () => {
  let provider: MusicProvider;
  let wrapped: MusicProvider;

  beforeEach(() => {
    vi.useFakeTimers();
    provider = fakeProvider();
    wrapped = withContentCache(provider, new TtlLruCache(50));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses repeated getLyrics for the same song into one upstream call", async () => {
    await wrapped.getLyrics("s1");
    await wrapped.getLyrics("s1");
    expect(provider.getLyrics).toHaveBeenCalledTimes(1);
    // 不同 id 各自穿透
    await wrapped.getLyrics("s2");
    expect(provider.getLyrics).toHaveBeenCalledTimes(2);
  });

  it("keeps lyrics beyond any TTL (permanent, LRU-evicted only)", async () => {
    await wrapped.getLyrics("s1");
    vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    await wrapped.getLyrics("s1");
    expect(provider.getLyrics).toHaveBeenCalledTimes(1);
  });

  it("caches empty lyrics with the short TTL, then re-fetches", async () => {
    (provider.getLyrics as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    await wrapped.getLyrics("silent");
    await wrapped.getLyrics("silent");
    expect(provider.getLyrics).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await wrapped.getLyrics("silent");
    expect(provider.getLyrics).toHaveBeenCalledTimes(2);
  });

  it("keys search by query + limit + offset", async () => {
    await wrapped.search("hello");
    await wrapped.search("hello");
    await wrapped.search("hello", 20);
    await wrapped.search("hello", 20, 40);
    expect(provider.search).toHaveBeenCalledTimes(3);
  });

  it("caches null getSongDetail distinctly from a miss", async () => {
    await wrapped.getSongDetail("nope");
    await wrapped.getSongDetail("nope");
    expect(provider.getSongDetail).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache getSongUrl (stream URLs expire)", async () => {
    await wrapped.getSongUrl("s1");
    await wrapped.getSongUrl("s1");
    expect(provider.getSongUrl).toHaveBeenCalledTimes(2);
  });

  it("delegates mutations (setCookie) to the original instance", async () => {
    wrapped.setCookie("cookie-value");
    expect(provider.setCookie).toHaveBeenCalledWith("cookie-value");
  });

  it("copies instance fields (platform)", () => {
    expect(wrapped.platform).toBe("netease");
  });

  it("short-TTLs an empty playlist, long-TTLs a populated one", async () => {
    (provider.getPlaylistSongs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([]);
    await wrapped.getPlaylistSongs("empty-list");
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await wrapped.getPlaylistSongs("empty-list"); // 空结果已过期 → 穿透
    expect(provider.getPlaylistSongs).toHaveBeenCalledTimes(2);

    (provider.getPlaylistSongs as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "x" } as unknown as Song,
    ]);
    await wrapped.getPlaylistSongs("full-list");
    vi.advanceTimersByTime(30 * 60 * 1000);
    await wrapped.getPlaylistSongs("full-list"); // 1h TTL 未到 → 命中
    expect(provider.getPlaylistSongs).toHaveBeenCalledTimes(3);
  });
});
