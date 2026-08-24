# TSMusicBot 版本更新分析报告

> 对比基线：`64ecd92` (2026-04-29) → 当前 HEAD `d702e49`
> 涉及 **12 次提交**、**109 个文件**、净变更 **+7245 / -10888 行**（净减少主要来自删除已完成的内部计划文档）

## 一、重大新功能（面向用户）

### 1. 全栈鉴权系统（破坏性 ⚠️）

**核心变化：从无密码 → 强制双角色登录**

- **首次启动需在 `/setup` 设置两套密码**：`adminPassword`（管理员）+ `userPassword`（普通用户）
- **角色权限分离**：
  - `admin` —— 可访问 `/settings`、修改机器人配置、登录平台账号、停止/清空队列
  - `user` —— 可播放、搜索、查看；不能改设置
- **HTTP-only Cookie 会话**：JWT 通过 `tsbot_token` Cookie 下发，自动 CSRF 防护，浏览器 JS 无法读取
- **登录限流**：5 次失败 / 5 秒（防暴力破解，分 IP 计数）
- **WebSocket 同样强制鉴权**：未登录连不上 `/ws`，返回 4001 状态码
- **JWT 过期可配**：`jwtExpiresIn` 默认 `7d`，支持 `s/m/h/d` 单位

**新增页面**：`/login`（密码登录）、`/setup`（首次初始化）、`/404`

**路由守卫**：未登录访问受保护页面自动跳 `/login?redirect=...`，登录后回跳；已登录用户访问 `/login` 重定向首页；非管理员访问 `/settings` 重定向首页。

### 2. 收藏夹（新功能 ⭐）

- 新页面 `/favorites`，导航条新增入口
- 任意歌曲卡片新增爱心收藏按钮（`FavoriteButton.vue`）
- 后端 `POST/GET/DELETE /api/favorites`，SQLite 持久化（`favorites` 表，`(songId, platform)` 唯一索引）
- 收藏增删通过 WebSocket `favoritesChanged` 事件实时广播到所有客户端

### 3. TS 服务器频道树可视化（新功能 ⭐）

- 边栏 / 抽屉展示当前 TS 服务器完整频道树
- 高亮机器人所在频道、显示在线人数、按图标区分语音/文字频道
- **管理员**：点击频道一键移动机器人（`!move` 等价）
- **普通用户**：只读
- 移动端折叠为底部抽屉（`ServerTreeDrawer.vue`）
- 机器人移动后通过 HTTP 轮询刷新频道树状态（`ServerTreeDrawer.vue` 每 5 秒自动拉取）

### 4. 队列拖拽重排序（新功能 ⭐）

- WebUI 队列支持鼠标/触屏拖拽重新排序（基于 `vuedraggable`）
- 新增 `PlayQueue.reorder(from, to)` —— 正确处理 `currentIndex` 与 `playedIndices` 索引偏移
- TeamSpeak 文字命令：`!reorder <from> <to>`、`!remove <num>`

### 5. TS 资料同步开关 UI（新功能 ⭐）

- 在「设置 → 机器人管理 → 编辑」弹窗中新增「TS 资料同步」区域
- 6 项开关一一对应数据库的 `profile_*_enabled` 列：
  - 头像跟随 / 客户端简介 / 昵称跟随 / 离开状态 / **频道简介（标注「权限敏感」）** / 播放提示消息
- 复用现有 `GET/PUT /api/player/:botId/profile` 端点，与基础连接配置在保存时并行提交（`Promise.all`）
- 新增通用 `BaseToggle.vue` 组件：v-model boolean、`role="switch"` + `aria-checked`、支持 `warning` 标注、整行点击区域

## 二、移动端全面适配（重点改进 📱）

本次版本对 WebUI 进行了**系统性的移动端体验重构**，从布局、交互、性能多维度优化，使手机/平板浏览器获得近似原生 App 的体验。

### 1. 移动端专属播放控制面板（`MobilePlayerControls.vue` 新增）

