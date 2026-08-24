import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Readable } from "node:stream";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { existsSync } from "node:fs";
import type { Logger } from "../../logger.js";
import type { IAudioBackend, BackendState, PlayPcmOptions } from "./audio-backend.js";

const require = createRequire(import.meta.url);
// 复用仓库现有的 ffmpeg-static 二进制，传给 Worker 使用。
const ffmpegStatic: string | null = require("ffmpeg-static");

type Cmd =
  | { c: "play"; url: string; seek: number; dur: number }
  | { c: "stop" }
  | { c: "pause" }
  | { c: "resume" }
  | { c: "seek"; sec: number }
  | { c: "set_volume"; vol: number }
  | { c: "set_ducking"; gain: number; ramp_ms: number };

/**
 * 解析 audio-worker 二进制路径；找不到返回 null。供工厂做启用前探测。
 */
export function resolveAudioWorkerBin(): string | null {
  const ext = process.platform === "win32" ? ".exe" : "";
  const candidates: string[] = [];
  if (process.env.TSBOT_AUDIO_WORKER_BIN) {
    candidates.push(process.env.TSBOT_AUDIO_WORKER_BIN);
  }
  // 运行时（dist/audio/backend → 仓库根）
  const root = path.resolve(__dirname, "..", "..", "..");
  candidates.push(
    path.join(root, `audio-worker/target/release/audio-worker${ext}`),
    path.join(root, `audio-worker/target/debug/audio-worker${ext}`),
  );
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return null;
}

/**
 * 阶段3：Rust Worker 音频后端。
 *
 * 通过 TCP loopback 与独立的 `audio-worker` 进程通信，协议与方案文档 4.4 一致：
 *   每条消息 = 1 字节 type + 4 字节大端 length + payload
 *   C 控制(Node→Worker, JSON) / E 事件(Worker→Node, JSON) / F 音频帧(Worker→Node, 原始 Opus 字节)
 *
 * 对外暴露与 {@link NodeAudioBackend} 完全相同的 {@link IAudioBackend} 接口，因此
 * BotInstance 无需感知后端差异。Worker 二进制缺失时由工厂回退到 node 后端。
 */
export class RustAudioBackend extends EventEmitter implements IAudioBackend {
  private readonly logger: Logger;
  private child: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private connected = false;
  private recvBuf = Buffer.alloc(0);
  private pending: Buffer[] = []; // 连接建立前的待发命令帧

