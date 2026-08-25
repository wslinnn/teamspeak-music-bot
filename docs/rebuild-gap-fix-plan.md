# 重建断差修复方案（bug × 3 + 休眠功能 × 11 + 死代码处置）

> ✅ **状态：P0+P1 已全部实施**（2026-08-25：B1 `32cf140`、B3 `20d08fc`、
> B2+D4 `e077ff6`、D0 `e758538`、D1 `31c9b3a`、D11a/b `64517ea`；全量 1049/1049。
> P2/P3 未动。本文是第二批；第一批 8 项见 `docs/dormant-features-ui-plans.md`，
> 已完成并抽查核实。）

> **背景**：当前 main 是"上游基座 + 选择性重放 fork 提交"重建的，前端经
> `db85626` 以内容移植（不带历史）方式接管。该模式产生三类断差：
> ① 字段瘦身型回归（接口 200 OK 但响应字段丢失，如已修复的
> `/elapsed` 4 字段、`play_history.duration`，见 `40e0863`/`8de32d5`）；
> ② 后端能力齐备但前端无入口（休眠功能）；
> ③ 前后端约定从未对齐（如 WS 关闭码）；
> ④ **接管丢失**：上游前端有、fork 接管版前端没有的 UI（如上游
> Settings 的"Jellyfin 音乐库"卡片——config.ts:156 注释仍引用它）。
> 本文档整理剩余全部已知断差并给出修复方案。

## 契约速查（已逐条核实，2026-08-25 main）

| 端点 | 契约 | 证据 |
|------|------|------|
| `GET/POST /api/bot/settings` | GET 返回 commandPrefix/idleTimeout/autoPause/voiceDucking/localAudio/savedQueues/playKeepsQueue/adminGroups/guestMode/**enabledProviders**/**defaultPlatform**/**spotify(masked)**/**jellyfin(masked)**；POST 全部支持写入（spotify/jellyfin 部分合并校验、enabledProviders 全量替换、defaultPlatform 带失效联动清洗） | bot.ts:68-88、104-260 |
| `GET /api/music/providers` | `{ enabled: string[] }`，按 config 过滤（local 看 localAudioEnabled、spotify 看 spotify.enabled，其余看 enabledProviders） | music.ts:388-404、config.ts:79-83 |
| `getStatus()`（WS stateChange / status 类响应的来源） | 含 `effectiveDuration`（试听曲为 trialDuration，否则完整 duration） | instance.ts:2019、instance.ts:1097 |
| `GET /api/player/:id/elapsed` | `{ elapsed, playing, paused, volume, playMode }`（`40e0863` 补全） | player.ts:192-203 |
| `POST /api/player/:id/play-next-song` | `{ song }`（需 id+platform）；插到当前曲后，空闲则直接播；guestFlag `playNext` | player.ts:540-585 |
| `POST /api/player/:id/play-now-song` | `{ song }`；插入后立即切播；guestFlag `playNow` | player.ts:588-620 |
| `POST /api/player/:id/fm` | `{ platform }` → `{ ok, message }`；guestFlag `playMode` | player.ts:119-143 |
| `POST /api/session/change-password` | `{ oldPassword, newPassword }`（新密码 ≥8 位）；成功后注销该用户的其他会话；审计留痕 | session.ts:186-215 |
| `GET /api/audit?limit=&offset=` | `{ entries }`（limit 1-500 默认 100） | audit.ts:6-11 |
| `GET/PUT /api/users/:id/permissions` | 按用户的细粒度能力/bot 白名单 | users.ts:173/186 |
| Jellyfin 组 | `/api/music/jellyfin/latest-albums|most-played|favorites|genres|genre/:id/songs` | music.ts:431-481 |
| Spotify 组（条件挂载） | `/api/spotify/login|callback|status` + `GET /api/config/public-url`（回调地址） | spotify.ts:36/50/68、server.ts:118 |
| `/api/auth` 扩展 | `jellyfin/test`、`sms/send`、`sms/verify` | auth.ts:95/130/150 |

---

## 一、Bug 修复（按优先级）

### B1 试听曲目进度/总时长错位 —— effectiveDuration 前端整体丢弃【P0】

