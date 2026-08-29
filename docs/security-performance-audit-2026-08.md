# 安全与性能审计报告

- **审计日期**：2026-08-29
- **审计对象**：TSMusicBot（本 fork 当前 main，commit e3c66ad）
- **审计范围**：后端全部源码（`src/`，Express 5 / WS / SQLite / FFmpeg 管线 / 8 个音源 Provider / Spotify 子进程）、前端 `web/`（Vue 3 + Vite + PWA）、依赖清单与 CI 配置
- **方法**：静态代码审查（全部路由与中间件逐一过鉴权链）+ 关键路径人工复核 + `npm audit`（官方源）+ 管道阻塞行为实验验证。只读审计，未修改任何业务代码。
- **标注说明**：标 ✅ 的发现为审计后经二次人工复核确认（非仅凭模式匹配）。每条给出位置、证据、影响与修复方案。

---

## 一、总体结论

整体代码安全素质**高于同类自托管项目平均水平**：SQL 全程预编译、spawn 全部数组参数无 shell 注入、session token 哈希落盘、bcrypt cost 12、CSRF Origin 校验、前端零 v-html、凭证 write-only。无"远程匿名 RCE / SQL 注入"级别问题。

但存在 **1 个应当立即修复的网络暴露问题**、**1 个直接决定长歌能否播完的音频管线缺陷**，以及若干越权与资源滥用面。依赖侧有 1 个 critical（安装期）+ 一批可通过 `npm audit fix` 非破坏性修复的 high。

### 风险总览

| 级别 | 安全 | 性能 | 依赖/配置 |
|---|---|---|---|
| 严重/最高 | SEC-01 | PERF-01 | — |
| 高 | SEC-02 ~ SEC-04 | PERF-02 ~ PERF-03 | DEP-01 ~ DEP-02 |
| 中 | SEC-05 ~ SEC-08 | PERF-04 ~ PERF-06 | DEP-03 ~ DEP-05 |
| 低 | SEC-09 ~ SEC-12 | PERF-07 ~ PERF-10 | DEP-06 ~ DEP-08 |

---

## 二、安全问题

### SEC-01 ✅【严重】内嵌网易云音乐 API 服务绑定 0.0.0.0 且无任何鉴权

- **位置**：`src/music/api-server.ts:92`
- **证据**：
  ```ts
  const app = await serverObj.serveNcmApi({ port: options.neteasePort }); // 未传 host
  ```
  库内部（`NeteaseCloudMusicApi/server.js:294`）`host` 为空时 `listen(port)` → 监听**全部网卡**。对比同文件 QQ sidecar 显式绑定了回环地址（`api-server.ts:156` 的 `koaApp.listen(port, "127.0.0.1")`），两处不一致属于疏漏而非设计。
- **影响**：`netease` 默认启用、端口默认 3001。裸机/局域网部署时，**任何同网段主机无需凭证**即可使用这台 NCM API 代理的全部约 300 个端点，并可借用 `data/cookies/` 中机器人已登录的网易云 cookie 调用登录态接口（账号信息、二维码登录流程等）。Docker 部署不受影响（仅 EXPOSE 3000）。
- **修复**：一行改动
  ```ts
  const app = await serverObj.serveNcmApi({ port: options.neteasePort, host: "127.0.0.1" });
  ```
  仿照 `go-librespot.test.ts:146` 补一个"sidecar 必须绑 loopback"的回归测试。
- **验证方法**：启动后 `netstat -ano | findstr 3001`，确认监听地址为 `127.0.0.1:3001` 而非 `0.0.0.0:3001`；局域网另一台机器 `curl http://<ip>:3001` 应拒绝。

### SEC-02 ✅【高】yt-dlp SSRF：已登录用户（含 guest）可让服务器拉取任意 http(s) URL