- `sm:hidden` 仅在移动端显示，从屏幕底部弹出的抽屉
- `Teleport` 到 `<body>` + `Transition` 实现 `translate-y-full → 0` 滑入动画
- 背景 `backdrop-blur-sm` 蒙层 + 点击关闭
- 整合两大常用控制：
  - **音量滑块**：实时显示百分比，带渐变指示和触摸友好的 20px 圆形 thumb
  - **播放模式 grid**：4 模式（顺序 / 循环 / 随机 / 随机循环）一屏可见，点击切换
- 入口：`Player.vue` 上的图标按钮（`sm:hidden` 仅移动端可见）

### 2. 导航栏移动化重构（`Navbar.vue`）

- 桌面：`hidden md:flex gap-6` 横向链接菜单
- 移动端：右上角汉堡按钮（`md:hidden`）→ 触发全屏侧滑抽屉
- `Transition name="mobile-menu"` 命名过渡，纯 CSS 滑入
- 触摸友好尺寸：机器人切换器显式标注 `min-h-[44px]`，菜单项使用 `py-3 px-4`（约 ≥ 44px 触摸目标，符合 Apple HIG / Material Design 触摸目标规范）
- **鉴权区独立**：移动端抽屉内单独划出登录/退出按钮区，避免在横向汉堡条溢出
- 机器人选择器在抽屉中以大号卡片样式呈现

### 3. 队列面板抽屉化（`Queue.vue`）

- 重写为 `Teleport` 到 `<body>` 的右侧抽屉
- 自适应宽度：`w-[min(360px,85vw)]`，小屏占 85% 视口宽，最大 360px
- 背景半透明蒙层，点击外侧自动关闭
- **拖动手柄差异化可见性**（解决移动端无 hover 的痛点）：
  - 移动端：`opacity-50` 始终可见
  - 桌面端：`md:opacity-0 md:group-hover:opacity-50` 默认隐藏，hover 行才显
- 拖拽重排序在触屏上同样可用

### 4. 歌词页响应式布局（`Lyrics.vue`）

- 主容器 `flex-col lg:flex-row`：
  - **< 1024 px**（手机/平板竖屏）：封面在上、歌词在下，纵向滚动
  - **≥ 1024 px**（桌面）：封面在左、歌词在右，横向布局
- 封面**三段式尺寸**：`180px` (基础) → `240px` (sm) → `280px` (lg)，避免在小屏上挤占歌词空间
- 内边距自适应 `px-6 sm:px-10`
- 路由元 `hideNavbar: true`：进入歌词页隐藏导航条,避免占用宝贵的纵向空间

### 5. 播放器组件条件渲染（`Player.vue`）

大量使用 Tailwind 断点工具类做组件级显示控制：

| 元素 | 移动端 | 桌面端 |
|---|---|---|
| 进度时间数字 | `hidden`（隐） | `sm:inline`（显） |
| 播放模式切换按钮 | `hidden`（隐） | `sm:flex`（显） |
| 音量条 | `hidden`（隐） | `sm:block`（显） |
| 装饰图标 | `hidden`（隐） | `sm:block`（显） |
| 移动控制面板入口 | `sm:hidden`（显） | `hidden`（隐） |

- **机器人徽章移动端可点击**：在小屏上点击徽章打开 `ServerTreeDrawer`，方便切换频道

### 6. 后台节流（`visibilitychange` API）

监听 `document.visibilityState`，标签页隐藏时大幅降低前端负载：

- **`App.vue`**：
  ```js
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopSyncTimer();
    else startSyncTimer();
  });
  ```
  停止周期性同步 → 节省 WebSocket 心跳与请求

- **`Player.vue`**：
  - 标签隐藏 → `cancelAnimationFrame`，回退到 250ms `setInterval` 备用计时器
  - 标签恢复 → 重启 RAF（每帧渲染），保证 UI 流畅
