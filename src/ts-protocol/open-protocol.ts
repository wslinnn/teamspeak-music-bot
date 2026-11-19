import { PlayMode } from "../audio/queue.js";
import type { Logger } from "../logger.js";
import { APP_VERSION } from "../version.js";
import type { TS3PluginCommand, TS3PluginTarget } from "./client.js";

/**
 * OpenProtocol v1: discovery over TeamSpeak **plugin commands**.
 *
 * Two clients that agree on a plugin name can exchange opaque payloads through
 * the server. This module uses that to let a user-side TeamSpeak plugin find
 * out what this bot is and which chat commands it understands — without any
 * HTTP surface, an API key, or a per-user login.
 *
 * Hard rules that keep it safe to speak to strangers:
 *  - only two plugin names are recognised, everything else is ignored;
 *  - every payload is capped at MAX_PAYLOAD_BYTES, on the way in and out;
 *  - replies are rate limited per peer AND globally, so one client cannot make
 *    the bot flood the server;
 *  - the command list is truncated (pop from the end) until it fits.
 *
 * `command_prefix` is informational only: it tells the plugin the literal
 * prefix the bot listens for. The bot does NOT start accepting `/` commands.
 */

export const OPEN_PROTOCOL_VERSION = 1;
export const IDENTITY_PLUGIN = "tsclient:identity";
export const COMMANDS_PLUGIN = "tsclient:commands";
export const MAX_PAYLOAD_BYTES = 1024;

export const APP_NAME = "TSMusicBot";
export const BOT_CAPABILITIES = ["chat:slash_commands"] as const;

export const ANNOUNCE_DEBOUNCE_MS = 2_000;
export const ANNOUNCE_RETRY_DELAY_MS = 500;

export const IDENTITY_ANNOUNCE_COOLDOWN_MS = 10_000;
export const IDENTITY_QUERY_COOLDOWN_MS = 5_000;
export const COMMANDS_LIST_REQ_COOLDOWN_MS = 5_000;

export const ACK_GLOBAL_BURST = 4;
export const ACK_GLOBAL_RATE_PER_SEC = 2;

export const MAX_COMMANDS = 16;
export const MAX_CMD_PREFIX_CHARS = 8;
export const MAX_CMD_NAME_CHARS = 24;
export const MAX_CMD_ARGS_CHARS = 32;
export const MAX_CMD_DESC_CHARS = 64;
export const MAX_APP_META_CHARS = 32;
const MAX_COOLDOWN_ENTRIES_BEFORE_PRUNE = 128;

export interface OpenProtocolCommandSpec {
  name: string;
  args?: string;
  desc: string;
}

export interface OpenProtocolIdentityPayload {
  v: 1;
  action: "announce" | "announce_ack";
  client_type: "bot";
  app_name: string;
  app_version: string;
  capabilities: string[];
}

export interface OpenProtocolCommandsListAckPayload {
  v: 1;
  action: "list_ack";
  command_prefix: string;
  commands: OpenProtocolCommandSpec[];
}

export interface OpenProtocolRuntimeConfig {
  locale: "zh" | "en";
  commandPrefix: string;
}

export interface OpenProtocolTransport {
  getClientId(): number;
  sendPluginCommand(name: string, data: string, target?: TS3PluginTarget): Promise<void>;
}

interface CommandCatalogEntry {
  name: string;
  args?: string;
  descZh: string;
  descEn: string;
}

const CORE_COMMAND_CATALOG: readonly CommandCatalogEntry[] = [
  { name: "play", args: "<歌曲>", descZh: "点歌并立即播放", descEn: "Play song" },
  { name: "add", args: "<歌曲>", descZh: "添加到队列", descEn: "Add to queue" },
  { name: "search", args: "<关键词>", descZh: "搜索歌曲", descEn: "Search songs" },
  { name: "pause", descZh: "暂停播放", descEn: "Pause playback" },
  { name: "resume", descZh: "恢复播放", descEn: "Resume playback" },
  { name: "next", descZh: "下一首", descEn: "Next track" },
  { name: "prev", descZh: "上一首", descEn: "Previous track" },
  { name: "stop", descZh: "停止并清空队列", descEn: "Stop & clear" },
  { name: "now", descZh: "当前播放", descEn: "Current track" },
  { name: "queue", descZh: "查看队列", descEn: "Show queue" },
  { name: "vol", args: "<0-100>", descZh: "调节音量", descEn: "Set volume" },
  { name: "mode", args: `<${Object.values(PlayMode).join("|")}>`, descZh: "切换播放模式", descEn: "Set play mode" },
  { name: "clear", descZh: "清空队列", descEn: "Clear queue" },
  { name: "remove", args: "<序号>", descZh: "移除指定曲目", descEn: "Remove track" },
  { name: "playlist", args: "<歌单>", descZh: "导入歌单", descEn: "Load playlist" },
  { name: "help", descZh: "命令帮助", descEn: "Command help" },
];