- **位置**：`src/music/youtube.ts:185-188`；入口 `src/web/api/music.ts:280-289` 与 `src/bot/instance.ts:1744`
- **证据**：
  ```ts
  const url = /^https?:\/\//i.test(playlistId)
    ? playlistId  // 任意 http(s) URL 原样进入 yt-dlp
    : `https://www.youtube.com/playlist?list=${playlistId}`;
  ```
- **影响**：`GET /api/music/playlist/<URL编码任意地址>?platform=youtube` 无角色门槛、无限流；`!playlist -y <url>` 任何 TS 频道用户可触发。服务器向任意目标发请求（跟随重定向），并把目标页 title/uploader/thumbnail 回传——可对内网做主机/端口探测与标题级读回（云 metadata、内网管理页）。
- **修复**：yt-dlp 路径只接受 `youtube.com / youtu.be / music.youtube.com` 域名的 URL（解析后校验 hostname 白名单），其余一律按"非法歌单 ID"拒绝；同时给该路由挂现有 `rateLimit`。
- **验证方法**：`GET /api/music/playlist/http%3A%2F%2F192.168.1.1%2F?platform=youtube` 应回 400。

### SEC-03 ✅【高】`/api/saved-queues` 缺失 bot 级访问控制（越权读/操控任意 bot）

- **位置**：`src/web/api/saved-queues.ts:67-79,104-118`；挂载点 `src/web/server.ts:215-226` 仅 `requireNotGuest`
- **证据**：`POST /` 与 `POST /:id/load` 直接 `botManager.getBot(botId)` 后操作，未像 player 路由（`src/web/api/player.ts:27`）那样统一过 `requireBotAccess`。
- **影响**：被管理员限制只能访问 bot A 的 member 可以：① 把 bot B 的当前队列快照保存为清单（**读取 bot B 队列内容**，含请求者昵称）；② 把清单 load 进 bot B **立即触发播放**（未授权的播放控制）。
- **修复**：`saved-queues.ts` 内两处取 bot 后补调与 `requireBotAccess` 等价的校验（或路由级挂 `authorize({ capability: "player.queue" })` + bot 归属校验），与 player 路由对齐。
- **验证方法**：用受限 member 会话对未授权 botId 调 `POST /api/saved-queues`，应 403。

### SEC-04 ✅【高】WebSocket 广播不按 member 的 bot 授权范围过滤（信息泄露）

- **位置**：`src/web/server.ts:307-311`、`src/web/websocket.ts:33-37`
- **证据**：
  ```ts
  const botScope = result.role === "guest" ? ... : "all";   // member 一律 all
  // websocket.ts: 非 guest 永远 return true
  if (!w.isGuest || w.botScope === "all" || !w.botScope) return true;
  ```
- **影响**：`user_bot_access` 限制只作用于 HTTP。被限制到 bot A 的 member 通过 WS 持续收到**全部 bot** 的状态 + 完整队列广播，与 `GET /api/bot` 的过滤逻辑不一致。
- **修复**：upgrade 时对 member 也解析 `getUserBotScope(userId)` 得到 Set；`visibleToClient` 对非 guest 同样按 Set 过滤。
- **验证方法**：受限 member 连 WS 后观察 `init`/`stateChange` 消息中是否出现未授权 botId。

### SEC-05【中】`trustProxy: true` 时登录限流可被 X-Forwarded-For 伪造绕过

- **位置**：`src/web/server.ts:78-80,126-129`；`src/web/middleware/rateLimit.ts:41`（按 `req.ip` 精确键控）
- **影响**：`trust proxy` 为布尔 `true`（信任整条 XFF 链）时，`req.ip` 取自攻击者可控的最左值，每请求换一个伪造 IP 即获得全新令牌桶，`/api/session/login` 的 5 次/分钟防爆破形同虚设；伪造 `X-Forwarded-Proto: https` 还会影响 cookie `Secure` 标志。IPv6 未做前缀聚合，同类绕过。
- **修复**：文档化要求 `trustProxy` 只填可信代理的**具体网段/跳数**（如 `"loopback"` 或 `1`），并在 README 部署章节强调"端口不可直达时才开启"；login 限流改为 IP + 目标用户名双键（用户名维度锁爆破）。

### SEC-06【中】guest 默认权限含 `addToQueue` ⇒ 开启游客模式后可匿名滥用上传

- **位置**：`src/data/config.ts:201`（默认 `addToQueue: true`）、`src/web/api/music.ts:18,127-138`、`src/web/api/session.ts:161-179`
- **影响**：`POST /api/session/guest` 零凭证且无限流；`/local/upload` 用 `express.raw` 把**最大 500MB 请求体整体缓冲进内存**。匿名者可：反复提交大请求造成内存峰值；慢速上传长期占住全进程唯一的上传闸（429 拒绝所有人）；填满 5GiB 上传配额。
- **修复**：默认关闭 guest 的 `addToQueue`（改为显式开启）；上传路由对 guest 单独挂更严格的限流；中期改流式接收（见 PERF-04）。

### SEC-07【中】500 响应直接回显内部异常 message

- **位置**：全部路由的 `catch` 块，如 `src/web/api/bot.ts:341`、`src/web/api/music.ts:200,257`、`src/web/api/player.ts:83`
- **影响**：fs 错误回显绝对路径、上游主机名/端口、连接错误细节泄露给已认证调用者（部分路由 guest 可达）。
- **修复**：统一错误中间件：对外固定文案 + 记录 `err` 到日志（可带 requestId）；`music.ts:29-33` 已处理 body-parser 413，其余 parser 错误也应接管，避免默认 HTML 错误页泄露堆栈。

### SEC-08【中】WS 会话仅握手时校验一次，登出/改密后既有连接不断开

- **位置**：`src/web/server.ts:294-301`、`src/web/websocket.ts:47-66`
- **影响**：管理员重置某用户密码后，该用户已建立的 WS 仍在实时接收全部广播；被盗 cookie 在 HTTP 会话被吊销后 WS 仍存活。
- **修复**：`deleteAllForUser` / logout 时按 `w.userId` 关闭对应用户的 WS；或在心跳周期内定期（如 60s）复验会话有效性。

### SEC-09【低】安全响应头不全（无 helmet）

- **位置**：`src/web/server.ts:91-96`
- **现状**：仅有 `X-Frame-Options: DENY`、`CSP: frame-ancestors 'none'`、`X-Robots-Tag`。缺 `X-Content-Type-Options: nosniff`、`Referrer-Policy`（HTTP 头层面）、HSTS、完整 CSP。
- **修复**：自建部署引入 helmet 或手工补齐上述 4 个头，成本低收益稳。

### SEC-10【低】Spotify access token 经子进程 argv 传递

- **位置**：`src/music/spotify/rust-librespot.ts:201-205`（`"--access-token", token`，代码注释已自认 CWE-214）
- **影响**：同机其他用户可经 `ps`/`/proc/<pid>/cmdline` 读到约 1 小时有效期的 token。单用户自托管场景影响很小。
- **修复**：librespot 若支持则改环境变量或 stdin 传递；否则接受风险并保持注释。

### SEC-11【低】敏感/半敏感信息落盘与暴露

- 网易云二维码轮询 key 写入日志：`src/web/api/auth.ts:53,70`。
- `adminPassword` 遗留明文字段仍随 `config.json` 持久化（`src/data/config.ts:118,180`；现已不用于认证，属应清理的"僵尸凭据"，且 Windows 下 0600 权限位无效，见 DEP-06）。
- `/api/health`、`/api/config/public-url` 未鉴权，泄露版本号与 publicUrl：`src/web/server.ts:114-121`。
- **修复**：日志去掉 key；`loadConfig` 时迁移删除 `adminPassword` 字段；两个公开端点酌情收窄返回内容。

### SEC-12【低】登录失败无审计记录；`avatars.read()` 无路径包含检查

- `src/data/audit.ts` 的 action 枚举不含 login，爆破行为事后无法追责（`src/web/api/session.ts:143-159`）。
- `src/data/avatars.ts:31-38` 的 `read()` 直接 `join(dir, relPath)` 未校验解析结果仍在目录内。**当前不可利用**（relPath 仅来自 DB 且写入端生成 UUID 文件名），属纵深防御缺失，建议补 `resolve` 后前缀检查。

---

## 三、性能问题

### PERF-01 ✅【最高·直接影响核心功能】FFmpeg 的 stderr 管道无消费者——长歌播放数分钟后必然卡死/跳歌

- **位置**：`src/audio/player.ts:253`（`stdio: ["ignore", "pipe", "pipe"]`）；`buildFfmpegArgs`（`player.ts:76-112`）未加 `-nostats`/`-loglevel`
- **证据**：spawn 后**只有 stdout 挂了 `data` 监听**，stderr 无人读取。而 ffmpeg 默认每 ~0.5s 向 stderr 写一行 `size=... time=...` 进度统计（未关闭 stats）。OS 管道缓冲（Linux 64KB / Windows 更小）约在 **5-6 分钟**后写满 → ffmpeg 阻塞在 stderr 写入 → PCM 断流 → 触发 `player.ts:194-199` 的 stall 看门狗 → 曲目被误判提前切歌。审计中已在本机实验复现"子进程向无消费者 stderr 写满 8MB 即永久阻塞"。对比：Spotify 后端两处 ffmpeg 均消费了 stderr（`go-librespot.ts:145`、`rust-librespot.ts:177`）。
- **影响**：表现为"所有长于几分钟的歌播到中段卡住/自动跳歌"，是最可能被用户实际感知的问题。
- **修复**（三选一，改一行即可）：
  1. `stdio: ["ignore", "pipe", "ignore"]`（最简单）；
  2. `buildFfmpegArgs` 首部加 `"-nostats", "-loglevel", "error"`（顺带减少噪声）；
  3. 挂 `this.ffmpeg.stderr.on("data", () => {})` 并在错误诊断时收集尾部日志（推荐，排障时还能拿到 ffmpeg 报错）。
- **验证方法**：播放一首 ≥10 分钟曲目，观察是否完整播完；用 `handle` 工具确认 ffmpeg 无阻塞线程。

### PERF-02【高】FM 模式队列无界增长 + 每次切歌全量序列化（内存 / SQLite blob / CPU 三重放大）

- **位置**：`src/audio/queue.ts:225-298`（`next()` 只推进索引，从不移除已播条目）、`src/bot/instance.ts:1875-1888`（`refillFm` 每曲补入无上限）、`src/data/database.ts:839-849`（`saveQueueState` 无条数上限；对比 `saveQueue` 有 1000 上限）、`instance.ts:1988-2010`（每次 stateChange 全量 `JSON.stringify` 整个队列同步写 SQLite）
- **影响**：24/7 FM 场景约 400 首/天，一年队列约 15 万条：RAM 无界增长；数月后每次切歌 = 数 MB 同步序列化 + 写放大，阻塞事件循环；随机模式 `next()` 每次全量扫描 `playedIndices` O(n)。
- **修复**：FM 模式在 `next()` 后移除已播条目（或 `songs.length` 超 `MAX_QUEUE_SONGS` 时裁剪头部）；`saveQueueState` 与 `saveQueue` 同样 clamp 到上限。

### PERF-03【高】WebSocket `stateChange` 每次广播完整队列 JSON

- **位置**：`src/web/websocket.ts:98-105`
- **影响**：切歌/暂停/加歌/音量/占用变化（`instance.ts` 30+ 处 `emit("stateChange")`）都把整个队列（上限 1000 首，约 200KB+）序列化后发给每个客户端。与 PERF-02 复合后是 FM 长期运行的主要 CPU/带宽放大器。
- **修复**：`stateChange` 只带 `status + 当前曲目 + 队列长度 + 队列版本号`；队列内容变化单独推 `queueChange`（前端拉 `/queue` 或做增量）。前端 `useWebSocket` 已有请求队列的能力，配合改动小。

### PERF-04【中】本地上传整包缓冲内存 + `writeFileSync` 同步写盘，阻塞事件循环与音频帧循环

- **位置**：`src/music/local.ts:330`（`writeFileSync(filePath, input.buffer)`）、`src/web/api/music.ts:18,39-56`（`express.raw` 500mb）
- **影响**：500MB 先全量进内存，再同步写盘（慢盘数秒级阻塞）；播放中的音频 20ms 帧循环（`player.ts:630`）被冻结 → TS 侧声音卡顿。现有单上传闸只防并发，防不了阻塞本身。
- **修复**：`busboy`/`multer` 流式接收落盘；至少改 `fs.promises.writeFile` 并把上传闸改为 `runExclusive` 异步排队。

### PERF-05【中】头像/资料同步在播放闸串行锁内 await 网络操作（最坏 ~14s），且封面无去重

- **位置**：`src/bot/instance.ts:1274,1239`（`await syncProfileToSong(song)`）、锁 `instance.ts:2199-2203`、`src/bot/profile.ts:113-131,476-488`
- **影响**：头像下载（8s 超时）+ TS 文件上传（6s 超时）占住 `runExclusive` 播放闸，期间该 bot 所有 Web 播放/加歌/切歌请求全部排队；单曲/专辑循环下同一封面反复下载上传。
- **修复**：`syncProfileToSong` 改 fire-and-forget（不 await，失败仅记日志）；按 `coverUrl` 加小型 LRU 去重缓存。

### PERF-06【中】上游搜索/详情无结果缓存；Jellyfin 封面代理无服务器端缓存

- **位置**：`src/web/api/music.ts:176-233`（`/search` 直达上游；`/search/all` 一次并发打 6 个上游）；`src/music/jellyfin.ts:445-459` + `music.ts:523-544`
- **影响**：多人搜同一关键词重复打上游（网易/QQ 有账号风控风险）；首页每次缓存失效就回源 Jellyfin 拉 12+ 张全图。
- **修复**：加 30-60s TTL 的关键词级内存缓存（注意按 platform+keyword 键控、容量上限）；Jellyfin 封面加 `itemId → {data, contentType}` 的 LRU。另 `kugou.ts:732,931`、`qq.ts:319` 的串行翻页可并行化（有界收益）。

### PERF-07【中·前端】MiniPlayer 的 rAF 循环无条件 60fps 运行（暂停/无歌也不停）

- **位置**：`web/src/components/MiniPlayer.vue:195-204,317-323`
- **影响**：组件常驻移动端，每帧写 2 个 ref 触发重渲染，暂停时也持续耗电。桌面 `Player.vue:171-205` 已有正确门控（`isPlaying` 才续帧 + 页面隐藏降级 250ms interval），MiniPlayer 未同步。
- **修复**：照搬 Player.vue 的门控与 visibilitychange 逻辑。

### PERF-08【中·前端】批量入队是 N+1 串行请求（最多约 200 个）

- **位置**：`web/src/components/library/FavoritesPanel.vue:108-131`（100 首 × [POST add-song + GET queue]）；`web/src/stores/player.ts:570-580,365-384`
- **修复**：收藏页复用后端已有的整单接口 `POST /player/:id/playlist` 一次入列；`addSong` 循环内不做 `fetchQueue()`，结束后统一刷一次。

### PERF-09【低】其余后端卫生项

- `user_audit` 表无保留上限（`src/data/audit.ts`），建议仿照 `play_history` 的 10 万行裁剪；日志文件无轮转（`src/logger.ts:23-25`）。
- WS 心跳 `setInterval` 在 `stop()` 未显式清理（`src/web/server.ts:264-273`），仅影响热重启。
- PCM 缓冲 `Buffer.concat` 逐块整拷（`player.ts:267,398,474`），热路径 GC 压力，量级可控，可用环形缓冲优化（非紧急）。

### PERF-10【低·前端】其余卫生项

- `Library.vue:28-39,60-71` 两个歌单网格漏加 `content-visibility: auto`（项目其他 5 处列表均有）。
- `ServerTreeDrawer.vue:117-121` 抽屉打开期间每 5s 全量重建树且页面隐藏不暂停。
- `SettingsBehavior.vue:163-172` 防抖定时器卸载未清理；收藏操作双重全量刷新（`favorites.ts:36-63`）；`/api/music/providers` 四处重复拉取无共享缓存（`App.vue:121` 等）。
- 会话轮询（`auth.ts:43-53`，60s）不感知页面可见性，量小可接受。

---

## 四、依赖与配置（DEP）

### DEP-01【高·安装期】tar@6.2.1 critical（经 `@discordjs/opus → node-pre-gyp`）

- `npm audit`：1 critical / 10 high / 4 moderate（根）+ 7 high / 6 moderate（web）。tar 含任意文件覆盖（GHSA-34x7-hfp2-rc4v），但仅在 `npm install` 解压预编译产物时使用，**运行时不加载**。audit 给出的修复（降级 opus@0.2.1）不可行——0.10.0 已是最新。
- **处置**：lockfile 锁定不随意重装；可尝试 `overrides` 强制 `tar@^7.5.21`（需回归 `check-native`）；监控 opus 更新。项目已有 `allowScripts` 白名单是加分项。

### DEP-02【高】`NeteaseCloudMusicApi@4.32.0` 依赖链含 DoS 漏洞且上游已停更

- `music-metadata@7` / `file-type@16` 死循环 DoS（GHSA-v6c2-xwv6-8xf7 等），上游 Binaryify 已归档不会再修。攻击者可控性有限（需恶意音频元数据经网易 CDN 返回）。
- **处置**：接受风险并记录；或 `overrides` 强制 `music-metadata@^11`（API 有破坏性变更，需回归）。**长期应规划替换该停更依赖**——这是本项目最大的供应链风险点。

### DEP-03【高·web 侧】web 目录 axios@1.14.0（约 29 条公告）与 vite@6.4.1（dev server 文件读 + Windows fs.deny 绕过）

- **处置**（均非破坏性）：`npm --prefix web install axios@^1.20.0 vite@^6.4.3`；两端各跑一次 `npm audit fix`（注意需 `--registry=https://registry.npmjs.org`，npmmirror 镜像不支持 audit）连带修掉 postcss/nanoid/form-data/immutable/qs/basic-ftp 等一批传递依赖 high。

