# Rust 音频 Worker 重构 — 可行性评估与实施方案（v2）

> ✅ **执行进度（2026-08-24）**：阶段1（IAudioBackend 抽象，094d220）、阶段2（Rust Worker 最小可用：TCP IPC + 外部 ffmpeg + opus-codec + 20ms 节拍 + 音量/闪避 + 背压，9814185）、阶段3（rust-backend 接入 + 工厂探测回退 + 保活自动重启 + dispose）全部完成。集成测试端到端通过（1.5s WAV → 78 帧 Opus + trackEnd），全量 1050/1050。默认 audioBackend=node 行为零变化。
> 关键修复：worker 帧循环空转 trackEnd bug（从连接起每 20ms 刷 trackEnd），改为三态（JustEnded 恰好一次 / Idle 静默）。
> 待做（阶段4）：pcm-feed（Spotify 外部 PCM，当前 rust 后端明确报错回退 node）、LRU 磁盘缓存、neteq 自适应缓冲、Linux 调度优先级；阶段5：真实 TS 服务器 A/B 听感对比与灰度。

> 分支：`feat/rust-audio-worker`
> 依据：`docs/豆包的建议.txt`（系统优化分析报告）+ `docs/豆包的建议续.txt`（Rust 库调研与落地策略）
> 目标：在不重写 TS 协议栈、音源适配器、Web 前端、业务逻辑的前提下，将**音频管线**（ffmpeg 管理 + Opus 编码 + 20ms 帧计时 + 多级缓冲 + 故障隔离）下沉到独立的 Rust 进程，复用现有 `@honeybbq/teamspeak-client` 做 UDP 发包。
>
> **重要说明**：原报告第 3 节建议 Worker 语言优先选 **Go**（开发维护成本更低）。本方案按你的要求尝试 **Rust**，因此在可行性评估中如实标注 Rust 相对 Go 的额外成本与风险，并保留 Node `worker_threads` 降级方案作为兜底。库选型已根据续篇修正（见第四节）。

---

## 一、可行性评估（结论先行）

### 1.1 可行性结论

| 维度 | 结论 | 依据 |
|------|------|------|
| 架构可行性 | ✅ 高 | Node 侧只需替换 `AudioPlayer` 实现，`BotInstance` 只依赖 `frame`/`trackEnd`/`error` 三个事件（见 `src/bot/instance.ts`），接口窄、可抽象 |
| Opus 编码可行性 | ✅ 高（参数需对齐） | Rust `opus-codec`（libopus 安全 FFI 包装）可静态编译 libopus 源码，输出标准 48k/立体声/20ms Opus 帧，与 `@discordjs/opus` 同源于 libopus，字节级兼容可期 |
| ffmpeg 集成可行性 | ✅ 高 | **调用外部 ffmpeg 二进制**（续篇强制约束），`tokio::process::Command` 派生子进程、异步读 stdout 管道；背压通过"停止读取"让 OS 管道缓冲自然阻塞 ffmpeg |
| 帧计时 / jitter 缓冲 | ✅ 高（Rust 强项） | `tokio::time::Instant` + 帧计数控制节拍，无 GC、无 V8 抖动；抖动缓冲可先用可靠 `VecDeque` 环形队列，再择机接 `neteq` |
| 故障隔离 | ✅ 高 | 独立进程崩溃不影响 Node 主进程；Node 侧自动重启 Worker |
| 跨平台（Windows 开发） | ⚠️ 中风险 | Windows 的 Unix Domain Socket 支持有限；需 TCP `127.0.0.1` 回退。你当前在 win32 开发，这是**首要拦路点** |
| 构建 / 部署复杂度 | ⚠️ 中风险 | 需引入 Rust 工具链到 `setup.bat`/`install.sh`/Dockerfile；或改为发布预编译二进制 |
| Windows 下 libopus 编译 | ✅ 已实测清除 | `opus-codec` 默认捆绑编译 libopus 源码；本机 MSVC(BuildTools 18) + VS 自带 cmake 可成功编译（详见 4.7） |
| 开发周期 | ⚠️ Rust 高于 Go | 所有权 / 生命周期 / 流背压更易踩坑，但工具链已就绪，可接受 |
| 性能收益是否来自语言 | ❌ 否 | 收益来自**进程隔离 + 线程分离 + 缓冲 + 调度优先级**，与语言无关；ffmpeg 本身 CPU 占用不变 |