- **`Lyrics.vue`**：歌词页独立挂载 `visibilitychange` 监听，标签隐藏时停止逐行高亮的 RAF 循环，恢复时重新对齐当前行
- **效果**：移动端切到其他 App 后，**电量与流量消耗显著降低**，再切回时进度无感对齐

### 7. 音量提交防抖

两端共同点：滑块均用 `@change`（用户松开）触发 `store.setVolume`，不再用每帧触发的 `@input`，**后端不再被滑块拖动洪峰打满**。两端实现略有差异：

- **`MobilePlayerControls.vue`**：`v-model.number="sliderVolume"`（本地 ref）+ `@change="onVolumeChange"`，UI 立即跟手，松开时提交
- **`Player.vue`（桌面）**：`:value="activeBot?.volume ?? 75"` 直接绑 store + `@change="onVolumeChange"`，没有本地 ref，但 `@change` 同样限制在松开时调用

两种方式都能避开拖动洪峰；mobile 抽屉因为体验上需要立即视觉反馈，所以采用了本地 ref 模式。

### 8. Tailwind 响应式断点统一铺设

- 移动相关断点 (`sm:` / `md:` / `lg:`) 跨 `MobilePlayerControls.vue`、`Navbar.vue`、`Player.vue`、`Queue.vue`、`Lyrics.vue`、`SongCard.vue`、`Search.vue` 等 **6 + 组件**统一使用
- 替换原 SCSS `@media (max-width: 768px)` 媒体查询：
  - **可读性高**：断点直接写在 class 上，不用跳到 SCSS 找媒体查询
  - **可视化好**：阅读模板即知响应行为
  - **构建体积小**：Tailwind 自动 tree-shake 未用到的工具类
- 断点对齐 Tailwind 默认规范：sm=640px、md=768px、lg=1024px

## 三、后端核心重构

### 1. 新增模块结构

```
src/auth/                    # 鉴权模块（全新）
├── jwt.ts                   # signToken/verifyToken/deriveSecret
├── middleware.ts            # createRequireAuth/createRequireAdmin
└── rate-limit.ts            # 滑动窗口限流器（自动 cleanup）

src/utils/                   # 工具模块（全新）
├── mutex.ts                 # 异步互斥锁
└── validate.ts              # botId/platform 输入校验

src/web/api/favorites.ts     # 收藏夹路由（全新）
src/music/netease-types.ts   # 网易云 API TypeScript 类型（120 行）
```

### 2. 配置加载强化（`src/data/config.ts`）

- **文件锁 + 原子写入**：`acquireFileLock` + `tmp + rename`，多进程并发不再损坏 `config.json`
- **启动校验**：`validateConfig` 强制检查 `webPort/locale/theme/commandPrefix/jwtExpiresIn`，无效抛错
- 新字段：`userPassword`、`jwtExpiresIn`

### 3. 数据库变更（`src/data/database.ts`）

- 新表 `favorites(id, songId, platform, title, artist, coverUrl, duration, createdAt)` + 唯一索引
- `play_history` 增加 `duration` 列
- **机器人 profile 配置改为持久化列**（之前只在内存）：`profile_avatar_enabled`、`profile_description_enabled`、`profile_nickname_enabled`、`profile_away_enabled`、`profile_channel_desc_enabled`、`profile_now_playing_enabled`
- 新增 `healthCheck()`（`PRAGMA quick_check`）
- `close()` 自动 `wal_checkpoint(TRUNCATE)`
- ✅ **`DEFAULT_PROFILE_CONFIG.channelDescEnabled` 在 `commit ee1c270` 中由 `true` 改为 `false`**：已同步修正 `bot_instances` 表结构中 `profile_channel_desc_enabled` 列的 SQL `DEFAULT 0`，且 `saveBotInstance` 在 INSERT 时显式写入 6 个 `profile_*` 列（`ON CONFLICT` UPDATE 分支不覆盖 profile 列，保证已有机器人配置不被重置）。新建机器人默认关闭频道简介，管理员可在「TS 资料同步 → 频道简介」手动开启。