### DEP-04【中】bcryptjs@2.4.3 → 3.0.3

- 2.x 自 2017 年停更（无已知 CVE）。3.x 原生 ESM + 自带类型，hash/compare 兼容，升级后可删已废弃的 `@types/bcryptjs`。

### DEP-05【中】Web 主服务监听 0.0.0.0 且不可配

- `src/web/server.ts:330` `listen(port)` 无 host。有完整鉴权缓解，但全新安装（尚无账号）在公网直暴时存在鉴权真空窗口。
- **修复**：增加可选 `webHost` 配置（默认建议文档化引导），README 首次配置章节强调。

### DEP-06【低】Windows 下凭证文件 0600 无效

- `config.ts:481` 的 `mode: 0o600` 在 Windows 被忽略，`data/config.json`（含 spotify clientSecret、jellyfin 明文密码/apiKey）仅靠目录 ACL 保护。**处置**：README 补充"Windows 下收紧 `data/` 目录 ACL"提示；结合 SEC-11 清理 `adminPassword` 僵尸字段。

### DEP-07【低】CI 与历史：确认干净

- 两个 workflow 均无 `pull_request_target` 滥用、权限最小化；`.gitignore` 覆盖 `data/`；`git log --all --diff-filter=A -- 'data/*'` 为空，**历史上从未提交过凭证**。建议（轻微）：actions 改 SHA 固定版本；`scripts/download-binaries.mjs` 下载的外部二进制补哈希校验。

