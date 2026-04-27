# TSMusicBot 全面重构设计文档

**日期**: 2026-04-28
**状态**: 已批准
**前置文档**: 项目对比分析报告（2026-04-28）

## 概述

基于对 teamspeak-music-bot 与 NeteaseTSBot 的对比分析，本设计制定了全面的渐进式重构方案。重构覆盖安全加固、后端健壮性、前端基础设施、前端体验升级、高级功能五个阶段，每个阶段独立可发布。

## 设计决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 实施策略 | 渐进式分阶段 | 每阶段可独立发布，风险可控 |
| CSS 方案 | 全面引入 Tailwind CSS | 统一设计系统，提高开发效率 |
| 鉴权方案 | JWT | 无状态，适合单实例部署，实现简洁 |
| 交付节奏 | 每阶段交付 | 用户可测试反馈，项目始终可用 |

## 阶段依赖关系

```
阶段 1: 安全加固（独立）
  │
  └──► 阶段 2: 后端健壮性（依赖阶段 1 的鉴权中间件）
        │
        └──► 阶段 3: 前端基础设施（依赖阶段 2 的统一 API 响应格式）
              │
              └──► 阶段 4: 前端体验升级（依赖阶段 3 的 Tailwind + 组件库）
                    │
                    └──► 阶段 5: 高级功能（依赖阶段 3/4 的 UI 基础）
```

## 核心原则

1. **向后兼容** — 每个阶段完成后项目功能不减，重构是内部改善
2. **渐进式迁移** — 新旧代码可共存，未迁移组件继续使用旧方案
3. **测试先行** — 每个阶段在改动前先补充针对当前行为的测试

---

## 阶段 1：安全加固

> 解决 P0 安全问题：Web 面板无认证、TS 命令权限空壳

### 1.1 JWT 鉴权系统

**新增文件：** `src/auth/jwt.ts`

- 使用 `jsonwebtoken` 库
- Token payload：`{ role: 'admin' }`
- Token 有效期：24 小时（可通过 config 配置）
- 密钥生成：从 `config.adminPassword` 通过 HMAC 派生出 JWT secret
- 不实现 refresh token，过期后重新登录

### 1.2 API 鉴权中间件

**新增文件：** `src/auth/middleware.ts`

- Express 中间件 `requireAuth`：从 `Authorization: Bearer <token>` 提取并验证 JWT
- 白名单路由（不需要认证）：
  - `POST /api/auth/login`
  - `GET /api/config/public-url`
  - 静态文件服务
- 所有其他 `/api/*` 路由必须通过 `requireAuth`

### 1.3 登录端点

**改造文件：** `src/web/api/auth.ts`

- `POST /api/auth/login`：接收 `{ password: string }`，与 `config.adminPassword` 比对
- 成功返回 `{ success: true, token, expiresIn }`
- 失败返回 401，记录日志
- 限流：5 秒内最多 5 次失败尝试

### 1.4 WebSocket 认证

**改造文件：** `src/web/websocket.ts`

- 客户端连接时通过 query 参数传递 token：`ws://host:port/ws?token=<jwt>`
- 服务端在 `upgrade` 事件中验证 token，无效则拒绝连接（关闭码 4001）

**改造文件：** `web/src/composables/useWebSocket.ts`

- 连接 URL 中自动附加当前 JWT token

### 1.5 TS 命令权限检查

**改造文件：** `src/bot/instance.ts`

- 实现 `adminGroups` 权限校验（当前仅为 TODO 注释）
- 通过 TS 协议查询发送者的服务器组 ID，与配置的管理员组列表比对
- 权限分级：
  - 管理员命令（`!stop`、`!volume`）— 需要管理员权限
  - 播放命令（`!play`、`!next`）— 所有频道用户可用

### 1.6 前端登录页

**新增文件：** `web/src/views/Login.vue`

- 密码输入框 + 登录按钮
- 登录成功后将 token 存入 `localStorage`，跳转到主页
- 路由守卫：未登录时所有路由重定向到 `/login`
- 401 响应自动清除 token 并跳转登录页

---

## 阶段 2：后端健壮性

> 解决后端设计缺陷：并发安全、资源管理、错误处理、类型安全、配置校验

### 2.1 并发安全

**新增文件：** `src/utils/mutex.ts`

- 简单的异步互斥锁实现（Promise 链 + 排队机制）

