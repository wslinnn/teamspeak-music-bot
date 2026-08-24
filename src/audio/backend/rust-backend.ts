import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { Readable } from "node:stream";
import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { shouldUsePowerShellDownload, cleanupTempDir } from "../player.js";
import type { Logger } from "../../logger.js";
import type { IAudioBackend, BackendState, PlayPcmOptions } from "./audio-backend.js";

const require = createRequire(import.meta.url);
// 复用仓库现有的 ffmpeg-static 二进制，传给 Worker 使用。
const ffmpegStatic: string | null = require("ffmpeg-static");

type Cmd =
  | { c: "play"; url: string; seek: number; dur: number; external?: boolean }
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
  // 外部 PCM 模式（Spotify 边车）
  private externalStream: Readable | null = null;
  private externalHandlers: {
    data: (chunk: Buffer) => void;
    end: () => void;
    error: (err: Error) => void;
  } | null = null;
  // 连接建立前缓冲的外部 PCM（边车在 Worker 启动期间就可能开始产出）
  private pcmPending: Buffer[] = [];
  private pcmPendingBytes = 0;
  // 外部 PCM 生产者是否因背压被暂停
  private producerPaused = false;
  // 连续 spawn/下载失败计数（对齐 player.ts 的 MAX_CONSECUTIVE_FAILURES 熔断）
  private spawnFailures = 0;
  private static readonly MAX_SPAWN_FAILURES = 3;
  // jdymusic PowerShell 下载回退
  private downloader: ChildProcess | null = null;
  private currentTempDir: string | null = null;
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
      // Windows：杀掉 worker 的整个子进程树（孤儿 ffmpeg；child.kill 只杀进程
      // 本体不杀子树）。Linux 由 worker 侧 PDEATHSIG 在内核层兜底
      if (process.platform === "win32" && child.pid) {
        try {
          spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } catch {
          /* best-effort */
        }
      }
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
      // 冲刷连接前缓冲的命令，随后冲刷缓冲的外部 PCM（顺序保证 Worker 先进入
      // external 会话再收到数据）
      for (const f of this.pending) sock.write(f);
      this.pending = [];
      // Worker 重启后外部会话丢失（进程内状态不跨重启）：重发 external play，
      // 使后续 P 帧重新生效，避免 Node 继续灌 PCM 而 Worker 静默丢弃
      if (this.externalActive && this.externalStream) {
        this.send({ c: "play", url: "", seek: 0, dur: 0, external: true });
      }
      for (const p of this.pcmPending) sock.write(p);
      this.pcmPending = [];
      this.pcmPendingBytes = 0;
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
        // 'F' 音频帧：原始 Opus 字节。每 50 帧（≈1s）重置失败计数，
        // 对齐 player.ts 的 HEALTHY_FRAME_RESET
        this.emit("frame", Buffer.from(payload));
        this.framesPlayed += 1;
        if (this.framesPlayed % 50 === 0) {
          this.spawnFailures = 0;
        }
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
    } else if (e === "ready") {
      if (this.state === "idle") this.state = "playing";
    } else if (e === "error") {
      // ffmpeg spawn 失败计入熔断（对齐 player.ts 的 spawnFailed/consecutiveFailures）
      if (msg.code === "ffmpeg_spawn") {
        this.spawnFailures++;
      }
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
    // 熔断：连续 spawn/下载失败达到上限后拒绝再试（对齐 player.ts MAX_CONSECUTIVE_FAILURES）
    if (this.spawnFailures >= RustAudioBackend.MAX_SPAWN_FAILURES) {
      this.logger.error({ failures: this.spawnFailures }, "FFmpeg failures limit reached");
      this.state = "idle";
      this.emit("error", new Error("ffmpeg unavailable"));
      return;
    }
    this.detachExternal();
    this.cleanupJdymusic();
    // Windows 下 /jdymusic/ CDN 直连会被 RST：与 player.ts 一致，先经
    // PowerShell(WinHTTP) 下载为本地临时文件再交给 Worker 播放
    if (shouldUsePowerShellDownload(url)) {
      this.playViaPowerShellDownload(url, seekSeconds, songDuration);
      return;
    }
    this.state = "playing";
    this.seekOffset = seekSeconds;
    this.framesPlayed = 0;
    this.externalActive = false;
    this.send({ c: "play", url, seek: seekSeconds, dur: songDuration });
  }

  private playViaPowerShellDownload(url: string, seekSeconds: number, songDuration: number): void {
    if (this.spawnFailures >= RustAudioBackend.MAX_SPAWN_FAILURES) {
      this.state = "idle";
      this.emit("error", new Error("ffmpeg unavailable"));
      return;
    }
    const tempDir = mkdtempSync(join(tmpdir(), "tsbot-rust-jdy-"));
    const tempFile = join(tempDir, "song.audio");
    this.currentTempDir = tempDir;

    const psScript = [
      "$ErrorActionPreference = 'Stop'",
      "$ProgressPreference = 'SilentlyContinue'",
      "$wc = New-Object System.Net.WebClient",
      "$wc.Headers.Add('User-Agent', $env:DL_UA)",
      "$wc.Headers.Add('Referer', $env:DL_REFERER)",
      "$wc.DownloadFile($env:DL_URL, $env:DL_OUT)",
    ].join("; ");

    this.logger.debug({ tempFile }, "Downloading via PowerShell (jdymusic CDN, rust backend)");
    const ps = spawn(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psScript],
      {
        env: {
          ...process.env,
          DL_URL: url,
          DL_OUT: tempFile,
          DL_UA: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          DL_REFERER: "https://music.163.com/",
        },
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    this.downloader = ps;

    ps.on("exit", (code) => {
      if (this.currentTempDir !== tempDir) {
        cleanupTempDir(tempDir); // 过期下载（已切歌）
        return;
      }
      this.downloader = null;
      if (code !== 0 || !existsSync(tempFile)) {
        this.cleanupJdymusic();
        this.spawnFailures++;
        this.emit("error", new Error(`jdymusic 下载失败 (exit ${code})`));
        return;
      }
      this.state = "playing";
      this.seekOffset = seekSeconds;
      this.framesPlayed = 0;
      this.send({ c: "play", url: tempFile, seek: seekSeconds, dur: songDuration });
    });
    ps.on("error", (err) => {
      if (this.currentTempDir === tempDir) {
        this.cleanupJdymusic();
        this.spawnFailures++;
        this.emit("error", err);
      }
    });
  }

  private cleanupJdymusic(): void {
    if (this.downloader) {
      this.downloader.kill();
      this.downloader = null;
    }
    if (this.currentTempDir) {
      cleanupTempDir(this.currentTempDir);
      this.currentTempDir = null;
    }
  }

  playPcmStream(readable: Readable, opts: PlayPcmOptions = {}): void {
    // 与 player.ts externalMode 语义一致：stop 作栅栏（不销毁旧流）、PCM 经
    // 'P' 帧喂入 Worker、欠载由 Worker 补静音、曲目结束由控制器调 stop 驱动
    this.stop();
    this.state = "playing";
    this.externalActive = true;
    this.seekOffset = 0;
    this.framesPlayed = 0;
    this.send({ c: "play", url: "", seek: 0, dur: 0, external: true });

    this.externalStream = readable;
    const onData = (chunk: Buffer): void => {
      if (this.externalStream !== readable) return; // 会话已切换，丢弃陈旧 PCM
      this.sendPcm(chunk);
    };
    const onEnd = (): void => {
      if (this.externalStream !== readable) return;
      this.detachExternal();
      opts.onExternalEnd?.();
    };
    // 对齐 player.ts：外部流 error 走 onExternalEnd 回调（由控制器善后），
    // 不 emit "error"——上层 error 会触发切歌，与 node 路径语义不同
    const onError = (err: Error): void => {
      if (this.externalStream !== readable) return;
      this.logger.warn({ err }, "External PCM stream error");
      this.detachExternal();
      opts.onExternalEnd?.();
    };
    this.externalHandlers = { data: onData, end: onEnd, error: onError };
    readable.on("data", onData);
    readable.on("end", onEnd);
    readable.on("error", onError);

    // 对齐 player.ts 的 CORRECTION C1：重挂一个曾被 pause 过的共享流（gapless
    // 换曲场景）必须显式 resume——on('data') 不会自动恢复 flowing===false 的流，
    // 否则新曲目只会有静音。对首次挂载/流动中的流 resume 是无害幂等操作。
    readable.resume();
  }

  /** 原始 PCM 字节按 'P' 帧直发 Worker（不走 JSON）；未连接时缓冲（上限 8MB）。 */
  private sendPcm(buf: Buffer): void {
    const frame = Buffer.allocUnsafe(5 + buf.length);
    frame[0] = 0x50; // 'P'
    frame.writeUInt32BE(buf.length, 1);
    buf.copy(frame, 5);
    if (this.connected && this.socket) {
      this.socket.write(frame);
      return;
    }
    if (this.pcmPendingBytes + frame.length > 8 * 1024 * 1024) {
      this.logger.warn({ queued: this.pcmPendingBytes }, "外部 PCM 断连缓冲超 8MB，丢弃新数据");
      return;
    }
    this.pcmPending.push(frame);
    this.pcmPendingBytes += frame.length;
  }

  /** 解绑外部流监听并暂停流动（不销毁流本身，对齐 player.ts 的 detach 语义）。 */
  private detachExternal(): void {
    const st = this.externalStream;
    const h = this.externalHandlers;
    if (st && h) {
      st.removeListener("data", h.data);
      st.removeListener("end", h.end);
      st.removeListener("error", h.error);
      try {
        st.pause(); // 陈旧 PCM 不再流动；重挂时由 playPcmStream 的 resume 恢复（C1）
      } catch {
        /* best-effort：绝不销毁共享边车流 */
      }
    }
    this.externalStream = null;
    this.externalHandlers = null;
    this.externalActive = false;
    this.producerPaused = false;
  }

  pause(): void {
    this.state = "paused";
    // 外部 PCM：即时暂停生产者（实时节拍源，主动暂停即足够防堆积；
    // 异常生产者由 Worker 侧 8MB 硬上限兜底报错）
    if (this.externalStream && !this.producerPaused) {
      this.producerPaused = true;
      this.externalStream.pause();
    }
    this.send({ c: "pause" });
  }

  resume(): void {
    this.state = "playing";
    if (this.externalStream && this.producerPaused) {
      this.producerPaused = false;
      this.externalStream.resume();
    }
    this.send({ c: "resume" });
  }

  stop(): void {
    this.state = "idle";
    this.framesPlayed = 0;
    this.detachExternal();
    this.cleanupJdymusic();
    this.pcmPending = [];
    this.pcmPendingBytes = 0;
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
    // 对齐 player.ts：外部（instance 成功路径）显式重置连续失败计数
    this.spawnFailures = 0;
  }

  dispose(): void {
    this.disposed = true;
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    this.detachExternal();
    this.cleanupJdymusic();
    this.pcmPending = [];
    this.pcmPendingBytes = 0;
    this.socket?.destroy();
    this.socket = null;
    this.child?.kill();
    this.child = null;
  }
}
