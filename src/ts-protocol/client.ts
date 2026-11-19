import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import {
  asChannelID,
  asClientID,
  Codec,
  deleteFile,
  getClientProperties,
  initFileUpload,
  listChannels,
  listClients,
  moveClient,
  sendChannelMessage,
  sendPrivateMessage,
  type Channel,
  type ChannelID,
  type ClientEnterEvent,
  type ClientEntry,
  type ClientLeaveEvent,
  type ClientMovedEvent,
  type ClientID,
  type TextMessageEvent,
  type VoiceDataEvent,
  type FileUploadInfo,
} from "@honeybbq/teamspeak";
import {
  Client as TS3FullClient,
  generateIdentitySync as genTS3Identity,
  parseIdentity,
  UIDAlgorithm,
  type Identity,
} from "@honeybbq/teamspeak/client";
import type { Logger } from "../logger.js";
import {
  detectServerProtocol,
  type ServerProtocol,
} from "./protocol-detect.js";
import { TS6HttpQuery } from "./http-query.js";
import {
  TrackingVoiceEndpointResolver,
  type ResolvedVoiceEndpoint,
} from "./voice-endpoint.js";

export { CODEC_OPUS_MUSIC } from "./voice.js";
export type { ServerProtocol } from "./protocol-detect.js";
export type { FileUploadInfo } from "@honeybbq/teamspeak";

