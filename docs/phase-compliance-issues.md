# Phase 1-5 合规性检查问题汇总

**检查日期**: 2026-04-29
**依据文档**: `docs/superpowers/specs/2026-04-28-comprehensive-refactoring-design.md`

---

## 总览

| Phase | 名称 | 总体状态 | 核心问题 |
|-------|------|----------|----------|
| 1 | 安全加固 | 部分完成 | 401 未自动跳转登录页 |
| 2 | 后端健壮性 | 基本完成 | 文件锁未实现、音量/非空字符串未校验 |
| 3 | 前端基础设施 | 基本完成 | 空 catch 块未完全清理、401 未跳转 |
| 4 | 前端体验升级 | 基本完成 | 封面图主色模糊背景占位未实现 |
| 5 | 高级功能 | 部分完成 | `requireAdmin` 中间件未应用到路由（关键安全问题） |

---

## Phase 1：安全加固

### 已完成项
- JWT 签发/验证（`src/auth/jwt.ts`）
- API 鉴权中间件（`src/auth/middleware.ts`）
- WebSocket 认证（关闭码 4001）
- TS 命令权限检查（`isInvokerAdmin` + 权限分级）

### 遗留问题

#### P1-1：401 响应未自动跳转登录页
- **文件**: `web/src/utils/http.ts`
- **说明**: 响应拦截器在 401 时清除 token（调用 `authStore.logout()`），但未执行页面跳转到 `/login`。用户需要手动刷新或等待下次路由切换才会被守卫拦截。
- **建议修复**:
  ```ts
  if (error.response?.status === 401) {
    const authStore = useAuthStore();
    authStore.logout();
    window.location.href = '/login';
    return Promise.reject(error);
  }
  ```

#### P1-2：登录端点文件位置与文档不一致
- **文件**: `src/web/server.ts`（实际）vs `src/web/api/auth.ts`（文档指定）
- **说明**: Admin 登录端点内联在 `server.ts` 中，`src/web/api/auth.ts` 仍为音乐平台认证路由（QR / Cookie / SMS）。功能存在，但文件组织不符。

---

## Phase 2：后端健壮性

### 已完成项
- Mutex 互斥锁（`src/utils/mutex.ts`）
- `playNext` 加锁（`src/bot/instance.ts`）
- FFmpeg 进程管理（SIGTERM -> 3秒 -> SIGKILL）
- WAL 模式、prepared statement 缓存、连接健康检查
- 错误处理统一（无空 catch）
- 类型安全（`netease-types.ts`）
- platform 白名单校验

### 遗留问题

#### P2-1：`saveConfig` 未实现文件锁
- **文件**: `src/data/config.ts`
- **说明**: 仅使用 `renameSync` 做原子写入，未使用操作系统文件锁（如 `fs-ext` 或 `proper-lockfile`）防止并发进程同时写入。
- **风险**: 中低。单进程场景下 rename 已足够安全，但多进程并发写入时仍可能丢失数据。

#### P2-2：config 缺少音量 0-100 校验
- **文件**: `src/data/config.ts`
- **说明**: `validateConfig()` 未对音量做 0-100 范围校验。音量校验目前仅在 `AudioPlayer.setVolume()`（运行时）和 API `/volume` 端点（输入层）实现。

#### P2-3：config 缺少非空字符串校验
- **文件**: `src/data/config.ts`
- **说明**: `validateConfig` 中没有对字符串配置项（如 `adminPassword`、`publicUrl`）做非空或长度校验。

#### P2-4：manager.ts 未使用 AbortController
- **文件**: `src/bot/manager.ts`
- **说明**: 通过 `oldBot.disconnect(); await oldBot.onceDisconnected();` 实现了等效逻辑，功能目标已达成，但实现方式与设计文档指定方案不同。

---

## Phase 3：前端基础设施

### 已完成项
- Tailwind CSS v4 + `@tailwindcss/vite`
- 7 个通用组件（`web/src/components/common/`）
- 统一 HTTP 客户端（`web/src/utils/http.ts`）
- WebSocket 指数退避重连（1秒-30秒，最多10次）
- 路由守卫 + 懒加载 + 过渡动画
- Settings.vue / Home.vue 拆分

### 遗留问题

#### P3-1：空 catch 块未完全清理
- **相关文件**:
  - `web/src/views/History.vue:52` — `catch { // Ignore if API not ready }`
  - `web/src/views/Lyrics.vue:103` — `catch { lines.value = []; }`
  - `web/src/components/Queue.vue:90` — `catch { // Ignore }`
  - `web/src/components/Navbar.vue:163` — `catch { // fall through }`
  - `web/src/components/Navbar.vue:178` — `catch { return false; }`
  - `web/src/components/Navbar.vue:219` — `catch { // ignore }`
  - `web/src/router/index.ts:72` — `catch { return next(); }`
- **说明**: 设计文档要求"禁止空 catch 块，至少记录日志"。上述 catch 块基本为空或仅有注释，不符合要求。
- **建议**: 补充至少 `console.warn(...)` 日志。

