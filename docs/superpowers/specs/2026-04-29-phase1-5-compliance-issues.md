# Phase 1-5 合规性审查问题清单

> 审查日期: 2026-04-29
> 对照 Spec: `docs/superpowers/specs/2026-04-28-comprehensive-refactoring-design.md`

---

## 整体得分

| 阶段 | Done | Partial | Missing | Broken |
|------|------|---------|---------|--------|
| Phase 1 安全 | 20 | 3 | 0 | 1 |
| Phase 2 后端健壮 | 19 | 6 | 2 | 0 |
| Phase 3 前端基础设施 | 16 | 3 | 2 | 0 |
| Phase 4 体验升级 | 14 | 3 | 0 | 0 |
| Phase 5 高级功能 | 13 | 3 | 0 | 0 |

---

## Critical（必须修复）

### C1. Phase 1: 限速器无效

**文件:** `src/web/server.ts:97`

登录失败路径从未调用 `loginLimiter.recordFailure(ip)`，导致限速形同虚设——无论多少次失败尝试都不会被拦截。

**修复:** 在 401 响应前添加 `loginLimiter.recordFailure(ip);`

---

### C2. Phase 5: `requireAdmin` 中间件未应用到任何路由

**文件:** `src/web/server.ts:57`

`createRequireAdmin(jwtSecret)` 已创建但返回值未被使用。机器人创建/删除/启动/停止、设置保存等管理 API 对所有认证用户开放（包括 `user` 角色）。

**修复:** 将 `requireAdmin` 中间件应用到 `createBotRouter` 内的写入路由（POST /、DELETE /:id、POST /:id/start、POST /:id/stop、POST /settings）。

---

### C3. Phase 2: 数据库健康检查缺失

**文件:** `src/data/database.ts`

无连接健康检查（无 `PRAGMA quick_check`、`PRAGMA integrity_check` 或 `SELECT 1` 探测）。`BotDatabase` 接口未暴露任何健康检查方法。

**修复:** 在 `BotDatabase` 接口添加 `healthCheck(): boolean` 方法，实现为 `db.pragma("quick_check")` 。

---

### C4. Phase 2: 配置文件写入无文件锁

**文件:** `src/data/config.ts:94-97`

`saveConfig()` 使用 `writeFileSync` 无锁机制。并发请求快速连续保存配置时存在数据损坏风险。

**修复:** 使用 `proper-lockfile` 或写入临时文件 + 原子重命名模式。

---

## Important（应该修复）

### I1. Phase 3: 11 个文件仍使用 `lang="scss"`，sass 依赖未移除

**文件:**
- `web/src/App.vue`
- `web/src/views/History.vue`
- `web/src/views/Lyrics.vue`
- `web/src/views/Setup.vue`
- `web/src/views/Favorites.vue`
- `web/src/views/Playlist.vue`
- `web/src/components/CoverArt.vue`
- `web/src/components/Navbar.vue`
- `web/src/components/Player.vue`
- `web/src/components/SongCard.vue`
- `web/src/components/Queue.vue`

**影响:** Spec 3.1 要求迁移完成后移除 `sass` 依赖。当前 `sass ^1.87.0` 仍在 devDependencies 中。

---

### I2. Phase 3: 前端存在多个空 catch 块

**文件:**
- `web/src/stores/player.ts:207, 218, 229` — `catch { // ignore }`
- `web/src/stores/favorites.ts:24` — `catch {}`
- `web/src/views/Settings.vue:149, 169, 269, 305` — `catch { /* ignore */ }`
- `web/src/App.vue:33` — `.catch(() => {})`

**影响:** Spec 3.3 要求消除各组件中的空 catch 块。

---

### I3. Phase 2: `auth.ts` 错误格式不一致

**文件:** `src/web/api/auth.ts:34, 47, 76, 96, 117`

错误响应返回 `{ error: string }` 而非统一格式 `{ success: false, error: string }`。

**修复:** 所有错误响应添加 `success: false` 字段。

---

### I4. Phase 2: 后端几处空 catch 块

