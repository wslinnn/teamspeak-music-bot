# 休眠功能的最小化前端对接方案

> 背景：收敛后以下功能后端已就位但无前端入口（见 `docs/performance-analysis.md` 与休眠清单核查）。
> 原则（第一性原理）：**UI 只做两件事——把已有后端契约映射成控件、挂到用户已有的注意力路径上**。不新建路由页面（除非必要）、不改现有组件签名（只加可选字段）、全部复用既有组件体系（BaseToggle/BaseModal/BaseButton/Toast/SettingsLayout 的 tab 机制/Queue 抽屉/Search 页模式）。
> 所有方案零后端改动——后端契约已完整存在。

## 契约速查（已核实）

| 端点 | 契约 |
|------|------|
| `GET/POST /api/bot/settings` | 一个端点覆盖：`idleTimeoutMinutes`(数字)、`autoPauseOnEmpty`、`localAudioEnabled`、`savedQueuesEnabled`、`playKeepsQueue`(布尔)、`voiceDucking{enabled,volumePercent}`、`guestMode{enabled,bots,permissions×8}`、`adminGroups`(整数数组)。GET 仅需非游客，POST 需 `bot.manage` 能力，部分合并、无效字段静默忽略 |
| `POST /api/music/local/upload` | **raw 二进制 body**（非 multipart），文件名走 `x-filename` 头（URL 编码），Content-Type 用文件 MIME → `{ song }`。受 `localAudioEnabled` 门控（关时 403）。视频后端自动 remux 留音轨，前端无需区分 |
| `GET/POST/DELETE /api/saved-queues`、`POST /:id/load` | 列表 `{queues}`；保存 `{botId,name,shared?}`；加载 `{botId,mode:"replace"\|"append"}`；删除 `/:id`。受 `savedQueuesEnabled` 门控 |
| `GET/POST/DELETE/PATCH /api/users(/...)` | 列表 / 新建 / 删除 / `reset-password` / `role`（另有 `:id/permissions` 细粒度，最小方案暂不用） |
| `PUT/DELETE /api/bot/:id/avatar` | `{ dataUrl }`（base64），DELETE 清除恢复默认 |
| `/api/music/search/all?q=&platform=&offset=` | 返回 `{songs, playlists, albums}`，服务端支持 offset 翻页 |
| 播放历史 | 响应已含 `requestedBy` 字段（只差展示） |

---

## 方案 1：行为设置 Tab（一个文件唤醒 5 个休眠项 + autoPause 陷阱 UI 化）

**挂载点**：Settings 新增第四个 tab「行为」（`tabs` 数组追加 `{ key: 'behavior', label: '行为设置', icon: 'mdi:tune' }`）。

**新增**：仅 1 个组件 `web/src/components/settings/SettingsBehavior.vue`（照抄 SettingsGeneral.vue 的结构与样式惯例）。

**内容**（全部 BaseToggle / 数字输入，挂载时 `GET /api/bot/settings` 回填，保存按钮一次 `POST` 差量）：
- 频道无人时自动暂停（`autoPauseOnEmpty`）——顺带让用户能在 UI 里关掉存量 config 的 `true` 陷阱
- 本地音频播放（`localAudioEnabled`）——方案 4 的前置开关
- 保存/加载播放清单（`savedQueuesEnabled`）——方案 2 的前置开关
- 单曲播放不清空队列（`playKeepsQueue`）
- 语音闪避（`voiceDucking.enabled` + 说话时音量百分比数字输入 0-100）
- 空闲自动停止分钟数（`idleTimeoutMinutes`，0=不启用）

**非破坏**：纯追加 tab，现有 tab 不动；后端部分合并语义天然容错。
**工作量**：0.5 天。**唤醒**：C7 语音闪避、C8 自动暂停（含陷阱可视化）、行为设置四开关。

## 方案 2：已存队列（零新页面，挂在现有 Queue 抽屉）

**挂载点**：`Queue.vue` 头部——现有「清空」按钮旁加两个图标按钮（保存 `mdi:content-save`、已存清单 `mdi:playlist-music`）。

**交互**：
1. 保存 → `BaseModal` 弹输入框（名称 + 共享勾选）→ `POST {botId, name, shared}` → toast
2. 已存清单 → `BaseModal` 列表（`GET`，每行：名称/歌曲数/共享标记 + 三个操作：**替换加载**（`mode:"replace"`）、**追加**（`mode:"append"`）、**删除**）→ 加载成功后调现有 `store.fetchQueue()` 刷新
3. `savedQueuesEnabled` 关闭时后端 403「此功能未启用」→ toast 提示"到 设置→行为 开启"（与聊天命令同语义）

**复用**：BaseModal、BaseButton、现有队列刷新路径、toast。
**非破坏**：只加两个按钮 + 两个 modal；不碰列表渲染与拖拽逻辑。
**工作量**：0.5 天。

## 方案 3：历史点歌人（最小的一项）

**挂载点**：`SongCard.vue`（History 页使用的那张卡）。

**改动**：`Song` 类型加可选字段 `requestedBy?: string`；SongCard 歌手行末尾条件渲染 `· 点歌 {{ song.requestedBy }}`（`v-if`，灰字小号）。History 页数据来自后端 `requestedBy` 字段，其他页面该字段为 undefined 自然不显示。

**非破坏**：可选字段 + 条件渲染，现有调用零影响。**工作量**：10 分钟。

## 方案 4：本地音视频上传（挂在 Search 页，复用 SongGridCard）

**挂载点**：`Search.vue` 分类 tab 行右侧一个极简上传按钮（`mdi:upload`，隐藏 `input[type=file]` + 全页 dragover/drop 事件）。

