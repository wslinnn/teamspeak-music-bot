# Git 历史整理方案

## 目标

将 `main` 分支上领先 `upstream/main` 的 11 个提交，整理成粒度清晰、逻辑独立的新分支，以便向 upstream 发起高质量的 Pull Request。

## 原则

1. **不破坏 main**：从 `upstream/main` 切出新分支进行整理，`main` 保持现状
2. **按功能拆分**：每个提交只做一个逻辑变更，review 者可独立理解
3. **文件级拆分**：由于原始提交已被 squash，内部改动混合，只能按文件归属进行近似拆分
4. **中间状态可运行**：每个提交完成后，系统应保持可编译/可运行（至少不破坏已有功能）
5. **不保留文档清理**：`dedd7fc` 中对 `docs/superpowers/plans/` 和 `docs/superpowers/specs/` 的删除操作不纳入新分支

## 现状

当前 `main` 领先 `upstream/main` 共 11 个提交：

| # | Commit | 说明 | 文件数 | 问题 |
|---|--------|------|--------|------|
| 1 | `dedd7fc` | chore: 清理文档并更新项目配置 | 19 | 混合了文档删除和依赖安装 |
| 2 | `871a2ba` | feat: 后端核心重构与认证模块 | 30 | 混合了 JWT、并发工具、播放器、数据库、API 重构 |
| 3 | `069223b` | feat: 前端整体重设计、认证流程与组件库 | 50 | 混合了 Tailwind、组件库、认证、页面、收藏夹、播放器 |
| 4 | `c5cca99` | feat: Cookie 认证迁移、歌词同步与音频修复 | 30 | 本身粒度合理，但跨越前后端 |
| 5 | `24c6db9` | fix: 修复播放状态同步、乐观更新与进度校准 | 3 | 粒度很好 |
| 6 | `8b19694` | feat: TS3 服务器树可视化与频道切换 | 9 | 粒度很好 |
| 7 | `d2b3bb5` | feat: 移动端播放控制面板与音量防抖 | 2 | 粒度很好 |
| 8 | `90332e1` | ci: 添加 Docker 镜像与发布包手动构建流程 | 1 | 粒度很好 |
| 9 | `004111c` | perf: 优化前端动画性能并减少布局抖动 | 14 | 粒度合理 |
| 10 | `ee1c270` | fix: 默认关闭机器人播放时的频道简介更新 | 1 | 粒度很好 |
| 11 | `fa13761` | ci: Docker release 导出 latest tag，新增 prod compose 配置 | 2 | 粒度很好 |

## 新提交序列（19 个）

从 `upstream/main` 开始，按以下顺序逐个提交：

### 1. `chore: 安装测试框架并更新前后端构建配置`

**来源**：`dedd7fc` 中的配置相关改动  
**文件**：
- `package.json`
- `package-lock.json`
- `vitest.config.ts`
- `web/.gitignore`
- `web/package.json`
- `web/package-lock.json`
- `web/vite.config.ts`
- `.gitignore`（根目录，保留其非文档相关的改动）

**说明**：纯依赖和构建配置更新，不涉及业务代码。为后续所有提交提供测试和构建基础设施。

---

### 2. `feat: JWT 鉴权系统与登录 API`

**来源**：`871a2ba` 中的认证新增文件  
**文件**：
- `src/auth/jwt.ts`
- `src/auth/jwt.test.ts`
- `src/auth/middleware.ts`
- `src/auth/middleware.test.ts`
- `src/auth/rate-limit.ts`
- `src/auth/rate-limit.test.ts`

**说明**：纯新增文件，无修改现有文件。提供 token 生成/验证、认证中间件、速率限制等基础能力。

**注意**：`src/web/api/auth.ts` 也涉及登录 API，但该文件同时包含平台 Cookie 认证逻辑（网易云/QQ），放在提交 8 中一起处理更合理。

---

### 3. `feat: 后端并发安全与输入校验工具`

**来源**：`871a2ba` 中的工具类新增  
**文件**：
- `src/utils/mutex.ts`
- `src/utils/mutex.test.ts`
- `src/utils/validate.ts`
- `src/utils/validate.test.ts`
- `src/audio/queue.ts`
- `src/audio/queue.test.ts`

