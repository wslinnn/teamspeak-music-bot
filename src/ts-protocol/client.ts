import { EventEmitter } from "node:events";
import { TS3Connection, type CommandResult } from "./connection.js";
import { VoiceConnection, CODEC_OPUS_MUSIC } from "./voice.js";
import {
  generateIdentity,
  importIdentity,
  exportIdentity,
  type TS3Identity,
} from "./identity.js";
import type { Logger } from "../logger.js";

export interface TS3ClientOptions {
  host: string;
  port: number; // Voice/virtual server port (default 9987)
  queryPort: number; // ServerQuery port (default 10011)
  nickname: string;
  identity?: string; // Exported identity JSON, or undefined to generate new
  defaultChannel?: string;
  channelPassword?: string;
}

export interface TS3TextMessage {
  invokerName: string;
  invokerId: string;
  invokerUid: string;
  message: string;
  targetMode: number; // 1=private, 2=channel, 3=server
}

export class TS3Client extends EventEmitter {
  private connection: TS3Connection;
  private voice: VoiceConnection;
  private identity: TS3Identity;
  private clientId = 0;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private logger: Logger;

  constructor(private options: TS3ClientOptions, logger: Logger) {
    super();
    this.logger = logger;

    this.connection = new TS3Connection({
      host: options.host,
      port: options.queryPort,
    });

    this.voice = new VoiceConnection({
      host: options.host,
      port: options.port,
    });

    this.connection.on("error", (err) => {
      this.logger.error({ err }, "TCP connection error");
      this.emit("error", err);
    });

    this.voice.on("error", (err) => {
      this.logger.error({ err }, "UDP voice error");
      this.emit("error", err);
    });

    this.connection.on(
      "notify:textmessage",
      (data: Record<string, string>) => {
        const msg: TS3TextMessage = {
          invokerName: data.invokername ?? "",
          invokerId: data.invokerid ?? "",
          invokerUid: data.invokeruid ?? "",
          message: data.msg ?? "",
          targetMode: parseInt(data.targetmode ?? "0", 10),
        };
        this.emit("textMessage", msg);
      }
    );

    this.connection.on("close", () => {
      this.logger.warn("Connection closed");
      this.emit("disconnected");
    });

    if (options.identity) {
      this.identity = importIdentity(options.identity);
    } else {
      this.identity = generateIdentity();
    }
  }

  async connect(): Promise<void> {
    this.logger.info(
      { host: this.options.host, port: this.options.port },
      "Connecting to TeamSpeak server"
    );

    await this.connection.connect();
    this.logger.debug("TCP connection established");

    await this.sendCommand("use", { port: this.options.port });

    await this.sendCommand("clientupdate", {
      client_nickname: this.options.nickname,
    });

    const whoami = await this.sendCommand("whoami", {});
    if (whoami.data.length > 0) {
      this.clientId = parseInt(whoami.data[0].client_id ?? "0", 10);
      this.logger.info({ clientId: this.clientId }, "Logged in");
    }

    if (this.options.defaultChannel) {
      await this.joinChannel(
        this.options.defaultChannel,
        this.options.channelPassword
      );
    }

    await this.voice.connect();
    this.voice.setClientId(this.clientId);
    this.logger.debug("UDP voice connection established");

    await this.sendCommand("servernotifyregister", { event: "textchannel" });
    await this.sendCommand("servernotifyregister", { event: "textprivate" });

    this.keepAliveInterval = setInterval(() => {
      this.voice.sendKeepAlive();
    });

    this.emit("connected");
  }

  async sendCommand(
    command: string,
    params: Record<string, string | number>
  ): Promise<CommandResult> {
    return this.connection.send(command, params);
  }

  async joinChannel(channelName: string, password?: string): Promise<void> {
    const channels = await this.sendCommand("channellist", {});
    const channel = channels.data.find(
      (ch) => ch.channel_name === channelName
    );

    if (!channel) {
      this.logger.warn({ channelName }, "Channel not found");
      return;
    }

    const params: Record<string, string | number> = {
      cid: channel.cid,
      clid: this.clientId,
    };
    if (password) {
      params.cpw = password;
    }

    await this.sendCommand("clientmove", params);
    this.logger.info({ channelName, cid: channel.cid }, "Joined channel");
  }

  async sendTextMessage(
    message: string,
    targetMode: number = 2
  ): Promise<void> {
    await this.sendCommand("sendtextmessage", {
      targetmode: targetMode,
      target: targetMode === 2 ? 0 : this.clientId,
      msg: message,
    });
  }

  async getClientsInChannel(): Promise<Record<string, string>[]> {
    const result = await this.sendCommand("clientlist", {});
    return result.data;
  }

  sendVoiceData(opusFrame: Buffer): void {
    this.voice.sendVoicePacket(opusFrame, CODEC_OPUS_MUSIC);
  }

  getIdentityExport(): string {
    return exportIdentity(this.identity);
  }

  getClientId(): number {
    return this.clientId;
  }

  disconnect(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    this.connection.disconnect();
    this.voice.disconnect();
    this.logger.info("Disconnected from TeamSpeak server");
  }
}
