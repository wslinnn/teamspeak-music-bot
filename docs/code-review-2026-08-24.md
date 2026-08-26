# 全项目 Code Review（2026-08-24）

按《review 方案》（第一性原理：目的 → 信任边界 → 不变量 → 边界×不变量矩阵）执行。
范围：`src/`（后端 76 个非测试文件）+ `web/src/`（前端 68 个文件），逐路由核对授权矩阵、
逐数据访问核对归属、状态机穷举、注入面/密钥面广度扫描。每条发现附触发场景与 file:line 证据。

## 修复状态（2026-08-24 当日全部完成，1101/1101 测试通过）

| 项 | 状态 | Commit |
|----|------|--------|
| S1 Jellyfin 封面代理化 + 存量 URL 清洗 | ✅ 已修复 | 6da3906 |
| S2 profile 更新白名单 | ✅ 已修复 | d399f21 |
| S3 bot config 密码掩码（留空=不改） | ✅ 已修复 | d5959ec |
| S4 登录哑哈希时序等化 | ✅ 已修复 | bf3dc51 |
| S5 播放/yt-dlp/jellyfin URL scheme 白名单 | ✅ 已修复 | 343235e |
| S6 config.json/SQLite 0600 | ✅ 已修复 | 7851fbf |
| S7 change-password 软 Origin 校验 | ✅ 已修复 | bf3dc51 |
| S8 /settings 平台块按 platform.auth 过滤 | ✅ 已修复 | cb08fc2 |
| F1 playGate 锁下沉覆盖全部入口 | ✅ 已修复 | 089cc85 |
| F2 history limit 钳制 + guest 门 | ✅ 已修复 | 1742ad9 |
| F3 暂停态 seek 保持暂停 | ✅ 已修复 | 73b1ce1 |
| F4 集合/单曲 id 入参校验 | ✅ 已修复 | a8aa982 |
| P1 play_history 索引 + 10 万行保留 | ✅ 已修复 | 6ce0619 |
| P2 上传进程内串行化 | ✅ 已修复 | f4d829f |
| P3 前端（轮询门控/取色复用/防抖/上限/content-visibility） | ✅ 已修复 | 85bcea4 |
| P4 /search/all 按 IP 限流 | ✅ 已修复 | 56a1a9c |
| P5 SIGKILL 前置 exitCode 检查 | ✅ 已修复 | e4ad383 |

S5 中 TS6 查询的 `rejectUnauthorized:false`（管理员配置的受信主机）与 S6 中
rust-librespot token 走 argv（代码内已自注，需 sidecar 协议改造）维持原状，属
接受的设计取舍；其余低风险项全部落地。

---

**总体结论**：安全地基扎实（认证、授权矩阵、SQL 参数化、命令注入面、前端 XSS 面均干净）。
发现 1 个值得尽快修的凭据外泄（Jellyfin token 随 coverUrl 下发）、1 个并发不变量覆盖不全的
架构性问题（runExclusive 锁只护住一半入口）、2 个会随时间恶化的性能债（play_history 无索引
无保留、上传全内存缓冲）。其余为低风险与信息级。

## 分级索引