/** Escape a string for use in TS3 ServerQuery-style commands. */
export function escapeTS3(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/ /g, "\\s")
    .replace(/\//g, "\\/")
    .replace(/\|/g, "\\p")
    .replace(/\t/g, "\\t")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

export interface TS3ClientOptions {
  host: string;
  port: number; // Voice/virtual server port (default 9987)
  queryPort: number; // ServerQuery port (10011 for TS3, 10080 for TS6 HTTP)
  nickname: string;
  identity?: string; // Exported identity string, or undefined to generate new
  defaultChannel?: string;
  channelId?: string; // Numeric channel ID (takes precedence over defaultChannel)
  channelPassword?: string;
  serverPassword?: string;
  /** Force a specific protocol instead of auto-detecting. */
  serverProtocol?: ServerProtocol;
  /** API key for TS6 HTTP Query authentication. */
  ts6ApiKey?: string;
  /** @internal Test seam: substitute the underlying SDK Client instance so the
   *  protocol layer can be exercised without a live TeamSpeak server. */
  sdkClientFactory?: (identity: Identity, addr: string, nickname: string, options: any) => any;
}

export interface TS3TextMessage {
  invokerName: string;
  invokerId: string;
  invokerUid: string;
  message: string;
  targetMode: number; // 1=private, 2=channel, 3=server
  invokerGroups: string[]; // sender's TS server-group ids; [] when not in view cache
}

/** Lightweight voice-packet signal used for activity detection. The encoded
 * payload is intentionally not forwarded beyond this protocol wrapper. */
export interface TS3VoiceActivity {
  clientId: number;
  codec: number;
  /** Stable TeamSpeak identity when the sender is present in the client view. */
  clientUid?: string;
}

/** Send acceptance only: an accepted UDP call does not confirm delivery. */
export interface TS3VoiceSendFailure {
  code?: string;
  consecutiveFailures: number;
  durationMs: number;
}

/** Sticky failure status lets playback stay paused when the terminal event
 * already fired during another track or an idle URL lookup. */
export type TS3VoiceSendResult = "accepted" | "retrying" | "failed" | "unavailable";

const VOICE_SEND_FAILURE_TIMEOUT_MS = 2_000;
const SAFE_SOCKET_ERROR_CODES = new Set([
  "ERR_SOCKET_DGRAM_NOT_RUNNING", "ERR_SOCKET_DGRAM_NOT_CONNECTED",
  "EPIPE", "ENOBUFS", "ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH",
  "ENETUNREACH", "ENETDOWN", "EACCES", "EPERM", "EINVAL", "EMSGSIZE",
  "EAGAIN", "ENOTCONN", "EBADF",
]);

function safeSocketErrorCode(error: unknown): string | undefined {
  try {
    if (!error || typeof error !== "object") return undefined;
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" && SAFE_SOCKET_ERROR_CODES.has(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

// Command notifications and UDP voice packets can be reordered in flight.
// Retain a leaving client's UID briefly so its final packet is still
// attributable; a new clientEnter for the same id cancels and overwrites it.
const VISIBLE_CLIENT_UID_RELEASE_GRACE_MS = 1_000;

/**
 * Map the library's TextMessage to our wrapper. Preserves invokerGroups (the
 * sender's TS server groups), which the library populates only when the sender
 * is in the bot's client-view cache; otherwise it is []. Used by the chat
 * command permission gate.
 */
/**
 * Map the library's TextMessageEvent to our wrapper. Some fields only exist
 * when the protocol command actually carried them (a channel message has no
 * target mode), so fall back rather than emitting undefined.
 */
export function toTS3TextMessage(msg: TextMessageEvent): TS3TextMessage {
  const raw = msg as unknown as {
    targetMode?: number;
    invokerGroups?: string[];
  };
  return {
    invokerName: msg.invokerName,
    invokerId: String(msg.invokerID),
    invokerUid: msg.invokerUID,
    message: msg.message,
    targetMode: raw.targetMode ?? 2,
    invokerGroups: raw.invokerGroups ?? [],
  };
}

export class TS3Client extends EventEmitter {
  private client: TS3FullClient | null = null;
  private identity: Identity;
  private readonly clientUid: string;
  private clientId = 0;
  /**
   * 自机频道号（显式解析）。库的内部 client 映射只从 enterview 通知填充，
   * 而服务器不会给 bot 自己发 enterview、clientmoved 又只更新"已在表里"
   * 的客户端——所以库的 channelID() 从连接起恒为 0n，占用判定/频道内
   * 客户端过滤会全部失灵。这里在连接/入频道后用 clientinfo 显式解析并缓存。
   */
  private resolvedChannelId: bigint | null = null;
  private readonly visibleClientUids = new Map<number, string>();
  private readonly visibleClientUidReleaseTimers = new Map<
    number,
    ReturnType<typeof setTimeout>
  >();
  private logger: Logger;
  private disconnecting = false;
  private detectedProtocol: ServerProtocol = "unknown";
  private httpQuery: TS6HttpQuery | null = null;
  private udpErrorTimer: ReturnType<typeof setTimeout> | null = null;
  private connectionGeneration = 0;
  private voiceFailureTimer: ReturnType<typeof setTimeout> | null = null;
  private voiceFailure: { code?: string; consecutiveFailures: number; startedAt: number } | null = null;
  private voiceEndpointResolver = new TrackingVoiceEndpointResolver();

  constructor(private options: TS3ClientOptions, logger: Logger) {
    super();
    this.logger = logger;

    if (options.identity) {
      try {
        this.identity = parseIdentity(options.identity);
      } catch (err) {
        // An identity persisted by @honeybbq/teamspeak-client 0.2.x may not be
        // in the 1.x export format. Generating a fresh one keeps the bot
        // connectable (the only cost is a new server-side identity) instead of
        // crash-looping on startup with no way to recover from the UI.
        this.logger.warn(
          { err },
          "Stored identity could not be parsed — generating a new one (the bot will appear as a new client)",
        );
        this.identity = genTS3Identity(8);
      }
    } else {
      this.identity = genTS3Identity(8);
    }
    // The identity's uid needs the server's hash algorithm (SHA-1 for TS3,
    // SHA-256 for TS6). The constructor cannot know it yet — the protocol is
    // detected during connect — so this is refreshed once the server family
    // is known (see refreshClientUid). SHA-1 is the TS3 default and matches
    // the pre-migration behaviour.
    this.clientUid = this.identity.uid(UIDAlgorithm.SHA1);
  }

  /** The detected (or forced) server protocol after connect(). */
  getServerProtocol(): ServerProtocol {
    return this.detectedProtocol;
  }

  /** TS6 HTTP Query client (available after connecting to a TS6 server). */
  getHttpQuery(): TS6HttpQuery | null {
    return this.httpQuery;
  }

  async connect(): Promise<void> {
    const generation = ++this.connectionGeneration;
    this.resetVoiceSendState();
    this.disconnecting = false;
    const voiceEndpointResolver = new TrackingVoiceEndpointResolver();
    this.voiceEndpointResolver = voiceEndpointResolver;
    this.clearVisibleClientUids();
    this.httpQuery = null;
    // Clean up any existing connection before creating a new one
    const previousClient = this.client;
    this.client = null;
    this.clientId = 0;
    if (previousClient) {
      this.logger.info("Cleaning up previous connection before reconnecting");
      try {
        await previousClient.disconnect();
      } catch {
        // Ignore errors during cleanup
      }
      if (generation !== this.connectionGeneration) return;
      // Fork: self-resolved channel id (library channelID reads 0n) must not
      // survive a reconnect — it belongs to the previous connection.
      this.resolvedChannelId = null;
    }

    const addr = `${this.options.host}:${this.options.port}`;

    // Detect or use forced protocol
    if (this.options.serverProtocol && this.options.serverProtocol !== "unknown") {
      this.detectedProtocol = this.options.serverProtocol;
      this.logger.info(
        { addr, protocol: this.detectedProtocol },
        "Using forced server protocol",
      );
    } else {
      this.logger.info({ addr }, "Detecting server protocol (TS3/TS6)...");
      const detection = await detectServerProtocol(
        this.options.host,
        this.options.port,
        3000,
        { ts3QueryPort: 10011, ts6HttpPort: 10080 },
      );
      if (generation !== this.connectionGeneration) return;
      this.detectedProtocol = detection.protocol;
      if (this.detectedProtocol === "unknown") {
        this.logger.warn(
          { addr },
          "Could not detect server protocol (query ports 10011/10080 unreachable). " +
            "Will attempt voice connection anyway. Use serverProtocol option to force TS3 or TS6.",
        );
      } else {
        this.logger.info(
          { addr, protocol: this.detectedProtocol, queryPort: detection.queryPort },
          `Server protocol detected: ${this.detectedProtocol.toUpperCase()}`,
        );
      }
    }

    // Set up TS6 HTTP Query if applicable
    if (this.detectedProtocol === "ts6") {
      const queryPort = this.options.queryPort !== 10011 ? this.options.queryPort : 10080;
      this.httpQuery = new TS6HttpQuery({
        host: this.options.host,
        port: queryPort,
        apiKey: this.options.ts6ApiKey,
      });
    }

    this.logger.info(
      { addr, protocol: this.detectedProtocol },
      "Connecting to TeamSpeak server (full client protocol)",
    );

    // Throttle repeated "udp send error" warnings (fires every 20ms during playback if UDP breaks)
    let sdkClient: TS3FullClient | null = null;
    const isCurrent = () => sdkClient !== null && this.client === sdkClient &&
      this.connectionGeneration === generation && !this.disconnecting;
    let udpErrorCount = 0;
    let udpErrorCode: string | undefined;
    const throttledWarn = (msg: string, ...args: unknown[]) => {
      if (!isCurrent()) return;
      if (typeof msg === "string" && msg.includes("udp send error")) {
        udpErrorCount++;
        udpErrorCode = args.map(safeSocketErrorCode).find(code => code !== undefined) ?? udpErrorCode;
        if (udpErrorCount === 1) {
          this.logger.warn({ ...(udpErrorCode ? { code: udpErrorCode } : {}), count: 1 }, "udp send error");
          // After 2 seconds, log a summary and reset.
          // Clear any previous timer to avoid leaking it.
          if (this.udpErrorTimer) clearTimeout(this.udpErrorTimer);
          this.udpErrorTimer = setTimeout(() => {
            if (!isCurrent()) return;
            if (udpErrorCount > 1) {
              this.logger.warn({ ...(udpErrorCode ? { code: udpErrorCode } : {}), count: udpErrorCount }, "Repeated udp send error; connection may be lost");
            }
            udpErrorCount = 0;
            udpErrorCode = undefined;
            this.udpErrorTimer = null;
          }, 2000);
          this.udpErrorTimer.unref?.();
        }
        return;
      }
      this.logger.warn(msg);
    };

    const sdkOptions = {
      // Forward server password to the protocol library so it can be
      // included in clientinit for password-protected servers
      serverPassword: this.options.serverPassword,
      resolver: voiceEndpointResolver,
      logger: {
        debug: (msg: string) => { if (isCurrent()) this.logger.debug(msg); },
        info: (msg: string) => { if (isCurrent()) this.logger.info(msg); },
        warn: throttledWarn,
        error: (msg: string) => { if (isCurrent()) this.logger.error(msg); },
      },
    };
    const created: TS3FullClient = this.options.sdkClientFactory
      ? this.options.sdkClientFactory(this.identity, addr, this.options.nickname, sdkOptions)
      : new TS3FullClient(this.identity, addr, this.options.nickname, sdkOptions);
    sdkClient = created;
    this.client = sdkClient;

    sdkClient.on("textMessage", (msg: TextMessageEvent) => {
      if (!isCurrent()) return;
      if (Number(msg.invokerID) === this.clientId) return;
      this.emit("textMessage", toTS3TextMessage(msg));
    });

    sdkClient.on("voiceData", (voice: VoiceDataEvent) => {
      if (!isCurrent()) return;
      // The library normally suppresses our own packets; retain the explicit
      // guard so a future protocol change cannot make the bot duck itself.
      if (Number(voice.clientID) === this.clientId) return;
      const clientUid = this.visibleClientUids.get(Number(voice.clientID));
      const activity: TS3VoiceActivity = {
        clientId: Number(voice.clientID),
        codec: voice.codec,
        ...(clientUid ? { clientUid } : {}),
      };
      this.emit("voiceActivity", activity);
    });

    sdkClient.on("disconnected", (err: unknown) => {
      if (!isCurrent()) return;
      const code = safeSocketErrorCode(err);
      this.logger.warn(code ? { code } : {}, "Connection closed");
      ++this.connectionGeneration;
      this.resetVoiceSendState();
      this.client = null;
      this.clientId = 0;
      this.resolvedChannelId = null;
      this.clearVisibleClientUids();
      this.emit("disconnected");
    });

    sdkClient.on("clientEnter", (info: ClientEnterEvent) => {
      if (!isCurrent()) return;
      const id = Number(info.id);
      this.rememberVisibleClientUid(id, info.uid ?? "");
      this.logger.debug(
        { nickname: info.nickname, id },
        "Client entered"
      );
      // Downstream consumers (channelView, resume filters) speak the fork's
      // simple { id, uid, channelID } shape, not the SDK's branded entry.
      // `uid` is optional in the SDK (a client can have none), so normalise it
      // to "" rather than leaking undefined into the UID cache.
      this.emit("clientEnter", {
        id,
        uid: info.uid ?? "",
        channelID: info.channelID,
        nickname: info.nickname,
        clientType: info.type,
      });
    });

    sdkClient.on("clientLeave", (ev: ClientLeaveEvent) => {
      if (!isCurrent()) return;
      const id = Number(ev.clientID);
      this.releaseVisibleClientUid(id);
      this.logger.debug({ id }, "Client left");
      this.emit("clientLeave", {
        id,
        // A leave event carries no uid (the SDK removed it); an empty string
        // keeps the downstream shape stable.
        uid: "",
        channelID: ev.fromChannelID,
        reason: ev.reason,
        reasonMessage: ev.reasonMessage,
      });
    });

    sdkClient.on("clientMoved", (ev: ClientMovedEvent) => {
      if (!isCurrent()) return;
      const id = Number(ev.clientID);
      this.logger.debug(
        { id, targetChannelID: ev.targetChannelID.toString() },
        "Client moved"
      );
      this.emit("clientMoved", {
        id,
        targetChannelID: ev.targetChannelID,
        invokerName: ev.invokerName,
      });
    });

    await sdkClient.connect();
    if (!isCurrent()) {
      // DNS/socket setup may finish after disconnect() closed the transport.
      // Close it again without waiting on command replies from a stale session.
      sdkClient.disconnect();
      return;
    }
    // Note: @honeybbq/teamspeak-client 0.2.x ships a universal clientinit
    // (client_version "3.?.? [Build: 5680278000]" + matching signature)
    // that works against both TS3 and TS6 servers. The old 3.6.2 monkey-
    // patch on handler.sendPacket was removed when we bumped to 0.2.1 — it
    // would have replaced the library's new correct version with a stale
    // signature and made TS6 handshakes fail.
    // connect() resolves only after the handshake completes; there is no separate wait step.
    if (!isCurrent()) return;
    this.clientId = Number(sdkClient.clientID);
    this.voiceFramesSent = 0;

    // Join channel by numeric ID (takes precedence) or by name
    if (this.options.channelId) {
      await this.joinChannel(this.options.channelId, this.options.channelPassword);
    } else if (this.options.defaultChannel) {
      await this.joinChannel(
        this.options.defaultChannel,
        this.options.channelPassword
      );
    }

    // 入频道后再解析一次，拿到最终频道号；失败不阻塞连接
    // （占用视图播种会降级并打 warn，30s 对账兜底）
    await this.resolveSelfChannel();
    this.logger.info(
      { clientId: this.clientId, channelId: this.resolvedChannelId?.toString() ?? null },
      `Logged in (visible client, ${this.detectedProtocol.toUpperCase()} server)`,
    );

    if (isCurrent()) this.emit("connected");
  }

  /** 用 clientinfo 显式解析自机频道号（绕开库 channelID() 恒为 0n 的缺陷）。 */
  private async resolveSelfChannel(): Promise<void> {
    this.resolvedChannelId = null;
    if (!this.client || this.clientId <= 0) return;
    try {
      const props = await getClientProperties(this.client, asClientID(this.clientId));
      const cid = BigInt(props.cid ?? "0");
      if (cid > 0n) this.resolvedChannelId = cid;
    } catch (err) {
      this.logger.warn({ err }, "Failed to resolve self channel via clientinfo");
    }
  }

  async joinChannel(channelName: string, password?: string): Promise<void> {
    const client = this.client;
    if (!client || this.disconnecting) return;
    const clientId = this.clientId;
    const generation = this.connectionGeneration;
    const isCurrent = () => this.client === client && this.clientId === clientId &&
      this.connectionGeneration === generation && !this.disconnecting;

    const isNumeric = /^\d+$/.test(channelName);
    if (isNumeric) {
      try {
        await moveClient(client, asClientID(clientId), asChannelID(BigInt(channelName)),
          password ? { password } : undefined);
        if (!isCurrent()) return;
        this.resolvedChannelId = BigInt(channelName);
        this.logger.info({ channelName }, "Joined channel");
      } catch (err) {
        if (isCurrent()) this.logger.error({ err, channelName }, "Failed to join channel");
      }
      return;
    }

    try {
      const channels = await listChannels(client);
      if (!isCurrent()) return;
      const channel = channels.find((ch) => ch.name === channelName);

      if (!channel) {
        this.logger.warn({ channelName }, "Channel not found");
        return;
      }

      await moveClient(client, asClientID(clientId), channel.id,
        password ? { password } : undefined);
      if (!isCurrent()) return;
      this.resolvedChannelId = channel.id;
      this.logger.info(
        { channelName, cid: channel.id.toString() },
        "Joined channel"
      );
    } catch (err) {
      if (isCurrent()) this.logger.error({ err, channelName }, "Failed to join channel");
    }
  }

  async sendTextMessage(
    message: string,
    targetMode: number = 2,
    targetClientId?: number,
  ): Promise<void> {
    if (!this.client) return;
    // Mode 1 = private message to one client; everything else is the channel.
    if (targetMode === 1) {
      if (targetClientId === undefined || targetClientId <= 0) return;
      await sendPrivateMessage(this.client, asClientID(targetClientId), message);
      return;
    }
    await sendChannelMessage(this.client, message);
  }

  async getClientsInChannel(): Promise<ClientEntry[]> {
    if (!this.client) return [];
    try {
      const allClients = await listClients(this.client);
      // 用显式解析的频道号：库的 channelID() 恒为 0n，会让过滤结果永远为空
      const myChannelId = this.getChannelId();
      if (myChannelId === 0n) return [];
      return allClients.filter((c) => c.channelID === myChannelId);
    } catch {
      return [];
    }
  }

  /**
   * Resolve a client's CURRENT server groups by client id, server-wide (works
   * regardless of channel/view) via a targeted `clientinfo` query. The raw
   * `client_servergroups` field is a comma-separated list (same field
   * `listClients` parses). Returns [] if the client can't be resolved or the
   * query fails, so callers fail closed.
   */
  async getClientServerGroups(clid: number): Promise<string[]> {
    if (!this.client) return [];
    try {
      const props = await getClientProperties(this.client, asClientID(clid));
      const raw = props.client_servergroups ?? "";
      return raw ? raw.split(",") : [];
    } catch {
      return [];
    }
  }

  // --- Raw command & file transfer pass-through ---

  async execCommand(cmd: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client.exec(cmd);
  }

  /** Fire a command without waiting for the server's response. */
  async sendCommandNoWait(cmd: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client.execNoWait(cmd);
  }

  async execCommandWithResponse(cmd: string): Promise<Record<string, string>[]> {
    if (!this.client) throw new Error("Not connected");
    return this.client.exec(cmd);
  }

  async fileTransferInitUpload(
    channelID: bigint | ChannelID,
    path: string,
    password: string,
    size: bigint,
    overwrite = true,
  ): Promise<FileUploadInfo> {
    if (!this.client) throw new Error("Not connected");
    return initFileUpload(this.client, asChannelID(channelID), path, size, {
      ...(password ? { password } : {}),
      overwrite,
    });
  }

  async uploadFileData(host: string, info: FileUploadInfo, data: Readable): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await this.client.uploadFileData(host, info, data);
  }

  async fileTransferDeleteFile(channelID: bigint | ChannelID, paths: string[]): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await deleteFile(this.client, asChannelID(channelID), paths);
  }

  /** The server host (needed for file transfer TCP connections). */
  getHost(): string {
    return this.options.host;
  }

  /** The current channel ID of this client. */
  getChannelId(): bigint {
    // 显式解析值优先：库的 channelID() 因自机不在其映射表里恒为 0n
    if (this.resolvedChannelId !== null) return this.resolvedChannelId;
    if (!this.client) return 0n;
    return BigInt(this.client.channelID);
  }

  /** Fork: full channel list for the server-tree view. */
  async getChannelList(): Promise<Channel[]> {
    if (!this.client) return [];
    try {
      return await listChannels(this.client);
    } catch {
      return [];
    }
  }

  /** Fork: full client list for the server-tree view. */
  async getClientList(): Promise<ClientEntry[]> {
    if (!this.client) return [];
    try {
      return await listClients(this.client);
    } catch {
      return [];
    }
  }

  /** Fork: move this client to a channel by numeric ID. */
  async joinChannelById(channelId: bigint | ChannelID, password?: string): Promise<void> {
    if (!this.client) throw new Error("Not connected");
    await moveClient(
      this.client,
      asClientID(this.clientId),
      asChannelID(channelId),
      password ? { password } : undefined,
    );
    this.resolvedChannelId = BigInt(channelId);
    this.logger.info({ channelId: channelId.toString() }, "Moved to channel by ID");
  }

  private voiceFramesSent = 0;

  sendVoiceData(opusFrame: Buffer): TS3VoiceSendResult {
    const client = this.client;
    if (!client || this.disconnecting) return "unavailable";
    try {
      client.sendVoice(opusFrame, Codec.OpusMusic);
    } catch (err) {
      if (this.voiceFailure) {
        this.voiceFailure.consecutiveFailures++;
        this.voiceFailure.code = safeSocketErrorCode(err) ?? this.voiceFailure.code;
        return this.voiceFailureTimer ? "retrying" : "failed";
      }
      const code = safeSocketErrorCode(err);
      const failure = this.voiceFailure = {
        ...(code ? { code } : {}), consecutiveFailures: 1, startedAt: Date.now(),
      };
      const generation = this.connectionGeneration;
      this.voiceFailureTimer = setTimeout(() => {
        if (this.client !== client || this.connectionGeneration !== generation ||
          this.disconnecting || this.voiceFailure !== failure) return;
        this.voiceFailureTimer = null;
        const event = this.voiceFailureDetails(failure);
        this.logger.error(event, "Voice sends have failed continuously; pausing playback is required");
        this.emit("voiceSendFailed", event);
      }, VOICE_SEND_FAILURE_TIMEOUT_MS);
      this.voiceFailureTimer.unref?.();
      const event = this.voiceFailureDetails(failure);
      this.logger.warn(event, "Voice send failed");
      this.emit("voiceSendFailure", event);
      return "retrying";
    }
    this.voiceFramesSent++;
    if (this.voiceFramesSent === 1) {
      this.logger.info({ opusBytes: opusFrame.length, clientId: this.clientId }, "First voice packet accepted by TeamSpeak client");
    }
    if (this.voiceFailure) {
      const event = this.voiceFailureDetails(this.voiceFailure);
      this.clearVoiceFailure();
      this.logger.info(event, "Voice send recovered");
      this.emit("voiceSendRecovered", event);
    }
    return "accepted";
  }

  private voiceFailureDetails(failure: NonNullable<TS3Client["voiceFailure"]>): TS3VoiceSendFailure {
    return {
      ...(failure.code ? { code: failure.code } : {}),
      consecutiveFailures: failure.consecutiveFailures,
      durationMs: Math.max(0, Date.now() - failure.startedAt),
    };
  }

  private clearVoiceFailure(): void {
    if (this.voiceFailureTimer) clearTimeout(this.voiceFailureTimer);
    this.voiceFailureTimer = null;
    this.voiceFailure = null;
  }

  private resetVoiceSendState(): void {
    this.clearVoiceFailure();
    this.voiceFramesSent = 0;
    if (this.udpErrorTimer) clearTimeout(this.udpErrorTimer);
    this.udpErrorTimer = null;
  }

  getIdentityExport(): string {
    // export() is the secret form parseIdentity() reads. toString() only
    // describes the identity by its UID, so using it here would silently
    // persist an unusable value and every reconnect would get a new identity.
    return this.identity.export();
  }

  getClientId(): number {
    return this.clientId;
  }

  /** Actual endpoint selected by the SDK's SRV/TSDNS discovery and DNS lookup. */
  getResolvedVoiceEndpoint(): ResolvedVoiceEndpoint | null {
    return this.voiceEndpointResolver.getEndpoint();
  }

  /** Stable identity of this managed TeamSpeak client. */
  getClientUid(): string {
    return this.clientUid;
  }

  private rememberVisibleClientUid(clientId: number, clientUid: string): void {
    const pendingRelease = this.visibleClientUidReleaseTimers.get(clientId);
    if (pendingRelease) clearTimeout(pendingRelease);
    this.visibleClientUidReleaseTimers.delete(clientId);

    if (clientId > 0 && clientUid) {
      this.visibleClientUids.set(clientId, clientUid);
    } else {
      this.visibleClientUids.delete(clientId);
    }
  }

  private releaseVisibleClientUid(clientId: number): void {
    const clientUid = this.visibleClientUids.get(clientId);
    if (!clientUid) return;

    const previous = this.visibleClientUidReleaseTimers.get(clientId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      if (this.visibleClientUids.get(clientId) === clientUid) {
        this.visibleClientUids.delete(clientId);
      }
      this.visibleClientUidReleaseTimers.delete(clientId);
    }, VISIBLE_CLIENT_UID_RELEASE_GRACE_MS);
    timer.unref?.();
    this.visibleClientUidReleaseTimers.set(clientId, timer);
  }

  private clearVisibleClientUids(): void {
    for (const timer of this.visibleClientUidReleaseTimers.values()) {
      clearTimeout(timer);
    }
    this.visibleClientUidReleaseTimers.clear();
    this.visibleClientUids.clear();
  }

  disconnect(): void {
    const generation = ++this.connectionGeneration;
    this.resetVoiceSendState();
    const client = this.client;
    this.client = null;
    if (client && !this.disconnecting) {
      this.disconnecting = true;
      client.disconnect().catch(() => {}).finally(() => {
        if (generation === this.connectionGeneration) this.disconnecting = false;
      });
    }
    this.clientId = 0;
    this.resolvedChannelId = null;
    this.clearVisibleClientUids();
    this.httpQuery = null;
    this.detectedProtocol = "unknown";
    this.logger.info("Disconnected from TeamSpeak server");
  }
}
