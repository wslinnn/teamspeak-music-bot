import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { Readable } from "node:stream";
import path from "node:path";
import { RustAudioBackend } from "./rust-backend.js";

// 极简 Logger 桩，满足类型要求（测试不需要结构化日志）
const logger: any = {
  info: (...a: unknown[]) => console.log("[info]", ...a),
  warn: (...a: unknown[]) => console.warn("[warn]", ...a),
  error: (...a: unknown[]) => console.error("[error]", ...a),
  debug: (...a: unknown[]) => {},
};

/** 生成一段合法的 48k/立体声/16bit WAV 正弦音文件，返回路径。 */
function makeSineWav(path: string, seconds: number, freq = 440): void {
  const sr = 48000;
  const ch = 2;
  const n = Math.floor(sr * seconds); // 每声道样本数
  const dataSize = n * ch * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * ch * 2, 28); // byteRate
  buf.writeUInt16LE(ch * 2, 32); // blockAlign
  buf.writeUInt16LE(16, 34); // bits
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * freq * i) / sr) * 30000);
    for (let c = 0; c < ch; c++) {
      buf.writeInt16LE(s, off);
      off += 2;
    }
  }
  writeFileSync(path, buf);
}

/**
 * 端到端冒烟测试：RustAudioBackend + audio-worker 进程。
 * 生成一段本地 WAV 正弦音，让 Worker 通过外部 ffmpeg 解码→Opus 编码回传，验证：
 *   - 能回传标准 20ms Opus 帧（数量合理）
 *   - 曲目自然结束后收到 trackEnd
 *   - 无 error 事件
 * 依赖：audio-worker 二进制已构建、ffmpeg-static 可用。
 */
describe("RustAudioBackend 端到端", () => {
  it(
    "播放本地 WAV 正弦音，回传 Opus 帧并最终 trackEnd",
    async () => {
      const wav = path.resolve("smoke_sine.wav");
      makeSineWav(wav, 1.5, 440);

      const backend = new RustAudioBackend(logger);
      const frames: Buffer[] = [];
      let trackEnded = false;
      let errored: Error | null = null;

      let trackEndCount = 0;
      backend.on("frame", (buf: Buffer) => frames.push(buf));
      backend.on("trackEnd", () => {
        trackEnded = true;
        trackEndCount += 1;
      });
      backend.on("error", (e: Error) => {
        errored = e;
      });

      backend.play(wav, 0, 1.5);

      // 等待 trackEnd 或超时（8 秒足够 1.5 秒音 + 启动开销）
      const deadline = Date.now() + 8000;
      while (!trackEnded && !errored && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }

      try {
        unlinkSync(wav);
      } catch {
        /* ignore */
      }

      // 回调内的赋值对 CFA 不可见，显式还原联合类型
      const err = errored as Error | null;
      if (err) {
        throw new Error(`收到 error 事件: ${err.message}`);
      }
      expect(trackEnded, "应收到 trackEnd").toBe(true);
      // trackEnd 必须恰好一次：上层对 error/trackEnd 都触发切歌，重复会跳歌
      expect(trackEndCount, "trackEnd 应恰好一次").toBe(1);
      // 1.5 秒音 ≈ 75 帧（20ms/帧）；允许启动延迟，至少 40 帧
      expect(frames.length, `Opus 帧数量过少: ${frames.length}`).toBeGreaterThan(40);
      const first = frames[0];
      expect(first.length, "Opus 首帧不应为空").toBeGreaterThan(0);
      console.log(`[smoke] 收到 ${frames.length} 个 Opus 帧，首帧 ${first.length} 字节`);
    },
    15000,
  );

  it(
    "源不可用时只上报 error、不追发 trackEnd（双事件会双跳歌）",
    async () => {
      const backend = new RustAudioBackend(logger);
      const events: string[] = [];
      backend.on("trackEnd", () => events.push("trackEnd"));
      backend.on("error", (e: Error) => events.push(`error:${e.message.slice(0, 40)}`));

      backend.play(path.resolve("definitely_missing_audio_source.wav"), 0, 10);

      // ffmpeg 派生→失败→退出需要一点时间
      await new Promise((r) => setTimeout(r, 4000));

      expect(events.some((e) => e.startsWith("error")), `应收到 error 事件: ${events}`).toBe(true);
      expect(events.some((e) => e === "trackEnd"), `不应收到 trackEnd: ${events}`).toBe(false);
      console.log("[smoke] 坏源事件序列:", events);
    },
    15000,
  );

  it(
    "外部 PCM 喂入（pcm-feed）：帧回传、EOF 回调、Worker 不发 trackEnd",
    async () => {
      const backend = new RustAudioBackend(logger);
      const frames: Buffer[] = [];
      let externalEnded = false;
      let trackEndCount = 0;
      backend.on("frame", (b: Buffer) => frames.push(b));
      backend.on("trackEnd", () => {
        trackEndCount += 1;
      });

      // 1.5 秒 48k/立体声/s16le 正弦 PCM，按 16KB 块推送（模拟边车 ffmpeg stdout）
      const sr = 48000;
      const n = Math.floor(sr * 1.5);
      const pcm = Buffer.alloc(n * 4);
      let off = 0;
      for (let i = 0; i < n; i++) {
        const v = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 30000);
        pcm.writeInt16LE(v, off);
        pcm.writeInt16LE(v, off + 2);
        off += 4;
      }
      let pos = 0;
      const readable = new Readable({
        read() {
          if (pos >= pcm.length) {
            this.push(null);
            return;
          }
          this.push(pcm.subarray(pos, pos + 16384));
          pos += 16384;
        },
      });

      backend.playPcmStream(readable, {
        onExternalEnd: () => {
          externalEnded = true;
        },
      });

      // 流会瞬间推完（缓冲在 Worker 侧），帧按 20ms 节拍回传约 3 秒
      await new Promise((r) => setTimeout(r, 4500));

      expect(externalEnded, "流 EOF 应回调 onExternalEnd").toBe(true);
      expect(frames.length, `PCM 帧数量过少: ${frames.length}`).toBeGreaterThan(60);
      // 外部模式语义：Worker 不发 trackEnd（曲目结束由控制器调 stop 驱动）
      expect(trackEndCount, "外部模式不应收到 trackEnd").toBe(0);
      console.log(`[smoke] pcm-feed 收到 ${frames.length} 帧 Opus`);
      backend.stop();
    },
    15000,
  );
});
