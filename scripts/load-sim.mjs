// S2/S3 本机模拟压测：N 个客户端（WS + 每 3s elapsed 轮询）打假后端。
// 用法：node load-sim.mjs <N> <seconds>
// 输出：RTT p50/p95/max、收到 stateChange 总数、服务器 node 进程 CPU 增量。
import WebSocket from "ws";

const N = Number(process.argv[2] ?? 10);
const DURATION_MS = Number(process.argv[3] ?? 30) * 1000;
const BASE = "http://127.0.0.1:3999";

const loginRes = await fetch(`${BASE}/api/client/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: "alice", password: "pw-alice-123", deviceName: "loadsim" }),
});
const { token } = await loginRes.json();
if (!token) { console.error("login failed", loginRes.status); process.exit(1); }

// 服务器 CPU 采样起点（node 进程：dev-server）
const { execSync } = await import("node:child_process");
const serverPid = execSync(
  `powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'dev-server' }).ProcessId"`
).toString().trim().split(/\s+/).filter(Boolean).pop();
const cpuOf = (pid) => Number(execSync(
  `powershell -NoProfile -Command "(Get-Process -Id ${pid}).TotalProcessorTime.TotalMilliseconds"`
).toString().trim());
const cpu0 = cpuOf(serverPid);

const rtts = [];
let stateChanges = 0;
let errors = 0;
const start = Date.now();
const AUTH = { Authorization: `Bearer ${token}` };

const stats = () => {
  const s = [...rtts].sort((a, b) => a - b);
  const p = (q) => s[Math.floor(s.length * q)] ?? 0;
  return { n: s.length, p50: p(0.5).toFixed(0), p95: p(0.95).toFixed(0), max: (s[s.length - 1] ?? 0).toFixed(0) };
};

async function client(i) {
  const ws = new WebSocket(`ws://127.0.0.1:3999/ws`, { headers: AUTH });
  ws.on("message", (d) => { try { if (JSON.parse(d).type === "stateChange") stateChanges++; } catch {} });
  await new Promise((ok) => ws.once("open", ok));
  while (Date.now() - start < DURATION_MS) {
    const t0 = performance.now();
    try {
      const res = await fetch(`${BASE}/api/player/bot-dev/elapsed`, { headers: AUTH });
      await res.json();
      rtts.push(performance.now() - t0);
    } catch { errors++; }
    const jitter = Math.random() * 40;
    await new Promise((r) => setTimeout(r, 3000 + jitter));
  }
  ws.close();
}

await Promise.all(Array.from({ length: N }, (_, i) => client(i)));
const cpu1 = cpuOf(serverPid);
const wallS = (Date.now() - start) / 1000;
const s = stats();
const cpuPct = (((cpu1 - cpu0) / 1000) / wallS / 16 * 100).toFixed(2);
console.log(`N=${N} dur=${wallS.toFixed(0)}s  elapsed_polls=${s.n}  errors=${errors}`);
console.log(`  RTT ms: p50=${s.p50} p95=${s.p95} max=${s.max}`);
console.log(`  stateChange 收到总数=${stateChanges}（每客户端≈${(stateChanges / N).toFixed(1)}）`);
console.log(`  服务器 node CPU 增量=${((cpu1 - cpu0) / 1000).toFixed(2)}s → 整系统 ${cpuPct}%（16 核归一）`);
