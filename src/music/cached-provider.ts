/**
 * 内容缓存装饰器（docs/server-cache-plan.md §3.2）：包装 MusicProvider，
 * 为歌词/歌单/专辑/歌曲详情/搜索/推荐歌单加缓存，其余方法（鉴权/流地址/
 * FM 等动态或写方法）原样透传。
 *
 * 实现用「方法 bind 回原实例 + 字段描述符复制」而非 Object.create 原型委托：
 * 类实例字段（this.api、this.cookieParams 等）挂在实例上，Object.create 的
 * 原型委托会让 this 指向 wrapper 而丢字段。bind 保证原方法内 this 不变。
 *
 * ## 账号隔离（重要）
 *
 * 缓存键默认**不含账号身份**，因为共享登录的单个实例即一个平台，这种默认值
 * 是对的。但多用户账号（per-user music accounts）会为同一平台、同一首歌
 * 产生不同账号视角的结果，此时不带身份的键会让成员 A 读到成员 B 的搜索
 * 结果与歌单——这是数据泄漏，不是缓存失效。
 *
 * 为此增加两个正交的防线，二者都要用：
 *
 *  1. `scope` 参与缓存键前缀（由调用方传入，通常取 cookie 的哈希前缀，
 *     不落原始凭据）；
 *  2. 个人账号 view **不要**复用共享 cache 实例（见 web/api/provider-scope.ts）。
 *
 * 只靠键隔离，未来任何一次键拼写重构都可能破功；只靠实例隔离，未来有人
 * 把 cache 提到外层又会破功。
 */
import { createHash } from "node:crypto";
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

/**
 * A stable, non-reversible cache scope for an account cookie.
 *
 * Hashing (rather than using the cookie itself) keeps live credentials out of
 * cache keys, which show up in heap dumps and debug output. An empty cookie is
 * the shared/anonymous view and gets no prefix, preserving every existing key.
 */
export function cacheScopeForCookie(cookie: string): string {
  const trimmed = (cookie ?? "").trim();
  if (!trimmed) return "";
  return createHash("sha256").update(trimmed).digest("hex").slice(0, 16);
}

export function withContentCache<P extends MusicProvider>(
  provider: P,
  cache: TtlLruCache,
  scope = "",
  /** Factory for the per-account cache a `withCookie` view gets. Without it the
   *  view falls back to the shared instance, which is only safe because the key
   *  prefix already separates accounts — but a dedicated cache is preferred so
   *  one heavy account cannot evict another's entries. */
  createCache?: () => TtlLruCache,
): P {
  const wrapped: Record<string, unknown> = {};
  // Every key goes through here so no call site can forget the account prefix.
  const scoped = (key: string) => (scope ? `${scope}:${key}` : key);

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
    cached(scoped(`lyrics:${songId}`), LYRICS_TTL_MS, emptyLines, () => provider.getLyrics(songId));

  wrapped.getPlaylistSongs = (playlistId: string) =>
    cached(scoped(`playlist:${playlistId}`), CONTENT_TTL_MS, emptySongs, () =>
      provider.getPlaylistSongs(playlistId));

  wrapped.getAlbumSongs = (albumId: string) =>
    cached(scoped(`album:${albumId}`), CONTENT_TTL_MS, emptySongs, () => provider.getAlbumSongs(albumId));

  // 查无此曲的 null 是合法缓存值；未命中用 undefined 表示，二者可区分
  wrapped.getSongDetail = (songId: string) =>
    cached(scoped(`song:${songId}`), CONTENT_TTL_MS, (v) => v === null, () =>
      provider.getSongDetail(songId));

  wrapped.search = (query: string, limit?: number, offset?: number) =>
    cached(
      scoped(`search:${query}:${limit ?? ""}:${offset ?? ""}`),
      SEARCH_TTL_MS,
      (v: SearchResult) => v.songs.length === 0 && v.albums.length === 0 && v.playlists.length === 0,
      () => provider.search(query, limit, offset),
    );

  wrapped.getRecommendPlaylists = () =>
    cached(scoped(`recommendPlaylists`), CONTENT_TTL_MS, emptyPlaylists, () =>
      provider.getRecommendPlaylists());

  // 可选方法：原 provider 没有就不包装（wrapped 上同样不存在）
  if (typeof provider.getPlaylistDetail === "function") {
    wrapped.getPlaylistDetail = (playlistId: string) =>
      cached(scoped(`playlistDetail:${playlistId}`), CONTENT_TTL_MS, (v) => v === null, () =>
        provider.getPlaylistDetail!(playlistId));
  }

  // withCookie returns a view logged in as another account. The bare bind above
  // would hand back an unwrapped provider, silently dropping every content
  // cache — but wrapping it here on the SAME cache instance would be worse:
  // two accounts would share unscoped keys. Each view gets its own cache.
  if (typeof provider.withCookie === "function") {
    wrapped.withCookie = (cookie: string) =>
      withContentCache(
        provider.withCookie!(cookie) as P,
        createCache === undefined ? cache : createCache(),
        cacheScopeForCookie(cookie),
      );
  }

  return wrapped as P;
}