**综合判断**：Rust 方案**技术上完全可行**，核心收益（隔离、稳定帧计时、缓冲）能拿到；主要代价是 (a) Windows 开发态的 IPC 回退方案，(b) 构建链引入 Rust，(c) 开发调试成本高于 Go。建议按阶段推进，每个阶段独立可验证、可回滚。

### 1.2 与原报告的分歧点（已按你的要求改为 Rust）

- 原报告第 3 节语言选型建议 **Go**；本报告落地 **Rust**，理由：你要求尝试 Rust，且本机已装 `cargo 1.98.0`。
- 保留原报告核心架构约束不变：**Worker 不碰 TS 协议、不碰音源 API、不碰业务逻辑**，只输出标准 20ms Opus 二进制帧。
- **库选型依据续篇修正**：明确**只调用外部 ffmpeg 二进制**，禁用进程内 FFmpeg 绑定；Opus 改用 `opus-codec`；抖动缓冲先用 `VecDeque` 再择机接 `neteq`。

---

## 二、范围边界（重写什么 / 不重写什么）

### 2.1 Rust Worker 负责（下沉）

- ffmpeg 子进程生命周期管理（派发、超时回收、崩溃检测、僵尸进程清理）
- 网络流读取、流背压控制（参考 `buildFfmpegArgs` 的 B 站/网易云 referer、reconnect 参数）
- 三级缓冲：网络接收缓冲 → 解码头缓冲 → Opus 帧 jitter-buffer（先 `VecDeque` 固定环形队列，再择机接 `neteq`）
- Opus 编码，严格 20ms 帧输出（基于高精度时钟节拍）
- 音量曲线 `volumeToFactor` 的 Rust 移植 + 语音闪避（ducking）增益叠加
- LRU 本地磁盘音频缓存（缓存解码后 Opus 码流，不缓存带时效签名的源 URL）
- 进度 / 结束 / 崩溃事件上报
- Linux 进程调度优先级（`chrt`/`nice`，可选）

### 2.2 Rust Worker **不**负责（保留在 Node）

- TS3/TS6 协议栈（`@honeybbq/teamspeak-client`）：Worker 只回传 Opus 帧，由现有 `tsClient.sendVoiceData` 发包
- 音源适配器（`music/*`）、队列（`queue.ts`）、Web/WebSocket、权限、SQLite、命令系统
- 音源 URL 解析与懒加载（由 Node 在 play 前解析好 URL，传给 Worker）
- **不引入** HTTP / WebSocket / 鉴权逻辑；不引入 WebRTC 库（如 `libdatachannel`）

### 2.3 两个特殊路径的处理

1. **Spotify 外部 PCM 模式**（`player.playPcmStream`）：Worker 新增 `pcm-feed` 模式 —— Node 把 Spotify 边车 ffmpeg 输出的标准化 48k/s16le/立体声 PCM 流，通过 IPC 喂给 Worker，由 Worker 统一做 Opus 编码与帧计时。
2. **Windows jdymusic CDN 特例**（`shouldUsePowerShellDownload`）：Windows 下该 CDN 直连会被 RST，Node 用 PowerShell 下载到临时文件。Worker 不做 PowerShell 逻辑；Node 侧把下载好的本地临时文件路径传给 Worker（Worker 对本地文件跑 ffmpeg 即可）。

---

## 三、架构设计

