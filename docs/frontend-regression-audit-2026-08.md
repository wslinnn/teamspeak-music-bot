# 前端重构回归审计（行为级比对）

- **日期**：2026-08-29
- **方法**：以 `upstream-ref` 分支的上游前端为基准，对本 fork 重写的 `web/src/` 做行为级比对（端点/载荷/响应字段消费/生命周期/门控/兜底分支），并用本仓后端 `src/web/` 验证疑似项是否仍受支持。三路并行审计 + 关键项人工复核。
- **背景**：二维码渲染断裂（上游 `QRCode.toDataURL` 兜底在接管重写时丢失）即属此类；本次为同类问题的系统性排查。
- **教训**：`frontend-diff-vs-upstream.md` 第五轮对账将平台账号流标注"✅ 等价"，但二维码回归恰在此处——"端点覆盖"不等于"行为等价"，对账结论需行为级证据支撑。

## A 级：功能性断裂（建议必修）

### A1. 游客「立即播放」整体断裂 ✅已复核
- 上游：`stores/player.ts` 的 `playSong` 按身份分流——游客走 `/play-now-song`（插入下一首+跳转，不清队列，`guestFlag:"playNow"`），成员走 `/play-song`。
- 现状：`web/src/stores/player.ts` 的 `playSong` 恒调 `/play-song`；全前端无 `play-now-song` 调用。而后端 `/play-song` 仅 `player.control` 无 guestFlag → 游客必 403。
- UI 仍按 `guestCan('playNow')` 给游客显示播放按钮 → **管理员给了权限也点不动，且每次点击弹错误 toast**。
- 修复方向：恢复身份分流（一处改动）。

### A2. Spotify 无法从 UI 启用 ✅已复核
- 上游：Spotify 卡有"启用播放"开关，`saveSpotify` 载荷含 `enabled`。
- 现状：前端无任何地方读写 `spotify.enabled`（全仓搜索零命中）；`SettingsSources.vue` 的 spotify 表单只有 clientId/clientSecret/deviceName/bitrate/backend。
- 后端链路完整（`bot.ts` 支持、`index.ts` 仅在 `enabled && clientId` 时挂载 provider）→ **仅凭 UI 配置 Spotify 永远不生效**，已启用的旧配置也无法从 UI 关闭。

## B 级：行为降级（高频体验问题）

### B1. 播放类动作不消费 `200 + {ok:false, message}` → "假成功" ✅已复核
- `playSong/playNextSong/playPlaylist/playAlbum` 全部无条件 `toast.success`，不读响应体。
- 后端大量分支以 200+ok:false 返回：「无法播放（区域/版权限制）」「N 首均无版权」「已加载 x/y 首，但无法开始播放」等。QQ 曲库版权灰曲是高频场景：用户看到"开始播放歌单"，实际一首没播。

### B2. Bot 表单丢失 `channelId`（按频道 ID 加入）
- 后端 POST/PUT/GET 完整支持且保留旧值；前端创建/编辑表单均无此字段 → 无法设置/更改/清除，仅 API 可达。

### B3. 游客模式"可控制的机器人"白名单丢失
- `SettingsPermissions.vue` 保存时硬编码 `bots: 'all'`；上游有"全部/逐 bot 勾选"。后端仍支持数组。与本次 SEC-04/SEC-03 修复的 bot 范围控制配套，收窄了管理能力。

### B4. 保存后全局状态不同步
- 音源开关/默认源保存后不刷新 `store.enabledProviders`（消费方最长 60s TTL 后才感知）；`savedQueuesEnabled` 保存后不写 store（队列"已存清单"入口需刷新页面才出现/消失）。上游为保存即 `fetchProviders()` + 写 store。

### B5. 401 跳转丢失回跳参数 ✅已复核
- `http.ts` 401 → `window.location.href = '/login'`（无参数）；`Login.vue` 读 `?redirect=`（有防开放重定向校验）但**没有任何代码会写入该参数** → 登录后总回首页，死参数。

## C 级：体验/卫生（择机）

