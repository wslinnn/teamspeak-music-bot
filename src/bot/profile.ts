import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import axios from "axios";
import { TS3Client, escapeTS3 } from "../ts-protocol/client.js";
import type { ProfileConfig } from "../data/database.js";
import type { QueuedSong } from "../audio/queue.js";
import type { Logger } from "../logger.js";

const TS3_NICKNAME_MAX = 30;
/** TS3 avatar max size — server default is ~300 KB. Use 200 KB to be safe. */
const AVATAR_MAX_BYTES = 200 * 1024;

/**
 * Manages the bot's TeamSpeak presence (avatar, description, nickname,
 * away status, channel description, now-playing messages).
 *
 * Every update is permission-safe: if a feature fails due to insufficient
 * server permissions, it silently disables itself until the next reconnect.
 */
export class BotProfileManager {
  private tsClient: TS3Client;
  private logger: Logger;
  private config: ProfileConfig;
  private defaultNickname: string;

  /** Per-feature permission-denied flags. Reset on reconnect. */
  private permDenied = {
    avatar: false,
    description: false,
    nickname: false,
    awayStatus: false,
    channelDesc: false,
    nowPlayingMsg: false,
  };

  constructor(
    tsClient: TS3Client,
    logger: Logger,
    config: ProfileConfig,
    defaultNickname: string,
  ) {
    this.tsClient = tsClient;
    this.logger = logger.child({ component: "profile" });
    this.config = { ...config };
    this.defaultNickname = defaultNickname;
  }

  // --- Public API ---

  /**
   * Called when a new song starts playing (song != null) or playback
   * stops (song == null).
   *
   * Commands are serialized to avoid overwhelming the TS3 command queue.
   * Nickname + away status are merged into a single `clientupdate` call.
   */
  async onSongChange(song: QueuedSong | null): Promise<void> {
    // 1. Avatar first — file transfer uses its own response tracker and
    //    must run before sendCommandNoWait calls whose orphaned responses
    //    could confuse the command matcher.
    await this.updateAvatar(song?.coverUrl ?? null);
    // 2. Combined clientupdate (nickname + away in one fire-and-forget)
    await this.updateClientProperties(song);
    // 3. Description (TS6 only — instant skip on TS3)
    await this.updateDescription(song);
    // 4. Channel description (fire-and-forget channeledit)
    await this.updateChannelDescription(song);
    // 5. Now-playing chat message
    if (song) await this.sendNowPlayingMessage(song);
  }

  /** Reset permission-denied flags on new connection. */
  onConnect(): void {
    this.permDenied = {
      avatar: false,
      description: false,
      nickname: false,
      awayStatus: false,
      channelDesc: false,
      nowPlayingMsg: false,
    };
  }

  getConfig(): ProfileConfig {
    return { ...this.config };
  }

  updateConfig(partial: Partial<ProfileConfig>): void {
    Object.assign(this.config, partial);
  }

  // --- Internal update methods ---