### 3.1 `IAudioBackend` 抽象（阶段 1，仍为纯 TypeScript，零 Rust）

在 `src/audio/backend/` 定义接口，镜像现有 `AudioPlayer` 公共 API：

```ts
// src/audio/backend/audio-backend.ts
import { EventEmitter } from "node:events";

export type BackendState = "idle" | "playing" | "paused";

export interface PlayOptions {
  url: string;
  seekSeconds?: number;
  songDuration?: number;
  /** Spotify 等外部 PCM：Node 侧已拉起 ffmpeg 并 pipe 进来 */
  externalPcm?: boolean;
}

export interface IAudioBackend extends EventEmitter {
  on(event: "frame", listener: (opus: Buffer) => void): this;
  on(event: "trackEnd", listener: () => void): this;
  on(event: "error", listener: (err: Error) => void): this;

  play(opts: PlayOptions): void;
  pause(): void;
  resume(): void;
  stop(): void;
  seek(seconds: number): void;
  setVolume(vol: number): void;
  getVolume(): number;
  setDuckingGain(gain: number, rampMs?: number): void;
  getState(): BackendState;
}
```

- `node-backend.ts`：把现有 `player.ts` 包一层，原封不动（回滚保底）。
- `rust-worker-backend.ts`：本方案新增，通过 IPC 与 Rust Worker 通信，对外暴露同一接口。
- `BotInstance` 改为依赖 `IAudioBackend`（工厂按 `config.audioBackend` 选择），不依赖具体类。
- `config.json` 新增字段：`"audioBackend": "node" | "rust"`（默认 `node`，灰度开关）。

> 阶段 1 合入 `main` 后，功能与现状**完全一致**，但已具备运行时切换新旧后端的能力。

### 3.2 进程拓扑

```
【Node 主进程（完整原有业务）】
├─ web / 音源 / 队列 / SQLite / TS 协议
└─ IAudioBackend
     ├─ node-backend.ts        （旧，回滚用）
     └─ rust-worker-backend.ts ← Unix-Socket/TCP IPC
              ↓
【独立 Rust Audio Worker 进程】
   ffmpeg 管理 · 流背压 · 三级缓冲 · Opus 编码 · 20ms 帧计时 · LRU 缓存 · 调度优先级
              ↓ 回传 Opus 二进制帧 + 事件(JSON)
【Node 主进程】→ tsClient.sendVoiceData → UDP 127.0.0.1 lo → TS 服务端 → 外网
```

---

## 四、Rust Worker 设计

### 4.1 工程结构（仓库根新增 `audio-worker/` 子目录，独立 Cargo 工程）

```
audio-worker/
├── Cargo.toml
├── build.rs                # 可选：定位 ffmpeg 二进制路径，注入编译期常量
├── src/
│   ├── main.rs             # 启动、监听 IPC、信号、子进程管理
│   ├── ipc.rs              # 长度前缀帧编解码（控制/事件/音频帧统一封装）
│   ├── session.rs          # 单次播放会话状态机
│   ├── ffmpeg.rs           # 外部 ffmpeg 子进程派生、参数构建、stdout 读取、背压
│   ├── pcm_feed.rs         # 接收 Node 经 IPC 喂入的外部 PCM（Spotify 模式）
│   ├── encoder.rs          # libopus 封装（opus-codec）：encode(3840B PCM → Opus 帧)
│   ├── jitter_buf.rs       # 阶段1：VecDeque 固定环形队列；阶段2：neteq 适配封装
│   ├── clock.rs            # 高精度帧节拍调度（Instant + 帧计数）
│   ├── volume.rs           # volumeToFactor + ducking 增益（与 TS 端完全一致）
│   ├── lru_cache.rs        # 磁盘 Opus 码流 LRU 缓存（sled / 自实现）
│   └── scheduler.rs        # Linux chrt/nice 提升优先级（cfg(unix)）
└── tests/
```