| # | 问题 | 备注 |
|---|------|------|
| C1 | 本地上传流退化：无类型过滤/500MB 预检/进度/多文件；上传后不切 local 源（歌插进当前标签，重搜即失） | 上传本身可达 |
| C2 | 游客+addToQueue 的上传入口被隐藏（`!isGuest` 多余门控；后端明确允许） | 与 SEC-06 默认关 addToQueue 叠加后影响小 |
| C3 | Jellyfin 登录态不展示；`checkAuthStatus` 用 `Promise.all`（上游 allSettled 五平台含 jellyfin） | 一个失败全部丢弃 |
| C4 | `pause()` 用缓存 getter 冻结进度，非上游特意修的 `liveElapsed()` | 暂停回拨最多 ~3s |
| C5 | FM 开台丢三步收尾：timing 归零/500ms 补同步/fetchQueue | WS 在线时自愈 |
| C6 | Queue 行点击无 `player.control` 前端门控 | 无权限者点击弹 403 噪音（后端一致拒绝，非越权） |
| C7 | 全局错误 toast 无豁免清单（history/user-playlists 等预期内失败也弹） | 上游无全局 toast，由视图自行决定 |
| C8 | Library 我的歌单无登录预检（未登录源每次进页打无效请求） | 上游先查 authStatus |
| C9 | 搜索状态不落 URL（`?q=`）、音源选择不记忆 | 上游有 router.replace + localStorage |
| C10 | 头像前端阈值 300KB vs 后端 200KB | 过前端校验被后端 413，仅通用报错 |
| C11 | 小项：QR 过期无"重新生成"直达；角色切换无二次确认；`canControlBot` 死代码；removePlaylistFavorite 丢 404 静默 resync | — |

## 已比对确认等价 / fork 超集的子项

Cookie 登录流、音质六档+Jellyfin 四档取值、修改密码（selfHandled401 语义）、用户管理/权限编辑器全部端点、命令前缀（fork 真持久化，上游是空操作）、Jellyfin 连接测试、密码只写不读、Spotify OAuth 回跳提示、searchPagination（逐字相同）、歌单/专辑详情 404 兜底、play-playlist/play-album 参数与 playCollection 门控、收藏红心、History 搜索+分页（超集）、Lyrics（超集：翻译开关/防竞态）、Login/FirstRun、`?bot=` 专属链接全链路、`/elapsed` 轮询启停（严格优于上游）、seek 乐观锚点、Queue 清空/停止/已存清单端点、拖拽重排（fork 特性）、Navbar 快捷操作（fork 门控更严）、useWebSocket 五类消息 + 4001（fork 超集）、Home FM 多源卡/Jellyfin 四区块/每日推荐多源（fork 已对齐且消费 ok/message）、FM 启停门控。

## 修复优先级建议

1. **A1**（游客点歌 403）——一行分流，硬功能断裂；
2. **A2**（Spotify 无开关）——补一个 toggle + 载荷字段；
3. **B1**（假成功）——四处 play 系 action 消费 `ok/message`（FM 卡已有正确范式可照抄）；
4. **B2/B3/B5** ——各为小改动；
5. **B4/C 级**——按迭代节奏消化。

> 修复时注意与既有机制对齐：B1 的 toast 语义与 `respondError` 的 `UserFacingError` 文案不冲突（ok:false 是 200 业务态）；A1 分流后 `guestCan('playNow')` 的按钮展示才真正闭环。

---

## 裁决：真漏 / 我们的优化 / 取舍项

> 原则：上游有而我们要补的，必须同时满足"后端仍支持 + 前端行为契约断裂"；
> 我们的实现是**有意的更好设计**时，不回退到上游做法，只在必要时补短板。

### 一、真漏（需要补回，按优先级）