const CORE_COMMAND_ARGS_EN: Readonly<Record<string, string>> = {
  play: "<query>",
  add: "<query>",
  search: "<keyword>",
  vol: "<0-100>",
  remove: "<index>",
  playlist: "<id|url>",
};

/** Strip control characters, then cut to `maxChars` CODE POINTS (not UTF-16
 *  units) so an emoji or CJK name is never split in half. */
function truncateChars(value: string, maxChars: number): string {
  const sanitized = value.replace(/[\u0000-\u001F\u007F]/g, "");
  const chars = Array.from(sanitized);
  if (chars.length <= maxChars) return sanitized;
  return chars.slice(0, maxChars).join("");
}

/** A prefix a plugin can usefully display: non-empty, no surrounding space,
 *  short. Anything else means "do not advertise command discovery". */
function isDiscoverablePrefix(prefix: string): boolean {
  return typeof prefix === "string"
    && prefix.length > 0
    && prefix.trim() === prefix
    && truncateChars(prefix, MAX_CMD_PREFIX_CHARS) === prefix;
}

export function buildIdentityPayloadJson(
  action: "announce" | "announce_ack",
  appVersion: string = APP_VERSION,
  commandPrefix = "!",
): string {
  const payload: OpenProtocolIdentityPayload = {
    v: OPEN_PROTOCOL_VERSION,
    action,
    client_type: "bot",
    app_name: truncateChars(APP_NAME, MAX_APP_META_CHARS),
    app_version: truncateChars(appVersion, MAX_APP_META_CHARS),
    // Omitted when the prefix cannot be discovered: a plugin must not parse
    // commands the bot will never receive.
    capabilities: isDiscoverablePrefix(commandPrefix) ? [...BOT_CAPABILITIES] : [],
  };
  return JSON.stringify(payload);
}

export function buildOpenProtocolCommands(locale: "zh" | "en"): OpenProtocolCommandSpec[] {
  return CORE_COMMAND_CATALOG.slice(0, MAX_COMMANDS).map((entry) => {
    const rawArgs = locale === "zh" ? entry.args : (CORE_COMMAND_ARGS_EN[entry.name] ?? entry.args);
    const rawDesc = locale === "zh" ? entry.descZh : entry.descEn;
    const spec: OpenProtocolCommandSpec = {
      name: truncateChars(entry.name, MAX_CMD_NAME_CHARS),
      desc: truncateChars(rawDesc, MAX_CMD_DESC_CHARS),
    };
    if (rawArgs) {
      spec.args = truncateChars(rawArgs, MAX_CMD_ARGS_CHARS);
    }
    return spec;
  });
}

export function buildCommandsListAckJson(
  locale: "zh" | "en",
  commandPrefix: string,
): string | null {
  if (!isDiscoverablePrefix(commandPrefix)) return null;

  const commands = buildOpenProtocolCommands(locale);
  // Pop from the end until the payload fits: the catalog is ordered by
  // importance, so dropping the tail loses the least useful entries.
  while (commands.length > 0) {
    const payload: OpenProtocolCommandsListAckPayload = {
      v: OPEN_PROTOCOL_VERSION,
      action: "list_ack",
      command_prefix: commandPrefix,
      commands,
    };
    const json = JSON.stringify(payload);
    if (Buffer.byteLength(json, "utf8") < MAX_PAYLOAD_BYTES) {
      return json;
    }
    commands.pop();
  }

  return JSON.stringify({
    v: OPEN_PROTOCOL_VERSION,
    action: "list_ack",
    command_prefix: commandPrefix,
    commands: [],
  } satisfies OpenProtocolCommandsListAckPayload);
}

/**
 * Per-peer cooldown + a global token bucket.
 *
 * Cooldown alone is not enough: a peer could rotate its identity, and many
 * peers could each stay within their own cooldown while together flooding the
 * channel. The bucket bounds the total.
 */
class AckRateLimiter {
  private readonly lastSent = new Map<string, number>();
  private tokens = ACK_GLOBAL_BURST;
  private lastRefillMs: number | null = null;

  private refill(nowMs: number): void {
    if (this.lastRefillMs === null) {
      this.lastRefillMs = nowMs;
      return;
    }
    const elapsedMs = Math.max(0, nowMs - this.lastRefillMs);
    this.tokens = Math.min(
      ACK_GLOBAL_BURST,
      this.tokens + (elapsedMs / 1000) * ACK_GLOBAL_RATE_PER_SEC,
    );
    this.lastRefillMs = nowMs;
  }