**说明**：新增互斥锁、输入校验工具和音频队列的单元测试。这些是独立的基础工具，不依赖其他业务代码。

---

### 4. `feat: FFmpeg 音频播放器改进`

**来源**：`871a2ba` 中的播放器改动  
**文件**：
- `src/audio/player.ts`

**说明**：音频播放器的核心重构，使用系统 FFmpeg 替代静态二进制，提升兼容性。

---

### 5. `feat: Bot 管理与配置校验`

**来源**：`871a2ba` 中的 Bot 和配置改动  
**文件**：
- `src/bot/instance.ts`
- `src/bot/manager.ts`
- `src/data/config.ts`
- `src/data/config.test.ts`

**说明**：Bot 实例增加互斥锁和权限检查，配置增加校验逻辑。

---

### 6. `feat: 数据库扩展与音乐源类型安全`

**来源**：`871a2ba` 中的数据层和音乐源改动  
**文件**：
- `src/data/database.ts`
- `src/data/database.test.ts`
- `src/music/provider.ts`
- `src/music/netease-types.ts`
- `src/music/netease.ts`

**说明**：数据库增加收藏夹表和 WAL 模式，Netease 音乐源增加 TypeScript 类型定义。

---

### 7. `feat: 后端 API 路由重构`

**来源**：`871a2ba` 中的 API 层改动  
**文件**：
- `src/web/api/bot.ts`
- `src/web/api/favorites.ts`
- `src/web/api/music.ts`
- `src/web/api/player.ts`

**说明**：各 API 路由模块的重构和新增（如 favorites API）。此时 `src/web/api/auth.ts` 暂不提交（它同时涉及平台认证，和提交 8 一起处理）。

---

### 8. `feat: 服务端集成认证与 WebSocket`

**来源**：`871a2ba` 中的服务端集成改动  
**文件**：
- `src/web/server.ts`
- `src/web/websocket.ts`
- `src/web/api/auth.ts`
- `src/index.ts`

**说明**：
- `server.ts`：注册认证中间件、setup 端点、所有 API 路由、全局 auth 中间件
- `websocket.ts`：WebSocket 客户端认证验证
- `auth.ts`：登录 API + 平台 Cookie 认证（网易云/QQ）
- `index.ts`：更新依赖注入，传入 cookieStore 等

**交叉依赖说明**：这是后端重构的"集成交付"提交。在此提交之前，单独的新增文件（如 `src/auth/*.ts`、`src/web/api/*.ts`）尚未被服务端实际引用；此提交将它们全部串联起来。由于 `server.ts` 同时涉及认证、setup、favorites 等多个功能，无法进一步拆分，只能作为整体集成提交。

---

### 9. `feat: 前端 Tailwind CSS 设计系统与通用组件库`

**来源**：`069223b` 中的样式和基础组件  
**文件**：
- `web/src/styles/index.css`
- `web/src/main.ts`
- `web/src/components/common/BaseButton.vue`
- `web/src/components/common/BaseCard.vue`
- `web/src/components/common/BaseModal.vue`
- `web/src/components/common/EmptyState.vue`
- `web/src/components/common/LoadingSpinner.vue`
- `web/src/components/common/SkeletonLoader.vue`
- `web/src/components/common/Toast.vue`
- `web/src/components/common/ToastContainer.vue`
- `web/src/components/common/index.ts`

**说明**：从 SCSS 迁移到 Tailwind CSS，建立通用组件库（按钮、卡片、弹窗、加载状态等）。

---

### 10. `feat: 前端认证流程与 HTTP 基础设施`

**来源**：`069223b` 中的认证和基础设施  
**文件**：
- `web/src/views/Login.vue`
- `web/src/stores/auth.ts`
- `web/src/utils/http.ts`
- `web/src/router/index.ts`
- `web/src/composables/useToast.ts`
- `web/src/stores/toast.ts`
- `web/src/utils/format.ts`

**说明**：登录页面、Pinia 认证状态管理、HTTP 拦截器（401 跳转）、路由守卫、Toast 通知系统、格式化工具。

---

### 11. `feat: 前端页面重构`