### 4. 播放器修复（`src/audio/player.ts`）

- **缓解爆音**：在 `play / stop / pause / resume` 四种状态切换时各发 8 帧静音过渡，减轻 seek 后或暂停瞬间 DAC 硬切产生的爆音
- **PID 隔离**：移除全局 `globalActivePids`，改用实例 `activePid`，多机器人不再串扰
- ffmpeg `SIGTERM` → `SIGKILL` 升级带分级日志

### 5. BotInstance 加固（`src/bot/instance.ts`）

- `isAdvancing` 布尔标志 → `playNextMutex`（异步互斥锁），更严格的并发保护
- 新增 `onceDisconnected()` —— 等待断开完成的 Promise，带 5 秒安全超时
- **真实管理员校验**：`isInvokerAdmin()` 通过 `clientinfo clid=...` 查询服务器组，与 `adminGroups` 配置对比，**fail-closed**（出错拒绝）。之前是 TODO 直接放行
- 新增 `cmdReorder` 命令实现

### 6. HTTP API 全面统一

- 所有 `/api/*` 路由错误响应统一 `{ success: false, error }` 格式（之前不一致）
- 全局认证中间件（白名单：`/api/health`、`/api/setup`、`/api/auth/login|logout|me`、`/api/config/public-url`）
- 写操作（停止/清空队列、修改设置、登录平台账号）需 `requireAdmin`
- `botId` 输入校验防注入
- `/api/health` 扩展：返回 `authEnabled` + `needsSetup` 用于前端引导
- 新端点：`POST /api/setup`、`POST /api/auth/login`、`GET /api/auth/me`、`POST /api/auth/logout`

### 7. 网易云适配器类型化

- 新增 `src/music/netease-types.ts` 定义 21 个响应接口
- `netease.ts` 中大量 `any` 替换为强类型 + `mapSong/mapPlaylist` 抽取（原本三处重复映射）

## 四、前端整体重设计

### 1. CSS 框架替换：SCSS → Tailwind CSS 4

- **移除** `sass` 依赖
- **新增** `tailwindcss@^4.2.4` + `@tailwindcss/vite@^4.2.4`
- `web/src/styles/global.scss` + `variables.scss` 删除
- 新建 `web/src/styles/index.css` 单一入口，CSS 变量 + Tailwind 工具类
- 几乎所有组件由 BEM/SCSS 改为 Tailwind 工具类

### 2. 通用基础组件库（`web/src/components/common/`）

新建 9 个组件，全 Tailwind：
- `BaseButton.vue`、`BaseCard.vue`、`BaseModal.vue`、`BaseToggle.vue`（最后一个由 `d702e49` 引入）
- `EmptyState.vue`、`LoadingSpinner.vue`、`SkeletonLoader.vue`
- `Toast.vue` + `ToastContainer.vue`（全局通知系统，配 `useToast` composable + `toast` store）

### 3. 大型视图拆分

- **`Settings.vue`**：基线约 1142 行 → 当前约 413 行壳层（含编辑机器人弹窗与平台/账户/通用相关 setup 逻辑），子模块化为：
  - `SettingsLayout.vue`、`SettingsBots.vue`、`SettingsGeneral.vue`、`SettingsPlatforms.vue`、`SettingsTheme.vue`
- **`Home.vue`**：基线约 375 行 → 当前 21 行编排器，拆分为 `NowPlaying.vue` / `QuickActions.vue` / `RecentHistory.vue`
- **`Lyrics.vue`**：路由元 `hideNavbar: true`，进入全屏歌词页
- 新增 `PlayingIndicator.vue`（播放状态视觉指示）

### 4. 状态管理扩展（Pinia）

- 新增 `stores/auth.ts` —— 鉴权状态、`checkAuthEnabled`、`login/setup/logout`、`isAdmin/isUser`
- 新增 `stores/favorites.ts` —— 收藏夹列表与同步
- 新增 `stores/toast.ts` —— 全局通知队列
- `stores/player.ts` —— 增加乐观更新、进度校准、setVolume 防抖