---

## 五、确认做得好的部分（避免误报，也是回归基线）

1. **SQL**：全程 prepared statements，无拼接；热路径语句启动时预编译；`play_history` 有索引 + LIMIT + 10 万行裁剪。
2. **命令执行**：所有子进程 `spawn/execFile` 数组参数、无 `shell:true`；播放 URL 有 scheme 白名单（拒绝 `file:`/`concat:`）；客户端传入 `song.url` 被服务端覆盖。
3. **会话体系**：token 仅存 SHA-256、7 天滑动 TTL、每用户 10 会话上限事务化、缺用户 DUMMY_HASH 等时比较防枚举、bcrypt cost 12；cookie `httpOnly + SameSite=Lax`。
4. **CSRF**：全局非 GET 强制 Origin/Referer 校验 + SameSite 双保险；前端 `<meta name="referrer">` 配合正确。
5. **WS 握手**：与 HTTP 同一套会话校验、Origin 校验、guest 随模式关闭即时失效、25s 心跳清理半开连接。
6. **前端**：全站 0 处 v-html、无 postMessage/window.open 面、凭证只走 cookie 不落 localStorage、SW 严格排除 `/api`/`/ws`、封面缓存仅白名单 CDN 域名、登录 redirect 校验站内路径。
7. **凭证读面**：所有平台密码/secret write-only（GET 只返回 `has*` 布尔）；Jellyfin `api_key` 全程同源代理不到达客户端；凭证文件原子写 + 尽力 0600。
8. **限流**：令牌桶实现内存有界（10 分钟驱逐 + unref）；login/setup/search/上传各有专闸。
9. **依赖版本**：核心运行时依赖（ws、better-sqlite3、express 5、根 axios）均为已修复版本；无 moment/lodash 类大件。