**改造文件：** `src/bot/instance.ts`

- `playNext()` 获取互斥锁后执行，完成后释放
- 并发调用排队等待，避免队列跳过多个曲目

**改造文件：** `src/bot/manager.ts`

- 重启 Bot 前等待旧 Bot 音频流完全停止
- 使用 `AbortController` 协调关停和重启

### 2.2 FFmpeg 进程管理

**改造文件：** `src/audio/player.ts`

- 去掉全局 PID 追踪器，在 `AudioPlayer` 实例上管理进程生命周期
- 进程清理流程：SIGTERM → 等 3 秒 → SIGKILL → 等进程 `exit` 事件确认
- 使用 Promise 包装进程退出，确保清理完成后才允许新进程启动
- 音频流增加背压控制：buffer 超过阈值时暂停读取，低于阈值时恢复

### 2.3 数据库操作优化

**改造文件：** `src/data/database.ts`

- 启用 WAL 模式提升并发读写性能
- 添加 prepared statement 缓存，避免重复编译
- `close()` 方法确保所有 prepared statement finalize
- 添加连接健康检查

### 2.4 错误处理统一

- 禁止空 `catch` 块，至少记录日志
- 音乐源搜索使用 `Promise.allSettled` 后，部分失败的结果仍展示给用户
- API 统一错误响应格式：`{ success: false, error: string }`
- Express 全局错误中间件捕获未处理异常

### 2.5 类型安全

**改造文件：** `src/music/netease.ts`

- 为网易云 API 响应定义完整的 TypeScript 接口，消除 `any`

**改造文件：** `src/web/api/music.ts`

- 消除 `as any` 强制转换

**改造文件：** `src/music/provider.ts`

- 可选方法调用前加存在性检查

### 2.6 配置校验

**改造文件：** `src/data/config.ts`

- 校验规则：
  - 端口范围 1-65535
  - 音量范围 0-100
  - 非空字符串
- 启动时校验，非法值报错退出
- 配置文件写入时加文件锁防止并发损坏

### 2.7 API 输入校验

- `platform` 参数白名单校验：`netease` | `qq` | `bilibili` | `youtube`
- `botId` 参数存在性检查
- 用户输入字符串长度/格式限制

---

## 阶段 3：前端基础设施

> 为前端 UI 升级建立基础：Tailwind CSS、设计系统、通用组件库

### 3.1 Tailwind CSS 迁移

**新增依赖：** `tailwindcss`, `@tailwindcss/vite`（Tailwind v4）

**迁移策略：**

- 安装 Tailwind CSS v4，配置 Vite 插件
- 保留 `variables.scss` 中的设计 token 作为参考，迁移到 Tailwind 配置
- 逐页面迁移：Login → Lyrics → History → Queue → Search → Home → Settings
- 迁移完成后移除 `sass` 依赖

**设计系统 token（Tailwind 配置中定义）：**

- 颜色系统：主色、强调色、背景色、文字色、成功/警告/错误色
- 间距系统：基于 4px 网格
- 字体：标题、正文、辅助文字
- 圆角、阴影、过渡动画统一值

### 3.2 通用组件库

**新增目录：** `web/src/components/common/`

| 组件 | 用途 |
|------|------|
| `Toast.vue` | 全局通知提示（成功/失败/警告），自动消失 |
| `LoadingSpinner.vue` | 加载状态指示器 |
| `EmptyState.vue` | 空状态展示 |
| `BaseButton.vue` | 统一按钮样式（主要/次要/危险） |
| `BaseCard.vue` | 卡片容器，统一悬浮效果 |
| `BaseModal.vue` | 模态弹窗基础组件 |
| `SkeletonLoader.vue` | 骨架屏加载占位 |

### 3.3 统一 HTTP 客户端

**新增文件：** `web/src/utils/http.ts`

- 基于 axios 创建实例，添加请求/响应拦截器
- 请求拦截器：自动附加 JWT token
- 响应拦截器：401 跳转登录页，统一错误 Toast
- 消除各组件中的空 catch 块

### 3.4 WebSocket 改进

**改造文件：** `web/src/composables/useWebSocket.ts`

- 连接时附加 JWT token
- 指数退避重连：初始 1 秒，最大 30 秒，最多重试 10 次
- 消息类型运行时校验
- 连接状态暴露给组件：connected / reconnecting / disconnected