**来源**：`069223b` 中的页面组件  
**文件**：
- `web/src/views/Home.vue`
- `web/src/views/Settings.vue`
- `web/src/views/Favorites.vue`
- `web/src/components/home/NowPlaying.vue`
- `web/src/components/home/QuickActions.vue`
- `web/src/components/home/RecentHistory.vue`
- `web/src/components/settings/SettingsBots.vue`
- `web/src/components/settings/SettingsGeneral.vue`
- `web/src/components/settings/SettingsLayout.vue`
- `web/src/components/settings/SettingsPlatforms.vue`
- `web/src/components/settings/SettingsTheme.vue`
- `web/src/stores/favorites.ts`
- `web/src/components/FavoriteButton.vue`
- `web/src/utils/platform.ts`
- `web/src/App.vue`
- `web/src/components/Navbar.vue`
- `web/src/components/CoverArt.vue`
- `web/src/components/Queue.vue`
- `web/src/components/SongCard.vue`
- `web/src/components/SongGridCard.vue`
- `web/src/views/History.vue`
- `web/src/views/Playlist.vue`
- `web/src/views/Search.vue`
- `web/src/views/Setup.vue`
- `web/src/views/NotFound.vue`

**说明**：首页和设置页拆分为子组件，新增收藏夹页面和状态管理，以及其他页面的适配改造。

---

### 12. `feat: 播放器、歌词与 WebSocket 改进`

**来源**：`069223b` 中的播放器和歌词  
**文件**：
- `web/src/components/Player.vue`
- `web/src/views/Lyrics.vue`
- `web/src/components/PlayingIndicator.vue`
- `web/src/composables/useWebSocket.ts`
- `web/src/stores/player.ts`

**说明**：播放器 UI 重设计、歌词页面、播放状态指示器、WebSocket 实时同步、Pinia player store 重构。

---

### 13. `feat: Cookie 认证迁移、歌词同步与音频修复`

**来源**：`c5cca99`  
**文件**：`c5cca99` 修改的全部文件  
**说明**：069223b 之后的重要功能补充。包含：
- 平台 Cookie 认证迁移（网易云/QQ）
- 歌词同步显示
- 音频播放修复
- 前端收藏夹和播放器的进一步完善

---

### 14. `fix: 播放状态同步、乐观更新与进度校准`

**来源**：`24c6db9`  
**文件**：
- `src/web/api/player.ts`
- `web/src/composables/useWebSocket.ts`
- `web/src/stores/player.ts`

**说明**：修复播放状态在前端和后端之间的同步偏差，优化乐观更新策略，校准进度条显示。

---

### 15. `feat: TS3 服务器树可视化与频道切换`

**来源**：`8b19694`  
**文件**：`8b19694` 修改/新增的全部文件  
**说明**：新增 TS3 服务器树可视化组件，支持在 WebUI 中查看频道结构并切换频道。

---

### 16. `feat: 移动端播放控制面板与音量防抖`

**来源**：`d2b3bb5`  
**文件**：
- `web/src/components/MobilePlayerControls.vue`
- `web/src/components/Player.vue`

**说明**：新增移动端专用的播放控制面板，优化音量调节的防抖处理。

---

### 17. `perf: 优化前端动画性能并减少布局抖动`

**来源**：`004111c`  
**文件**：`004111c` 修改/新增的全部文件  
**说明**：使用 `requestAnimationFrame` 优化动画，减少强制同步布局（layout thrashing），提升移动端性能。

**注意**：该提交新增了一个 `docs/raf-optimization-analysis.md` 技术文档。如果需要保留此文档，可在本提交中一并纳入；如果不需要，可在提交时排除。

---

### 18. `fix: 默认关闭机器人播放时的频道简介更新`

**来源**：`ee1c270`  
**文件**：
- `src/data/database.ts`

**说明**：将 `profile_channel_desc_enabled` 默认值从 `true` 改为 `false`，避免新配置或重置后的机器人自动修改频道简介。

---

### 19. `ci: Docker 镜像构建与发布流程`

**来源**：`90332e1` + `fa13761`  
**文件**：
- `.github/workflows/release-docker.yml`
- `scripts/docker/docker-compose.prod.yml`

**说明**：GitHub Actions 手动构建流程，导出镜像时同时包含版本 tag 和 `latest` tag，新增适用于预构建镜像的 docker-compose.prod.yml。