#### P3-2：401 响应不自动跳转登录页
- **文件**: `web/src/utils/http.ts`
- **说明**: 同 Phase 1 问题 P1-1。`http.ts` 在 401 时仅调用 `authStore.logout()`，未执行路由跳转到 `/login`。

#### P3-3：部分页面仍有旧版 scoped CSS 未完全迁移到 Tailwind
- **相关文件**:
  - `web/src/views/Lyrics.vue` — 大量自定义 CSS（`.lyrics-page`、`.lyrics-overlay` 等）
  - `web/src/views/History.vue` — `.back-btn`、`.page-title` 等
  - `web/src/views/Playlist.vue` — `.playlist-hero`、`.play-all-btn` 等
  - `web/src/views/Setup.vue` — 大量 setup 向导样式
  - `web/src/components/Player.vue` — 播放器样式复杂
  - `web/src/components/Navbar.vue` — 导航栏样式复杂
  - `web/src/components/SongCard.vue` — scoped 样式
  - `web/src/components/Queue.vue` — scoped 样式
- **说明**: 设计文档要求"逐页面迁移：Login -> Lyrics -> History -> Queue -> Search -> Home -> Settings"。目前 Search、Login、Home 已完全使用 Tailwind，但 Lyrics、History、Queue 等页面未完全迁移。

---

## Phase 4：前端体验升级

### 已完成项
- 搜索页卡片网格布局 + 平台筛选 + 悬浮效果
- 播放器跳动指示器 + rAF 进度条优化
- 队列拖拽排序（`vuedraggable`）
- 响应式适配（汉堡菜单 + 移动端 Tab）
- 路由过渡动画 + stagger

### 遗留问题

#### P4-1：封面图主色模糊背景占位未实现
- **文件**: `web/src/components/CoverArt.vue`、`web/src/components/Player.vue`
- **说明**: 设计文档要求"封面图加载时使用主色模糊背景占位"。当前 `CoverArt.vue` 在图片加载前显示的是灰色默认占位（`cover-placeholder` + 音乐图标）。`showShadow` 属性实现的是图片加载后的底部模糊倒影效果，不是加载前的占位。此外，`Player.vue` 中使用 `<CoverArt>` 时未传入 `showShadow`。
- **建议**: 使用 `color-thief` 库或 Canvas 采样提取封面图主色，在图片加载前显示主色模糊背景。

---

## Phase 5：高级功能

### 已完成项
- `favorites` 表 + CRUD API + WebSocket 推送
- 歌词全屏模式 + 高亮滚动 + interval 泄漏修复
- JWT `role` 字段、`users` 配置
- 前端登录支持用户名 + 密码
- 前端按角色显隐菜单（`v-if="authStore.isAdmin"`）

### 遗留问题

#### P5-1：`requireAdmin` 中间件未应用到路由（关键安全问题）
- **文件**: `src/web/server.ts`、`src/auth/middleware.ts`
- **说明**: `createRequireAdmin` 已在 `src/auth/middleware.ts:26-42` 创建，但仅传给了 `createBotRouter`。`player` / `music` / `favorites` 等路由完全没有角色检查。普通用户（`role: user`）通过直接调用 API，仍可执行管理操作。
- **风险**: 高。前端界面虽隐藏了管理功能，但后端未强制限制。
- **建议修复**: 在 `server.ts` 中为管理类接口传入 `requireAdmin`，至少包括：
  - `POST /api/bot/*`（已做）
  - `POST /api/player/:botId/stop`
  - `POST /api/player/:botId/volume`
  - `POST /api/player/:botId/clear`
  - `POST /api/music/quality`

#### P5-2：收藏夹表缺少 `user_id` 字段
- **文件**: `src/data/database.ts`
- **说明**: 设计文档 5.1 只要求 `song_id, platform, title, artist, cover_url, created_at`，当前实现符合。但多用户登录时所有用户共享同一份收藏列表。如需多用户隔离，需后续扩展 `user_id` 字段。

---

## 修复优先级建议

| 优先级 | 问题 ID | 问题描述 | 涉及文件 |
|--------|---------|----------|----------|
| 高 | P5-1 | `requireAdmin` 未应用到路由，管理 API 对普通用户开放 | `src/web/server.ts` |
| 高 | P1-1 / P3-2 | 401 响应不自动跳转登录页 | `web/src/utils/http.ts` |
| 中 | P3-1 | 空 catch 块未完全清理 | `History.vue`, `Queue.vue`, `Navbar.vue` 等 |
| 中 | P2-1 | `saveConfig` 缺少文件锁 | `src/data/config.ts` |
| 低 | P4-1 | 封面图主色模糊背景占位 | `CoverArt.vue`, `Player.vue` |
| 低 | P2-2 / P2-3 | config 缺少音量/非空字符串校验 | `src/data/config.ts` |
| 低 | P1-2 | 登录端点文件位置与文档不一致 | `src/web/server.ts` |
| 低 | P2-4 | manager.ts 未使用 AbortController | `src/bot/manager.ts` |