  // 本地镜像状态（供 getXxx 返回，避免每次跨进程查询）
  private state: BackendState = "idle";
  private volume = 75;
  private disposed = false;
  private respawnTimer: ReturnType<typeof setTimeout> | null = null;
  private framesPlayed = 0;
  private seekOffset = 0;
  private externalActive = false;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.spawnWorker();
  }

  private resolveWorkerBin(): string | null {
    return resolveAudioWorkerBin();
  }

  private spawnWorker(): void {
    if (this.disposed) return;
    const bin = this.resolveWorkerBin();
    if (!bin) {
      this.logger.error("未找到 audio-worker 二进制，Rust 后端不可用（应已由工厂回退）");
      this.emit("error", new Error("audio-worker binary not found"));
      return;
    }
    const ffmpegArg = ffmpegStatic && existsSync(ffmpegStatic) ? ffmpegStatic : "ffmpeg";
    this.logger.info({ bin, ffmpegArg, fsType: typeof ffmpegStatic }, "spawn audio-worker");
    const child = spawn(bin, ["--ffmpeg=" + ffmpegArg], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    this.child = child;
    let stderrTail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail += chunk.toString();
      const m = stderrTail.match(/LISTENING\s+(\d+)/);
      if (m) {
        const port = Number(m[1]);
        this.connect(port);
        stderrTail = ""; // 只处理一次
      }
    });
    child.on("exit", (code) => {
      this.logger.warn({ code }, "audio-worker 进程退出");
      this.connected = false;
      this.socket?.destroy();
      this.socket = null;
      if (this.disposed) return;
      // 故障隔离：上报错误让上层切歌/记录，1 秒后自动重启 Worker（pending 命令重连后补发）
      this.emit("error", new Error(`audio-worker exited (code ${code ?? "?"})`));
      this.respawnTimer = setTimeout(() => {
        this.respawnTimer = null;
        this.spawnWorker();
      }, 1000);
    });
    child.on("error", (err) => {
      this.logger.error({ err }, "audio-worker 启动失败");
      this.emit("error", err);
    });
  }

  private connect(port: number): void {
    const sock = net.createConnection({ host: "127.0.0.1", port });
    this.socket = sock;
    sock.on("connect", () => {
      this.connected = true;
      this.logger.info({ port }, "已连接 audio-worker");
      // 冲刷连接前缓冲的命令
      for (const f of this.pending) sock.write(f);
      this.pending = [];
    });
    sock.on("data", (chunk: Buffer) => this.onData(chunk));
    sock.on("close", () => {
      this.connected = false;
      this.logger.warn("audio-worker 连接关闭");
    });
    sock.on("error", (err) => {
      this.logger.error({ err }, "audio-worker 连接错误");
      this.emit("error", err);
    });
  }

  private onData(chunk: Buffer): void {
    this.recvBuf = Buffer.concat([this.recvBuf, chunk]);
    // 循环解析完整帧
    for (;;) {
      if (this.recvBuf.length < 5) return;
      const type = this.recvBuf[0];
      const len = this.recvBuf.readUInt32BE(1);
      if (this.recvBuf.length < 5 + len) return;
      const payload = this.recvBuf.subarray(5, 5 + len);
      this.recvBuf = this.recvBuf.subarray(5 + len);
      if (type === 0x46) {
        // 'F' 音频帧：原始 Opus 字节
        this.emit("frame", Buffer.from(payload));
        this.framesPlayed += 1;
      } else if (type === 0x45) {
        // 'E' 事件
        this.dispatchEvent(payload);
      }
      // 'C' 不应从 Worker 收到，忽略
    }
  }

  private dispatchEvent(payload: Buffer): void {
    let msg: any;
    try {
      msg = JSON.parse(payload.toString("utf8"));
    } catch {
      return;
    }
    const e = msg?.e;
    if (e === "trackEnd") {
      this.state = "idle";
      this.emit("trackEnd");
    } else if (e === "ready" || e === "progress") {
      if (this.state === "idle") this.state = "playing";
      // progress 仅用于内部计时，不对外暴露事件；如有需要可扩展
    } else if (e === "error") {
      this.emit("error", new Error(`audio-worker: ${msg.code ?? "error"} ${msg.msg ?? ""}`));
    }
  }

  private send(cmd: Cmd): void {
    const json = JSON.stringify(cmd);
    const payload = Buffer.from(json, "utf8");
    const frame = Buffer.allocUnsafe(5 + payload.length);
    frame[0] = 0x43; // 'C'
    frame.writeUInt32BE(payload.length, 1);
    payload.copy(frame, 5);
    if (this.connected && this.socket) {
      this.socket.write(frame);
    } else {
      this.pending.push(frame);
    }
  }

  play(url: string, seekSeconds = 0, songDuration = 0): void {
    this.state = "playing";
    this.seekOffset = seekSeconds;
    this.framesPlayed = 0;
    this.externalActive = false;
    this.send({ c: "play", url, seek: seekSeconds, dur: songDuration });
  }

  playPcmStream(_readable: Readable, _opts?: PlayPcmOptions): void {
    // 阶段4 才实现（pcm-feed 模式）。当前 Rust Worker 版本未实现外部 PCM 喂入，
    // 回退告警并上报错误，调用方应改用 node 后端处理 Spotify 边车流。
    this.logger.warn("Rust 后端暂不支持 playPcmStream（外部 PCM 模式），请使用 node 后端");
    this.emit("error", new Error("RustAudioBackend.playPcmStream 尚未实现"));
  }

  pause(): void {
    this.state = "paused";
    this.send({ c: "pause" });
  }

  resume(): void {
    this.state = "playing";
    this.send({ c: "resume" });
  }

  stop(): void {
    this.state = "idle";
    this.framesPlayed = 0;
    this.send({ c: "stop" });
  }

  seek(seconds: number): void {
    this.seekOffset = seconds;
    this.framesPlayed = 0;
    this.send({ c: "seek", sec: seconds });
  }

  setVolume(vol: number): void {
    this.volume = vol;
    this.send({ c: "set_volume", vol });
  }

  getVolume(): number {
    return this.volume;
  }

  setDuckingGain(gain: number, rampMs = 0): void {
    this.send({ c: "set_ducking", gain, ramp_ms: rampMs });
  }

  getState(): BackendState {
    return this.state;
  }

  getElapsed(): number {
    return this.seekOffset + (this.framesPlayed * 20) / 1000;
  }

  isExternalActive(): boolean {
    return this.externalActive;
  }

  resetFailures(): void {
    // Rust Worker 内部自管理健康计数，无需 Node 侧处理
  }

  dispose(): void {
    this.disposed = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    this.socket?.destroy();
    this.socket = null;
    this.child?.kill();
    this.child = null;
  }
}