---

## 六、修复路线图（按投入产出比排序）

| 批次 | 项目 | 成本 | 收益 |
|---|---|---|---|
| **P0 立即** | SEC-01 netease sidecar 绑 127.0.0.1 + 回归测试 | 1 行 | 消除最大的未鉴权暴露面 |
| **P0 立即** | PERF-01 ffmpeg stderr（stdio 改法或 `-nostats`） | 1 行 | 长歌不再中途卡死/跳歌 |
| **P1 本周** | SEC-03 saved-queues 补 requireBotAccess；SEC-04 WS 按 member scope 过滤 | 各 ~20 行 | 修补越权读写与信息泄露 |
| **P1 本周** | SEC-02 yt-dlp 域名白名单 + 限流 | ~30 行 | 堵 SSRF 探测面 |
| **P1 本周** | DEP-03 web axios/vite 升级 + 两端 `npm audit fix` | 半小时 | 清掉一批 high |
| **P2 两周** | PERF-02 FM 队列裁剪 + 快照 clamp；PERF-03 WS 增量广播 | 各 ~50 行 | 24/7 运行稳定性 |
| **P2 两周** | SEC-06 guest 默认关 addToQueue；SEC-07 统一错误中间件；SEC-05 trustProxy 文档化 | 小 | 收敛滥用与信息泄露 |
| **P2 两周** | PERF-04 上传流式化；PERF-05 头像同步异步化；PERF-07 MiniPlayer 门控；PERF-08 批量入队走整单接口 | 中 | 明显的交互性能提升 |
| **P3 择机** | DEP-02 规划替换 NeteaseCloudMusicApi；DEP-04 bcryptjs 3.x；SEC-08/09/10/11/12；PERF-06/09/10；DEP-05/06 | 按项评估 | 纵深防御与长期维护性 |