| # | 级别 | 维度 | 一句话 |
|---|------|------|--------|
| S1 | 风险·中 | 安全 | Jellyfin 凭据拼进 coverUrl，随搜索/队列下发给所有用户（含 guest） |
| F1 | 风险·中 | 功能 | “音频==currentIndex” 不变量只在 5 个 WebUI 路由加锁，聊天命令等入口裸奔 |
| P1 | 风险·中 | 性能 | play_history 无索引 + 无保留策略，GET /history 随数据量线性变慢 |
| S2 | 风险·低 | 安全 | PUT profile 把 req.body 原样 Object.assign（原型污染 + 任意字段） |
| P2 | 风险·低 | 性能/DoS | 本地上传 500MB 全内存缓冲，可被并发上传打爆 |
| S3 | 风险·低 | 安全 | GET bot/:id/config 原样返回频道/服务器密码（与密钥掩码策略不一致） |
| F2 | 风险·低 | 功能 | GET history 的 limit 无 clamp（?limit=-1 = 全表），且 guest 可读 |
| S4 | 低 | 安全 | 登录时序侧信道（用户不存在路径无 bcrypt） |
| S5 | 低 | 安全 | SSRF 面：yt-dlp/ffmpeg/jellyfin URL 无 scheme/内网校验；TLS 不验证 |
| F3 | 低 | 功能 | 暂停态 seek 会隐式恢复播放 |
| P3 | 低 | 性能 | 前端无界列表渲染、封面二次下载、3s 常驻轮询、WS 全队列广播 |
| P4 | 低 | 性能 | /search/all 无节流并发打 6 个上游 |
| S6-S8 | 信息 | 安全 | 密钥明文落盘；session 路由在 CSRF 检查之前；member 可读全局设置 |
| F4, P5 | 信息 | 功能/性能 | playlistId 未校验；SIGKILL PID 复用窗口 |

---

## 一、安全

### 做得好的（逐项核对过的正面结论）

- **认证**：会话 token 32 字节随机、SHA-256 落库（`sessions.ts:56-57`）；每用户 10 会话上限且
  count→delete→insert 包事务（`sessions.ts:60-69`）；登录/setup 分开限流 5/min、3/min
  （`server.ts:126-129`）；失败登录 250ms 固定延迟；改密后吊销其他会话。
- **授权矩阵**（全部 10 个 router 逐路由核对）：公开面仅 health/public-url/session；
  其余在 `csrfOriginCheck + requireAuth` 之后（`server.ts:135-136`）；users/audit 双
  requireAdmin；favorites/song-favorites/saved-queues 挂 requireNotGuest 且路由内再校验
  userId 归属；player 路由统一 `requireBotAccess` 且 403 先于 404 防 bot 枚举
  （`player.ts:20-25`）；guest 会话随 guestMode 关闭即时失效（HTTP + WS 双路）。
- **SQL**：全部 prepare 参数化。仅两处内部常量插值（`database.ts:217` 迁移列名、
  `database.ts:597` SHARED_QUEUE_OWNER），均非用户可控。
- **命令注入**：ffmpeg/yt-dlp/PowerShell 全部数组参数 spawn，无 shell:true；PowerShell 的
  下载 URL 走环境变量不进脚本（`player.ts:312-325`）。
- **前端 XSS**：68 个文件零 v-html/innerHTML/eval；会话走 httpOnly cookie，无 localStorage
  存 token；WS 仅同源 + 消息体 shape 校验；postMessage/_blank 面为零。
- **TS3 协议转义**：`escapeValue` 反斜杠优先，值全量转义（`commands.ts:19-25`）。
- **文件写入**：本地上传 UUID 命名 + ext 白名单 + basename 清洗（`local.ts:105-118, 317-330`）；
  头像 botId 为 randomUUID 生成（`manager.ts:137`）。

### S1（风险·中）Jellyfin 凭据随 coverUrl 外泄

- **现状**：`buildCoverUrl/buildStreamUrl/buildUniversalUrl` 把 `this.token`（apikey 模式下即
  管理员配置的 API key；userpass 模式下即 access token）拼进 URL（`jellyfin.ts:78-111`，
  调用点 `jellyfin.ts:365, 403, 406`）。该 coverUrl 进入每个 Song 对象，随搜索结果、
  歌单、队列广播（WS stateChange 携带全队列）下发给客户端。
- **触发场景**：jellyfin 启用 + 任意用户（**搜索端点无 authorize 门，guest 也可搜**，
  `music.ts:156-182`）→ `GET /api/music/search?platform=jellyfin&q=x` → 响应 coverUrl 里
  直接可见 `api_key=...`。
- **影响**：拿到即获得该 Jellyfin 账号的完整 API 访问权（自助音乐库通常还是内网地址）。
- **最小修复**：封面改走服务端代理路由（`GET /api/cover?platform=jellyfin&id=...`，
  校验会话后由后端携带 token 转发）；播放 URL 本就只进后端 ffmpeg，重点是 coverUrl 面。