> **强制约束（续篇）**：Worker **只调用外部 ffmpeg 二进制**，绝不链接 libav。参考 HearthAudio/Hearth（Rust 版 Lavalink 替代）与 Songbird（Discord Rust 语音库）的架构，但 IPC 改为 UDS（非 HTTP）、输出面向 Unix Socket（非 RTP）。

### 4.2 关键依赖（crates）—— 已按续篇修正

| 用途 | crate | 备注 |
|------|-------|------|
| 异步运行时 | `tokio`（`rt-multi-thread`/`macros`/`process`/`net`/`signal`） | 进程、UDS、定时器、信号 |
| **Opus 编码** | **`opus-codec`**（libopus 安全 FFI，支持 `static` 静态编译 libopus 源码） | 续篇纠正：旧 `opus`/`audiopus` 是老包，优先 `opus-codec` |
| 抖动缓冲 | 阶段1 自实现 `VecDeque`；阶段2 择机接 `neteq`（`neteq = "0.9"`） | `neteq` 需适配"本地有序帧"场景，非直接复制示例 |
| IPC 帧 | **自实现长度前缀协议**（基于 `tokio::net::UnixStream` + `bytes`） | UDS 为 tokio 内置，无需第三方 crate |
| 可选 WebM 封装 | `transmux = "0.11"`（**仅后置可选，第一版不启用**） | 只做容器 mux，不二次编码；兜底交给 ffmpeg 直出 |
| 字节缓冲 | `bytes` | 管道 / UDS 零拷贝 |
| 错误处理 | `thiserror` + `anyhow` | 强类型错误 + 顶层快速处理 |
| 日志 | `tracing` + `tracing-subscriber` | 结构化输出，Node 侧接入 pino |
| 信号 | `signal-hook-tokio` | 捕获 SIGINT/SIGTERM，优雅关闭 ffmpeg 与 UDS |
| 配置/CLI | `clap` / `serde` | socket 路径、缓冲时长、缓存上限 |
| LRU 磁盘缓存 | `sled` 或自实现文件缓存 | 缓存 Opus 帧而非源 URL |

```toml
# audio-worker/Cargo.toml（最小完整依赖模板，版本以 crates.io 最新为准）
[package]
name = "audio-worker"
version = "0.1.0"
edition = "2021"

[dependencies]
tokio = { version = "1.0", features = ["rt-multi-thread", "macros", "process", "net", "signal"] }
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
bytes = "1.0"

# Opus 编码：opus-codec 安全 FFI，默认捆绑编译 libopus 源码（无需系统库）
# 经本机验证：opus-codec 0.2.0 可在 Windows + MSVC(BuildTools 18) 下成功编译
# libopus，并真实编码出字节级对齐的 20ms/48k/立体声 Opus 帧。
# 注意：无 `static` feature（默认即捆绑源码）；构建需 cmake（用 VS 自带的即可）。
opus-codec = { version = "0.2" }   # 真实存在的最新版为 0.2.0（非 0.5）

# 阶段2 择机接入：自适应 jitter-buffer neteq（默认关闭，先走 VecDeque）
neteq = { version = "0.9", default-features = false, optional = true }

# 可选：fragmented-webm 封装，未来 web 降级使用（默认关闭）
# 真实最新版为 0.24.0（非续篇说的 0.11），MSRV 较高，后置可选
transmux = { version = "0.24", optional = true }

thiserror = "1.0"
anyhow = "1.0"
tracing = "0.1"
tracing-subscriber = "0.3"
signal-hook-tokio = "0.3"
clap = { version = "4.0", features = ["derive"] }

[features]
default = []
jitter-neteq = ["neteq"]
webm = ["transmux"]
```

### 4.3 ❗ 避坑黑名单（续篇强制约束，不要引入）