  private prune(nowMs: number): void {
    if (this.lastSent.size <= MAX_COOLDOWN_ENTRIES_BEFORE_PRUNE) return;
    const maxAgeMs = Math.max(
      IDENTITY_ANNOUNCE_COOLDOWN_MS,
      IDENTITY_QUERY_COOLDOWN_MS,
      COMMANDS_LIST_REQ_COOLDOWN_MS,
    );
    for (const [key, ts] of this.lastSent) {
      if (nowMs - ts >= maxAgeMs) {
        this.lastSent.delete(key);
      }
    }
  }

  tryAcquire(peerKey: string, actionKey: string, cooldownMs: number, nowMs: number): boolean {
    this.prune(nowMs);
    const key = `${peerKey}:${actionKey}`;
    const prev = this.lastSent.get(key);
    if (prev !== undefined && nowMs - prev < cooldownMs) {
      return false;
    }

    this.refill(nowMs);
    if (this.tokens < 1) {
      return false;
    }

    // Consumed even if the send later fails: otherwise a client that reliably
    // breaks the send path would get unlimited retries.
    this.tokens -= 1;
    this.lastSent.set(key, nowMs);
    return true;
  }

  clear(): void {
    this.lastSent.clear();
    this.tokens = ACK_GLOBAL_BURST;
    this.lastRefillMs = null;
  }
}

export interface OpenProtocolManagerOptions {
  transport: OpenProtocolTransport;
  getConfig: () => OpenProtocolRuntimeConfig;
  logger: Logger;
  /** Injectable clock for tests. */
  now?: () => number;
}

export class OpenProtocolManager {
  private readonly transport: OpenProtocolTransport;
  private readonly getConfig: () => OpenProtocolRuntimeConfig;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly rateLimiter = new AckRateLimiter();

