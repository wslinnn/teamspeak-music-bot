import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { Readable } from "node:stream";
import http from "node:http";
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
      const frameStamps: bigint[] = [];
      let trackEnded = false;
      let errored: Error | null = null;

      let trackEndCount = 0;
      backend.on("frame", (buf: Buffer) => {
        frames.push(buf);
        frameStamps.push(process.hrtime.bigint());
      });
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

      // 帧节拍质量：20ms 帧必须以 ~20ms 间隔到达。慢于实时供帧会让 TS 端
      // 持续欠载产生爆音（回归：Windows 定时器 15.625ms 分辨率曾把节拍
      // 量化成 31.25ms，供帧速度仅实时 64%）。均值上限收紧到 23ms 以便
      // 该回归必然失败；max 留余量容忍测试机负载。
      const gaps: number[] = [];
      for (let i = 1; i < frameStamps.length; i++) {
        gaps.push(Number(frameStamps[i] - frameStamps[i - 1]) / 1e6);
      }
      const meanGap = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
      const maxGap = Math.max(...gaps, 0);
      expect(meanGap, `帧间隔均值 ${meanGap.toFixed(1)}ms 应接近 20ms（供帧慢于实时=爆音）`).toBeLessThan(23);
      expect(maxGap, `帧间隔最大 ${maxGap.toFixed(1)}ms`).toBeLessThan(80);

      console.log(
        `[smoke] 收到 ${frames.length} 个 Opus 帧，首帧 ${first.length} 字节，` +
          `帧间隔 mean=${meanGap.toFixed(1)}ms max=${maxGap.toFixed(1)}ms`,
      );
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

  it(
    "卡死看门狗：源连接后无数据，~5 秒后 trackEnd 恢复（#89 语义）",
    async () => {
      // 接受连接但永不响应的 HTTP 服务器：ffmpeg 存活、零输出、自身不超时
      const server = http.createServer(() => {
        /* never respond */
      });
      await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}/hang.mp3`;

      const backend = new RustAudioBackend(logger);
      let trackEndCount = 0;
      const errs: string[] = [];
      backend.on("trackEnd", () => {
        trackEndCount += 1;
      });
      backend.on("error", (e: Error) => {
        errs.push(e.message.slice(0, 60));
      });

      const t0 = Date.now();
      backend.play(url, 0, 0); // 时长未知 → node 语义保守按"近结尾"5 秒看门狗

      const deadline = Date.now() + 15000;
      while (trackEndCount === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
      }
      const elapsed = Date.now() - t0;
      server.close();
      backend.stop();

      // 看门狗走 trackEnd 路径（node 恒 trackEnd），不是 ffmpeg_no_output error
      expect(errs, `不应有 error: ${errs}`).toEqual([]);
      expect(trackEndCount, "应收到恰好一次 trackEnd").toBe(1);
      // ≈5s 看门狗 + 启动余量；过短说明源秒失败（那是 error 路径）
      expect(elapsed, `看门狗触发过快: ${elapsed}ms`).toBeGreaterThan(3000);
      console.log(`[smoke] 看门狗 ${(elapsed / 1000).toFixed(1)}s 后 trackEnd`);
    },
    25000,
  );

  it(
    "预缓冲门：短文件（不足 500ms 门限）在 EOF 开门后仍完整播出并 trackEnd",
    async () => {
      // 0.3s ≈ 57.6KB PCM < 96KB 门限：门必须靠 EOF 兜底开门，否则短文件永不出帧
      const wav = path.resolve("smoke_short.wav");
      makeSineWav(wav, 0.3, 660);

      const backend = new RustAudioBackend(logger);
      const frames: Buffer[] = [];
      let trackEndCount = 0;
      backend.on("frame", (b: Buffer) => frames.push(b));
      backend.on("trackEnd", () => {
        trackEndCount += 1;
      });

      backend.play(wav, 0, 0.3);
      const deadline = Date.now() + 8000;
      while (trackEndCount === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      try {
        unlinkSync(wav);
      } catch {
        /* ignore */
      }
      backend.stop();

      expect(trackEndCount, "EOF 开门后应正常 trackEnd").toBe(1);
      // 0.3s ≈ 15 帧；EOF 开门不应吞帧
      expect(frames.length, `短文件帧数异常: ${frames.length}`).toBeGreaterThanOrEqual(13);
      expect(frames.length, `短文件帧数异常: ${frames.length}`).toBeLessThanOrEqual(17);
      console.log(`[smoke] 短文件(0.3s) 收到 ${frames.length} 帧`);
    },
    15000,
  );

  it(
    "暂停淡出：pause 后 ≤2 帧内静默，resume 后恢复出帧",
    async () => {
      const wav = path.resolve("smoke_pause.wav");
      makeSineWav(wav, 4, 440); // 4s = 768KB，远超门限，1s 后已稳定出帧

      const backend = new RustAudioBackend(logger);
      let frames = 0;
      backend.on("frame", () => {
        frames += 1;
      });

      backend.play(wav, 0, 4);
      // 等门开 + 稳定播放（≥1s 音频已出）
      const warmup = Date.now() + 2500;
      while (frames < 40 && Date.now() < warmup) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(frames, "前置：应已稳定出帧").toBeGreaterThanOrEqual(40);

      // pause：drain 淡出 ≤1 帧 + 在途 ≤1 帧 → 800ms 窗口内不应再有新帧
      backend.pause();
      const framesAtPause = frames;
      await new Promise((r) => setTimeout(r, 800));
      const drained = frames - framesAtPause;
      expect(drained, `暂停后仍收到 ${drained} 帧（应 ≤2）`).toBeLessThanOrEqual(2);

      // resume：淡入恢复，500ms 内应重新出帧
      backend.resume();
      const framesAtResume = frames;
      const resumeDeadline = Date.now() + 2000;
      while (frames === framesAtResume && Date.now() < resumeDeadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(frames, "resume 后应恢复出帧").toBeGreaterThan(framesAtResume);

      try {
        unlinkSync(wav);
      } catch {
        /* ignore */
      }
      backend.stop();
      console.log(`[smoke] pause drain=${drained} 帧，resume 后恢复出帧`);
    },
    15000,
  );
});