### 3.5 路由改进

**改造文件：** `web/src/router/index.ts`

- 路由守卫：未登录重定向 `/login`
- 404 通配路由
- 路由组件懒加载：`() => import('./views/Search.vue')`
- 路由过渡动画：`<RouterView>` 包裹 `<Transition>`

### 3.6 巨型组件拆分

**Settings.vue → 拆分为：**

| 新组件 | 职责 |
|--------|------|
| `SettingsLayout.vue` | Tab 布局容器 |
| `SettingsGeneral.vue` | 通用设置 |
| `SettingsBots.vue` | Bot 管理 |
| `SettingsPlatforms.vue` | 平台登录 |
| `SettingsTheme.vue` | 主题设置 |

**Home.vue → 拆分为：**

| 新组件 | 职责 |
|--------|------|
| `NowPlaying.vue` | 当前播放信息 |
| `QuickActions.vue` | 快捷操作 |
| `RecentHistory.vue` | 最近播放 |

---

## 阶段 4：前端体验升级

> 基于 Tailwind + 组件库，全面升级 UI 体验

### 4.1 搜索页重设计

**改造文件：** `web/src/views/Search.vue`

- 表格列表 → 卡片网格布局
- 每张卡片：封面图、歌曲名、艺术家、平台图标、时长
- 悬浮效果：卡片上移 + 阴影加深 + 播放按钮浮现
- 平台筛选标签栏：全部 | 网易云 | QQ | B站 | YouTube
- 搜索无结果显示 `EmptyState`
- 搜索中显示 `SkeletonLoader`

### 4.2 播放器增强

**改造文件：** `web/src/components/Player.vue`

- 正在播放指示器：三根跳动竖条 CSS animation
- 进度条优化：仅在播放时启用 rAF，暂停/停止时取消
- 当前曲目在队列列表中高亮
- 封面图加载时使用主色模糊背景占位

### 4.3 队列拖拽排序

**改造文件：** `web/src/components/Queue.vue`

- 引入 `vuedraggable` 库
- 拖拽手柄 + 拖拽时半透明效果
- 拖拽完成后调用 API 更新队列顺序

### 4.4 响应式适配

- Mobile-First 策略：
  - 播放器底部栏简化控件（隐藏次要按钮）
  - 搜索结果窄屏下切换单列布局
  - 导航栏小屏幕改为汉堡菜单
  - Settings 页面移动端使用垂直 Tab 布局

### 4.5 页面过渡动画

- 路由切换淡入淡出（150ms）
- 列表项交错进入动画（stagger）

---

## 阶段 5：高级功能

> 新增功能：收藏夹、歌词优化、角色分级

### 5.1 收藏夹功能

**后端：**

- 数据库新增 `favorites` 表：song_id, platform, title, artist, cover_url, created_at
- API 端点：`GET /api/favorites`、`POST /api/favorites`、`DELETE /api/favorites/:id`
- 收藏状态通过 WebSocket 推送同步

**前端：**

- 搜索结果和队列中每首歌旁增加收藏按钮（心形图标）
- 新增 `web/src/views/Favorites.vue` 收藏列表页面
- 导航栏增加收藏入口

### 5.2 歌词页面优化

**改造文件：** `web/src/views/Lyrics.vue`

- 全屏歌词模式：模糊背景 + 居中大字歌词
- 当前歌词行高亮 + 自动滚动
- 修复 interval 累积定时器泄漏

### 5.3 角色分级

**后端：**

- JWT payload 增加 `role` 字段：`admin` | `user`
- 新增配置项 `users: { username, password, role }[]`
- API 中间件增加角色检查

**前端：**

- 登录页支持用户名 + 密码
- 管理功能（Bot 创建/删除、设置修改）仅管理员可见
- 普通用户只能控制播放

---

## 新增依赖汇总

### 后端

| 包名 | 用途 | 阶段 |
|------|------|------|
| `jsonwebtoken` | JWT 签发与验证 | 1 |
| `zod` | 配置校验（可选，也可手动校验） | 2 |

### 前端

| 包名 | 用途 | 阶段 |
|------|------|------|
| `tailwindcss` | CSS 框架 | 3 |
| `@tailwindcss/vite` | Tailwind v4 Vite 插件 | 3 |
| `vuedraggable` | 队列拖拽排序 | 4 |