### 5. WebSocket 复用增强（`composables/useWebSocket.ts`）

- 自动重连 + 指数退避
- 处理新增事件：`botRemoved`、`favoritesChanged`
- 心跳保活、断线时优雅状态恢复

### 6. 路由总览

```
/             首页
/search       搜索
/playlist/:id 歌单详情
/lyrics       全屏歌词（无导航条）
/history      播放历史
/favorites    收藏夹（新）
/settings     设置（requiresAdmin）
/setup        首次初始化（已配置后访问会被重定向）
/login        登录页（新）
/bot/:id      切换机器人后跳首页
/:any         404 页（新）
```

## 五、CI / 部署改进

### 1. Docker 自动发布工作流

新增 `.github/workflows/release-docker.yml`（手动触发）：

- 输入版本号 `v1.x.x` → 构建镜像 → 同时打 `v1.x.x` 与 `latest` 双 tag
- `docker save | gzip` 生成 `tsmusicbot-vX.tar.gz`
- 自动创建（或使用现有）GitHub Release，挂载 tar.gz 资源
- 支持 draft 模式

### 2. 生产环境 Compose 配置

新增 `scripts/docker/docker-compose.prod.yml`：

- 用预构建镜像（`tsmusicbot:latest` 或环境变量 `TSMUSICBOT_IMAGE` 指定版本）
- 保留原 `docker-compose.yml` 用于源码构建
- host 网络 + 命名卷 + 健康检查

部署可一行：
```bash
docker load -i tsmusicbot-v1.x.x.tar.gz
docker-compose -f docker-compose.prod.yml up -d
```

## 六、测试建设

`vitest.config.ts` 在基线 `64ecd92` 已存在；本次新增 **5 个测试文件**（共约 252 行）+ 修改 3 个既有测试文件（共 +73 行），合计本次新增/修改 **+323 行测试代码**。

**新增**（涵盖鉴权与工具模块）：
- `src/auth/jwt.test.ts`（32 行）
- `src/auth/middleware.test.ts`（75 行）
- `src/auth/rate-limit.test.ts`（54 行）
- `src/utils/mutex.test.ts`（40 行）
- `src/utils/validate.test.ts`（51 行）

**追加用例**：
- `src/audio/queue.test.ts`（+35 行，主要覆盖 `reorder` 索引偏移）
- `src/data/config.test.ts`（+34 行，覆盖文件锁与 `validateConfig`）
- `src/data/database.test.ts`（+4 行）

完整测试套件覆盖音频/鉴权/数据/工具/TS 协议，仓库共 14 个 `*.test.ts` 文件、约 962 行。

## 七、依赖变更

### 后端 `package.json`

| 操作 | 包 |
|---|---|
| ➕ | `jsonwebtoken@^9.0.3` |
| ➕ | `@types/jsonwebtoken@^9.0.10` |

### 前端 `web/package.json`

| 操作 | 包 |
|---|---|
| ➕ | `tailwindcss@^4.2.4` |
| ➕ | `@tailwindcss/vite@^4.2.4` |
| ➕ | `vuedraggable@^4.1.0` |
| ➖ | `sass@^1.87.0` |

## 八、破坏性变更清单（README 必须提醒）

1. **强制鉴权初始化** —— 首次启动会被引导到 `/setup`，必须设置管理员密码 + 用户密码才能继续使用
2. **登录态用 HTTP-only Cookie** —— 旧的 URL 参数 token 方式失效；前端必须开启 `withCredentials`
3. **新增「频道简介同步」开关，默认关闭** —— `DEFAULT_PROFILE_CONFIG.channelDescEnabled` 已改为 `false`，同时数据库列默认值与 INSERT 逻辑均已同步修正。新建机器人默认关闭频道简介同步，已有机器人配置不受影响。如需开启，请在「设置 → 机器人管理 → 编辑」弹窗的「TS 资料同步 → 频道简介」处打开。
4. **`Settings` 页面只有管理员可访问** —— 普通用户被重定向到首页
5. **平台账号登录、停止/清空队列等写操作变为管理员独占** —— 普通用户操作会收到 403
6. **写入 `config.json` 的方式改为 lock + atomic rename** —— 极端情况会留下 `.tmp-*.json` 临时文件，可手动清理

