import { type EventEmitter } from "node:events";
import type { Readable } from "node:stream";

/**
 * 音频后端统一接口。
 *
 * 目的：把现有的 {@link AudioPlayer}（Node 进程内 ffmpeg + @discordjs/opus）与
 * 未来的 Rust Worker 后端（阶段3）收敛到同一个窄接口上，让 BotInstance 只依赖
 * 接口、不依赖具体实现，从而能在运行时通过 `config.audioBackend` 灰度切换，并
 * 在任何阶段一键回退到旧的 Node 实现。
 *
 * 事件契约与 `src/bot/instance.ts` 的 `setupPlayerEvents()` 完全对齐：
 * - `frame`    : 一帧标准 20ms Opus 二进制（与 @discordjs/opus 字节级等价）
 * - `trackEnd` : 当前曲目自然结束
 * - `error`    : 播放/编码错误
 *
 * 方法集覆盖 instance.ts 与 voice-ducking.ts 对 `this.player` 的全部调用。
 */
export type BackendState = "idle" | "playing" | "paused";

export interface PlayPcmOptions {
  /** Spotify 等外部 PCM 边车流结束时（异常）的回调；正常切歌由调用方驱动。 */
  onExternalEnd?: () => void;
}

export interface IAudioBackend extends EventEmitter {
  on(event: "frame", listener: (opusFrame: Buffer) => void): this;
  on(event: "trackEnd", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;
  // EventEmitter 基类签名兜底，避免窄化 on 后其它字符串事件报错。
  on(event: string | symbol, listener: (...args: any[]) => void): this;

  /** 播放一个 URL（http/本地文件）。seekSeconds/duration 为可选。 */
  play(url: string, seekSeconds?: number, songDuration?: number): void;

  /** 外部 PCM 模式：Node 侧已拉起 ffmpeg 并把标准化 48k/s16le/立体声 PCM 流喂入。 */
  playPcmStream(readable: Readable, opts?: PlayPcmOptions): void;

  pause(): void;
  resume(): void;
  stop(): void;
  seek(seconds: number): void;

  setVolume(vol: number): void;
  getVolume(): number;

  /** 语音闪避增益（0=静音，1=不变）。rampMs>0 时做线性斜坡。 */
  setDuckingGain(gain: number, rampMs?: number): void;

  getState(): BackendState;
  /** 已播放秒数（近似值，Spotify 外部模式下为帧计数估算）。 */
  getElapsed(): number;
  /** 是否正附着在外部（Spotify 边车）PCM 流上。 */
  isExternalActive(): boolean;
  /** 清除连续失败计数（健康帧到达后由实现内部调用，也供外部显式重置）。 */
  resetFailures(): void;
}
