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

- 前端：本 fork 使用 **Tailwind CSS 4 + Vite 6**（上游为 SCSS + Vite 6，2026-08 已同步升级到 Vite 6；构建栈同代，样式体系仍是接管边界）。`web/` 由本 fork 完全接管，上游新增的前端页面（如已存队列、用户管理）需用 Tailwind 自行实现，只参考上游的交互逻辑与 API 契约。前端逐项差异见 `docs/frontend-diff-vs-upstream.md`。
- 鉴权：使用上游的会话式多用户体系（`/api/session`），旧主线的 JWT 鉴权已废弃。**Bearer 凭据三分流**（v1.15.2 合并起）：`X-API-Key` 头或 `tsmb_` 前缀 Bearer 走上游 API key（`API_KEY_RAW_PREFIX`），其余 Bearer 走 fork 桌面端 client token，无凭据回落 cookie 会话——动 `requireAuth.ts` 时三分支顺序与门槛不可破坏，上游测试与 fork 测试同时守护它。
- 路由冲突处理：上游 `/api/favorites` 是按用户的歌单收藏，本 fork 的歌曲收藏挂载在 **`/api/song-favorites`**。两者语义并存、互不冲突（一个收藏歌单、一个收藏歌曲）；`/api/favorites` 族（搜索/歌单页红心 + Library 音乐库页）已于 2026-08 前端对接（见 `docs/rebuild-gap-fix-plan.md` D12），**不是死代码，不要删除**。

## 同步上游的例行流程

```bash
git fetch upstream
# 0) 试合并预检（不落工作区）：确认冲突面与「双方都改的 web 文件」清单
git merge-tree --write-tree main upstream/main
git merge upstream/main
# 1) 前端无需回退：web/** 的 merge=ours 在「双方都改」时即生效（不只冲突时），
#    自动合并也保 fork 版本；合并后用 git diff main --stat -- web/ 验证，
#    预期只剩上游新增且我们保留的纯 TS 文件；上游 SCSS 组件按接管边界 git rm
#    （不删会让 vue-tsc/根 vitest 收集到无法解析的依赖）
# 2) 上游新增/变更的测试有三类必然适配：工厂函数按并集签名改调用点、
#    上游测试桩补 fork 字段（channelView/getChannelId/tryResumeAgedUrl 等）、
#    fork 独有路径补模块级 vi.mock（如 client-voice 的 getClientInfo）
# 3) 跑测试
npm install && npm run build && npm test
# 4) 更新参考分支
git branch -f upstream-ref upstream/main
# 5) 三方 diff 审查（ours=合并前 main / theirs=upstream/main / result）：
#    git diff upstream/main -- src/ 的每个 hunk 都必须是「有意的 fork 增量」，
#    任何无法解释的 hunk 都是事故
```

预期冲突只剩 README / package.json / package-lock.json 的小摩擦；后端冲突
以「上游框架为底、fork 增量移植回上游结构」为基调（v1.15.2 合并实例见
提交 2254dca）。

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
| 播放可靠性双机制（v1.15.2 合并起并存） | 长暂停防链接过期 `instance.ts tryResumeAgedUrl`（resume 路径、全平台）⊕ B站断流续播 `resumeInterruptedStream`（trackEnd、仅 bilibili）；占用判定 ChannelView（`channel-view.ts`）⊕ 上游围栏查询 `refreshOccupancy`；cmdResume/cmdPause 的恢复让位与 immediate 语义见各函数注释 |

## PR 回上游候选

以下功能具有普适价值，合入上游后可删除本 fork 的重放代码：

1. 队列手动重排序（`queue.reorder` + `!reorder` + REST 端点）
2. 歌曲收藏（跨客户端，与上游按用户的歌单收藏互补）
3. TS 服务器频道树端点（`server-tree` / `join-channel`）

## 提交规范

与上游一致：`type(scope): subject`。内部实现/基础设施用英文 subject，用户可见行为用中文；移植类提交在 body 注明来源（如 `port from legacy main`）。详见 `docs/dev-restack-plan.md` 的提交规范一节。