1. `ez-ffmpeg` / `ffmpeg-next` / `rsmpeg`：进程内 FFmpeg 绑定，编译依赖 libav 开发库，docker / 交叉编译痛苦。**只调用外部 ffmpeg 二进制**。
2. 不要在 Worker 内部引入 HTTP、WebSocket、鉴权逻辑；Worker 只做音频处理，会话、权限全部交给 Node 层。
3. 不要使用 WebRTC 库（如 `libdatachannel`）放在 Worker，Worker 不处理浏览器会话。

### 4.4 IPC 协议（统一长度前缀帧，规避 JSON/二进制混用歧义）

每条消息 = `1 字节 type` + `4 字节大端 length` + `payload`：

- `C` 控制指令（Node→Worker，JSON，低频）：
  - `{"c":"play","url":"...","seek":0,"dur":0,"external":false}`
  - `{"c":"pause"}` / `{"c":"resume"}` / `{"c":"stop"}`
  - `{"c":"seek","sec":30}`
  - `{"c":"set_volume","vol":75}`
  - `{"c":"set_ducking","gain":0.6,"ramp_ms":300}`
  - `{"c":"feed_pcm","data":<raw>}`（仅 external 模式，payload 为原始 PCM 字节，不走 JSON）
- `E` 事件（Worker→Node，JSON）：
  - `{"e":"ready"}` / `{"e":"progress","pos_ms":14200}`
  - `{"e":"trackEnd"}` / `{"e":"error","code":"ffmpeg_exit","msg":"..."}`
- `F` 音频帧（Worker→Node）：payload = 原始 Opus 字节（与 `@discordjs/opus` 字节级等价）。Node 收到 `F` 直接 `emit("frame", buf)`。

传输层：
- 生产（Linux / Docker）：`UnixListener` 监听 `/run/tsbot-audio.sock`（配置化）。
- 开发（Windows）：回退到 `TcpListener` 监听 `127.0.0.1:<port>`，靠 lo 回环，无公网带宽消耗。
- 由 `config.audioBackendSocket` 或环境变量选择。

> 不使用 HTTP/WebSocket 做进程内部 IPC，UDS / 本地 TCP 开销最低。

### 4.5 帧节拍与缓冲（核心收益点）

- 进入 `playing` 后，先填充 jitter-buffer 至目标时长（如 150ms）再开始输出，抵抗瞬时抖动。
- 主循环：`next_frame_time = start + n*20ms`，用 `tokio::time::sleep_until(Instant)` 对齐；不依赖 OS 普通定时器的累加漂移。
- 每帧：`jitter_buf.pop()` → `encoder.encode(pcm)` → 发送 `F` 帧；PCM 不足则发静音帧（保持 20ms 时间线连续，避免 TS 断流）。
- 水位监控：低于 LOW 水位告警日志；ffmpeg stdout 超过 HIGH 水位则暂停读取（OS 管道自然反压）。

**抖动缓冲的分阶段策略（续篇关键建议）**：

- **阶段1（最小可用）**：**不接 neteq**，用自实现 `VecDeque` 固定大小环形队列做缓冲，先保证 TS 正常播放、跑通核心链路。此时整套链路全部是成熟组件，风险极低。
- **阶段2（优化迭代）**：在阶段1 稳定后，再择机接入 `neteq` 做自适应抖动缓冲（水位自动调节、时间拉伸）。`neteq` 原生面向"网络接收乱序 RTP 包"，我们的场景是"本地有序帧喂入、做时序管理与防 underrun"，属于**反向用法**，需要适配、不能直接复制示例代码。若踩坑随时切回 `VecDeque`。

### 4.6 与 TS 端行为对齐（必须验证）

- `volumeToFactor` 曲线（`0.2x + 0.8x^8`）逐行移植，保证音量手感一致。
- ducking 增益叠加逻辑与 `applyVolume` 的线性/斜坡处理一致。
- Opus 编码参数须与 `@discordjs/opus` 输出**字节级兼容**：采样率 48000、声道 2、帧长 20ms、PCM 3840 字节；建议显式设 `bitrate`/`application=VoIP` 与现有编码器对齐（具体数值在阶段2用 A/B 比对确认）。

