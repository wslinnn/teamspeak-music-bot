import Database from "better-sqlite3";
import { chmodSync } from "node:fs";
import { CAPABILITIES, BOTS_ALL } from "./permissions.js";
import { GUEST_USER_ID, GUEST_USERNAME } from "./users.js";
import type { QueuedSong } from "../audio/queue.js";

/**
 * Reserved owner id for chat-saved / opt-in-shared queues. A `__`-bracketed
 * literal can never collide with a real WebUI user id (UUIDs), so it cleanly
 * partitions "shared" saved queues from per-user private ones (issue #119).
 */
export const SHARED_QUEUE_OWNER = "__shared__";
/** Cap per owner (private user OR the shared bucket). */
export const MAX_SAVED_QUEUES = 50;
/** Cap per saved queue / persisted live-queue snapshot. */
export const MAX_QUEUE_SONGS = 1000;

/** A stored song is a QueuedSong minus the lazily-resolved `url`. */
export type StoredSong = Omit<QueuedSong, "url">;

/** Saved-queue row without the (potentially large) songs blob — for list views. */
export interface SavedQueueMeta {
  id: number;
  ownerId: string;
  /** 共享清单的实际创建人（私有清单等于 ownerId）；旧行可能为空串 */
  createdBy: string;
  name: string;
  songCount: number;
  createdAt: string;
  updatedAt: string;
  /** 列表查询时 join 出的创建人用户名（共享清单取 createdBy，私有取 ownerId） */
  ownerName?: string | null;
}

/** Full saved queue, including its songs. */
export interface SavedQueue extends SavedQueueMeta {
  songs: StoredSong[];
}

/** One-row-per-bot persisted live-queue state (Feature 2, auto-restore). */
export interface QueueStateRow {
  botId: string;
  songs: StoredSong[];
  currentIndex: number;
  mode: string;
  isFmMode: boolean;
  fmPlatform: string;
  /** 关机时是否正在播放（忠实恢复：播放→重启后续播；暂停/空闲→只恢复队列不出声） */
  wasPlaying: boolean;
}

export interface PlayHistoryEntry {
  botId: string;
  songId: string;
  songName: string;
  artist: string;
  album: string;
  platform: "netease" | "qq" | "bilibili" | "youtube" | "local" | "kugou" | "spotify" | "jellyfin";
  coverUrl: string;
  /** 歌曲时长（秒）。旧记录/未知为 0——历史页时长显示与进度条跳转依赖它 */
  duration?: number;
  requestedBy?: string;
}

export interface PlayHistoryRecord extends PlayHistoryEntry {
  id: number;
  playedAt: string;
}

export interface BotInstance {
  id: string;
  name: string;
  serverAddress: string;
  serverPort: number;
  nickname: string;
  defaultChannel: string;
  channelId: string;
  channelPassword: string;
  autoStart: boolean;
  /** "ts3" | "ts6" | "" (empty = auto-detect) */
  serverProtocol: string;
  /** API key for TS6 HTTP Query */
  ts6ApiKey: string;
  /** Password to join the TS server (server password) */
  serverPassword: string;
  identity?: string;
}

export interface ProfileConfig {
  avatarEnabled: boolean;
  descriptionEnabled: boolean;
  nicknameEnabled: boolean;
  awayStatusEnabled: boolean;
  channelDescEnabled: boolean;
  nowPlayingMsgEnabled: boolean;
}

export const DEFAULT_PROFILE_CONFIG: ProfileConfig = {
  avatarEnabled: true,
  descriptionEnabled: true,
  nicknameEnabled: true,
  awayStatusEnabled: true,
  channelDescEnabled: true,
  nowPlayingMsgEnabled: true,
};

/**
 * Per-bot player settings persisted across restarts (#125): the playback volume
 * and play mode. These reset to defaults on process restart when kept only in
 * memory (AudioPlayer/PlayQueue), so they are stored on the bot_instances row —
 * exactly like the per-bot profile flags — and restored when the bot is (re)built.
 */
export interface PlayerSettings {
  /** 0-100. */
  volume: number;
  /** PlayMode string: "seq" | "loop" | "random" | "rloop". */
  playMode: string;
}

const PLAY_MODES = new Set(["seq", "loop", "random", "rloop"]);

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  volume: 75,
  playMode: "seq",
};