| # | 项目 | 裁决依据 | 修法要点 |
|---|------|---------|---------|
| A1 | 游客点歌分流 `play-now-song` | 后端 `/play-now-song`（guestFlag:playNow）与权限测试用例都在，按钮也在展示——契约断在前端一行分流 | `playSong` 按 `auth.isGuest` 选端点；与 B1 一起处理成功/失败分支 |
| A2 | Spotify `enabled` 开关 | `config.ts:81`：spotify 的启用**只看** `spotify.enabled`（不在六开关内），前端无任何翻转入口 → UI 配了也永不生效 | Spotify 卡加"启用播放" toggle，保存载荷带上；未填 clientId 时提示先填 |
| B1 | 播放系消费 `ok/message` | 后端 200+ok:false 是版权/区域限制的主表达路径；且现实现 ok:false 时仍做乐观更新（错误重置进度锚点），比不提示更糟 | 四处 play 系 action：`ok===false` → error toast(message) 并**跳过乐观更新**；`message` 有值无 ok:false → info（歌单部分加载 x/y）。QuickActions FM 卡已有正确范式 |
| B2 | Bot 表单 `channelId` | 后端 POST/PUT/GET 全支持且 undefined 保留旧值；与 defaultChannel 互斥输入上游有现成交互 | 创建/编辑表单补可选输入框 |
| B3 | 游客 bots 白名单 UI | 后端支持数组；**成员侧**同款 UI 已存在（权限编辑器 botsAll+勾选），只缺游客侧——直接复用该模式 | `SettingsPermissions.vue` 加"全部/逐 bot 勾选"，保存载荷 `bots: 'all' \| ids` |
| B4 | 保存后状态同步 | 我们的 TTL 缓存（PERF-10 优化）无意中放大了"保存不生效"的窗口；savedQueuesEnabled 则完全不同步 | 保留缓存，补"保存后失效"：SettingsSources.save() 成功后失效 providers 缓存并重拉；SettingsBehavior 切 savedQueuesEnabled 后写 `playerStore.savedQueuesEnabled` |
| B5 | 401 回跳参数 | Login.vue 读 `?redirect=`（含防开放重定向校验）但无人写入——死参数 | http.ts 401 → `/login?redirect=` + encodeURIComponent(pathname+search)；selfHandled401 清单不受影响 |
| C4 | pause 用 `liveElapsed()` | 上游注释明说是刻意修的点；我们自己的注释也写明 getter 是缓存 computed | 一行改回 liveElapsed() |
| C6 | Queue 行点击补 `can('player.control')` 守卫 | 与 D14"无权限入口不渲染/不响应"的项目哲学一致；现在无权限点击弹 403 噪音 toast | 函数首行加守卫 |
| C10 | 头像前端阈值 300KB→200KB | 后端是权威（413），前端阈值不一致只会造成"过了前端校验被后端拒" | 对齐 200KB（校验+文案） |
| C3 | `checkAuthStatus` 改 allSettled + Jellyfin 状态展示 | 上游注释"一个慢平台不得遮蔽其他平台"；Promise.all 语义确实更脆 | allSettled 五平台；Jellyfin 卡展示"已连接：昵称" |
| C8 | Library 我的歌单登录预检 | qq/kugou 未登录时请求必失败/空，配合 C7 造成噪音 | 拉取前按 `authStatus` 门控（store 已有 fetchAuthStatus） |
| C9 | 搜索 `?q=` 落 URL + 音源记忆 | 刷新丢词、无法分享搜索链接；上游实现成本低 | doSearch 成功后 `router.replace({query:{q}})`；音源 localStorage 记忆（对齐首页已有机制） |
| C1a | 上传预检 + 成功后切 local 源 | 500MB 前端预检避免白传几分钟才 413；类型过滤；上传后不切源导致"传完找不到" | isMediaFile 过滤 + 大小预检 + 成功后切 local 标签 |
| C11 | 小项：QR 过期"重新生成"直达；角色切换二次确认；removePlaylistFavorite 404 静默 resync；`canControlBot` 接入或删除 | 各一行级 | 打包处理 |

### 二、我们的优化——保留，不回退上游

| 项 | 说明 |
|----|------|
| 401 集中处理（selfHandled401 + 拦截器） | 比上游裸 fetch 分散处理更集中；改密码不误登出是 fork 特性 |
| 全局错误 toast | 架构保留；C7 只需给"预期内失败"补 skipErrorToast 豁免（history/user-playlists/avatar 等），不是退回上游 |
| WS 4001 语义 + 指数退避 + 手动重连横幅 | 上游 3s 死循环 + 认证失效也重连是缺陷；**不要**照搬上游无限重连 |
| providers 60s TTL 共享缓存 | PERF-10 优化保留；B4 的修法是"保存后失效"，不是删缓存 |
| `addSongSilent` 批量入队（100+1 请求） | 优于上游 N+1 |
| 命令前缀真正持久化 | 上游 savePrefix 是空操作 |
| 密码类字段"留空=不变"+ has* 标志回显 | 比上游明文回填安全 |
| 搜索"全部"聚合 + 单源直查 | 上游 6 路扇出；fork 省请求 |
| 收藏红心对游客隐藏 | 上游游客点击 403 |
| `/elapsed` 轮询启停（空闲跳过/暂停降频/隐藏停表） | 严格优于上游无条件 3s |
| MiniPlayer/Player rAF 门控 + 隐藏降级 | 本轮性能修复 |
| 游客上传入口随 SEC-06 收紧 | 有意收紧：guest addToQueue 默认关闭后，游客上传卡维持隐藏是配套行为；管理员显式开启 addToQueue 时是否放开入口，随 B3 一起再议 |
| 成员 bot 白名单权限编辑器（7a7bd33） | 上游没有；B3 的游客侧 UI 直接复用它的模式 |