---

### 4.7 阶段2 首验结果（2026-08-24 本机实测）

在 `feat/rust-audio-worker` 分支实测，结论是**首要拦路点已清除、Rust 路线在本机可行**：

- **opus-codec 编译**：`cargo build`（仅依赖 `opus-codec = "0.2"`）在 Windows + **MSVC BuildTools 18** 下成功编译其捆绑的 libopus 源码，并生成 `audio-worker.exe`。
- **真实编码**：用与 `@discordjs/opus` 对齐的参数（48k / 立体声 / 20ms / `Application::Voip`）编码一帧 3840 字节静音 PCM → 输出 3 字节 Opus 帧，API 可用、字节流可产出。
- **关键环境坑（必读）**：本机 `cmake` **不在默认 PATH**。opus-codec 的 build.rs 走 `cmake` crate 并自动识别到 "Visual Studio 18 2026" 生成器（说明 MSVC 可被找到），但缺 `cmake` 二进制本身会直接报 `is cmake not installed?`。**解决：无需单独安装 cmake**——VS18 BuildTools 已自带，路径为：
  `C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe`
  构建前把它加入 PATH 即可（见下方 `setup.bat` 集成建议）。
- **未验证项（后续阶段）**：tokio 调用外部 ffmpeg、UDS/TCP IPC、neteq 抖动缓冲、与 TS 端实际出声 A/B 比对——这些放到阶段2/3 再逐步验证。

> `setup.bat` / `install.sh` 集成建议：编译前 `set PATH=%PATH%;<VS CMake bin>`（或 `call vcvarsall.bat`），再 `cargo build --release`。CI 预编译二进制可绕开本机工具链。

## 五、Node 侧适配层（`rust-worker-backend.ts`）

- 构造时：定位 Worker 二进制（`bin/tsbot-audio-worker` 或 `PATH`），若缺失则**自动回退 `node-backend`** 并发出告警（保证部署健壮性）。
- 启动/保活：用 `child_process.spawn` 拉起 Worker；监听 IPC 断开 → 自动重启 → 触发切歌 + 向前端/TS 频道上报错误（对应原报告"故障隔离"收益）。
- 实现 `IAudioBackend`：把控制方法转成 `C` 指令写 socket；读 socket 的 `E`/`F` 消息转成 `frame`/`trackEnd`/`error` 事件。
- 二进制零拷贝：`F` 帧直接用 `Buffer` 转发，不做 base64。
- 二进制检测：区分 Windows（TCP）与 Linux（Unix socket）两种连接建立方式。

---

## 六、构建与部署集成

| 环境 | 方案 |
|------|------|
| 开发（Windows） | `setup.bat` 增加 `cargo build --release`（或下载预编译二进制到 `bin/`）；失败则跳过并回退 node-backend |
| Linux / systemd | `install.sh` 内 `cargo build --release`，或 CI 产出预编译二进制；Node 主进程与 Worker 由 systemd 分别管理，Node 负责拉起 Worker |
| Docker | 多阶段构建：rust 镜像编译 Worker → 拷贝二进制进运行镜像；`Dockerfile` 增加 rust 阶段 |
| 发布 | 推荐 GitHub Actions 为各平台（linux-x64 / windows-x64）产出 `tsbot-audio-worker` 预编译产物，避免每个用户本地编译 |

> 是否落地"本地编译 vs 预编译二进制"是阶段2前的决策点，影响 `setup.bat`/`Dockerfile` 改动量。

---

## 七、分阶段实施路径（每阶段独立可验证、可回滚）

### 阶段 1（纯 TS，可合入 main）：接口抽象
- 实现 `IAudioBackend` + `node-backend.ts`（包装现有 `player.ts`）。
- `BotInstance` 改为依赖接口；`config.json` 增加 `audioBackend` 开关（默认 `node`）。
- 行为零变化，具备切换能力。**不引入 Rust。**

