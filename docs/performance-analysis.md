# 性能分析与 PWA / WASM 适用性报告

> 基于 main（f796c7e，上游 v1.13.1 + fork 资产）源码审查 + 微基准实测
> 日期：2026-08-24

## 结论速览

| 领域 | 结论 |
|------|------|
| 后端音频管线 | **健康**：重活全在 native（ffmpeg 解码 / @discordjs/opus 编码），JS 只做编排；帧调度有漂移补偿，PCM 有背压 |
| 后端唯一热循环 | `applyVolume` 逐样本 JS 循环，实测 **0.09% 核/bot**——不构成瓶颈，Int16Array 改写可 3.8x（顺手优化） |
| WS 广播 | 事件驱动、序列化每事件一次，无问题；watch item：stateChange 携带完整队列 |
| 前端 | 进度同步设计良好（3s 校准 + 本地插值 + 不可见自动停）；History 无上限是唯一隐患 |
| **PWA** | **适用且当前是回归状态**：接管 web/ 时丢失了上游 v1.12.0 的图标与 manifest，应立即恢复；Service Worker 有真实收益（冷启动 + 封面缓存） |
| **WASM** | **无正当场景**：全项目没有"JS 慢 10-100x 且占 CPU 可观"的计算循环（见第四节逐项分析） |

---

## 一、后端分析

### 1.1 音频管线（核心热路径）

数据流：`ffmpeg 解码(native) → PCM 缓冲 → applyVolume(JS) → @discordjs/opus 编码(native) → 20ms 帧发送`。

逐项审查结果：

| 环节 | 现状 | 评价 |
|------|------|------|
| 帧调度 | `nextFrameTime += 20` 绝对时间漂移补偿（player.ts `scheduleNextFrame`） | ✅ 正确，长期速率不漂移；Windows 定时器抖动由 TS 端 jitter buffer 吸收 |
| PCM 缓冲 | 高/低水位 640KB/256KB + stdout pause/resume 背压 | ✅ 有界，无 O(n²) 累积 |
| underrun | 外部模式发静音帧保持 20ms 时间线连续 | ✅ |
| 音量 | JS 逐样本（见 1.2） | ⚠️ 可优化但非瓶颈 |
| 编码 | `@discordjs/opus`（native 模块，48kHz 立体声） | ✅ |
| 卡死检测 | 远离结尾的看门狗 + 健康帧计数 | ✅ |

### 1.2 唯一热循环：applyVolume（微基准实测）

现状对 3840 字节帧（20ms 立体声）逐样本调用 `Buffer.readInt16LE/writeInt16LE`（每次都是 V8→C++ 边界）。实测（本机）：

| 实现 | 每帧耗时 | 每秒音频 CPU 占用 | 每 bot 每小时总 CPU |
|------|---------|------------------|--------------------|
| Buffer 逐样本（现状） | 0.0179 ms | 0.90 ms（**0.09% 核**） | 3.2 s |
| Int16Array 视图 | 0.0047 ms | 0.23 ms（0.02% 核） | 0.84 s |

结论：**不是瓶颈**（10 个 bot 同时播也只占 ~1% 核），但 Int16Array 改写是 3.8x 的免费午餐、改动 10 行——建议顺手做，不紧急。注意 ducking 渐变路径同样受益。

### 1.3 WebSocket 广播

- `JSON.stringify` 每事件仅一次，再发给所有客户端 ✅
- `stateChange` 全部 23 处触发点都是事件驱动（命令/连接/切歌），**无周期 ticker** ✅
- ⚠️ watch item：`stateChange` 载荷携带**完整队列**。当前规模（几十首）无感；若出现千首队列 × 多客户端，单事件 ~200KB JSON。届时再改（队列仅在增删时推送、seek/pause 只推 status）

### 1.4 进程模型与内存

网易云 API（NeteaseCloudMusicApi）与 QQ API（Koa）都以 **in-process** 方式跑在 bot 主进程内。影响：

- RSS 估计 120–200MB（Node 基线 + 两套 API）——内存而非 CPU 问题
- 任一内嵌 API 未捕获异常会带崩整个 bot 进程（建议项：`process.on('uncaughtException')` 已有与否值得核对；更彻底的隔离是子进程化，收益/成本比一般，暂不动）

### 1.5 其他

- better-sqlite3 同步调用均在低频路径（历史写入/配置保存），无阻塞风险
- pino 日志事件级，无每帧日志
- 定时器清理、bot 实例生命周期均有互斥保护（上游补齐）

---

## 二、前端分析

| 项 | 现状 | 评价 |
|----|------|------|
| 进度同步 | 可见时 3s HTTP 校准 + 本地插值，`visibilitychange` 隐藏即停（App.vue） | ✅ 设计良好；WS 推送 elapsed 的收益趋零 |
| RAF/动画 | fork 时期已专项优化（004111c 防布局抖动） | ✅ |
| 封面 | `loading="lazy"` | ✅ |
| 搜索结果 | ~80 条全量 v-for | ✅ 可接受 |
| 队列 | 全量 v-for，几十条常态 | ✅ 可接受 |
| **播放历史** | 后端默认只返回最近 50 条（勘误：并非无上限渲染），真正的问题是无法查看更早记录 | ✅ 已改为「加载更多」（每次 +100，渲染上限 1000） |
| 包体积 | index 444KB（gzip 161KB） | ℹ️ Tailwind+组件库+Pinia 全家桶单 chunk；`manualChunks` 拆 vendor 可省冷启动 ~50%，低优先级 |

