import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import { AudioPlayer } from "../player.js";
import type { Logger } from "../../logger.js";
import type { BotConfig } from "../../data/config.js";
import type { IAudioBackend, BackendState, PlayPcmOptions } from "./audio-backend.js";
import { RustAudioBackend, resolveAudioWorkerBin } from "./rust-backend.js";

/**
 * 阶段1 的 Node 音频后端：把现有 {@link AudioPlayer} 原封不动地包一层，对外暴露
 * {@link IAudioBackend}。目的是让 BotInstance 依赖接口而非具体类，且行为与原实现
 * 完全一致（零变化）。未来 Rust Worker 后端（阶段3）实现同一接口即可热替换。
 *
 * 事件通过转发（frame/trackEnd/error）桥接到本类的 EventEmitter，供 BotInstance
 * 的 setupPlayerEvents() 订阅。
 */
export class NodeAudioBackend extends EventEmitter implements IAudioBackend {
  private readonly player: AudioPlayer;

  constructor(logger: Logger) {
    super();
    this.player = new AudioPlayer(logger);
    this.player.on("frame", (opusFrame: Buffer) => this.emit("frame", opusFrame));
    this.player.on("trackEnd", () => this.emit("trackEnd"));
    this.player.on("error", (err: Error) => this.emit("error", err));
  }

  play(url: string, seekSeconds = 0, songDuration = 0): void {
    this.player.play(url, seekSeconds, songDuration);
  }

  playPcmStream(readable: Readable, opts?: PlayPcmOptions): void {
    this.player.playPcmStream(readable, opts ?? {});
  }

  pause(): void {
    this.player.pause();
  }

  resume(): void {
    this.player.resume();
  }

  stop(): void {
    this.player.stop();
  }

  seek(seconds: number): void {
    this.player.seek(seconds);
  }

  setVolume(vol: number): void {
    this.player.setVolume(vol);
  }

  getVolume(): number {
    return this.player.getVolume();
  }

  setDuckingGain(gain: number, rampMs = 0): void {
    this.player.setDuckingGain(gain, rampMs);
  }

  getState(): BackendState {
    return this.player.getState();
  }

  getElapsed(): number {
    return this.player.getElapsed();
  }

  isExternalActive(): boolean {
    return this.player.isExternalActive();
  }

  resetFailures(): void {
    this.player.resetFailures();
  }

  dispose(): void {
    // AudioPlayer 托管 ffmpeg 子进程，stop() 已完成回收
    this.player.stop();
  }
}

/**
 * 后端工厂：依据 `config.audioBackend` 选择实现。
 *
 * - `"node"`（默认）：{@link NodeAudioBackend}，复用现有实现。
 * - `"rust"`：阶段3 才会实现的 Rust Worker 后端；当前尚未实现，回退到 node 并发
 *   出告警，保证部署健壮性（二进制缺失/未实现时不致崩溃）。
 */
export function createAudioBackend(config: BotConfig, logger: Logger): IAudioBackend {
  const kind = config.audioBackend ?? "node";
  if (kind === "rust") {
    // 启用前探测二进制，缺失则回退 node 后端，避免无效后端进入运行态。
    if (!resolveAudioWorkerBin()) {
      logger.warn(
        { audioBackend: kind },
        "audioBackend=rust 但 audio-worker 二进制缺失，回退到 node 后端",
      );
      return new NodeAudioBackend(logger);
    }
    logger.info({ audioBackend: kind }, "使用 Rust Worker 音频后端");
    return new RustAudioBackend(logger);
  }
  return new NodeAudioBackend(logger);
}