### S2（风险·低）profile 更新无字段白名单（原型污染）

- **现状**：`PUT /api/player/:botId/profile` 把 `req.body` 原样传给
  `pm.updateConfig` → `Object.assign(this.config, partial)`（`player.ts:707-714`，
  `profile.ts:157-159`）。
- **触发场景**：body 带 `{"__proto__":{"x":1}, ...}`——JSON.parse 产生 own 属性，Object.assign
  的 [[Set]] 走 `__proto__` setter，替换运行时 config 对象的原型；任意垃圾字段同样注入。
  持久化层只写 6 个已知列所以落库面窄。
- **影响**：bot.manage 权限方可触发；主要后果是运行时对象状态被污染 + 接口回显任意字段。
- **最小修复**：照抄 bot.ts settings 的做法——只接受 6 个已知布尔字段。

### S3（风险·低）bot 配置接口返回明文密码

- **现状**：`GET /api/bot/:id/config` 只剥离 `ts6ApiKey/identity`，`channelPassword/
  serverPassword` 原样返回（`bot.ts:369`）。对比：settings 接口对 spotify secret、jellyfin
  password/apiKey 均执行“只写不读”掩码（`bot.ts:38-56`）——同一项目两套策略。
- **影响**：被授予 bot.manage 的 member 可读出 TS 服务器/频道密码（前端编辑表单确实要用，
  但可用“留空=不改”语义替代回显）。
- **最小修复**：与掩码策略对齐——密码字段只返回 `hasPassword: true`，编辑留空不覆盖。

### S4（低）登录时序侧信道

- **现状**：用户不存在时跳过 bcrypt，只做 250ms 延迟（`session.ts:126-130`）；用户存在时
  bcrypt(12) + 250ms，时延差可用于枚举用户名。已有 5/min 限流大幅缓解。
- **最小修复**：不存在用户时对固定哑哈希跑一次 compare。

### S5（低）SSRF 面（自托管取舍，公网部署需知悉）

- yt-dlp 接受用户提供的任意 http(s) URL（`youtube.ts:183-187`，入口 `music.ts:260`、
  `player.ts:345`）；ffmpeg `-i` 不限 scheme（`player.ts:106`）；jellyfin serverUrl 仅
  trim 无 scheme 校验（`bot.ts:209-211`）；TS6 查询 `rejectUnauthorized:false`
  （`http-query.ts:116`）。
- **影响**：能点歌的用户可让服务器向内网地址发起请求/拉流。LAN 部署影响有限；公网部署
  应在网络层限制出网目标。

### S6-S8（信息）

- **S6 密钥明文落盘**：config.json（spotify secret、jellyfin 密码/key、bot 服务器/频道密码、
  identity）与 SQLite `bot_instances` 列；cookies.json 明文但 0600。自托管常规取舍；
  建议至少把 config.json/data 目录权限收紧到 0600/0700。rust-librespot token 走 argv
  （代码内已自注）；go-librespot 首登 OAuth URL 以 info 级打进日志
  （`go-librespot.ts:170-172`）。
- **S7 session 路由位于 CSRF 检查之前**（`server.ts:131` 先于 `:135`）——login/logout/
  change-password 无 origin 校验；但请求体必须 application/json（HTML form 发不出），
  实际可利用性≈0。audit 级别记录。
- **S8 member 可读全局设置**：`GET /api/bot/settings` 仅 requireNotGuest
  （`bot.ts:70`），任何 member 可读 jellyfin 内网地址/用户名、guestMode 等（无密钥）。
  前端按 capability 藏页签，后端放宽了一档。

---

## 二、功能正确性（状态机/并发/持久化）

### 做得好的

- **队列状态机**：currentIndex ∈ [-1, n-1] 在 add/addNext/remove/reorder/play/playAt/
  restore 全路径成立（remove 对 `index ≤ currentIndex` 的两分支语义正确；reorder 三情形
  重映射正确；restore 越界降级 -1）。