**症状**：VIP 试听曲的进度条按完整曲长渲染——走不完就自动切歌；总时长显示完整曲长而非试听长度。

**根因**：后端 `getStatus()` 已返回 `effectiveDuration`（试听取 `trialDuration`），但前端 `BotStatus` 接口没有该字段、`web/src` 全局零引用；进度条与总时长全部使用 `currentSong.duration`（web/src/stores/player.ts:92-95、web/src/components/Player.vue:153-156、:65）。与已修复的 `/elapsed`、history duration 属同一"字段瘦身"模式。

**修复方案**（零后端改动，纯前端 + 一个响应字段）：
1. `web/src/stores/player.ts`：`BotStatus` 接口加 `effectiveDuration?: number`；`syncElapsed` 与 `updateBotStatus` 顺带保存。
2. `src/web/api/player.ts` `/elapsed` 响应补 `effectiveDuration`（一行）。
3. `Player.vue`：进度条分母与总时长显示改用 `effectiveDuration ?? currentSong.duration`；`updateProgress` 的 maxDuration 同理。
4. 顺带（可选）：前端 `fetchQueue` 已收到 `{queue, status}` 却只读 `.queue`——把 status 也并入 `updateBotStatus`，减少一次状态请求。

**非破坏**：可选字段 + `??` 回退，无 effectiveDuration 时行为与现状一致。
**测试建议**：后端补一条 `/elapsed` 响应字段断言；前端手工验收（播放一首 VIP 试听曲：总时长=试听长、进度条能走满）。
**工作量**：0.5 天。

### B2 搜索页音源标签硬编码 —— 不消费 /api/music/providers【P1】

**症状**：platformTabs 硬编码 5 项（web/src/views/Search.vue:222-228），与后端实际启用的音源脱节：禁用某音源后标签仍在（点击报 400"音源未启用"）；已启用但没写进硬编码列表的音源（kugou/jellyfin/local/spotify）没有搜索入口。

**勘误**：早前对账报告称"Yououtube 点击静默回落网易云"——经复核 `getProvider`（music.ts:80-88）**有** youtube 分支，实际行为由 `enabledProviders` 门控：未启用时 resolveProvider 返回 400（music.ts:98-105），是显式报错而非静默回落。

**修复方案**：
1. `Search.vue` 挂载时 `GET /api/music/providers` → `enabled`；`platformTabs` 改 computed："全部" + enabled 过滤后的标签（label 映射表：netease=网易云、qq=QQ、bilibili=B站、youtube=YouTube、kugou=酷狗、jellyfin=Jellyfin、local=本地、spotify=Spotify）。
2. 当前激活平台被禁用时（运行中配置变化）回退到"全部"。

**非破坏**：默认 config 下 enabled 与现有 5 标签一致（netease/qq/bilibili/youtube 通常在默认 enabledProviders 中），外观不变。
**测试建议**：修改 enabledProviders 后刷新搜索页，标签随动。
**工作量**：0.5 天。

### B3 WS 会话过期假死 —— 4001 关闭码前后端从未对齐【P0】

**症状**：登录会话过期后，前端 WS 进入最长 10 轮指数退避重连（期间页面数据停更"假死"），同时 HTTP 侧 401 会跳转 /login——两者并存打架；用户看到"连接失败，已达最大重试次数"而非"请重新登录"。

**根因**：前端 `useWebSocket.ts:150` 专门等待 close code `4001`（收到即提示重新登录并停止重连），但后端在 upgrade 阶段对无效会话直接写 `HTTP/1.1 401` + destroy（server.ts:271-282 两处：会话无效、游客模式已关）——浏览器对握手失败只给 `1006`；游客模式关闭的运行时踢出用的是 `1008`（websocket.ts:187）。**4001 从未被任何一端发出过。**

**修复方案**（后端一处改动，前端现有处理器直接生效）：
1. `server.ts` upgrade 的两个认证失败分支改为：完成 WS 握手后立即 `ws.close(4001, "session expired"/"guest mode disabled")`，替代裸 HTTP 401 + destroy。实现上需在 `wss.handleUpgrade` 回调里 close——把拒绝逻辑从"握手前拒绝"挪到"握手后关闭"。
2. Origin 校验失败的 403（server.ts:262-266）保持原样（非认证语义）。
3. `refreshGuestPolicy` 的运行时 1008（websocket.ts:187）可顺带改为 4001，让"管理员关闭游客模式"也走"请重新登录"路径（游客会话本就无效）。

