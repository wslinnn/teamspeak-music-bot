import type { BotDatabase } from "../../data/database.js";
import type { MusicProvider, SongUrlResult } from "../../music/provider.js";

/**
 * Request-scoped provider resolution for per-user music accounts.
 *
 * ## Two separate scopes
 *
 * 1. **Metadata scope** (browser side): search / playlists / recommendations
 *    read through the caller's own linked account, an admin-assigned account,
 *    or the shared login — in that order of preference (see resolveMusicCookie).
 *
 * 2. **Room playback scope**: ALWAYS the shared login. Playback happens in the
 *    TeamSpeak channel, so entitlements must be the bot's, not the requesting
 *    member's — otherwise a member without VIP would silently fail to play
 *    tracks the room's account can play, and the play history would be
 *    attributed to whoever happened to click. This is also what the player's
 *    QQ batch playability check relies on.
 */

/** Only these platforms have per-account logins today. */
export const SCOPED_PLATFORMS = ["netease", "qq", "kugou", "bilibili"] as const;
export type ScopedPlatform = (typeof SCOPED_PLATFORMS)[number];

export interface ProviderScopeDeps {
  database: BotDatabase;
  /** BotConfig.perUserMusicAccounts — off means every caller uses the shared login. */
  perUserMusicAccounts: boolean;
  /** The bot's shared, cache-wrapped provider per platform. */
  shared: (platform: string) => MusicProvider | undefined;
}

export interface ScopedUser {
  id: string;
  role: string;
}

/**
 * Guests never get an account scope.
 *
 * Every guest maps onto the same anonymous identity, so a cookie linked by one
 * guest would be readable by every other guest. Refusing the scope up front is
 * the only safe answer — `perUserMusicAccounts` is a member-level feature.
 */
function scopedUser(user: ScopedUser | undefined | null): ScopedUser | null {
  if (!user) return null;
  if (user.role === "guest") return null;
  return user;
}

/**
 * Which cookie should drive this request's metadata reads, or null for the
 * shared login.
 *
 * Order: explicit preference → own account → admin-assigned account → shared.
 * The explicit preference wins over everything because it is the member saying
 * "my account has no VIP, use the room's".
 */
export function resolveMusicCookie(
  database: BotDatabase,
  user: ScopedUser | undefined | null,
  platform: string,
): string | null {
  const scoped = scopedUser(user);
  if (!scoped) return null;

  if (database.getMusicPref(scoped.id, platform)) return null;

  const own = database.getUserMusicCookie(scoped.id, platform);
  if (own) return own;

  const granted = database.selectGrantedAccount(scoped.id, platform);
  if (granted?.cookie) return granted.cookie;

  return null;
}

/**
 * The caller's own linked cookie only (ignores admin grants and the shared
 * preference). Used by personal FM, which predates the account pool and must
 * keep working exactly as it did even when the pool feature is off.
 */
export function personalCookieFor(
  database: BotDatabase,
  user: ScopedUser | undefined | null,
  platform: string,
): string | null {
  const scoped = scopedUser(user);
  if (!scoped) return null;
  return database.getUserMusicCookie(scoped.id, platform) || null;
}

/**
 * The member's own OR admin-assigned cookie, ignoring the shared preference.
 * Deliberately has no `alwaysPersonal` escape hatch: once the feature is turned
 * off (or the account disabled), an assignment must stop applying immediately.
 */
export function grantedCookieFor(
  database: BotDatabase,
  user: ScopedUser | undefined | null,
  platform: string,
): string | null {
  const scoped = scopedUser(user);
  if (!scoped) return null;
  const own = database.getUserMusicCookie(scoped.id, platform);
  if (own) return own;
  return database.selectGrantedAccount(scoped.id, platform)?.cookie || null;
}

/**
 * Wrap a per-account provider so room playback falls back to the shared login
 * when the member's account cannot serve the track.
 *
 * Only `getSongUrl` is wrapped: metadata keeps using the member's account (that
 * is the whole point of per-user logins), while playback must not fail just
 * because the member's account lacks an entitlement the room's account has.
 */
export function withSharedPlaybackFallback<P extends MusicProvider>(
  view: P,
  shared: MusicProvider,
): P {
  const ownResolve = view.getSongUrl.bind(view);
  view.getSongUrl = async (
    songId: string,
    quality?: string,
    options?: Parameters<MusicProvider["getSongUrl"]>[2],
  ): Promise<SongUrlResult | null> => {
    try {
      const own = await ownResolve(songId, quality, options);
      if (own?.url) return own;
    } catch {
      // fall through — the shared account may still be entitled
    }
    return shared.getSongUrl(songId, quality, options);
  };
  return view;
}

export interface ResolvedProvider<T extends MusicProvider = MusicProvider> {
  provider: T;
  /** Where the credentials came from — drives the UI's status label. */
  source: "shared" | "own" | "granted";
}

/**
 * Resolve the provider a browser request should read through.
 *
 * Falls back to the shared provider for every case the scope cannot answer:
 * feature disabled, guest, no linked account, no grant, or a platform without
 * per-account login support.
 */
export function resolveProviderForRequest(
  deps: ProviderScopeDeps,
  user: ScopedUser | undefined | null,
  platform: string,
): ResolvedProvider {
  const shared = deps.shared(platform);
  if (!shared) throw new Error(`unsupported platform: ${platform}`);
  const asShared: ResolvedProvider = { provider: shared, source: "shared" };

  if (!deps.perUserMusicAccounts) return asShared;
  const scoped = scopedUser(user);
  if (!scoped) return asShared;
  if (!(SCOPED_PLATFORMS as readonly string[]).includes(platform)) return asShared;

  const own = deps.database.getUserMusicCookie(scoped.id, platform) || null;
  const prefShared = deps.database.getMusicPref(scoped.id, platform);
  if (prefShared) return asShared;

  const cookie = own ?? deps.database.selectGrantedAccount(scoped.id, platform)?.cookie ?? null;
  if (!cookie) return asShared;

  const base = deps.shared(platform);
  if (typeof base?.withCookie !== "function") return asShared;

  return {
    provider: withSharedPlaybackFallback(base.withCookie(cookie), shared),
    source: own ? "own" : "granted",
  };
}

/** Mask a cookie for display: never send the value itself to a client. */
export function maskCookie(cookie: string): string {
  const value = (cookie ?? "").trim();
  if (!value) return "";
  if (value.length <= 12) return `${value.slice(0, 2)}…${value.slice(-2)} (${value.length} 字符)`;
  return `${value.slice(0, 6)}…${value.slice(-4)} (${value.length} 字符)`;
}