export interface FavoritePlaylist {
  id: number;
  userId: string;
  platform: string;
  playlistId: string;
  name: string;
  coverUrl: string;
  songCount: number;
  createdAt: string;
}

// Song favorites (fork): per-user song favorites keyed by (userId, songId, platform).
export interface SongFavoriteEntry {
  id?: number;
  userId: string;
  songId: string;
  platform: string;
  title: string;
  artist: string;
  coverUrl: string;
  duration: number;
}

export interface SongFavoriteRecord extends SongFavoriteEntry {
  id: number;
  createdAt: string;
}

export interface BotDatabase {
  db: Database.Database;
  addPlayHistory(entry: PlayHistoryEntry): void;
  getPlayHistory(botId: string, limit: number): PlayHistoryRecord[];
  saveBotInstance(instance: BotInstance): void;
  getBotInstances(): BotInstance[];
  deleteBotInstance(id: string): boolean;
  getProfileConfig(botId: string): ProfileConfig;
  saveProfileConfig(botId: string, config: ProfileConfig): void;
  getPlayerSettings(botId: string): PlayerSettings;
  saveVolume(botId: string, volume: number): void;
  savePlayMode(botId: string, playMode: string): void;
  getCustomAvatarPath(botId: string): string | null;
  setCustomAvatarPath(botId: string, path: string | null): void;
  addFavorite(userId: string, playlist: { platform: string; playlistId: string; name: string; coverUrl: string; songCount: number }): void;
  removeFavorite(userId: string, playlistId: string, platform: string): boolean;
  getFavorites(userId: string): FavoritePlaylist[];
  isFavorited(userId: string, playlistId: string, platform: string): boolean;
  addSongFavorite(entry: Omit<SongFavoriteEntry, "id">): void;
  getSongFavorites(userId: string): SongFavoriteRecord[];
  deleteSongFavorite(id: number, userId: string): boolean;
  isSongFavorite(userId: string, songId: string, platform: string): boolean;
  // Saved queues (Feature 1) — upsert by (ownerId, name), capped.
  saveQueue(ownerId: string, name: string, songs: StoredSong[], createdBy?: string): SavedQueue;
  listSavedQueues(ownerId: string, includeShared: boolean): SavedQueueMeta[];
  getSavedQueue(id: number): SavedQueue | null;
  deleteSavedQueue(id: number): boolean;
  // Live-queue persistence (Feature 2) — one row per bot.
  saveQueueState(state: QueueStateRow): void;
  getQueueState(botId: string): QueueStateRow | null;
  clearQueueState(botId: string): void;
  close(): void;
}

