# Fork 维护说明

本仓库是 [ZHANGTIANYAO1/teamspeak-music-bot](https://github.com/ZHANGTIANYAO1/teamspeak-music-bot) 的 fork，主线（`main`）已**收敛到上游底座**：`dev` 分支基于 `upstream/main`，按功能选择性保留自有资产，目标是恢复 `git merge upstream/main` 的能力。

## 分支结构

| 分支/标签 | 说明 |
|-----------|------|
| `main` | 当前主力分支（由 dev 验收后交接而来） |
| `upstream-ref` | 上游代码的本地只读参考副本，移植/重放时用于对照，**不做提交** |
| `legacy-main-2026-08` | 收敛前的旧主线（Tailwind 重写 + 自研 JWT 鉴权时代的存档） |
| `upstream/main` | 上游远端跟踪分支 |

对照用法：

```bash
git diff upstream-ref -- src/audio/queue.ts   # 看上游版与工作区的差异
git show upstream-ref:src/bot/instance.ts     # 直接查看上游版某文件
```

## 与上游的结构性差异（为什么不能直接吸收上游前端）

- 前端：本 fork 使用 **Tailwind CSS 4 + Vite 6**（上游为 SCSS + Vite 5）。`web/` 由本 fork 完全接管，上游新增的前端页面（如已存队列、用户管理）需用 Tailwind 自行实现，只参考上游的交互逻辑与 API 契约。
- 鉴权：使用上游的会话式多用户体系（`/api/session`），旧主线的 JWT 鉴权已废弃。
- 路由冲突处理：上游 `/api/favorites` 是按用户的歌单收藏，本 fork 的歌曲收藏挂载在 **`/api/song-favorites`**。

## 同步上游的例行流程

```bash
git fetch upstream
git merge upstream/main
# 1) 前端冲突由 merge=ours 自动保留我们的版本（见下节）
# 2) 清理上游新增的、未被我们引用的 web 文件：
git diff --name-only upstream/main -- web/   # 人工确认后 git rm 未引用的 SCSS 页面
# 3) 跑测试
npm install && npm run build && npm test
# 4) 更新参考分支
git branch -f upstream-ref upstream/main
```

预期冲突只剩 README / package.json / package-lock.json 的小摩擦。

## 协作者一次性配置

`web/**` 的 keep-ours 依赖自定义 merge driver，克隆后执行一次：

```bash
git config merge.ours.driver true
```

## Windows 开发注意

- `npm install` 会从 `package-lock.json` 里删掉 `libc` 字段（平台噪音）。**不要提交 lockfile 的这类变更**，保持与上游 lock 一致以减少合并冲突：`git checkout -- package-lock.json`。
- 原生模块探测类测试（ffmpeg 探测）在 Windows 上需要超过 vitest 默认 5s 的超时，`vitest.config.ts` 已配置 `testTimeout: 30000`。

## 本 fork 独有功能的代码入口

| 功能 | 入口 |
|------|------|
| 歌曲收藏 | `src/web/api/song-favorites.ts`（路由）、`src/data/database.ts` 的 `addSongFavorite` 等、WS 事件 `favoritesChanged` |
| 频道树 | `src/web/api/bot.ts` 的 `/:id/server-tree` 与 `/:id/join-channel`、`src/bot/instance.ts` 的 `getServerTree()/joinChannelById()` |
| 队列重排序 | `src/audio/queue.ts` 的 `reorder()`、`!reorder` 命令、`POST /api/player/:botId/queue/reorder` |
| WebSocket 广播扩展 | `src/web/websocket.ts` 的 `controller.broadcast`（fork 暴露） |
| Docker 预构建发布 | `.github/workflows/release-docker.yml`、`scripts/docker/docker-compose.prod.yml` |

## PR 回上游候选

以下功能具有普适价值，合入上游后可删除本 fork 的重放代码：

1. 队列手动重排序（`queue.reorder` + `!reorder` + REST 端点）
2. 歌曲收藏（跨客户端，与上游按用户的歌单收藏互补）
3. TS 服务器频道树端点（`server-tree` / `join-channel`）

## 提交规范

与上游一致：`type(scope): subject`。内部实现/基础设施用英文 subject，用户可见行为用中文；移植类提交在 body 注明来源（如 `port from legacy main`）。详见 `docs/dev-restack-plan.md` 的提交规范一节。