**非破坏**：浏览器对 4001 的呈现与 1006 相同（都会触发 onclose），仅 code 可区分；已连接的正常会话不受影响。
**测试建议**：集成测试——建立 WS 后使会话失效（或用过期 cookie 握手），断言收到 4001 而非握手失败。
**工作量**：0.5 天（含测试）。

---

## 二、休眠功能对接（第二批，按价值排序）

> 原则沿用第一批：只把已有后端契约映射成控件、挂到既有注意力路径；不新建路由页；全部复用 BaseToggle/BaseModal/BaseButton/Toast 体系；零后端改动（B1-B3 除外）。

### D0 音源与连接管理【P1·接管丢失，阻塞 D5/D6】

**现状**：`enabledProviders`/`defaultPlatform`/`spotify`/`jellyfin` 四个配置块，后端 GET/POST 完整支持（含校验与联动清洗），**前端零消费**（`web/src` grep 无命中）。上游 Settings.vue 有"Jellyfin 音乐库"卡片且注释明言它是唯一的 enabledProviders 翻转入口（upstream-ref Settings.vue:168-178）——fork 接管前端时丢失。后果：**启用 Jellyfin/调整默认音源只能手改 config.json**；D5 的 Jellyfin 版块、D6 的 Spotify OAuth 实际都被此缺口阻塞。

**挂载点**：Settings 新增"音源"Tab（照抄 tab 挂载模式）：
- 启用开关列表：GATEABLE_PROVIDERS 逐项 BaseToggle（jellyfin/netease/qq/bilibili/youtube/kugou；local、spotify 由各自专属开关控制，只读展示）
- 默认音源下拉：enabled ∪ "自动（按优先级）"（`defaultPlatform` null 语义）
- Jellyfin 连接卡片：baseUrl/apiKey 输入 + `POST /api/auth/jellyfin/test` 连通测试
- Spotify 连接卡片：clientId/clientSecret 输入（masked GET 回显）

**交互**：一次 `POST /api/bot/settings` 差量保存；enabledProviders 变更后提示"网易云/QQ 内嵌 API 服务需重启生效"（bot.ts 注释语义）。
**非破坏**：纯新增 Tab；后端不动。
**工作量**：1 天。

### D1 插队播放（下一首播放 / 立即播放）【价值最高】

**挂载点**：`SongCard.vue` 与搜索页 `SongGridCard` 的操作区——现有"播放/添加到队列"两个图标按钮旁各加一个"下一首播放"（`mdi:playlist-play`）；"立即播放"收敛进 History 页 SongCard 的双击行为以外再加一个图标位（或悬浮菜单，二选一，以不破坏现有两按钮布局为准）。
**交互**：点击 → `POST /api/player/:id/play-next-song` 或 `play-now-song` `{song}` → toast；play-now 成功后乐观 `_optimisticPlay()`（store 已有）。
**复用**：store 现有 `playSong/addSong` 的错误处理与 toast 模式照抄。
**工作量**：0.5 天。

### D2 修改密码入口

**挂载点**：Settings 通用 Tab 底部（或 Navbar 用户菜单，二选一；通用 Tab 改动最小）加"修改密码"行 → BaseModal（旧密码/新密码/确认新密码，≥8 位前端校验）。
**交互**：`POST /api/session/change-password` → 成功 toast 提示"其他设备的登录已注销"（后端语义，用户应知情）→ 关闭 modal。
**工作量**：0.5 天。

### D3 FM 模式开启

**挂载点**：`web/src/components/home/QuickActions.vue`（已在此 GET `/personal/fm` 歌单）加"开启私人FM"按钮。
**交互**：`POST /api/player/:id/fm {platform: 当前默认源}` → 按 `{ok,message}` toast；失败消息（如"bot 未连接"）原样展示。
**工作量**：10 分钟级。

### D4 音源标签动态化

即 B2，与 D0 配套实施：D0 提供管理侧（启用/禁用），B2/D4 提供消费侧（标签随动）。