  private generation = 0;
  private announceSeq = 0;
  private lastSuccessSeq = 0;
  private lastAnnounceAttemptMs: number | null = null;
  private trailingAnnounceTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAnnounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: OpenProtocolManagerOptions) {
    this.transport = options.transport;
    this.getConfig = options.getConfig;
    this.logger = options.logger;
    this.now = options.now ?? (() => Date.now());
  }

  /** Reset timers and rate-limit state on disconnect or teardown. */
  reset(): void {
    this.generation += 1;
    this.announceSeq = 0;
    this.lastSuccessSeq = 0;
    this.lastAnnounceAttemptMs = null;
    this.clearTimers();
    this.rateLimiter.clear();
  }

  /** Schedule or send a debounced channel broadcast announcing this bot. */
  scheduleAnnounce(): void {
    const clientId = this.transport.getClientId();
    if (clientId <= 0) return;

    const nowMs = this.now();
    if (
      this.lastAnnounceAttemptMs !== null &&
      nowMs - this.lastAnnounceAttemptMs < ANNOUNCE_DEBOUNCE_MS
    ) {
      // Trailing edge: one more announce after the debounce window, so the
      // last entrant still sees it without every entrant costing a broadcast.
      if (!this.trailingAnnounceTimer) {
        const delayMs = Math.max(0, ANNOUNCE_DEBOUNCE_MS - (nowMs - this.lastAnnounceAttemptMs));
        const gen = this.generation;
        this.trailingAnnounceTimer = setTimeout(() => {
          this.trailingAnnounceTimer = null;
          if (gen !== this.generation) return;
          this.dispatchAnnounce(gen);
        }, delayMs);
        this.trailingAnnounceTimer.unref?.();
      }
      return;
    }

    this.clearTimers();
    this.dispatchAnnounce(this.generation);
  }

  /** Handle an incoming plugin command. Unknown names are ignored silently. */
  async handlePluginCommand(cmd: TS3PluginCommand): Promise<void> {
    if (cmd.name !== IDENTITY_PLUGIN && cmd.name !== COMMANDS_PLUGIN) {
      return;
    }

    const selfClientId = this.transport.getClientId();
    if (
      selfClientId <= 0 ||
      cmd.invokerId === selfClientId ||
      cmd.invokerId <= 0 ||
      Buffer.byteLength(cmd.data, "utf8") >= MAX_PAYLOAD_BYTES
    ) {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      const value = JSON.parse(cmd.data) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return;
      }
      parsed = value as Record<string, unknown>;
    } catch {
      this.logger.debug(
        { name: cmd.name, invokerId: cmd.invokerId },
        "Ignoring malformed OpenProtocol JSON payload",
      );
      return;
    }

    if (parsed.v !== OPEN_PROTOCOL_VERSION || typeof parsed.action !== "string") {
      return;
    }

    // Prefer the stable UID so a peer reconnecting with a new client id keeps
    // its cooldown; fall back to the id when the server named no UID.
    const peerKey = cmd.invokerUid.trim() || String(cmd.invokerId);

    if (cmd.name === IDENTITY_PLUGIN) {
      await this.handleIdentityAction(parsed.action, peerKey, cmd.invokerId);
      return;
    }

    if (cmd.name === COMMANDS_PLUGIN) {
      await this.handleCommandsAction(parsed.action, peerKey, cmd.invokerId);
    }
  }

  private async handleIdentityAction(
    action: string,
    peerKey: string,
    invokerId: number,
  ): Promise<void> {
    let cooldownMs: number;
    if (action === "announce") {
      cooldownMs = IDENTITY_ANNOUNCE_COOLDOWN_MS;
    } else if (action === "query") {
      cooldownMs = IDENTITY_QUERY_COOLDOWN_MS;
    } else {
      return;
    }

    if (!this.rateLimiter.tryAcquire(peerKey, `${IDENTITY_PLUGIN}:${action}`, cooldownMs, this.now())) {
      return;
    }

    const payload = buildIdentityPayloadJson("announce_ack", APP_VERSION, this.getConfig().commandPrefix);
    await this.sendAck(IDENTITY_PLUGIN, payload, invokerId);
  }

  private async handleCommandsAction(
    action: string,
    peerKey: string,
    invokerId: number,
  ): Promise<void> {
    if (action !== "list_req") return;

    const { locale, commandPrefix } = this.getConfig();
    if (
      !isDiscoverablePrefix(commandPrefix) ||
      !this.rateLimiter.tryAcquire(
        peerKey,
        `${COMMANDS_PLUGIN}:list_req`,
        COMMANDS_LIST_REQ_COOLDOWN_MS,
        this.now(),
      )
    ) {
      return;
    }

    const payload = buildCommandsListAckJson(locale, commandPrefix);
    if (payload !== null) await this.sendAck(COMMANDS_PLUGIN, payload, invokerId);
  }

  private async sendAck(pluginName: string, payload: string, invokerId: number): Promise<void> {
    if (Buffer.byteLength(payload, "utf8") >= MAX_PAYLOAD_BYTES) {
      this.logger.debug({ pluginName }, "OpenProtocol payload exceeded size limit");
      return;
    }

    try {
      await this.transport.sendPluginCommand(pluginName, payload, invokerId);
    } catch (err) {
      this.logger.debug({ err, pluginName, invokerId }, "Failed to send OpenProtocol response");
    }
  }

  private dispatchAnnounce(expectedGen: number): void {
    if (expectedGen !== this.generation || this.transport.getClientId() <= 0) {
      return;
    }

    this.lastAnnounceAttemptMs = this.now();
    const seq = ++this.announceSeq;
    const payload = buildIdentityPayloadJson("announce", APP_VERSION, this.getConfig().commandPrefix);

    if (Buffer.byteLength(payload, "utf8") >= MAX_PAYLOAD_BYTES) {
      this.logger.debug("OpenProtocol announce payload exceeded size limit");
      return;
    }

    this.transport
      .sendPluginCommand(IDENTITY_PLUGIN, payload, "channel")
      .then(() => {
        if (expectedGen !== this.generation) return;
        this.lastSuccessSeq = Math.max(this.lastSuccessSeq, seq);
      })
      .catch((err: unknown) => {
        if (expectedGen !== this.generation) return;
        this.logger.debug({ err }, "OpenProtocol announce broadcast failed");
        this.scheduleAnnounceRetry(expectedGen, seq);
      });
  }

  private scheduleAnnounceRetry(expectedGen: number, failedSeq: number): void {
    if (this.retryAnnounceTimer) {
      clearTimeout(this.retryAnnounceTimer);
      this.retryAnnounceTimer = null;
    }

    this.retryAnnounceTimer = setTimeout(() => {
      this.retryAnnounceTimer = null;
      if (
        expectedGen !== this.generation ||
        this.lastSuccessSeq >= failedSeq ||
        this.transport.getClientId() <= 0
      ) {
        return;
      }
      const retrySeq = ++this.announceSeq;
      const payload = buildIdentityPayloadJson("announce", APP_VERSION, this.getConfig().commandPrefix);
      this.lastAnnounceAttemptMs = this.now();
      this.transport
        .sendPluginCommand(IDENTITY_PLUGIN, payload, "channel")
        .then(() => {
          if (expectedGen !== this.generation) return;
          this.lastSuccessSeq = Math.max(this.lastSuccessSeq, retrySeq);
        })
        .catch((err: unknown) => {
          if (expectedGen !== this.generation) return;
          this.logger.debug({ err }, "OpenProtocol announce retry failed");
        });
    }, ANNOUNCE_RETRY_DELAY_MS);
    this.retryAnnounceTimer.unref?.();
  }

  private clearTimers(): void {
    if (this.trailingAnnounceTimer) {
      clearTimeout(this.trailingAnnounceTimer);
      this.trailingAnnounceTimer = null;
    }
    if (this.retryAnnounceTimer) {
      clearTimeout(this.retryAnnounceTimer);
      this.retryAnnounceTimer = null;
    }
  }
}