**交互**：
1. 选择/拖入文件 → `POST /api/music/local/upload`，body 直接放 `File`（axios 传 File 自动按 raw 发），`x-filename: encodeURIComponent(file.name)`，`Content-Type: file.type`
2. 响应 `{ song }` → **插入当前结果列表顶部**，复用现有 SongGridCard 的播放/下一首/加入队列
3. 上传中按钮 loading（axios `onUploadProgress` 进度条为可选增强，视频大文件时值得）
4. `accept` 给全后端支持的扩展名（mp3/flac/wav/m4a/ogg/opus + mp4/mov/mkv/avi/flv/wmv…），视频后端自动 remux，前端零区分
5. `localAudioEnabled` 关闭时 403 → toast 引导"到 设置→行为 开启"

**非破坏**：新增一个按钮 + drop 监听；结果列表渲染逻辑不变。
**工作量**：0.5 天（含进度条 +1 小时）。**唤醒**：E1 音频 + E2 视频（同一实现）。

## 方案 5：搜索分类翻页（复制自家 platformTabs 模式）

**挂载点**：`Search.vue`，在平台 tab 行下方加一行「歌曲 / 歌单 / 专辑」分类 pill（**直接复制现有 platformTabs 的按钮组样式与交互**）。

**交互**：
1. `/search/all` 一次返回三类，分类 tab 只做本地数组切换（默认「歌曲」= 与现状完全一致）
2. 每分类底部「加载更多」→ 同参数再请求 `offset += 每页大小`，结果追加（服务端已支持并 clamp）
3. 歌单/专辑卡片：CoverArt + 名称 + 歌曲数，点击歌单复用现有 `store.playPlaylist(playlistId, platform)`（Playlist 页已有该入口逻辑）；专辑先展示列表（播放走现有 `play-album` 端点，若无现成 store action 则最小实现一个）

**非破坏**：默认分类=歌曲、默认无翻页请求，行为与旧版一致；旧搜索路径保留。
**工作量**：1 天。**唤醒**：D2 专辑/歌单搜索 + D3 翻页。

## 方案 6：权限 Tab（命令权限 + 游客模式，admin 专属）

**挂载点**：Settings 新增第五个 tab「权限」（`v-if="authStore.isAdmin"`，tabs 动态计算）。

**新增**：仅 `SettingsPermissions.vue`。内容全部走 `POST /api/bot/settings`：
- **命令权限**：一个文本输入「管理命令限定的服务器组 ID（逗号分隔）」→ 解析成 `adminGroups: number[]`；留空=不限制（后端语义）
- **游客模式**：`guestMode.enabled` BaseToggle + 8 个权限 BaseToggle（加队列/下一首/立即播放/跳过/暂停音量进度/移除清空/播放模式FM/整个歌单，默认仅第一项开）+ 作用域最小版（起步只做"全部机器人"，`bots:"all"`；白名单多选标记为二期）

**非破坏**：新 tab 仅 admin 可见；后端字段级合并。
**工作量**：0.5-1 天。**唤醒**：B5 命令权限、B3 游客模式（登录页游客入口已就绪，开关打开即出现）。

## 方案 7：用户管理 Tab（admin 专属）

**挂载点**：Settings 第六个 tab「用户」（`v-if="authStore.isAdmin"`）。

**新增**：仅 `SettingsUsers.vue`：
- 列表（`GET /api/users`）：用户名 / 角色徽章 / 操作
- 新建用户：BaseModal 表单（用户名 + 密码 ≥8）→ `POST`
- 行操作：提升/降级（`PATCH /:id/role`，后端阻止降级最后一位管理员）、重置密码（BaseModal 输新密码 → `POST /:id/reset-password`）、删除（`DELETE`，确认弹窗）
- **二期**（标记不做）：每用户细粒度能力与机器人白名单（`GET/PUT /:id/permissions`）——展示现状即可，编辑交互成本高、使用频率低

**非破坏**：纯新增。**工作量**：1 天。

## 方案 8：自定义机器人头像（挂在现有机器人编辑弹窗）

**挂载点**：`SettingsBots.vue` 的创建/编辑表单内加「自定义头像」区块。

**交互**：预览缩略图（`GET /api/bot/:id/avatar`）+ 上传（`FileReader` 读 File → base64 → `PUT { dataUrl }`，限 200KB/`image/*` 前端预检）+ 移除按钮（`DELETE`）。语义说明一行：「空闲时显示自定义头像，播放时显示专辑封面」（后端既有优先级）。

**非破坏**：表单内追加区块；不传头像时行为不变。
**工作量**：0.5 天。

---

## 实施顺序建议（价值/成本排序）

| 序 | 方案 | 工作量 | 理由 |
|----|------|--------|------|
| 1 | 方案 3 点歌人 | 10 分钟 | 顺手 |
| 2 | 方案 1 行为 Tab | 0.5 天 | 一次唤醒最多；autoPause 陷阱获得 UI 化出口 |
| 3 | 方案 2 已存队列 | 0.5 天 | 零新页面；前置开关在方案 1 里已有 |
| 4 | 方案 4 本地上传 | 0.5 天 | E1/E2 完全休眠中最有价值；前置开关同上 |
| 5 | 方案 5 搜索分类 | 1 天 | 主路径体验升级，独立无依赖 |
| 6 | 方案 6 权限 Tab | 0.5-1 天 | admin 场景 |
| 7 | 方案 7 用户 Tab | 1 天 | 多用户管理场景 |
| 8 | 方案 8 头像 | 0.5 天 | 纯装饰 |

合计约 4.5-5 天。每个方案独立可交付、独立提交（conventional commits），互不依赖（方案 2/4 运行时依赖方案 1 的开关，但代码上独立）。