## 九、推荐 README 更新点

1. 「功能特性」中加入：
   - **管理员/用户双角色鉴权**（首次启动强制设置）
   - **收藏夹**（云端持久化、跨客户端同步）
   - **服务器频道树可视化**（管理员可一键移动机器人）
   - **队列拖拽重排序**（WebUI / TS 命令双支持）
   - **TS 资料同步可视化配置**（头像/简介/昵称/离开/频道简介/播放提示 6 项开关）
   - **📱 全面移动端适配** —— 汉堡导航 / 底部播放抽屉 / 队列抽屉 / 歌词响应式 / 后台节流 / 触摸友好尺寸 / 音量防抖

2. 单列「📱 移动端体验」章节（建议）：
   - 自适应布局：手机竖屏与桌面横屏完全不同的最佳布局
   - 抽屉式控制：播放控制、队列、服务器树都改为底部/侧边抽屉
   - 后台节流：切到后台自动暂停心跳与渲染，节省电量与流量
   - 触摸优化：导航与机器人切换器达 44px 触摸目标，菜单项使用 `py-3 px-4` 留足触控空间
   - 拖拽手柄：移动端始终可见，避免依赖 hover

3. 「快速开始」中：
   - 增加 **首次启动会跳转到 `/setup`** 的提示
   - Docker 部分增加 **`docker-compose.prod.yml` + GitHub Release tar.gz 一键导入** 部署方式

4. 「TeamSpeak 文字命令」表中增加：
   - `!remove <num>` —— 移除队列指定项
   - `!reorder <from> <to>` —— 队列内移动条目

5. 「项目架构」中：
   - `src/auth/` —— 鉴权模块
   - `src/utils/` —— 互斥锁与输入校验
   - `web/src/components/common/` —— 通用组件库（含 `BaseToggle` 通用开关）
   - `web/src/components/settings/` —— Settings 子模块化
   - `web/src/components/MobilePlayerControls.vue` —— 移动端播放抽屉
   - `web/src/views/Login.vue`、`Favorites.vue`

6. 「技术栈」中：
   - 前端样式：`SCSS` → **Tailwind CSS 4**（含响应式断点 sm/md/lg）
   - 鉴权：JWT (jsonwebtoken) + HTTP-only Cookie
   - 拖拽：vuedraggable

7. 「更新升级」中加上一条与现有「身份迁移」并列的警告，提示从此版本之前升级时**必须重新登录、首次启动会被引导到 `/setup`**。

## 附录：本次涉及的提交

| Commit | 标题 |
|---|---|
| `dedd7fc` | chore: 清理文档并更新项目配置 |
| `871a2ba` | feat: 后端核心重构与认证模块 |
| `069223b` | feat: 前端整体重设计、认证流程与组件库 |
| `c5cca99` | feat: Cookie 认证迁移、歌词同步与音频修复 |
| `24c6db9` | fix: 修复播放状态同步、乐观更新与进度校准 |
| `8b19694` | feat: TS3 服务器树可视化与频道切换 |
| `d2b3bb5` | feat: 移动端播放控制面板与音量防抖 |
| `90332e1` | ci: 添加 Docker 镜像与发布包手动构建流程 |
| `004111c` | perf: 优化前端动画性能并减少布局抖动 |
| `ee1c270` | fix: 默认关闭机器人播放时的频道简介更新 |
| `fa13761` | ci: Docker release 导出 latest tag，新增 prod compose 配置 |
| `d702e49` | feat: 设置页加入 TS 资料同步开关 |