### D5 Jellyfin 首页版块

**前置依赖**：D0（Jellyfin 目前是 opt-in，没有启用入口就没有版块可显示）。
**挂载点**：`Home.vue`——jellyfin 在 enabled 中时（复用 B2 的 providers 数据，建议放进 store 避免重复请求）新增版块：最新专辑（横向卡片行）、最常播放、收藏；点专辑卡片进"流派/专辑歌曲"列表（`genre/:id/songs` 或复用 play-album 端点直接播）。
**交互**：专辑卡 → 播放走现有 `POST /api/player/:id/play-album`（契约 `{albumId, platform}`）。
**工作量**：1 天。

### D6 Spotify OAuth 网页流程

**前置依赖**：D0 的 Spotify 连接卡片（clientId 等此前无任何配置入口，只能手改 config.json）。
**挂载点**：`SettingsPlatforms.vue` 新增 Spotify 区块：`GET /api/spotify/status` 显示登录态；"去授权"跳 `GET /api/spotify/login` 返回的授权 URL（回调地址依赖 `GET /api/config/public-url`，部署侧需外网可达——文档里注明该前置条件）。
**工作量**：0.5-1 天（含回调联调；不可达时给出明确提示而非死链）。

### D7 短信 / 酷狗 / Jellyfin 账号登录

**挂载点**：`SettingsPlatforms.vue` 按各平台现有扫码/Cookie 卡片模式扩展：短信（`sms/send`+`sms/verify` 两步）、jellyfin（`jellyfin/test` 连通测试）。酷狗登录契约需先核对 `/api/auth` 实际字段再排期。
**工作量**：1 天。

### D8 审计日志页（admin 专属）

**挂载点**：Settings 新 tab"审计"（`v-if="authStore.isAdmin"`，照抄 SettingsUsers 的 tab 挂载方式）：表格（时间/操作者/动作/目标），`GET /api/audit?limit=100&offset=` 分页。
**工作量**：0.5 天。

### （二期）D9 按用户细粒度权限编辑器

第一批方案 7 明确标记的二期：`GET/PUT /api/users/:id/permissions` 的能力矩阵 + bot 白名单编辑。使用频率低、交互成本高，维持二期不动。

### D10 TS 聊天命令 Web 化（vote / follow / move / artist）【低优先级】

TS 命令面板完整支持但 WebUI 无对应入口的四项（instance.ts:828-887 命令表）：
- `!vote`（投票跳过，多用户 TS 场景）／`!follow`·`!unfollow`（跟随某人点歌）——群聊场景天然属聊天侧，Web 化价值中等
- `!move`（移动 bot 到频道）——可与 server-tree 抽屉联动（`join-channel` 端点已有）
- `!artist`（歌手电台）
仅在确有需求时排期，暂列备忘。

### D11 bot 实例字段对接（autoStart / channelPassword / TS6 协议）【P1-P3 分层】

后端 `BotInstance` 与连接层支持，但产品面不可达（SettingsBots 表单只有 name/serverAddress/serverPort/nickname/defaultChannel/serverPassword 六项）：

- **`channelPassword`（频道密码）【P1，纯前端】**：POST/PUT 路由均已接收（bot.ts:449/483），仅表单缺字段——私密频道场景刚需。表单加一个密码输入即可。
- **`autoStart`（开机自启）【P1，前端 + PUT 小改】**：创建路由接收（bot.ts:452，默认 false）、manager 在重启/Docker 重连时消费（manager.ts:183/318），但 UI 无开关，且 **PUT /:id 不接收 autoStart**（bot.ts:482 解构缺失）——完整对接需 PUT 补一个字段透传（"零后端改动"原则的已知例外）。
- **`serverProtocol` + `ts6ApiKey`（TS6 服务器）【P3，全链路休眠】**：ts-protocol 连接层支持 TS6 HTTP Query（自动检测 + API key），但**创建/更新路由都不接收这两个字段**——目前只能直改数据库。TS6 接入整体休眠，待有真实 TS6 部署需求再评估（路由 + 表单 + 检测联调）。

**工作量**：channelPassword 10 分钟；autoStart 0.5 天（含 PUT 透传与测试）；TS6 单独评估。