> 每项修复建议按各条目所附"验证方法"补一条回归测试；SEC-01/SEC-03/PERF-01 三项建议加进 CI 用例。测试建议统一放 `vitest`（与现有 `*.test.ts` 同约定），提交信息用 `fix(security): …` / `fix(perf): …` 前缀。

---

## 七、修复实施记录（2026-08-29）

全部代码级发现已修复并通过 `npm test` + `npm run build`。逐项对应关系：

| 编号 | 处置 | 说明 |
|---|---|---|
| SEC-01 | ✅ 已修复 | `api-server.ts` 显式传 `host: "127.0.0.1"`；新增 loopback 绑定回归测试 |
| SEC-02 | ✅ 已修复 | `youtube.ts` 新增 `resolvePlaylistUrl` YouTube 域名白名单（抛 `UnsupportedPlaylistUrlError`）；`/music/playlist/:id` 挂 10-burst 限流；非法 URL 返回 400 |
| SEC-03 | ✅ 已修复 | 新增 `canAccessBot`，saved-queues 的 save/load 在存在性检查前校验 bot 范围；补 403 测试 |
| SEC-04 | ✅ 已修复 | WS upgrade 经 `resolvePermissionContext` 解析 member 的 bot 范围；`visibleToClient` 对非 guest 同样过滤；补 init/广播过滤测试 |
| SEC-05 | ✅ 已修复 | login 限流键改为 `ip + username` 双维；README 补 XFF 伪造风险与防火墙要求 |
| SEC-06 | ✅ 已修复 | guest 默认 `addToQueue: false`（显式配置不受影响）；`/api/session/guest` 挂 10/min 限流 |
| SEC-07 | ✅ 已修复 | 新增 `UserFacingError`（业务拒绝保留原文案）+ `respondError`（其余错误固定文案、原文进日志）；替换全部 54 处 500 回显 |
| SEC-08 | ✅ 已修复 | WS 握手记录 tokenHash；logout/改密/重置/删号经 `closeUserSessions` 以 4001 关闭对应 socket（支持 exceptTokenHash 豁免当前会话）；补测试 |
| SEC-09 | ✅ 已修复 | 补 `X-Content-Type-Options: nosniff`、`Referrer-Policy: same-origin`、TLS 下 HSTS |
| SEC-10 | ⚠ 接受 | librespot 需要 argv 传 token；单用户自托管场景影响小，代码注释保留 |
| SEC-11 | ✅ 已修复 | QR 轮询 key 不再写日志；`saveConfig` 不再持久化 adminPassword（历史明文下次保存自动清除）；`/api/health` 去掉版本号 |
| SEC-12 | ✅ 已修复 | 新增 `login.failed` 审计动作；avatars `read/remove` 补 resolve 包含检查 |
| PERF-01 | ✅ 已修复 | ffmpeg args 加 `-nostats -loglevel error`；两处 spawn 的 stderr 挂尾部缓冲消费，异常退出记录 stderr |
| PERF-02 | ✅ 已修复 | `PlayQueue.trimPlayed(maxKeep)`（复用 remove 的索引重排）；FM 补给后裁剪到 500；`saveQueueState` clamp 到 1000 并重定位 currentIndex；补测试 |
| PERF-03 | ✅ 已修复 | stateChange 携带队列精确签名，未变时省略 queue 并带 `queueUnchanged` 标志；前端保留本地队列不再重复拉取 |
| PERF-04 | ✅ 已修复（第一阶段） | 上传写盘改 `fs.promises.writeFile`，不再冻结事件循环/音频帧循环。`express.raw` 内存缓冲改为流式接收留作后续（需引入 multipart 流式解析，涉及前后端协议变更） |
| PERF-05 | ✅ 已修复 | `syncProfileToSong` 改 fire-and-forget（playGate 不再被 ~14s 的头像下载+上传阻塞）；profile 按缩略图 URL 去重，切歌不重复下载/上传同一封面 |
| PERF-06 | ✅ 已修复 | `TtlCache`：搜索结果 30s/200 条；Jellyfin 封面 10min/200 条 |
| PERF-07 | ✅ 已修复 | MiniPlayer 复用 Player 的门控：仅播放中续帧、页面隐藏降级 250ms 轮询 |
| PERF-08 | ✅ 已修复 | 新增 `addSongSilent`：收藏「全部加进队列」与 Jellyfin 流派批量入队不再每首拉队列+弹 toast（200 请求 → 100+1） |
| PERF-09 | ✅ 已修复 | `user_audit` 启动裁剪至 1 万行；WS 心跳 interval 在 stop() 清理；日志接入 pino-roll（50MB 滚动、保留 1 份） |
| PERF-10 | ✅ 已修复 | Library 网格 content-visibility；ServerTreeDrawer 后台暂停轮询；SettingsBehavior 防抖卸载清理；favorites 500ms 去重窗口；providers 改走 store 共享缓存（60s TTL）；会话轮询后台跳过 |
| DEP-01 | ✅ 已修复 | `overrides` 强制 `tar@^7.5.21`（实际安装 7.5.22）；删除 prebuild 后强制 `npm rebuild @discordjs/opus` 实测下载+解压+加载全通过 |
| DEP-02 | ⚠ 接受 | 见下方风险接受记录 |
| DEP-03 | ✅ 已修复 | web：axios ^1.20.0、vite ^6.4.3、audit fix 后 **0 漏洞**（顺带移除死依赖 node-vibrant/qrcode）；根目录：audit fix + tar override 后仅剩 DEP-02 链 |
| DEP-04 | ✅ 已修复 | bcryptjs ^3.0.3（原生 ESM + 自带类型，删除 @types/bcryptjs），hash/compare API 兼容 |
| DEP-05 | ✅ 已修复 | 新增 `webHost` 配置（默认 0.0.0.0 保持行为），`server.listen` 显式绑定并写日志 |
| DEP-06 | ✅ 已修复 | README 补 webHost 引导与 Windows data/ 目录 ACL 提示；adminPassword 文档同步 |
| DEP-07 | ✅ 已修复（建议范围） | actions/checkout、actions/setup-node 固定官方 tag SHA；docker/* 按审计建议保留 tag |

### 风险接受记录（DEP-02）

`NeteaseCloudMusicApi@4.32.0` 依赖链（music-metadata@7 → file-type@16）存在解析恶意音频元数据时的死循环 DoS（GHSA-v6c2-xwv6-8xf7 等）。上游 Binaryify/NeteaseCloudMusicApi 已归档，**不存在包含修复的发布版本**；audit 给出的修复路径（降级 3.47.5）会移除现有功能，不可行。

- **影响面**：需 bot 拿到经网易 CDN 下发的恶意构造音频元数据才可触发，攻击者可控性低；受影响的是 sidecar 进程（死循环 DoS），不涉及 RCE/数据泄露。
- **缓释**：sidecar 现已绑定 127.0.0.1（SEC-01），暴露面收敛到本机；进程卡死可通过重启恢复。
- **退出计划**：规划替换该停更依赖（自建网易 API 反代或社区维护 fork），替换前接受此风险并随 `npm audit` 定期复核。