### 三、取舍待定（默认维持现状，需要产品决策再动）

| 项 | 现状 | 建议 |
|----|------|------|
| C5 FM 开台三步收尾 | WS 在线时自愈 | 可选补（三行）；不补也无感 |
| WS 10 次退避后停止 | 有横幅手动重连 | 保留 fork 语义 |
| C2 游客上传入口 | 隐藏 | 维持隐藏；若管理员开启 guest addToQueue，可在前端按 `guestCan('addToQueue')` 放开（与后端口径一致），作为独立小改动再议 |

---

## 修订修复方案（批次）

**P1（功能断裂，一次迭代内）**
1. A1：`playSong` 游客分流 `play-now-song`；无 `playNow` 权限时按钮本就不渲染，无需额外处理。
2. A2：Spotify 卡加启用 toggle；载荷含 `enabled`；保存后失效 providers 缓存。
3. B1：四处 play 系 action 消费 `ok/message`；`ok:false` 时 error toast + 跳过 `_optimisticPlay/_setTiming`；部分加载走 info。

**P2（小改，随手批次）**
4. B5 401 回跳；5. C4 pause liveElapsed；6. C10 头像 200KB 对齐；7. C6 Queue 行守卫；
8. B4 同步：providers 缓存失效 action + savedQueuesEnabled 写 store。

**P3（能力补全，规划批次）**
9. B2 bot 表单 channelId；10. B3 游客 bots 白名单（复用权限编辑器模式）；
11. C3 allSettled + Jellyfin 状态展示；12. C1a 上传预检+切源；13. C8 Library 登录预检；
14. C9 搜索 URL/记忆；15. C11 小项打包。

**P4（可选/待议）**
16. C1 进度条与多文件；17. C5 FM 收尾；18. C7 豁免清单扩全；19. C2 游客上传入口放开与否。

每批照例：vitest 回归（A1 可测分流逻辑、B1 可测 ok:false 分支）+ `npm test`/`npm run build` 门禁；提交按 `fix(web): …` 前缀。

---

## 实施记录（2026-08-29，P1~P4 全部完成）

用户拍板：**游客上传保持关闭**（P4-C2 不放开入口，维持 `!isGuest` 门控与 SEC-06 默认收紧一致）。

- P1：A1 游客分流 `play-now-song`（含 4 条 store 回归测试：身份分流 + ok:false 不乐观更新）；B1 四处 play 系消费 `ok/message`（部分加载按 info 提示，失败按 error 且跳过乐观更新）；A2 Spotify「启用播放」toggle + 载荷 `enabled` + 保存后失效 providers 缓存。
- P2：B5 401 携带 `?redirect=`；C4 pause 改 `liveElapsed()`；C10 头像阈值对齐 200KB；C6 Queue 行点击 `player.control` 守卫；B4 `invalidateEnabledProviders` + savedQueuesEnabled 保存即写 store。
- P3：B2 创建/编辑表单补 `channelId`；B3 游客 bots 白名单 UI（复用权限编辑器交互）；C3 `checkAuthStatus` allSettled 五平台 + Jellyfin 卡连接态展示；C1a 上传媒体扩展名过滤 + 500MB 预检 + 成功切 local 源；C8 Library qq/kugou 登录预检；C9 搜索 `?q=` 落 URL + 音源 localStorage 记忆；C11 QR 过期「重新生成」/ 角色切换二次确认 / 歌单收藏 404 静默 resync / Navbar 接入 `canControlBot`。
- P4：C1 上传进度百分比 + 多文件拖拽；C5 FM 走 store `startFm`（进度归零/500ms 补同步/刷新队列）；C7 全局 toast 豁免清单（history / user/playlists / auth/status）；C2 维持游客上传关闭（按用户决定，无代码改动）。

验证：`npm test` 1127/1127（含新增 player store 4 条）、`npm run build`（tsc + vue-tsc + vite + PWA）全绿。