### 阶段 2（Rust 最小可用原型，独立验证）—— 绕开 neteq/transmux
- 新建 `audio-worker/` Cargo 工程；实现 IPC 监听 + `play` 派生**外部 ffmpeg** + **opus-codec** 编码 + 回传 `F` 帧 + `trackEnd`/`error` 事件。
- 抖动缓冲**先用 `VecDeque` 固定环形队列**，不接 neteq、不启 transmux。
- **先做裸 stdout→opus→socket 的本地脚本联调**，不接主 Bot，验证：能出声、帧稳定、崩溃不拖垮 Node。
- **首要验证项**：Windows 下 `opus-codec` 能否编译 libopus（决定后续能否在本机开发）。

### 阶段 3（Node 侧 rust-worker-backend 接入）
- 实现 `rust-worker-backend.ts`，接通 `IAudioBackend`。
- 开发态切 `audioBackend: "rust"`，长时间压力播放，对比旧实现在爆音、内存、稳定性上的差异。

### 阶段 4（完善周边能力）
- **择机**接入 `neteq` 做自适应抖动缓冲（若踩坑则保留 `VecDeque`）。
- LRU 磁盘缓存、调度优先级、ducking、pcm-feed（Spotify）、崩溃自动重启 + 自动切歌 + 错误上报、日志对接 pino。

### 阶段 5（灰度）
- 生产可随时切回 `node`；稳定后决定是否废弃旧 Node 音频实现。
- **可选后置**：评估 `transmux` 做 fragmented-webm 封装用于 Web 收听降级；不做则完全不引入。

---

## 八、Rust 库栈「真实可落地性」核查（续篇核验结论）

| 模块 | 是否权威/成熟 | 风险等级 | 兜底方案 |
|------|------|------|------|
| tokio 进程调用外部 ffmpeg（非绑定） | ✅ tokio 官方内置，生产广泛 | 低 | `std::process::Command` |
| opus-codec Opus 编码 | ✅ 成熟，Discord 生态大量使用，底层 libopus 1.3 | 低（static 需 cmake/C 工具链） | 系统 `libopus` 动态链接 |
| neteq 抖动缓冲 | ✅ 高质量第三方重实现（非谷歌官方），100% safe Rust；**场景需适配** | **中（本栈最大风险）** | 先用 `VecDeque` 固定环形队列 |
| UDS IPC（tokio::net） | ✅ tokio 官方内置 | 低 | 无（Windows 回退 TCP） |
| transmux webm 封装 | ✅ 功能完备第三方库，使用规模有限 | 中；**后置可选，第一版不用** | ffmpeg 直出 fragmented-webm 透传 |
| 辅助 crates（serde/bytes/thiserror/anyhow/tracing/signal-hook） | ✅ 生态标准库 | 无风险 | 无 |

**最大风险点说明**：`neteq` 是第三方干净重实现 WebRTC NetEQ 算法，**不是谷歌官方维护、非直接复制 libwebrtc 源码**；它原生面向"网络接收端乱序包→输出 PCM"，我们的用法是"本地有序帧喂入、利用缓冲水位与时间戳管理输出有序帧"，属于反向用法，需要适配、不能直接复制示例。公开的大规模生产案例有限。因此续篇明确建议：**阶段1 先绕开 neteq，用简单 `VecDeque` 把核心播放链路跑通，neteq 作为优化迭代项而非前置依赖；transmux 直接延后，第一版不碰。**

---

## 九、风险与回滚