- **AudioPlayer**：sessionId 栅栏彻底（数据/exit/error/帧循环回调全带校验，`player.ts:263,
  279, 285, 614`）；背压高/低水位；停播看门狗区分近尾/远尾；外部 PCM 流 detach 不 destroy。
- **快照↔恢复往返对称**：wasPlaying 语义在写侧（`instance.ts:1855`）与读侧
  （`instance.ts:1897`）一致；disconnect 前取消挂起快照防止空队列覆盖。
- **playNext** 的 isAdvancing 在 finally 复位；resolveAndPlay 网络往返后复查 connected。

### F1（风险·中）playGate 锁只覆盖一半入口

- **不变量**（代码自己声明的，`player.ts:292-294`）：“并发请求不能在队列变更与起播之间
  交错（ audible track 必须等于 queue.currentIndex）”。
- **现状**：`runExclusive` 仅在 player.ts 5 个路由调用（play-at/play-song/play-next-song/
  play-now-song/add-song，grep 全仓库证实）。**锁外**的同类序列：
  - 聊天命令：`cmdPlay → playSingleSong`（`instance.ts:1215-1222, 1237-1270`）、`cmdAdd`、
    `cmdPlayNext`、`cmdPlaylist`、`cmdAlbum`、`startFm`（WebUI 的 `POST /play`、`/add`、
    `/fm` 路由同样经 executeCommand 走这些锁外方法）；
  - WebUI 路由：`play-playlist`/`play-album`（`player.ts:342-512` 直接 stop/clear/add/
    playAt/resolveAndPlay）、`add-by-id`（`player.ts:665-698`）；
  - `loadSavedQueue`（`instance.ts:1279-1307`）、`restoreQueueFromSnapshot`
    （`instance.ts:1874`）。
- **触发场景**：A=WebUI `/play-song`（锁内）在 `resolveAndPlay` 的数秒网络窗口内，
  B=聊天 `!play`（锁外）执行 stop+clear+add+play 并也进入 resolveAndPlay → A 在
  await 之后读的 `this.queue.current()`（`instance.ts:1264`）已是 B 的歌：同一首被双重
  resolve/起播，或可听轨道与高亮错位。低概率但真实存在，且代码注释表明作者已知该类
  竞态（专门为它建了锁）。
- **最小修复**：把锁下沉到 BotInstance 内部——executeCommand 的 AUDIO 命令集合整体、
  play-playlist/play-album/add-by-id 逻辑、loadSavedQueue、restore 包进 runExclusive
  （注意 runExclusive 是 Promise 链式互斥，可重入问题需检查：锁内再调 executeCommand
  会死锁，下沉时用内部无锁版本）。

### F2（风险·低）history 接口 limit 无 clamp 且 guest 可读

- `player.ts:726` `parseInt(req.query.limit) || 50`：`?limit=-1` → SQLite `LIMIT -1` =
  全表返回；`?limit=99999999` 同理。且该路由无 authorize 门，guest 可读（含 requestedBy
  用户名）。对比 audit.ts:14-18 有标准 clampInt。
- **最小修复**：clamp 到 [1, 500]；如认为历史含用户名属内部信息，补 `requireNotGuest`。

### F3（低）暂停态 seek 隐式恢复播放

- `player.ts:829-837` seek → play() → state="playing"；路由 `player.ts:210` 不检查 paused。
  暂停中拖进度条 → 歌曲开始出声。与“pause 是用户意图”模型冲突（自动暂停路径专门区分了
  autoPaused 与用户暂停）。语义选择，建议 seek 保持 paused（play 后立即 pause，或 UI 禁用）。

### F4（信息）

- `POST /:botId/playlist` 不校验 playlistId 存在（`player.ts:325-338`），undefined 变成
  字符串 "undefined" 去搜索；`parseCommand(...)!` 非空断言可能 NPE → 500。