### 零散休眠端点与死配置（清单备查，不单独立项）

**次要休眠端点**：`GET /api/bot/:id`（单 bot 查询，被列表接口+WS 等价覆盖）、`POST /api/player/:id/add-by-id`（前端总持完整 song 对象走 add-song）、`GET /api/music/song/:id`、`GET /api/music/album/:id`（详情接口，D5 可顺带消费专辑详情）。

**死配置字段**（config.ts 定义、全仓库无消费者，属上游遗留，**同样不删**以免增加上游合并冲突面，仅记档）：`autoReturnDelay`、`adminPassword`（已被 users/session 体系取代）、`locale`。`commandAliases` 有消费（instance.ts:724，命令别名）但无编辑 UI——如需可视化可并入 D0 的音源 Tab 一并做。

---

## 三、死代码处置：`/api/favorites`

上游的"歌单收藏"路由（favorites.ts 全部 4 条）已被 fork 的 `/api/song-favorites`（歌曲收藏）取代，前端零调用。

**建议：保留不删**。理由：本仓库收敛策略的核心是让 `src/` 尽量贴上游以降低未来 `git merge upstream/main` 的冲突面（`web/** merge=ours` 只保护前端）；删除上游文件会在下次上游合并时产生删除冲突，收益为零。仅在 `FORK.md` 记一笔"上游歌单收藏未采用，前端走 /api/song-favorites"即可。

---

## 四、实施顺序建议

| 序 | 项 | 优先级 | 工作量 | 理由 |
|----|----|--------|--------|------|
| 1 | B1 effectiveDuration | P0 | 0.5 天 | 用户可见 bug，与刚修的 duration 同模式，纯前端+1 字段 |
| 2 | B3 WS 4001 对齐 | P0 | 0.5 天 | 会话过期假死的直接病因，后端单点改动 |
| 3 | D0 音源与连接管理 | P1 | 1 天 | 接管丢失回归；阻塞 D5/D6，且是 B2/D4 的管理闭环 |
| 4 | B2+D4 音源标签动态化 | P1 | 0.5 天 | 消除误导性 UI；与 D0 共用 providers 数据 |
| 5 | D1 插队播放 | P1 | 0.5 天 | 休眠项中用户价值最高，契约现成 |
| 6 | D11a channelPassword 表单字段 | P1 | 10 分钟 | 私密频道刚需，纯前端 |
| 7 | D11b autoStart 开关 | P1 | 0.5 天 | 运维刚需（重启自动恢复） |
| 8 | D2 修改密码 | P2 | 0.5 天 | 多用户场景刚需 |
| 7 | D3 FM 开启 | P2 | 10 分钟 | 顺手 |
| 8 | D8 审计页 | P2 | 0.5 天 | admin 合规场景 |
| 9 | D5 Jellyfin 版块 | P2 | 1 天 | 依赖 #3（D0）与 #4 的 providers 数据 |
| 10 | D6 Spotify OAuth | P3 | 0.5-1 天 | 依赖 #3（D0）+ 部署前置条件 |
| 11 | D7 短信/酷狗/Jellyfin 登录 | P3 | 1 天 | 需先核对契约 |
| 12 | D11c TS6 协议接入 | P3 | 单独评估 | 连接层已备，路由/表单全缺，待真实需求 |
| 13 | FORK.md 死代码记笔 | P3 | 10 分钟 | 顺手 |

P0 合计 1 天，P0+P1 合计约 4.5 天。每项独立可交付、独立提交（conventional commits）。

---

## 附：已完成的同类修复（对账档案）

| 项 | 提交 | 类型 |
|----|------|------|
| 第一批 8 项休眠功能对接 | fb0b8b4 起共 9 个提交（16866bc 标记完成） | 休眠功能 |
| `/elapsed` 补全 4 字段 | 40e0863 | 字段瘦身回归（backup 09b035e 有、重建丢失） |
| `play_history.duration` 补回 | 8de32d5 | 字段瘦身回归（backup 建表有、重建丢失） |
| 站点图标/PWA 接管误伤修复 | a995c33 / b64e825 | 移植二次误伤 |
| JWT 单密码鉴权 → 上游 session/users | 032d472（有意替换，非遗漏） | 设计替换 |
