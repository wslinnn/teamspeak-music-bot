// 桌面端（tsmb-desktop）开发用的轻量假后端：内存库 + 一个永远在播放的
// fake bot + 测试歌词。不连 TeamSpeak、不碰真实音源。
//
//   npx tsx scripts/dev-server.mjs        # 监听 http://127.0.0.1:3999
//
// 账号：alice / pw-alice-123（admin）
// WS：ws://127.0.0.1:3999/ws（Bearer 或 cookie 均可）
import { EventEmitter } from "node:events";
import pino from "pino";
import { createDatabase } from "../src/data/database.js";
import { createUserStore } from "../src/data/users.js";
import { getDefaultConfig } from "../src/data/config.js";
import { createWebServer } from "../src/web/server.js";

const PORT = 3999;
const SONG_DURATION = 213; // 秒
const SONG_ID = "20391";

const startedAt = Date.now();
const songElapsed = () => ((Date.now() - startedAt) / 1000) % SONG_DURATION;

const fakeBot = new EventEmitter();
fakeBot.id = "bot-dev";
fakeBot.getStatus = () => ({
  id: "bot-dev",
  name: "Dev Bot",
  connected: true,
  playing: true,
  paused: false,
  currentSong: {
    id: SONG_ID,
    platform: "netease",
    title: "晴天",
    artist: "周杰伦",
    duration: SONG_DURATION,
  },
  queueSize: 1,
  volume: 75,
  playMode: "seq",
  elapsed: songElapsed(),
});
fakeBot.getQueue = () => [];

// 模拟 stateChange 的推送频率（真实后端约每首歌 30 次，这里 5s 一次足够验证）
setInterval(() => fakeBot.emit("stateChange"), 5000);

const botManager = {
  getAllBots: () => [fakeBot],
  getBot: (id) => (id === fakeBot.id ? fakeBot : undefined),
  on: () => {},
  removeListener: () => {},
};

// 每 5 秒一行，覆盖整首歌
const lyrics = Array.from({ length: Math.ceil(SONG_DURATION / 5) }, (_, i) => ({
  time: i * 5,
  text: `测试歌词 第 ${i + 1} 行`,
  translation: i % 2 === 0 ? `translation line ${i + 1}` : undefined,
}));

const provider = {
  platform: "netease",
  getLyrics: async () => lyrics,
};

const logger = pino({ level: "info" });
const botDb = createDatabase(":memory:");
await createUserStore(botDb.db).createUser("alice", "pw-alice-123", "admin");

const web = createWebServer({
  port: PORT,
  botManager,
  neteaseProvider: provider,
  qqProvider: provider,
  bilibiliProvider: provider,
  localProvider: provider,
  kugouProvider: provider,
  spotifyProvider: provider,
  jellyfinProvider: provider,
  database: botDb,
  config: getDefaultConfig(),
  configPath: "data/config.json",
  logger,
  avatarStore: {},
});

await web.start();
logger.info(`dev server ready: http://127.0.0.1:${PORT}  (alice / pw-alice-123)`);
