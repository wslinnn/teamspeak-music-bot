// 帧到达抖动测量：诊断 Rust 音频路径的爆音来源
// 用法：node scripts/measure-frame-jitter.mjs [worker二进制路径]
// 生成 10s WAV → 播放 → 记录每帧到达时间戳 → 输出间隔分布
import { writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { RustAudioBackend } from "../dist/audio/backend/rust-backend.js";

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

function makeSineWav(p, seconds) {
  const sr = 48000, ch = 2, n = Math.floor(sr * seconds);
  const dataSize = n * ch * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.round(Math.sin((2 * Math.PI * 440 * i) / sr) * 30000);
    for (let c = 0; c < ch; c++) { buf.writeInt16LE(s, off); off += 2; }
  }
  writeFileSync(p, buf);
}

const wav = path.resolve("jitter_probe.wav");
makeSineWav(wav, 10);

const backend = new RustAudioBackend(logger);
const stamps = [];
let trackEnded = false;
backend.on("frame", () => stamps.push(process.hrtime.bigint()));
backend.on("trackEnd", () => { trackEnded = true; });

backend.play(wav, 0, 10);
const deadline = Date.now() + 20000;
while (!trackEnded && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 100));
}
try { unlinkSync(wav); } catch {}

const gaps = [];
for (let i = 1; i < stamps.length; i++) {
  gaps.push(Number(stamps[i] - stamps[i - 1]) / 1e6); // ms
}
gaps.sort((a, b) => a - b);
const pct = (p) => gaps[Math.floor(gaps.length * p)] ?? 0;
const max = gaps[gaps.length - 1] ?? 0;
const mean = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
const big = gaps.filter((g) => g > 40).length;

console.log(`帧数: ${stamps.length}`);
console.log(`间隔  mean=${mean.toFixed(1)}ms  p50=${pct(0.5).toFixed(1)}  p95=${pct(0.95).toFixed(1)}  p99=${pct(0.99).toFixed(1)}  max=${max.toFixed(1)}ms`);
console.log(`间隔>40ms 的次数: ${big}（每次都是一次潜在的爆音/欠载）`);
process.exit(0);
