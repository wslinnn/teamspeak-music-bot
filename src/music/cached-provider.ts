/**
 * 内容缓存装饰器（docs/server-cache-plan.md §3.2）：包装 MusicProvider，
 * 为歌词/歌单/专辑/歌曲详情/搜索/推荐歌单加缓存，其余方法（鉴权/流地址/
 * FM 等动态或写方法）原样透传。
 *
 * 实现用「方法 bind 回原实例 + 字段描述符复制」而非 Object.create 原型委托：
 * 类实例字段（this.api、this.cookieParams 等）挂在实例上，Object.create 的
 * 原型委托会让 this 指向 wrapper 而丢字段。bind 保证原方法内 this 不变。
 */
import type { LyricLine, MusicProvider, Playlist, SearchResult, Song } from "./provider.js";
import type { TtlLruCache } from "./cache.js";

/** 歌词不可变：永续（仅受 LRU 驱逐）。 */
const LYRICS_TTL_MS = Number.MAX_SAFE_INTEGER;
/** 歌单/专辑/歌曲详情/推荐歌单榜。 */
const CONTENT_TTL_MS = 60 * 60 * 1000;
/** 搜索：短 TTL，纯当上游防限速保险。 */
const SEARCH_TTL_MS = 10 * 60 * 1000;
/** 空结果（查无/无歌词）：短 TTL，防同一空资源反复穿透。 */
const EMPTY_TTL_MS = 10 * 60 * 1000;

export function withContentCache<P extends MusicProvider>(provider: P, cache: TtlLruCache): P {
  const wrapped: Record<string, unknown> = {};

  // 复制实例自有字段（platform、this.api 等）与原型方法；方法 bind 回原
  // 实例，保证透传调用（getAuthStatus、getSongUrl、setCookie…）语义不变。
  const proto = Object.getPrototypeOf(provider);
  const layers: object[] = [provider];
  if (proto && proto !== Object.prototype) layers.push(proto);
  for (const layer of layers) {
    for (const key of Object.getOwnPropertyNames(layer)) {
      if (key === "constructor" || key in wrapped) continue;
      const desc = Object.getOwnPropertyDescriptor(layer, key);
      if (!desc) continue;
      if (typeof desc.value === "function") {
        wrapped[key] = (desc.value as (...args: unknown[]) => unknown).bind(provider);
      } else if ("value" in desc || desc.get) {
        Object.defineProperty(wrapped, key, desc);
      }
    }
  }

  // 统一的穿透-缓存管线：命中直接返回；未命中穿透后按内容是否为空选 TTL。
  // 网络异常不缓存——抛出即穿透失败，下次调用自然重试。
  const cached = async <T>(
    key: string,
    ttlMs: number,
    isEmpty: (value: T) => boolean,
    fetch: () => Promise<T>,
  ): Promise<T> => {
    const hit = cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await fetch();
    cache.set(key, value, isEmpty(value) ? EMPTY_TTL_MS : ttlMs);
    return value;
  };

  const emptyLines = (v: LyricLine[]) => v.length === 0;
  const emptySongs = (v: Song[]) => v.length === 0;
  const emptyPlaylists = (v: Playlist[]) => v.length === 0;

  wrapped.getLyrics = (songId: string) =>
    cached(`lyrics:${songId}`, LYRICS_TTL_MS, emptyLines, () => provider.getLyrics(songId));

  wrapped.getPlaylistSongs = (playlistId: string) =>
    cached(`playlist:${playlistId}`, CONTENT_TTL_MS, emptySongs, () =>
      provider.getPlaylistSongs(playlistId));

  wrapped.getAlbumSongs = (albumId: string) =>
    cached(`album:${albumId}`, CONTENT_TTL_MS, emptySongs, () => provider.getAlbumSongs(albumId));

  // 查无此曲的 null 是合法缓存值；未命中用 undefined 表示，二者可区分
  wrapped.getSongDetail = (songId: string) =>
    cached(`song:${songId}`, CONTENT_TTL_MS, (v) => v === null, () =>
      provider.getSongDetail(songId));

  wrapped.search = (query: string, limit?: number, offset?: number) =>
    cached(
      `search:${query}:${limit ?? ""}:${offset ?? ""}`,
      SEARCH_TTL_MS,
      (v: SearchResult) => v.songs.length === 0 && v.albums.length === 0 && v.playlists.length === 0,
      () => provider.search(query, limit, offset),
    );

  wrapped.getRecommendPlaylists = () =>
    cached(`recommendPlaylists`, CONTENT_TTL_MS, emptyPlaylists, () =>
      provider.getRecommendPlaylists());

  // 可选方法：原 provider 没有就不包装（wrapped 上同样不存在）
  if (typeof provider.getPlaylistDetail === "function") {
    wrapped.getPlaylistDetail = (playlistId: string) =>
      cached(`playlistDetail:${playlistId}`, CONTENT_TTL_MS, (v) => v === null, () =>
        provider.getPlaylistDetail!(playlistId));
  }

  return wrapped as P;
}