- `POST /api/bot/settings` 先改内存后 saveConfig（`bot.ts:253`），save 抛错时内存与磁盘
  不一致（下次重启回滚）。

---

## 三、性能

### P1（风险·中）play_history 无索引 + 无保留

- **现状**：每首歌 INSERT 一行，全仓库无 `DELETE FROM play_history`（无保留策略）；
  DDL 无 (botId) 索引（`database.ts:280-292`，索引清单里只有 sessions/audit/favorites/
  bot_access/saved_queues）。查询 `WHERE botId=? ORDER BY id DESC LIMIT ?`
  （`database.ts:460-462`）全表扫描。
- **量化**：24/7 FM ≈ 480 行/天/-bot ≈ 17.5 万行/年；GET /history 是前端页面加载+
  Library 最近在播的常规调用，延迟随行数线性上涨，最终拖慢事件循环（同步 SQLite）。
- **最小修复**：`CREATE INDEX idx_play_history_botId ON play_history(botId, id DESC)` +
  保留上限（如启动时 `DELETE WHERE id NOT IN (最近 N 行 per bot)`，N=5 万）。

### P2（风险·低）上传 500MB 全内存

- `express.raw` 整体缓冲（`music.ts:17, 37-58`），guest（若开 addToQueue）与 member 可
  并发上传 → 内存峰值 = 并发数 × 文件大小；磁盘侧无配额，仅“队列被替换/播完”时清理。
- **最小修复**：改 multer/busboy 磁盘流式，或 cap 降到 100MB + 每用户并发 1。

### P3（低）前端

- 无界渲染：Favorites/Playlist/Queue 全量、Search “加载更多”无上限、History 1000 行无
  虚拟化（无虚拟化依赖）。History/Favorites 过滤每键全量扫描无防抖。
- `CoverArt.vue:61-103` 对每个封面额外 new Image() 二次下载 + canvas 取色 → 封面请求×2。
- `App.vue:45` 每 3s GET elapsed **不看播放态**（暂停/空闲也轮询，仅 tab 隐藏时暂停）；
  `player.ts:399-412` 每次写 5+ 响应式字段。
- WS `stateChange` 广播携带整队列 JSON 给所有客户端（`websocket.ts:98-105`）——大队列×
  多客户端时每次切歌 N 份全量序列化。

### P4（低）搜索无节流

- `/search/all` 一次并发打 6 个上游（`music.ts:202-209`），搜索端点无 rate limit——
  被刷可能触发上游对服务器 IP 封禁。建议对 search 端点加轻量限流。

### P5（信息）

- `forceCleanup` 1.5s 后按原始 pid SIGKILL（`player.ts:582-590`）——进程已退出且 OS 复用
  该 PID 的窗口内可能误杀无关进程。低概率；可改为只依赖 exit 事件 + proc.kill 兜底。

---

## 四、建议处理顺序

1. **S1**（Jellyfin token 外泄——唯一涉及凭据泄露的项，guest 可达）
2. **P1**（history 索引 + 保留——两行 DDL + 一个清理函数，性价比最高）
3. **F1**（playGate 下沉——结构性，趁改动面可控早做）
4. **F2 + S2 + S3**（三个小补丁：clamp、白名单、密码掩码）
5. **P2/P3/P4**（按部署形态取舍：公网部署优先 P2）
6. S4/S5/S6/F3/P5 按需

## 审查方法附注

- 路由×中间件矩阵：以 `server.ts` 挂载顺序为准逐 router 核对（含 WS upgrade 路径）。
- 注入面：两路交叉（人工逐文件 + 全仓库 sink 扫描），SQL/spawn/fs/URL/日志五类 sink 均有
  负结果确认。
- 状态机：player 三态、queue currentIndex、ChannelView occupancy、连接态逐转移核对。
- 未覆盖：E2E 运行时验证（本次为静态审查 + 既有 1083 测试作为回归基线）；spotify
  sidecar/go-librespot 二进制内部不在范围。