function migrateSchema(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(bot_instances)").all() as Array<{ name: string }>;
  const names = columns.map((c) => c.name);
  if (!names.includes("identity")) {
    db.exec("ALTER TABLE bot_instances ADD COLUMN identity TEXT");
  }
  if (!names.includes("serverProtocol")) {
    db.exec("ALTER TABLE bot_instances ADD COLUMN serverProtocol TEXT NOT NULL DEFAULT ''");
  }
  if (!names.includes("ts6ApiKey")) {
    db.exec("ALTER TABLE bot_instances ADD COLUMN ts6ApiKey TEXT NOT NULL DEFAULT ''");
  }
  if (!names.includes("serverPassword")) {
    db.exec("ALTER TABLE bot_instances ADD COLUMN serverPassword TEXT NOT NULL DEFAULT ''");
  }
  if (!names.includes("channelId")) {
    db.exec("ALTER TABLE bot_instances ADD COLUMN channelId TEXT NOT NULL DEFAULT ''");
  }
  // Profile feature flags
  const profileCols = [
    "profile_avatar_enabled",
    "profile_description_enabled",
    "profile_nickname_enabled",
    "profile_away_enabled",
    "profile_channel_desc_enabled",
    "profile_now_playing_enabled",
  ];
  for (const col of profileCols) {
    if (!names.includes(col)) {
      db.exec(`ALTER TABLE bot_instances ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 1`);
    }
  }
  if (!names.includes("custom_avatar_path")) {
    db.exec("ALTER TABLE bot_instances ADD COLUMN custom_avatar_path TEXT");
  }
  // Per-bot persisted player settings (#125): volume + play mode. Defaults match
  // AudioPlayer/PlayQueue's in-memory defaults so pre-existing rows keep behaving
  // exactly as before until the user changes them.
  if (!names.includes("volume")) {
    db.exec("ALTER TABLE bot_instances ADD COLUMN volume INTEGER NOT NULL DEFAULT 75");
  }
  if (!names.includes("play_mode")) {
    db.exec("ALTER TABLE bot_instances ADD COLUMN play_mode TEXT NOT NULL DEFAULT 'seq'");
  }

  const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  const userColNames = userColumns.map((c) => c.name);
  if (!userColNames.includes("role")) {
    db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'admin'");
  }

  const historyColumns = db.prepare("PRAGMA table_info(play_history)").all() as Array<{ name: string }>;
  const historyColNames = historyColumns.map((c) => c.name);
  if (!historyColNames.includes("requestedBy")) {
    db.exec("ALTER TABLE play_history ADD COLUMN requestedBy TEXT NOT NULL DEFAULT ''");
  }
  if (!historyColNames.includes("duration")) {
    db.exec("ALTER TABLE play_history ADD COLUMN duration REAL NOT NULL DEFAULT 0");
  }
  // 歌曲收藏用户隔离（多用户化补课）：旧表无归属，回填给首位管理员
  // （单用户时代只有管理员能创建）；唯一键从 (songId, platform) 重建为
  // (userId, songId, platform)，允许不同用户各自收藏同一首。
  const favCols = db.prepare("PRAGMA table_info(favorites)").all() as Array<{ name: string }>;
  if (!favCols.some((c) => c.name === "userId")) {
    const firstAdmin = (
      db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY createdAt LIMIT 1").get() as
        | { id: string }
        | undefined
    )?.id;
    db.exec("ALTER TABLE favorites ADD COLUMN userId TEXT NOT NULL DEFAULT ''");
    if (firstAdmin) {
      db.prepare("UPDATE favorites SET userId = ? WHERE userId = ''").run(firstAdmin);
    }
    db.exec("DROP INDEX IF EXISTS idx_favorites_song_platform");
    db.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_user_song_platform ON favorites(userId, songId, platform)",
    );
  }
  // 已存清单记录创建人：共享清单的创建人展示与删除保护依赖它
  const sqCols = db.prepare("PRAGMA table_info(saved_queues)").all() as Array<{ name: string }>;
  if (!sqCols.some((c) => c.name === "createdBy")) {
    db.exec("ALTER TABLE saved_queues ADD COLUMN createdBy TEXT NOT NULL DEFAULT ''");
  }
  // 忠实恢复：快照记录关机时的播放状态（旧行默认 0 = 视为未在播，恢复后不出声）
  const qsCols = db.prepare("PRAGMA table_info(queue_state)").all() as Array<{ name: string }>;
  if (!qsCols.some((c) => c.name === "wasPlaying")) {
    db.exec("ALTER TABLE queue_state ADD COLUMN wasPlaying INTEGER NOT NULL DEFAULT 0");
  }
}

/** 播放历史保留上限（全局行数）。每首歌一行且无清理时 24/7 FM 一年约 17.5 万行/bot，
 * 历史查询（botId 过滤 + id 倒序）会随行数变慢并阻塞事件循环；启动时裁掉最旧的溢出行。 */
const PLAY_HISTORY_RETENTION_ROWS = 100_000;

function prunePlayHistory(db: Database.Database): void {
  // `id <=` 含边界：OFFSET N 取到第 N+1 新的行并连同更旧的一起删除 → 恰好保留最新 N 行。
  // 行数不足上限时子查询为 NULL，`id <= NULL` 不命中任何行 → no-op。
  db
    .prepare(
      `DELETE FROM play_history WHERE id <= (
         SELECT id FROM play_history ORDER BY id DESC LIMIT 1 OFFSET ?
       )`,
    )
    .run(PLAY_HISTORY_RETENTION_ROWS);
}

function initTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      botId TEXT NOT NULL,
      songId TEXT NOT NULL,
      songName TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      platform TEXT NOT NULL,
      coverUrl TEXT NOT NULL,
      requestedBy TEXT NOT NULL DEFAULT '',
      duration REAL NOT NULL DEFAULT 0,
      playedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_play_history_botId_id
      ON play_history(botId, id DESC);

    CREATE TABLE IF NOT EXISTS bot_instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      serverAddress TEXT NOT NULL,
      serverPort INTEGER NOT NULL,
      nickname TEXT NOT NULL,
      defaultChannel TEXT NOT NULL,
      channelId TEXT NOT NULL DEFAULT '',
      channelPassword TEXT NOT NULL,
      autoStart INTEGER NOT NULL DEFAULT 0,
      serverProtocol TEXT NOT NULL DEFAULT '',
      ts6ApiKey TEXT NOT NULL DEFAULT '',
      serverPassword TEXT NOT NULL DEFAULT '',
      volume INTEGER NOT NULL DEFAULT 75,
      play_mode TEXT NOT NULL DEFAULT 'seq',
      identity TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      passwordHash TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin'
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL,
      lastSeenAt INTEGER NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_sessions_expiresAt ON sessions(expiresAt);

    CREATE TABLE IF NOT EXISTS user_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp INTEGER NOT NULL,
      actorId TEXT,
      actorUsername TEXT,
      targetUserId TEXT,
      targetUsername TEXT,
      action TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_audit_timestamp ON user_audit(timestamp DESC);

    CREATE TABLE IF NOT EXISTS favorite_playlists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId TEXT NOT NULL,
      platform TEXT NOT NULL,
      playlistId TEXT NOT NULL,
      name TEXT NOT NULL,
      coverUrl TEXT NOT NULL DEFAULT '',
      songCount INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(userId, platform, playlistId)
    );
    CREATE INDEX IF NOT EXISTS idx_favorites_userId ON favorite_playlists(userId);

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      songId TEXT NOT NULL,
      platform TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      coverUrl TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_favorites_song_platform ON favorites(songId, platform);

    CREATE TABLE IF NOT EXISTS user_permissions (
      userId     TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY (userId, permission),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS user_bot_access (
      userId TEXT NOT NULL,
      botId  TEXT NOT NULL,
      PRIMARY KEY (userId, botId),
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_bot_access_userId ON user_bot_access(userId);

    CREATE TABLE IF NOT EXISTS saved_queues (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      ownerId   TEXT NOT NULL,
      name      TEXT NOT NULL,
      songs     TEXT NOT NULL,
      songCount INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL DEFAULT (datetime('now')),
      updatedAt TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(ownerId, name)
    );
    CREATE INDEX IF NOT EXISTS idx_saved_queues_ownerId ON saved_queues(ownerId);

    CREATE TABLE IF NOT EXISTS queue_state (
      botId        TEXT PRIMARY KEY,
      songs        TEXT NOT NULL,
      currentIndex INTEGER NOT NULL,
      mode         TEXT NOT NULL,
      isFmMode     INTEGER NOT NULL DEFAULT 0,
      fmPlatform   TEXT NOT NULL DEFAULT '',
      wasPlaying   INTEGER NOT NULL DEFAULT 0,
      updatedAt    TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

/**
 * One-time backfill: existing `member` users created before the
 * account-permissions feature are granted full access (all 5 capabilities +
 * the `bots.all` marker), exactly once per database. Admins are skipped (they
 * bypass permission checks). New members created after this runs are not
 * affected — they get the basic tier via POST /api/users. A marker row in
 * `schema_meta` makes this idempotent.
 */
export function backfillMemberPermissions(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT)`);
  const done = db.prepare("SELECT value FROM schema_meta WHERE key = 'perm_backfill_done'").get();
  if (done) return;
  const members = db.prepare("SELECT id FROM users WHERE role = 'member'").all() as { id: string }[];
  const insCap = db.prepare("INSERT OR IGNORE INTO user_permissions (userId, permission) VALUES (?, ?)");
  const tokens = [...CAPABILITIES, BOTS_ALL];
  const tx = db.transaction(() => {
    for (const m of members) {
      for (const t of tokens) insCap.run(m.id, t);
    }
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('perm_backfill_done', ?)").run(String(members.length));
  });
  tx();
}

/**
 * Ensure the reserved guest principal exists. Idempotent via the PK on
 * `users.id`. This row only backs login-less guest sessions; it is excluded
 * from countUsers()/listUsers() so it never interferes with first-run setup
 * or the user-management UI, and holds an unusable password hash.
 */
export function ensureGuestUser(db: Database.Database): void {
  const now = Date.now();
  db.prepare(
    "INSERT OR IGNORE INTO users (id, username, passwordHash, createdAt, updatedAt, role) VALUES (?, ?, '!', ?, ?, 'guest')"
  ).run(GUEST_USER_ID, GUEST_USERNAME, now, now);
}

export function createDatabase(dbPath: string): BotDatabase {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // The SQLite file holds bot server/channel passwords and identities
  // (review S6) — tighten to owner-only on POSIX. best-effort: ":memory:" and
  // locked files just skip it; Windows has no chmod anyway.
  if (process.platform !== "win32") {
    try {
      chmodSync(dbPath, 0o600);
    } catch {
      /* best-effort */
    }
  }
  initTables(db);
  migrateSchema(db);
  prunePlayHistory(db);
  backfillMemberPermissions(db);
  ensureGuestUser(db);

  const insertHistory = db.prepare(`
    INSERT INTO play_history (botId, songId, songName, artist, album, platform, coverUrl, requestedBy, duration)
    VALUES (@botId, @songId, @songName, @artist, @album, @platform, @coverUrl, @requestedBy, @duration)
  `);

  const selectHistory = db.prepare(`
    SELECT * FROM play_history WHERE botId = ? ORDER BY id DESC LIMIT ?
  `);

  const upsertInstance = db.prepare(`
    INSERT INTO bot_instances (id, name, serverAddress, serverPort, nickname, defaultChannel, channelId, channelPassword, autoStart, serverProtocol, ts6ApiKey, serverPassword, identity)
    VALUES (@id, @name, @serverAddress, @serverPort, @nickname, @defaultChannel, @channelId, @channelPassword, @autoStart, @serverProtocol, @ts6ApiKey, @serverPassword, @identity)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      serverAddress = excluded.serverAddress,
      serverPort = excluded.serverPort,
      nickname = excluded.nickname,
      defaultChannel = excluded.defaultChannel,
      channelId = excluded.channelId,
      channelPassword = excluded.channelPassword,
      autoStart = excluded.autoStart,
      serverProtocol = excluded.serverProtocol,
      ts6ApiKey = excluded.ts6ApiKey,
      serverPassword = excluded.serverPassword,
      identity = excluded.identity
  `);

  const selectInstances = db.prepare(`SELECT * FROM bot_instances`);

  const deleteInstance = db.prepare(`DELETE FROM bot_instances WHERE id = ?`);

  const selectProfileConfig = db.prepare(`
    SELECT profile_avatar_enabled, profile_description_enabled,
           profile_nickname_enabled, profile_away_enabled,
           profile_channel_desc_enabled, profile_now_playing_enabled
    FROM bot_instances WHERE id = ?
  `);

  const updateProfileConfig = db.prepare(`
    UPDATE bot_instances SET
      profile_avatar_enabled = @avatar,
      profile_description_enabled = @description,
      profile_nickname_enabled = @nickname,
      profile_away_enabled = @away,
      profile_channel_desc_enabled = @channelDesc,
      profile_now_playing_enabled = @nowPlaying
    WHERE id = @id
  `);

  const selectPlayerSettings = db.prepare(
    `SELECT volume, play_mode FROM bot_instances WHERE id = ?`,
  );
  const updateVolume = db.prepare(`UPDATE bot_instances SET volume = ? WHERE id = ?`);
  const updatePlayMode = db.prepare(`UPDATE bot_instances SET play_mode = ? WHERE id = ?`);

  const selectCustomAvatar = db.prepare(`SELECT custom_avatar_path FROM bot_instances WHERE id = ?`);
  const updateCustomAvatar = db.prepare(`UPDATE bot_instances SET custom_avatar_path = ? WHERE id = ?`);

  const insertFavorite = db.prepare(`
    INSERT INTO favorite_playlists (userId, platform, playlistId, name, coverUrl, songCount)
    VALUES (@userId, @platform, @playlistId, @name, @coverUrl, @songCount)
  `);

  const deleteFavorite = db.prepare(`
    DELETE FROM favorite_playlists WHERE userId = ? AND playlistId = ? AND platform = ?
  `);

  const selectFavorites = db.prepare(`
    SELECT id, userId, platform, playlistId, name, coverUrl, songCount, createdAt
    FROM favorite_playlists WHERE userId = ? ORDER BY createdAt DESC
  `);

  const checkFavorited = db.prepare(`
    SELECT 1 FROM favorite_playlists WHERE userId = ? AND playlistId = ? AND platform = ?
  `);

  const insertSongFavorite = db.prepare(`
    INSERT INTO favorites (userId, songId, platform, title, artist, coverUrl, duration)
    VALUES (@userId, @songId, @platform, @title, @artist, @coverUrl, @duration)
  `);

  const selectSongFavorites = db.prepare(`
    SELECT * FROM favorites WHERE userId = ? ORDER BY id DESC
  `);

  const deleteSongFavoriteStmt = db.prepare(`DELETE FROM favorites WHERE id = ? AND userId = ?`);

  const checkSongFavorite = db.prepare(`
    SELECT 1 FROM favorites WHERE userId = ? AND songId = ? AND platform = ? LIMIT 1
  `);

  // A corrupt/hand-edited songs blob must never throw into a route or the
  // restore path — degrade to an empty list instead.
  const parseSongs = (raw: string): StoredSong[] => {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? (v as StoredSong[]) : [];
    } catch {
      return [];
    }
  };
  const rowToSavedMeta = (r: {
    id: number; ownerId: string; createdBy?: string; name: string; songCount: number; createdAt: string; updatedAt: string; ownerName?: string | null;
  }): SavedQueueMeta => ({
    id: r.id,
    ownerId: r.ownerId,
    createdBy: r.createdBy ?? "",
    name: r.name,
    songCount: r.songCount,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ownerName: r.ownerName ?? null,
  });

  const upsertSavedQueue = db.prepare(`
    INSERT INTO saved_queues (ownerId, name, songs, songCount, createdBy)
    VALUES (@ownerId, @name, @songs, @songCount, @createdBy)
    ON CONFLICT(ownerId, name) DO UPDATE SET
      songs = excluded.songs,
      songCount = excluded.songCount,
      updatedAt = datetime('now')
  `);
  const selectSavedQueueByOwnerName = db.prepare(
    "SELECT * FROM saved_queues WHERE ownerId = ? AND name = ?",
  );
  const selectSavedQueueIdByOwnerName = db.prepare(
    "SELECT id FROM saved_queues WHERE ownerId = ? AND name = ?",
  );
  const countSavedQueues = db.prepare(
    "SELECT COUNT(*) AS c FROM saved_queues WHERE ownerId = ?",
  );
  const listSavedQueuesOwn = db.prepare(
    `SELECT sq.id, sq.ownerId, sq.createdBy, sq.name, sq.songCount, sq.createdAt, sq.updatedAt,
            u.username AS ownerName
     FROM saved_queues sq
     LEFT JOIN users u ON u.id = sq.ownerId
     WHERE sq.ownerId = ? ORDER BY sq.updatedAt DESC`,
  );
  const listSavedQueuesShared = db.prepare(
    `SELECT sq.id, sq.ownerId, sq.createdBy, sq.name, sq.songCount, sq.createdAt, sq.updatedAt,
            u.username AS ownerName
     FROM saved_queues sq
     LEFT JOIN users u ON u.id = CASE WHEN sq.ownerId = '${SHARED_QUEUE_OWNER}'
                                      THEN NULLIF(sq.createdBy, '') ELSE sq.ownerId END
     WHERE sq.ownerId = ? OR sq.ownerId = ? ORDER BY sq.updatedAt DESC`,
  );
  const selectSavedQueueById = db.prepare("SELECT * FROM saved_queues WHERE id = ?");
  const deleteSavedQueueById = db.prepare("DELETE FROM saved_queues WHERE id = ?");

  const upsertQueueState = db.prepare(`
    INSERT INTO queue_state (botId, songs, currentIndex, mode, isFmMode, fmPlatform, wasPlaying, updatedAt)
    VALUES (@botId, @songs, @currentIndex, @mode, @isFmMode, @fmPlatform, @wasPlaying, datetime('now'))
    ON CONFLICT(botId) DO UPDATE SET
      songs = excluded.songs,
      currentIndex = excluded.currentIndex,
      mode = excluded.mode,
      isFmMode = excluded.isFmMode,
      fmPlatform = excluded.fmPlatform,
      wasPlaying = excluded.wasPlaying,
      updatedAt = datetime('now')
  `);
  const selectQueueState = db.prepare("SELECT * FROM queue_state WHERE botId = ?");
  const deleteQueueState = db.prepare("DELETE FROM queue_state WHERE botId = ?");

  return {
    db,

    addPlayHistory(record) {
      // duration 缺省 0（历史记录可缺时长，接口层兜底）
      insertHistory.run({ duration: 0, ...record, requestedBy: record.requestedBy ?? "" });
    },

    getPlayHistory(botId, limit) {
      return selectHistory.all(botId, limit) as PlayHistoryRecord[];
    },

    saveBotInstance(instance) {
      upsertInstance.run({
        ...instance,
        autoStart: instance.autoStart ? 1 : 0,
        identity: instance.identity ?? null,
      });
    },

    getBotInstances() {
      const rows = selectInstances.all() as Array<
        Omit<BotInstance, "autoStart" | "identity"> & { autoStart: number; identity: string | null }
      >;
      return rows.map((r) => ({
        ...r,
        autoStart: r.autoStart === 1,
        serverProtocol: r.serverProtocol ?? "",
        ts6ApiKey: r.ts6ApiKey ?? "",
        serverPassword: r.serverPassword ?? "",
        channelId: r.channelId ?? "",
        identity: r.identity ?? undefined,
      }));
    },

    deleteBotInstance(id) {
      const result = deleteInstance.run(id);
      return result.changes > 0;
    },

    getProfileConfig(botId) {
      const row = selectProfileConfig.get(botId) as Record<string, number> | undefined;
      if (!row) return { ...DEFAULT_PROFILE_CONFIG };
      return {
        avatarEnabled: row.profile_avatar_enabled === 1,
        descriptionEnabled: row.profile_description_enabled === 1,
        nicknameEnabled: row.profile_nickname_enabled === 1,
        awayStatusEnabled: row.profile_away_enabled === 1,
        channelDescEnabled: row.profile_channel_desc_enabled === 1,
        nowPlayingMsgEnabled: row.profile_now_playing_enabled === 1,
      };
    },

    saveProfileConfig(botId, config) {
      updateProfileConfig.run({
        id: botId,
        avatar: config.avatarEnabled ? 1 : 0,
        description: config.descriptionEnabled ? 1 : 0,
        nickname: config.nicknameEnabled ? 1 : 0,
        away: config.awayStatusEnabled ? 1 : 0,
        channelDesc: config.channelDescEnabled ? 1 : 0,
        nowPlaying: config.nowPlayingMsgEnabled ? 1 : 0,
      });
    },

    getPlayerSettings(botId) {
      const row = selectPlayerSettings.get(botId) as
        | { volume: number | null; play_mode: string | null }
        | undefined;
      if (!row) return { ...DEFAULT_PLAYER_SETTINGS };
      // Coerce/validate: clamp volume to 0-100 and fall back to defaults for any
      // NULL / out-of-range / unknown value (a hand-edited DB must never feed a
      // bad value into AudioPlayer.setVolume / PlayQueue.setMode).
      const rawVol = typeof row.volume === "number" ? row.volume : DEFAULT_PLAYER_SETTINGS.volume;
      const volume = Number.isFinite(rawVol)
        ? Math.max(0, Math.min(100, Math.round(rawVol)))
        : DEFAULT_PLAYER_SETTINGS.volume;
      const playMode =
        typeof row.play_mode === "string" && PLAY_MODES.has(row.play_mode)
          ? row.play_mode
          : DEFAULT_PLAYER_SETTINGS.playMode;
      return { volume, playMode };
    },

    saveVolume(botId, volume) {
      const clamped = Math.max(0, Math.min(100, Math.round(volume)));
      updateVolume.run(clamped, botId);
    },

    savePlayMode(botId, playMode) {
      // Persist only recognized modes so a bad value can never poison the row.
      if (!PLAY_MODES.has(playMode)) return;
      updatePlayMode.run(playMode, botId);
    },

    getCustomAvatarPath(botId) {
      const row = selectCustomAvatar.get(botId) as { custom_avatar_path: string | null } | undefined;
      return row?.custom_avatar_path ?? null;
    },
    setCustomAvatarPath(botId, path) {
      updateCustomAvatar.run(path, botId);
    },

    addFavorite(userId, playlist) {
      insertFavorite.run({ userId, ...playlist });
    },

    removeFavorite(userId, playlistId, platform) {
      const result = deleteFavorite.run(userId, playlistId, platform);
      return result.changes > 0;
    },

    getFavorites(userId) {
      return selectFavorites.all(userId) as FavoritePlaylist[];
    },

    isFavorited(userId, playlistId, platform) {
      const row = checkFavorited.get(userId, playlistId, platform);
      return row !== undefined;
    },

    addSongFavorite(entry) {
      insertSongFavorite.run(entry);
    },

    getSongFavorites(userId) {
      return selectSongFavorites.all(userId) as SongFavoriteRecord[];
    },

    deleteSongFavorite(id, userId) {
      const result = deleteSongFavoriteStmt.run(id, userId);
      return result.changes > 0;
    },

    isSongFavorite(userId, songId, platform) {
      const row = checkSongFavorite.get(userId, songId, platform);
      return row !== undefined;
    },

    saveQueue(ownerId, name, songs, createdBy) {
      if (songs.length > MAX_QUEUE_SONGS) {
        throw new Error(`保存失败：歌曲数量超过上限 ${MAX_QUEUE_SONGS}`);
      }
      // Strip any lazily-resolved url before persisting.
      const stripped: StoredSong[] = songs.map((s) => {
        const { url: _url, ...rest } = s as QueuedSong;
        return rest;
      });
      // Enforce the per-owner cap only for a NEW name (an overwrite of an
      // existing saved queue must always be allowed).
      const existing = selectSavedQueueIdByOwnerName.get(ownerId, name) as
        | { id: number }
        | undefined;
      if (!existing) {
        const { c } = countSavedQueues.get(ownerId) as { c: number };
        if (c >= MAX_SAVED_QUEUES) {
          throw new Error(`保存失败：已保存队列数量超过上限 ${MAX_SAVED_QUEUES}`);
        }
      }
      upsertSavedQueue.run({
        ownerId,
        name,
        songs: JSON.stringify(stripped),
        songCount: stripped.length,
        // 覆盖保存不改 createdBy：创建人保持首次保存者（upsert 的 UPDATE 分支也不碰它）
        createdBy: createdBy ?? ownerId,
      });
      const row = selectSavedQueueByOwnerName.get(ownerId, name) as SavedQueueMeta;
      return { ...rowToSavedMeta(row), songs: stripped };
    },

    listSavedQueues(ownerId, includeShared) {
      const rows = includeShared
        ? (listSavedQueuesShared.all(ownerId, SHARED_QUEUE_OWNER) as SavedQueueMeta[])
        : (listSavedQueuesOwn.all(ownerId) as SavedQueueMeta[]);
      return rows.map(rowToSavedMeta);
    },

    getSavedQueue(id) {
      const row = selectSavedQueueById.get(id) as
        | (SavedQueueMeta & { songs: string })
        | undefined;
      if (!row) return null;
      return { ...rowToSavedMeta(row), songs: parseSongs(row.songs) };
    },

    deleteSavedQueue(id) {
      return deleteSavedQueueById.run(id).changes > 0;
    },

    saveQueueState(state) {
      upsertQueueState.run({
        botId: state.botId,
        songs: JSON.stringify(state.songs),
        currentIndex: state.currentIndex,
        mode: state.mode,
        isFmMode: state.isFmMode ? 1 : 0,
        fmPlatform: state.fmPlatform,
        wasPlaying: state.wasPlaying ? 1 : 0,
      });
    },

    getQueueState(botId) {
      const r = selectQueueState.get(botId) as
        | { botId: string; songs: string; currentIndex: number; mode: string; isFmMode: number; fmPlatform: string; wasPlaying: number }
        | undefined;
      if (!r) return null;
      return {
        botId: r.botId,
        songs: parseSongs(r.songs),
        currentIndex: r.currentIndex,
        mode: r.mode,
        isFmMode: r.isFmMode === 1,
        fmPlatform: r.fmPlatform,
        wasPlaying: r.wasPlaying === 1,
      };
    },

    clearQueueState(botId) {
      deleteQueueState.run(botId);
    },

    close() {
      db.close();
    },
  };
}