---

## 三、PWA：适用，且当前是回归状态（建议立即修复）

### 3.1 现状问题

收敛接管 `web/` 时，把上游 v1.12.0 新增的 `web/public/`（favicon.ico/svg、icon-192/512、maskable、apple-touch-icon、site.webmanifest）**一并删掉了**，且我们的 `index.html` 无任何引用。后果：浏览器标签无图标、手机"添加到主屏幕"体验降级。这是收敛的意外回归（差异清单 F7 在旧路线标记了执行、restack 路线漏掉了）。

### 3.2 修复方案（P0，半小时）

1. `git checkout upstream/main -- web/public/` 恢复资产
2. `index.html` 补 `<link rel="icon">` ×2 + `apple-touch-icon` + `<link rel="manifest" href="/site.webmanifest">`
3. `.gitattributes` 把 `web/public/**` 从 `merge=ours` 中排除（或单独 allow），否则未来上游更新图标会静默保留旧版

### 3.3 进阶：Service Worker（P2，可选但收益真实）

本项目形态（局域网 WebUI + WebSocket 实时态 + 移动端重度使用）适合的 PWA 子集：

| 能力 | 价值 | 做法 |
|------|------|------|
| 安装到主屏 | manifest 即得（3.2 完成后自动获得） | — |
| **静态资源 precache** | 冷启动提速：Vite 产物带内容指纹，天然适合 workbox `precache`（~几十个 hashed assets） | `vite-plugin-pwa` 的 `registerType: 'autoUpdate'` |
| **封面 runtime cache** | 二次浏览零 CDN 请求：专辑封面是稳定 URL，`staleWhileRevalidate` + 容量上限 | workbox runtimeCaching 规则 1 条 |
| 离线模式 | **无意义，不做**：所有数据（搜索/队列/歌词）都在服务端，离线只有空壳 | — |

注意：SW 缓存了 `index.html` 后，发版更新依赖 autoUpdate + 用户下次访问；对本项目（自用/小团队）无风险。

---

## 四、WASM：逐候选分析，结论是"无正当场景"

第一性原理：WASM 的适用条件是"该循环 JS 比 native 慢 10-100x **且**占 CPU 可观"。逐项检验：

| 候选 | 检验结果 |
|------|---------|
| 音量缩放（唯一热循环） | 实测 0.09% 核；Int16Array 已拿到 3.8x（到 0.02% 核）；WASM 再 2-3x 的绝对收益是 **0.005% 核**——为万分之一核引入 wasm 工具链（构建/调试/跨平台 .wasm 产物）完全不值 |
| 音频解码/编码 | 已是 native（ffmpeg 子进程 + @discordjs/opus native 模块）；换 wasm 版只会更慢 |
| KRC 歌词解码 / 网易云 AES 加密 | 用 Node 内置 zlib/crypto（native 绑定），且都是低频操作（切歌/登录时一次） |
| 歌词滚动/拖拽/频谱 | DOM/CSS 级操作，瓶颈不在计算 |
| 搜索结果变换、LRC 解析 | 每次几毫秒级，用户无感 |

**建议：不做 WASM。** 这个项目的性能架构（计算下沉 native、JS 只做编排）已经是正确形态。若未来出现真实需求（如本地音频文件的前端波形渲染、客户端实时可视化频谱），届时再评估——那时才存在 10-100x 差距的场景。

---

## 五、行动建议（按优先级）

| 优先级 | 事项 | 成本 | 预期收益 |
|--------|------|------|---------|
| **P0** | ✅ 已完成（a995c33）：恢复 web/public 图标 + manifest + index.html 引用 | 0.5h | favicon/主屏图标恢复 |
| P1 | ✅ 已完成（ac3586b）：History 加载更多（+100/次，上限 1000） | 1h | 可查看完整历史且移动端不卡 |
| P1 | ✅ 已完成（de2bf56）：applyVolume 改 Int16Array（含 Buffer 回退） | 1h | 热循环 ~4x |
| P2 | ✅ 已完成（b64e825）：vite-plugin-pwa precache + 封面/字体缓存 | 0.5 天 | 冷启动提速、二次浏览封面零请求 |
| P2 | ✅ 已完成：Vite manualChunks 拆 vue/http vendor | 0.5h | index 444→257KB（gzip 161→88KB），vendor 跨发版缓存 |
| Watch | stateChange 队列载荷瘦身 | — | 千首队列/多客户端场景出现时再做 |
| 不做 | WASM | — | 无正当场景 |
| 不做 | 离线模式 | — | 与产品形态矛盾 |