  private async updateAvatar(coverUrl: string | null): Promise<void> {
    if (!this.config.avatarEnabled || this.permDenied.avatar) return;
    try {
      if (!coverUrl) {
        await this.clearAvatar();
        return;
      }
      // Request a thumbnail from the CDN to stay within TS3's avatar size limit.
      const thumbUrl = this.thumbnailUrl(coverUrl);
      const imageBuffer = await this.downloadImage(thumbUrl);
      if (!imageBuffer || imageBuffer.length === 0) return;
      if (imageBuffer.length > AVATAR_MAX_BYTES) {
        this.logger.warn(
          { bytes: imageBuffer.length, max: AVATAR_MAX_BYTES },
          "Cover image still too large after resize — skipping avatar update",
        );
        return;
      }

      // Wrap the file-transfer sequence with a 6s timeout — the TS3
      // full-client file transfer can silently hang.
      await Promise.race([
        this.doAvatarUpload(imageBuffer),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Avatar upload timed out")), 6000),
        ),
      ]);
      this.logger.info("Avatar updated");
    } catch (err) {
      this.handleFeatureError("avatar", err);
    }
  }

  private async doAvatarUpload(imageBuffer: Buffer): Promise<void> {
    const host = this.tsClient.getHost();
    const info = await this.tsClient.fileTransferInitUpload(
      0n, "/avatar", "", BigInt(imageBuffer.length), true,
    );
    await this.tsClient.uploadFileData(host, info, Readable.from(imageBuffer));
    const md5 = createHash("md5").update(imageBuffer).digest("hex");
    await this.tsClient.sendCommandNoWait(`clientupdate client_flag_avatar=${escapeTS3(md5)}`);
  }

  private async clearAvatar(): Promise<void> {
    try {
      await this.tsClient.fileTransferDeleteFile(0n, ["/avatar"]);
    } catch {
      // File may not exist — that's fine
    }
    try {
      await this.tsClient.sendCommandNoWait("clientupdate client_flag_avatar=");
    } catch (err) {
      this.handleFeatureError("avatar", err);
    }
  }

  private async updateDescription(song: QueuedSong | null): Promise<void> {
    if (!this.config.descriptionEnabled || this.permDenied.description) return;
    try {
      const text = song
        ? `${song.name} - ${song.artist} [${song.album}]`
        : "";
      const httpQuery = this.tsClient.getHttpQuery();
      if (httpQuery) {
        await httpQuery.clientUpdate({ client_description: text });
      } else {
        // clientupdate rejects client_description (error 1538).
        // Use clientedit on our own clid instead — this is what
        // TS3AudioBot does via TSLib's ChangeDescription().
        const clid = this.tsClient.getClientId();
        if (clid <= 0) return;
        await this.tsClient.execCommand(
          `clientedit clid=${clid} client_description=${escapeTS3(text)}`,
        );
      }
      this.logger.info("Description updated");
    } catch (err) {
      this.handleFeatureError("description", err);
    }
  }

  /**
   * Build and send a single `clientupdate` command that sets nickname
   * and away status together, avoiding multiple round-trips that can
   * cause command-queue timeouts on the TS3 protocol.
   */
  private async updateClientProperties(song: QueuedSong | null): Promise<void> {
    const parts: string[] = [];

    // --- Nickname ---
    if (this.config.nicknameEnabled && !this.permDenied.nickname) {
      if (!song) {
        parts.push(`client_nickname=${escapeTS3(this.defaultNickname)}`);
      } else {
        const songInfo = `${song.name} - ${song.artist}`;
        const prefix = "\u266A "; // ♪
        const sep = " - ";
        const overhead = prefix.length + sep.length + this.defaultNickname.length;
        if (overhead <= TS3_NICKNAME_MAX) {
          const maxSongLen = TS3_NICKNAME_MAX - overhead;
          const truncated = songInfo.length > maxSongLen
            ? songInfo.slice(0, maxSongLen - 1) + "\u2026"
            : songInfo;
          parts.push(`client_nickname=${escapeTS3(`${prefix}${truncated}${sep}${this.defaultNickname}`)}`);
        }
      }
    }

    // --- Away status ---
    if (this.config.awayStatusEnabled && !this.permDenied.awayStatus) {
      if (song) {
        parts.push("client_away=0");
      } else {
        parts.push(`client_away=1 client_away_message=${escapeTS3("\u7B49\u5F85\u64AD\u653E")}`);
      }
    }

    if (parts.length === 0) return;

    try {
      const httpQuery = this.tsClient.getHttpQuery();
      if (httpQuery) {
        // TS6: build a properties object
        const props: Record<string, string | number> = {};
        for (const part of parts) {
          const eq = part.indexOf("=");
          if (eq > 0) props[part.slice(0, eq)] = part.slice(eq + 1);
        }
        await httpQuery.clientUpdate(props);
      } else {
        // Use sendCommandNoWait: the TS3 full-client protocol often
        // doesn't return a timely error response for clientupdate,
        // causing execCommand to time out after 10s.
        await this.tsClient.sendCommandNoWait(`clientupdate ${parts.join(" ")}`);
      }
      this.logger.info("Client properties updated (nickname + away)");
    } catch (err) {
      // Flag both features on permission error
      this.handleFeatureError("nickname", err);
      this.handleFeatureError("awayStatus", err);
    }
  }

  private async updateChannelDescription(song: QueuedSong | null): Promise<void> {
    if (!this.config.channelDescEnabled || this.permDenied.channelDesc) return;
    try {
      const channelId = this.tsClient.getChannelId();
      if (channelId === 0n) return; // unknown channel

      if (!song) {
        await this.tsClient.sendCommandNoWait(
          `channeledit cid=${channelId} channel_description=`,
        );
        this.logger.debug("Channel description cleared");
        return;
      }

      const lines = [
        `\u266A \u6B63\u5728\u64AD\u653E: ${song.name} - ${song.artist}`, // ♪ 正在播放:
        `\u4E13\u8F91: ${song.album}`, // 专辑:
        `\u5E73\u53F0: ${song.platform}`, // 平台:
      ];
      const desc = lines.join("\\n");
      await this.tsClient.sendCommandNoWait(
        `channeledit cid=${channelId} channel_description=${escapeTS3(desc)}`,
      );
      this.logger.debug("Channel description updated");
    } catch (err) {
      this.handleFeatureError("channelDesc", err);
    }
  }

  private async sendNowPlayingMessage(song: QueuedSong): Promise<void> {
    if (!this.config.nowPlayingMsgEnabled || this.permDenied.nowPlayingMsg) return;
    try {
      const text = `\u266A \u6B63\u5728\u64AD\u653E: ${song.name} - ${song.artist} [${song.album}]`;
      await this.tsClient.sendTextMessage(text);
      this.logger.debug("Now-playing message sent");
    } catch (err) {
      this.handleFeatureError("nowPlayingMsg", err);
    }
  }

  // --- Helpers ---

  /**
   * Append CDN resize parameters to get a thumbnail suitable for TS3 avatars.
   * NetEase and QQ Music CDNs both support URL-based image resizing.
   */
  private thumbnailUrl(url: string): string {
    if (url.includes("music.126.net") || url.includes("netease")) {
      // NetEase Cloud Music CDN: ?param=<w>y<h>
      return url.includes("?") ? url : `${url}?param=200y200`;
    }
    if (url.includes("qqmusic") || url.includes("qq.com")) {
      // QQ Music CDN: /200 suffix or similar
      return url.replace(/\/\d+$/, "/200");
    }
    // Other platforms — return as-is, size check will skip if too large
    return url;
  }

  private async downloadImage(url: string): Promise<Buffer | null> {
    try {
      const resp = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 8000,
        maxContentLength: 2 * 1024 * 1024, // 2 MB cap
      });
      return Buffer.from(resp.data);
    } catch (err) {
      this.logger.warn({ err, url }, "Failed to download cover image");
      return null;
    }
  }

  private handleFeatureError(
    feature: keyof typeof this.permDenied,
    err: unknown,
  ): void {
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    // Disable the feature for this session on unrecoverable errors:
    // - permission / insufficient → server denies the action
    // - invalid parameter → command not supported by this protocol
    if (
      msg.includes("permission") ||
      msg.includes("insufficient") ||
      msg.includes("invalid parameter")
    ) {
      this.permDenied[feature] = true;
      this.logger.info(
        { feature, reason: msg },
        "Feature disabled for this session (will retry after reconnect)",
      );
    } else {
      this.logger.warn({ feature, err }, "Profile update failed");
    }
  }
}