| 风险 | 影响 | 缓解 |
|------|------|------|
| Windows 下 `opus-codec` 静态编译 libopus 失败（需 cmake + C 工具链） | 本机无法开发/运行 Rust Worker | 阶段2首验；失败则改用系统 `libopus` 动态链接，或本机仅做 Linux 容器开发 |
| Unix Socket 在 Windows 不稳 | 开发态 IPC 不通 | TCP `127.0.0.1` 回退，靠 lo 回环 |
| Opus 帧与 TS 端不兼容 | 听不到声音 | 阶段2用 A/B 比对 `@discordjs/opus` 输出，参数对齐后再接入 |
| neteq 适配踩坑 | 抖动缓冲不稳定 | 阶段1 已用 `VecDeque` 跑通，随时切回；neteq 非前置依赖 |
| Rust 开发调试周期长 | 进度慢 | 阶段拆分，每阶段可独立回滚；保留 `node-backend` 兜底 |
| 增加维护面（二进制/部署） | 运维复杂 | 二进制缺失自动回退 node；CI 预编译产物 |

**回滚保障**：`audioBackend` 开关 + `node-backend` 永久保留，任何阶段出问题一键切回。

---

## 十、验证方案（A/B 对比）

1. **单元级**：构造 PCM 样本，分别用 `@discordjs/opus` 与 Rust Worker 编码，比对输出字节（参数对齐）。
2. **集成级**：同一首歌，分别用 `node` / `rust` 后端播放，抓取 TS 客户端听感 + `dev_web.log` 中进度/报错。
3. **压力级**：队列连续播放 2 小时 + 模拟 Node 侧 GC/IO 阻塞（人为 `setInterval` 重活），对比爆音/underrun 次数（在 `BotInstance` 的 `frame` 路径加计数埋点）。
4. **故障级**：`kill -9` Worker 进程，验证 Node 自动重启 + 自动切歌 + 前端报错。

---

## 十一、结论

1. **Rust 重写音频管线技术上可行**，核心收益（进程隔离、稳定帧计时、多级缓冲、故障隔离）可拿到；与语言无关的那部分收益同样适用。
2. 相对原报告建议的 Go，**Rust 主要额外成本**在 Windows 开发态 IPC 回退、引入 Rust 构建链、以及更高开发调试门槛；但本机已具备 `cargo 1.98.0`，且接口边界清晰（仅 3 个事件），风险可控。
3. 库选型已据续篇修正：**只调用外部 ffmpeg 二进制**（禁进程内绑定）、**Opus 用 `opus-codec`**、**抖动缓冲先 `VecDeque` 再择机 `neteq`**、**transmux 延后**。整套栈多为成熟组件，最大风险点是 `neteq` 的场景适配。
4. **首要拦路点（已实测清除）**：Windows 下 `opus-codec` 编译捆绑 libopus 所需的 **cmake + MSVC 工具链** —— 本机实测：MSVC 用 VS BuildTools 18，cmake 用 VS 自带二进制（加入 PATH 即可），`cargo build` 成功并真实编码出 Opus 帧（详见 4.7）。
5. 必须保留 `IAudioBackend` + `node-backend` 回滚架构，灰度上线，避免一次性全量改造带来线上故障。
6. **性能提升主要来自架构与缓冲，而非编程语言**；ffmpeg 仍是 CPU 消耗大头，Rust 不能降低它。

---

## 附：可立即着手的下一步（待你确认后开工）

- [ ] **阶段2首验（纯验证，不改主仓库）**：在本机用 `cargo new` 起最小工程，只验证 `opus-codec` 能否在 Windows 编译出 libopus 并编码一帧（约半天，验证后即删或留在 `audio-worker/` 骨架）。
- [ ] **阶段1先行**：先实现 `IAudioBackend` 抽象（零 Rust，纯 TS 重构），为后续接入打基础，可独立合入 `main`。
- [ ] **决策**：本地编译 vs 预编译二进制发布策略（影响 setup/Docker 改动）。
- [ ] **确认 ffmpeg 二进制来源**：Worker 调用外部 `ffmpeg` 的具体路径策略（复用仓库现有 `ffmpeg-static` npm 包暴露的二进制，或系统 PATH 中的 ffmpeg）。