**文件:**
- `src/music/netease.ts:294` — `catch { // ignore }`
- `src/bot/instance.ts:201` — `catch { /* ignore */ }`
- `src/audio/player.ts:195` — `catch { // Process already gone }`

**影响:** Spec 2.4 要求至少进行日志记录。

---

### I5. Phase 1: 登录失败未记录日志

**文件:** `src/web/server.ts:97`

Spec 1.3 要求"失败返回 401，记录日志"。当前失败路径只返回 401，未调用 `logger.warn`。

**修复:** 在 401 响应前添加 `logger.warn({ ip }, "Login failed")` 。

---

### I6. Phase 1: JWT 过期时间不可配置

**文件:** `src/auth/jwt.ts:4`

Spec 1.1 要求"Token 有效期：24 小时（可通过 config 配置）"。当前硬编码 `const JWT_EXPIRES_IN = "24h"`。

**修复:** 在 `BotConfig` 添加 `jwtExpiresIn` 字段，传入 `signToken` 函数。

---

### I7. Phase 2: `bot.ts` 有 7 处 `as any` 类型断言

**文件:** `src/web/api/bot.ts`

使用 `(req as any).validatedId` 而非 Express 类型扩展。`player.ts` 已使用 `declare module` 扩展 `Request` 类型，bot 路由应采用相同模式。

---

## Minor（次要偏差，可接受）

### M1. Phase 2: AbortController 改用 `onceDisconnected()` 事件

Spec 2.1 要求使用 `AbortController` 协调关闭。实际使用 `onceDisconnected()` + 5s 超时，功能等效。

### M2. Phase 4: 封面模糊用实际图片而非纯色主色调

Spec 4.2 要求"主色调模糊背景占位"。实际使用封面图自身 blur 效果，视觉连续性更好。

### M3. Phase 4: 搜索网格最窄 2 列而非 1 列

Spec 4.4 要求极窄屏切换单列。实际最窄为 `grid-cols-2`，360px+ 屏幕可用。

### M4. Phase 4: 设置页移动端用水平标签页

Spec 4.4 要求"移动端竖向标签页"。实际移动端水平滚动标签页（常见移动端模式），桌面端竖向。

### M5. Phase 3: 401 由路由守卫间接重定向

Spec 1.6 要求"401 响应自动跳转登录页"。HTTP 拦截器只调用 `authStore.logout()` 清除 token，由路由守卫在下一次导航时重定向。功能正常。

### M6. Phase 1: 登录端点内联在 server.ts 而非独立文件

Spec 1.3 指定 `src/web/api/auth.ts`。实际登录逻辑内联在 `src/web/server.ts`。功能正确但偏离文件组织规划。

### M7. Phase 2: 损坏的 config JSON 静默恢复为默认值

`loadConfig()` 捕获 JSON 解析错误后返回 defaults 而非崩溃退出。考虑至少记录警告。

---

## 各阶段详细审查结果

### Phase 1: 安全加固 (25 项)