---

## 操作步骤

```bash
# 1. 确保 upstream 远程已配置且最新
git fetch upstream

# 2. 从 upstream/main 切出新分支
git checkout -b feature/refactor-v2 upstream/main

# 3. 逐组提取文件并提交
#    对每组文件执行：
#    git checkout main -- <file1> <file2> ...
#    git add <file1> <file2> ...
#    git commit -m "<提交信息>"
#
#    特别注意：
#    - 提交 1 中不提取 docs/ 目录的删除操作
#    - 提交 8 中的 server.ts / websocket.ts / auth.ts / index.ts 必须一起提交
#    - 提交 11 文件较多，可按子目录分批 add 再一次性 commit

# 4. 完成后对比确认文件内容一致
git diff main --stat
# 应显示无差异（除 docs/superpowers/ 的删除外）

# 5. Push 新分支
git push -u origin feature/refactor-v2

# 6. 从 feature/refactor-v2 向 upstream/main 发起 PR
```

## 依赖关系与提交顺序约束

```
提交 1 (配置)
  └── 提交 2-8 (后端，任意顺序，但 8 必须在 2-7 之后)
        └── 提交 9-12 (前端，任意顺序)
              └── 提交 13-18 (功能增强与修复，按时间顺序)
                    └── 提交 19 (CI)
```

**硬性依赖**：
- 提交 8 必须在提交 2-7 之后（server.ts 引用了这些新增模块）
- 提交 10 必须在提交 9 之后（Login.vue 使用了通用组件和样式）
- 提交 11 必须在提交 9-10 之后（页面使用通用组件和认证状态）
- 提交 12 必须在提交 11 之后（Player 依赖 stores/player）
- 提交 13 必须在提交 8 和 12 之后（Cookie 认证依赖后端 auth 和前端 player）
- 提交 14 必须在提交 12-13 之后（修复 player 同步）
- 提交 15 必须在提交 8 之后（TS3 API 依赖后端 bot API）
- 提交 16 必须在提交 12 之后（MobilePlayerControls 修改 Player.vue）
- 提交 17 必须在提交 12 和 15-16 之后（动画优化涉及 Player、ServerTreeDrawer、MobilePlayerControls）

**软性依赖**（建议顺序，但交换不影响编译）：
- 提交 2-7 之间可以任意排序（它们都是独立新增/修改，直到提交 8 才集成）
- 提交 9-12 之间理论上可以任意排序（但按上述顺序最清晰）

## 限制与已知不完美

1. **文件级拆分的局限**：由于原始提交已被 squash，某些文件（如 `server.ts`、`auth.ts`、`player.ts`）内部的改动跨越了多个功能。这些文件只能作为整体放在某一个提交中，无法做到完美的 hunk 级别拆分。

2. **中间状态的功能缺失**：在提交 2-7 完成后、提交 8 完成前，新增的后端模块（如 JWT、mutex）尚未被 `server.ts` 引用，因此部分功能在浏览器中不可访问。但这不影响系统编译和运行。

3. **c5cca99 跨越前后端**：提交 13 同时修改了后端 API 和前端组件，无法进一步拆分，否则会导致前后端状态不一致。

4. **docs/raf-optimization-analysis.md**：提交 17 中包含此文档。如需排除，在 `git checkout main -- <files>` 时不包含它即可。

## 验证清单

整理完成后，建议检查以下内容：

- [ ] `git diff upstream/main..feature/refactor-v2 --stat` 与 `git diff upstream/main..main --stat` 基本一致（除 docs/superpowers/ 外）
- [ ] 新分支可以正常构建：`npm ci && npm run build`
- [ ] 新分支可以正常启动：无语法错误，数据库初始化正常
- [ ] 提交历史在 GitHub 上看起来清晰，每个提交都有明确主题和合理文件数

## 后续建议

整理完成后：
1. 从 `feature/refactor-v2` 向 `upstream/main` 发起一个 PR（或按功能拆成 2-3 个 PR）
2. `main` 分支可保留作为备份，或后续删除/归档
3. 后续开发继续基于新分支或重新基于 upstream/main 切分支，保持小粒度提交习惯
