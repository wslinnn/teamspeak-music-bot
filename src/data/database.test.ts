import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createDatabase, type BotDatabase, type BotInstance, type PlayHistoryEntry } from "./database.js";

describe("database", () => {
  let botDb: BotDatabase;

  beforeEach(() => {
    botDb = createDatabase(":memory:");
  });

  afterEach(() => {
    botDb.close();
  });

  it("creates tables on init", () => {
    const tables = botDb.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      )
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("play_history");
    expect(names).toContain("bot_instances");
  });

  it("records and retrieves play history", () => {
    botDb.addPlayHistory({
      botId: "bot1",
      songId: "song1",
      songName: "Test Song",
      artist: "Test Artist",
      album: "Test Album",
      platform: "netease",
      coverUrl: "https://example.com/cover.jpg",
      duration: 180,
    });

    botDb.addPlayHistory({
      botId: "bot1",
      songId: "song2",
      songName: "Another Song",
      artist: "Another Artist",
      album: "Another Album",
      platform: "qq",
      coverUrl: "https://example.com/cover2.jpg",
      duration: 240,
    });

    const history = botDb.getPlayHistory("bot1", 10);
    expect(history).toHaveLength(2);
    expect(history[0].songName).toBe("Another Song");
    expect(history[1].songName).toBe("Test Song");
  });

  it("saves and loads bot instances", () => {
    const instance: BotInstance = {
      id: "bot1",
      name: "Music Bot",
      serverAddress: "localhost",
      serverPort: 9987,
      nickname: "MusicBot",
      defaultChannel: "Music",
      channelPassword: "",
      autoStart: true,
      serverProtocol: "",
      ts6ApiKey: "",
      serverPassword: "",
    };

    botDb.saveBotInstance(instance);
    const instances = botDb.getBotInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject(instance);
    expect(instances[0].autoStart).toBe(true);

    // Test upsert
    botDb.saveBotInstance({ ...instance, nickname: "UpdatedBot", autoStart: false });
    const updated = botDb.getBotInstances();
    expect(updated).toHaveLength(1);
    expect(updated[0].nickname).toBe("UpdatedBot");
    expect(updated[0].autoStart).toBe(false);
  });

  it("deletes bot instance", () => {
    botDb.saveBotInstance({
      id: "bot1",
      name: "Music Bot",
      serverAddress: "localhost",
      serverPort: 9987,
      nickname: "MusicBot",
      defaultChannel: "Music",
      channelPassword: "",
      autoStart: false,
      serverProtocol: "",
      ts6ApiKey: "",
      serverPassword: "",
    });

    expect(botDb.deleteBotInstance("bot1")).toBe(true);
    expect(botDb.getBotInstances()).toHaveLength(0);
    expect(botDb.deleteBotInstance("nonexistent")).toBe(false);
  });

  it("new bot inherits DEFAULT_PROFILE_CONFIG (channel_desc off by default)", () => {
    botDb.saveBotInstance({
      id: "bot1",
      name: "Music Bot",
      serverAddress: "localhost",
      serverPort: 9987,
      nickname: "MusicBot",
      defaultChannel: "Music",
      channelPassword: "",
      autoStart: false,
      serverProtocol: "",
      ts6ApiKey: "",
      serverPassword: "",
    });

    const profile = botDb.getProfileConfig("bot1");
    expect(profile.channelDescEnabled).toBe(false);
    expect(profile.avatarEnabled).toBe(true);
    expect(profile.descriptionEnabled).toBe(true);
    expect(profile.nicknameEnabled).toBe(true);
    expect(profile.awayStatusEnabled).toBe(true);
    expect(profile.nowPlayingMsgEnabled).toBe(true);
  });

  it("preserves user-edited profile config across saveBotInstance upsert", () => {
    botDb.saveBotInstance({
      id: "bot1",
      name: "Music Bot",
      serverAddress: "localhost",
      serverPort: 9987,
      nickname: "MusicBot",
      defaultChannel: "Music",
      channelPassword: "",
      autoStart: false,
      serverProtocol: "",
      ts6ApiKey: "",
      serverPassword: "",
    });

    // 用户在 UI 中开启了频道简介、关闭了头像
    botDb.saveProfileConfig("bot1", {
      avatarEnabled: false,
      descriptionEnabled: true,
      nicknameEnabled: true,
      awayStatusEnabled: true,
      channelDescEnabled: true,
      nowPlayingMsgEnabled: true,
    });

    // 之后再次更新 bot 配置（重命名等），profile 不应被重置
    botDb.saveBotInstance({
      id: "bot1",
      name: "Renamed Bot",
      serverAddress: "localhost",
      serverPort: 9987,
      nickname: "Renamed",
      defaultChannel: "Music",
      channelPassword: "",
      autoStart: false,
      serverProtocol: "",
      ts6ApiKey: "",
      serverPassword: "",
    });

    const profile = botDb.getProfileConfig("bot1");
    expect(profile.avatarEnabled).toBe(false);
    expect(profile.channelDescEnabled).toBe(true);
  });
});