| # | 要求 | 状态 | 备注 |
|---|------|------|------|
| 1.1a | 使用 `jsonwebtoken` 库 | Done | |
| 1.1b | Token payload 含 `role` 字段 | Done | |
| 1.1c | Token 24h 有效期，可通过 config 配置 | Partial | 硬编码，不在 config 中 |
| 1.1d | HMAC 从 adminPassword 派生 JWT secret | Done | |
| 1.1e | 无 refresh token | Done | |
| 1.2a | `requireAuth` 中间件提取 Bearer token | Done | |
| 1.2b | 白名单: POST /api/auth/login | Done | |
| 1.2c | 白名单: GET /api/config/public-url | Done | |
| 1.2d | 白名单: 静态文件 | Done | |
| 1.2e | 其他 /api/* 路由需认证 | Done | |
| 1.3a | POST /api/auth/login 接受 password | Done | |
| 1.3b | 比对 config.adminPassword | Done | |
| 1.3c | 成功返回 `{ success, token, expiresIn }` | Done | |
| 1.3d | 失败返回 401 并记录日志 | Partial | 返回 401 但未记录日志 |
| 1.3e | 限速: 5 次/5 秒 | **Broken** | `recordFailure` 未被调用 |
| 1.4a | WS 客户端通过 query 传 token | Done | |
| 1.4b | WS 服务端校验 token，失败返回 4001 | Done | |
| 1.4c | 前端 WS URL 附加 JWT token | Done | |
| 1.5a | adminGroups 权限检查已实现 | Done | |
| 1.5b | 查询 TS server groups 比对 config | Done | |
| 1.5c | admin 命令需要 admin 权限 | Done | |
| 1.5d | play 命令对所有频道用户可用 | Done | |
| 1.6a | 密码输入框 + 登录按钮 | Done | |
| 1.6b | 成功后存储 token 到 localStorage | Done | |
| 1.6c | 路由守卫重定向到 /login | Done | |
| 1.6d | 401 自动清除 token 并跳转登录页 | Partial | 清除 token 但未直接跳转 |

### Phase 2: 后端健壮 (27 项)

| # | 要求 | 状态 | 备注 |
|---|------|------|------|
| 2.1.1 | Mutex 实现 | Done | |
| 2.1.2 | `playNext()` 获取 Mutex | Done | |
| 2.1.3 | 等待旧 bot 停止 + AbortController | Partial | `onceDisconnected()` 有效但未用 AbortController |
| 2.2.1 | 无全局 PID，实例级生命周期 | Done | |
| 2.2.2 | SIGTERM -> 3s -> SIGKILL -> exit 事件 | Done | |
| 2.2.3 | 退出 Promise 确保清理完成 | Partial | sessionId 隔离等效，无显式 exit promise |
| 2.2.4 | 背压控制 | Done | |
| 2.3.1 | WAL 模式 | Done | |
| 2.3.2 | 预处理语句缓存 | Done | |
| 2.3.3 | `close()` 终结预处理语句 | Done | 依赖 better-sqlite3 自动终结 |
| 2.3.4 | 连接健康检查 | Missing | 完全未实现 |
| 2.4.1 | 无空 catch 块 | Partial | netease.ts、instance.ts 仍有空 catch |
| 2.4.2 | 搜索使用 Promise.allSettled | Done | |
| 2.4.3 | 统一错误格式 `{ success, error }` | Partial | auth.ts 缺少 `success` 字段 |
| 2.4.4 | Express 全局错误中间件 | Done | |
| 2.5.1 | netease.ts 无 any | Done | |
| 2.5.2 | music.ts 无 as any | Done | |
| 2.5.3 | bot.ts 无 as any | Partial | 7 处 `as any`（超出 spec 范围） |
| 2.5.4 | 可选方法存在性检查 | Done | |
| 2.6.1 | 端口范围 1-65535 | Done | |
| 2.6.2 | 音量范围 0-100 | Done | 运行时验证 |
| 2.6.3 | 非空字符串 | Partial | 部分字段未验证 |
| 2.6.4 | 启动时验证，无效值报错退出 | Partial | 损坏 JSON 静默恢复默认值 |
| 2.6.5 | 配置文件写入加锁 | Missing | |
| 2.7.1 | platform 白名单 | Done | |
| 2.7.2 | botId 存在性检查 | Done | |
| 2.7.3 | 输入字符串长度/格式限制 | Partial | 工具存在但未普遍应用 |

### Phase 3: 前端基础设施 (21 项)

| # | 要求 | 状态 | 备注 |
|---|------|------|------|
| 3.1a | 安装 Tailwind CSS v4 | Done | |
| 3.1b | 迁移设计 token 到 Tailwind | Done | |
| 3.1c | 逐页面迁移到 Tailwind | Partial | 11 文件仍用 `lang="scss"` |
| 3.1d | 移除 sass 依赖 | Missing | `sass ^1.87.0` 仍在 |
| 3.1e | 设计 token: 颜色/间距/字体/圆角/阴影/过渡 | Partial | 阴影和间距 token 未显式定义 |
| 3.2a | common/: Toast, LoadingSpinner, EmptyState | Done | |
| 3.2b | common/: BaseButton, BaseCard, BaseModal, SkeletonLoader | Done | |
| 3.3a | axios http.ts 实例 + 拦截器 | Done | |
| 3.3b | 请求拦截器附加 JWT token | Done | |
| 3.3c | 响应拦截器: 401 跳转 + 统一错误 Toast | Partial | 401 清除 token 但未直接跳转 |
| 3.3d | 消除空 catch 块 | Missing | 多处空 catch |
| 3.4a | WS 连接附加 JWT token | Done | |
| 3.4b | 指数退避重连: 1s 初始，30s 最大，10 次 | Done | |
| 3.4c | 消息类型运行时校验 | Done | |
| 3.4d | 暴露连接状态 connected/reconnecting/disconnected | Done | |
| 3.5a | 路由守卫: 未登录重定向 /login | Done | |
| 3.5b | 404 通配路由 | Done | |
| 3.5c | 路由懒加载 | Done | |
| 3.5d | Transition 包裹 RouterView | Done | |
| 3.6a | Settings 拆分为 5 子组件 | Done | |
| 3.6b | Home 拆分为 3 子组件 | Done | |

### Phase 4: 体验升级 (17 项)

| # | 要求 | 状态 | 备注 |
|---|------|------|------|
| 4.1a | 搜索卡片网格布局 | Done | |
| 4.1b | 卡片悬浮效果 | Done | |
| 4.1c | 平台筛选标签 | Done | |
| 4.1d | 搜索无结果空状态 | Done | |
| 4.1e | 搜索骨架屏加载 | Done | |
| 4.2a | 正在播放跳动条动画 | Done | |
| 4.2b | rAF 进度条仅在播放时运行 | Done | |
| 4.2c | 队列列表当前歌曲高亮 | Done | |
| 4.2d | 封面模糊背景占位 | Partial | 用图片 blur 而非纯色 |
| 4.3a | vuedraggable 集成 | Done | |
| 4.3b | 拖拽手柄 + 半透明效果 | Done | |
| 4.3c | 拖拽完成后调 API 更新顺序 | Done | |
| 4.4a | 移动端播放器简化控件 | Done | |
| 4.4b | 极窄屏搜索结果单列 | Partial | 最窄 2 列 |
| 4.4c | 移动端汉堡菜单 | Done | |
| 4.4d | 移动端设置页竖向标签页 | Partial | 移动端水平、桌面端竖向 |
| 4.4e | SongCard 窄屏隐藏专辑/时长 | Done | |
| 4.5a | 路由切换淡入淡出 150ms | Done | |
| 4.5b | 列表项交错入场动画 | Done | |

### Phase 5: 高级功能 (16 项)

| # | 要求 | 状态 | 备注 |
|---|------|------|------|
| 5.1-后端 | favorites 数据库表 | Done | |
| 5.1-后端 | GET /api/favorites | Done | |
| 5.1-后端 | POST /api/favorites | Done | |
| 5.1-后端 | DELETE /api/favorites/:id | Done | |
| 5.1-后端 | WebSocket 广播同步收藏 | Done | |
| 5.1-前端 | 收藏按钮（心形图标） | Done | |
| 5.1-前端 | Favorites.vue 页面 | Done | |
| 5.1-前端 | 导航栏收藏入口 | Done | |
| 5.2 | 全屏歌词模式 | Done | |
| 5.2 | 当前歌词高亮 + 自动滚动 | Done | |
| 5.2 | 修复 interval 定时器泄漏 | Done | |
| 5.3-后端 | JWT payload 含 role 字段 | Done | |
| 5.3-后端 | users 配置数组 | Done | |
| 5.3-后端 | API 中间件角色检查 | Partial | 中间件存在但未应用到路由 |
| 5.3-前端 | 登录页支持用户名+密码 | Done | |
| 5.3-前端 | 管理功能仅管理员可见 | Partial | 前端隐藏正确，后端未强制 |
