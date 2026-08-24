# dev 分支执行方案（收敛到上游底座）

> 目标：以 `upstream/main` 为新底座建立 `dev` 分支，选择性移植我们的资产，**恢复 `git merge upstream/main` 的能力**。
> 鉴权：直接使用上游的会话式多用户鉴权（含游客模式），**不移植**我们的 JWT。之前"砍掉多用户"的决策在此路线下自动作废——它是底座附赠的。
> 状态：本方案是当前选定路线；`upstream-update-plan.md`（留在 main 的逐项移植路线）已标记为备用。
> 前置数据：我们后端增量仅 31 文件 +2090/-447 行（多为 additive 模块）；上游 125 文件 +28302 行；双方重叠后端文件约 24 个。

## 零、已核实的关键事实

| 事实 | 结论 |
|------|------|
| `/api/favorites` 路由冲突 | 双方都注册此路径、语义不同（我们=歌曲收藏，上游=歌单收藏且带 `requireNotGuest`）。**我们的必须改名挂载**（定为 `/api/song-favorites`），数据库表不冲突（`favorites` vs `favorite_playlists`），可共存 |
| CI 不撞名 | 我们 `release-docker.yml` vs 上游 `docker-publish.yml`，可共存，移植即可 |
| 前端 API 接缝 | 集中在 `web/src/stores/`（auth/player/favorites），改造面有界 |
| 频道树 | 我们独有（`GET /api/bot/:id/server-tree` + `getServerTree()`），上游无此端点，移植即得 |
| Profile 开关 | 上游也有（Settings 内 6 开关，`5799891`），**不移植我们的后端**，仅核对字段名后适配我们的 UI 文案 |
| 根依赖 | dev 直接用上游 `package.json`/`package-lock.json`（含 koa、锁定版本、engines）；`web/` 是独立 package，自己的 Vite 6 + Tailwind 4 不受影响 |
| Node 版本 | 本机 v22.15 满足上游 engines（`^22.12`） |

## 一、移植决策总表

### A. 整体拿（`git checkout main -- <路径>`）

| 资产 | 说明 |
|------|------|
| `web/` 整个目录 | Tailwind 前端：设计体系、组件库、移动端、频道树抽屉、拖拽队列、收藏页 |
| `.github/workflows/release-docker.yml` | Docker 预构建发布流（先 `git rm` 上游 web/ 再放我们的，避免上游 SCSS 残留死代码） |
| `src/utils/mutex.ts` + `validate.ts` + 各自测试 | 上游不碰的目录，additive（若重放时发现上游已有等价物则放弃） |
| `docs/` 我们的分析文档 | 保留参考价值 |

### B. 改造后移植

| 资产 | 改造点 |
|------|--------|
| 歌曲收藏后端（main 的 `src/web/api/favorites.ts`） | 另存为 `src/web/api/song-favorites.ts`，挂载 `/api/song-favorites`，鉴权中间件对齐上游（`requireAuth`）；前端 `stores/favorites.ts` 同步改路径 |
| 前端鉴权流（`stores/auth.ts`、`Login.vue`、`Setup.vue`） | 契约从我们的 `/api/auth/*`（JWT、仅密码）改为上游 `/api/session/*`（setup/login/logout/me/change-password，**用户名+密码**）；Login 加用户名输入；新增 FirstRun 首次创建管理员页（对应上游 `/first-run`）；导航栏显示当前用户 + 登出；fetch 封装统一 401 → 跳登录 |
| 队列 reorder | 把我们的 `queue.ts` reorder 语义重放到上游 queue.ts（其已演化出 addNext/forwardStack/playAt 修复），重放 REST 端点 + `!reorder` 命令；前端拖拽逻辑在 web/ 里自带，仅核对调用的端点存在 |
| 频道树后端 | 重放 `bot.ts` 的 server-tree 路由块 + instance/manager 的 `getServerTree()` |

### C. 不移植（舍弃清单）

| 舍弃 | 理由 |
|------|------|
| `src/auth/` JWT 模块全套 | 与上游会话鉴权冲突；上游版本更完整（多用户/游客/审计/CSRF） |
| 我们 `instance.ts` 的连接竞态/互斥锁修复 | 上游有独立等价实现；如对照后发现上游缺失某个具体修复，再按需重放 |
| 我们 `server.ts` 的 trustProxy/JWT 挂载逻辑 | 上游 server.ts 自带 trustProxy 与会话中间件 |
| 我们的 `config.ts` 增量字段（userPassword/jwtExpiresIn） | 旧字段留在存量 config.json 里无害，上游忽略即可 |
| 我们 README 的正文 | dev 的 README 从上游出发 + 增补 fork 说明段（见 Step 5） |
| 我们的密码-only 登录交互 | 换上游用户名+密码 |

### D. PR 回上游候选（可选，长期消除冲突）

队列 reorder + REST API、歌曲收藏 API、频道树端点——均为普适功能，上游有接受社区 PR 的记录。合入上游后，dev 上对应重放代码可删除。

## 二、执行步骤

### Step 0：保险与建支（半小时）

```bash
git checkout main && git tag legacy-main-2026-08   # 旧主线锚点备份
git branch upstream-ref upstream/main              # 上游代码的本地参考副本
git checkout -b dev upstream/main
git push -u origin dev
npm install && cd web && npm install && cd .. && npm run build   # 确认上游底座可构建
```

**通过标准**：`npm run build` 与 `npm test`（上游 66 个测试文件）在本机全绿。

**`upstream-ref` 分支的用法**：它是上游代码的只读参考副本，不做任何提交。移植/重放期间随时对照：
```bash
git diff upstream-ref -- src/audio/queue.ts   # 看上游版与工作区的差异
git show upstream-ref:src/bot/instance.ts     # 直接查看上游版某文件
```
每次例行同步上游后，`git branch -f upstream-ref upstream/main` 更新它。

### Step 1：接管前端代码（0.5 天，仅"拿代码"，不可用是预期）

> ⚠️ **接管 ≠ 替换可用**：我们的前端按 main 的后端契约写（JWT 鉴权、`/api/auth/*`、歌曲版 favorites）。`git checkout main -- web/` 只是把代码放进 dev，此时启动必然 401/报错——**必须完成 Step 2 的接口适配后才可用**。Step 1 与 Step 2 是一道工序的两半。

```bash
git rm -rq web/
git checkout main -- web/
git checkout main -- .github/workflows/release-docker.yml
git checkout main -- src/utils/ docs/
# 配置 web/ 永久 keep-ours，让未来 merge 不在前端产生冲突：
git config merge.ours.driver true
printf 'web/** merge=ours\n' >> .gitattributes
npm run build
```

**通过标准**：前端**构建**通过（TypeScript/Vite 编译过，UI 行为不要求）；`.gitattributes` 提交。
**纪律（写入 FORK 说明）**：未来每次 merge upstream 后，`git diff --name-only upstream/main -- web/` 检查上游新增的 web 文件（merge=ours 只挡内容冲突，不挡新增文件），未引用的 SCSS 页面文件直接 `git rm`。

### Step 2：前后端接口适配（P0，1.5–3 天，dev 可用的门槛）

已提取双方全部端点对照过（我们前端 24 个调用 vs 上游底座注册路由），结论分三类：

**2a. 鉴权契约——彻底改造（工作量主体）**

| 我们前端现在调用 | 上游底座 | 改造 |
|---|---|---|
| `POST /api/auth/login`（仅密码） | `POST /api/session/login`（**用户名+密码**） | 改 `stores/auth.ts` + `Login.vue` 加用户名输入 |
| `GET /api/auth/me` | `GET /api/session/me` | 同上 |
| `POST /api/auth/logout` | `POST /api/session/logout` | 同上 |
| `POST /api/setup`（双密码初始化） | `POST /api/session/setup`（创建首位管理员） | 新增 `FirstRun.vue`（路由 `/first-run`），替换原 `/setup` 流程 |

配套：导航栏当前用户名 + 登出；fetch 封装统一 401 → `/login`；上游 mutating 请求有 CSRF Origin 同源校验，确认我们的请求都走同源 fetch（带 credentials）；WebSocket `/ws` 由会话 Cookie 鉴权（同源握手自动携带，去掉我们可能的 query token 逻辑）。

**2b. favorites 语义冲突——改名（方案已定）**

我们前端 `stores/favorites.ts` 调用的 `/api/favorites`（歌曲收藏）→ 改为 `/api/song-favorites`（Step 3 后端同步改名）。上游同名路由是歌单收藏，互不干扰。

**2c. 同名端点——逐一联调核对（grep 看不见的风险在这）**

以下端点双方同名存在（继承自共同祖先），**路径对 ≠ 契约对**，须逐个核对请求/响应字段：

- 平台登录：`/api/auth/qrcode`、`/api/auth/qrcode/status`、`/api/auth/status`、`/api/auth/cookie`（上游多了 sms、jellyfin/test，不管）
- 播放控制：`/api/player/:botId/` 下的 play、add、pause、resume、next、prev、seek、mode、queue、play-at、history、profile 等（上游响应结构可能已变，重点核 profile 六开关字段名）
- 音乐：`/api/music/search`、`search/all`、`quality`、`recommend/*`、`user/playlists`、`personal/fm`、`playlist/:id`、`lyrics/:id`、`bilibili/popular`
- 机器人 CRUD：`/api/bot`、`/api/bot/:id`、start/stop

核对方法：以 `upstream-ref` 分支为参照，逐端点读上游 router 的 req/res 定义，修正我们 stores 的类型与调用；确缺的端点补薄适配层（挂在上游路由之后，不改上游文件）。

**通过标准**：dev 版完整走通 首次启动→创建管理员→登录→扫码登录网易云→点歌→收藏→频道树→拖拽队列→登出重登，全流程无 404/401/字段错位报错。

### Step 3：additive 后端移植（0.5–1 天）

1. 歌曲收藏：`git show main:src/web/api/favorites.ts` 另存为 `song-favorites.ts`，挂 `/api/song-favorites` + 上游鉴权中间件；`stores/favorites.ts` 改路径；带上我们的收藏测试
2. 频道树：重放 `server-tree` 路由与 `getServerTree()`；前端抽屉已在 web/ 内，核对数据结构
3. `utils/mutex`、`utils/validate`：带入后检查上游是否已有等价物，有则不挂

### Step 4：语义重放（1–2 天）

1. 队列 reorder：重放到上游 `queue.ts`（注意上游的 addNext/forwardStack/playAt 语义，重写测试而非照搬）；REST + `!reorder` 命令；前端拖拽联调
2. **24 文件语义对照**：对重叠文件逐个 `git diff main upstream/main -- <file>` 快速过一遍，只重放"上游确实没有且仍有价值"的差异（预期很少，多数已被上游等价修复覆盖）。每重放一项配一个测试
3. Profile 开关字段名核对：我们 UI 的 6 开关 vs 上游 `PUT /api/player/:id/profile` 字段，不一致处改 UI 映射

### Step 5：CI 与文档（半天）

1. `release-docker.yml` 移植后调整：触发条件支持 dev 预发布 tag（`v2-beta.*`），产出 tar.gz + compose.prod（这些文件随 web/ 一起来自 main，核对 scripts/docker）
2. dev 的 README：以上游为基 + 顶部"本 Fork 增补"段（Tailwind UI、频道树、拖拽队列、歌曲收藏、`!reorder`、预构建镜像）；fork 特有维护说明（merge=ours 纪律、PR 候选）放 `FORK.md`
3. main 分支：README 顶部加跳转说明（"新版本在 dev 分支，基于上游 v1.13.0+，含多用户鉴权"）+ `git push origin legacy-main-2026-08`

### Step 6：验收（0.5–1 天 + 试用 1–2 周）

**存量数据演练**：复制生产 `data/` → dev 版启动 → 校验：
- [ ] 首次启动进入 /first-run，创建管理员
- [ ] 旧 `favorites` 表数据在新 `/api/song-favorites` 下完好可见
- [ ] 机器人实例、服务器组、profile 配置不丢
- [ ] 旧 config.json 的 userPassword/jwtExpiresIn 被忽略且无报错

**功能清单（我们保留的）**：歌曲收藏增删/跨端同步、频道树浏览+一键移动、队列拖拽+`!reorder`、TS 资料同步 6 开关、移动端体验、Docker 预构建发布。
**功能清单（上游底座的）**：多用户+细粒度权限+游客模式、!search/#N/id/链接、搜索分类翻页（**注：搜索页 UI 属 P1 缺口，见下**）、保存/加载清单（P1 缺口）、自动暂停、语音闪避、酷狗/Jellyfin/本地音源（后端可用，设置 UI 属缺口）、全部播放修复。
**试用期**：dev 跑日常使用 1–2 周，期间 main 保持服务或直接切换。

### Step 7：交接与例行纪律

```bash
git checkout main && git tag legacy-main && git reset --hard dev && git push -f origin main
```

（或者更保守：dev 直接改名为主力分支，main 冻结打标。二选一，交接后 README 跳转说明删除。）

**之后每次上游 release**：`git merge upstream/main`（预期仅 README/package.json 小冲突）→ web/ 新增文件清理 → 跑测试 → 发布。不再积攒。

## 提交规范（与上游保持一致）

dev 上所有提交遵循上游的 Conventional Commits 风格——既是整洁问题，也是为了未来把我们 PR 回上游时 commit 可直接复用：

- **格式**：`type(scope): subject`，subject 不加句号，祈使语气
- **type**：`feat` / `fix` / `docs` / `chore` / `ci` / `test` / `refactor` / `perf` / `build` / `style`
- **scope**：小写模块名，跟随上游用法——`player` `queue` `web` `bot` `api` `auth` `config` `netease` `qq` `local` `ts-protocol` `lyrics` `profile` `setup` `scripts` 等；跨模块或不明确时可省略 scope（上游也常省略，如 `fix: ...`）
- **subject 语言**：跟随上游习惯——**内部实现/基础设施用英文，用户可见行为用中文**，两种都常见；一段提交内不要混
- **关联**：对应上游 issue/PR 的移植带尾注，如 `(#90)` 或 `[PR #123]`；我们自己的工作不编造编号
- **粒度**：一个提交做一件事；移植类提交在 body 里注明来源（如 `port from upstream 3b2d6a7`）

上游实例（照此对齐）：

```
feat(kugou): add login-gated discovery (daily/recommend/user playlists, FM) + covers
fix(player): set browser UA + Referer for Netease CDN to stop auto-skip
feat(bot): !play id <id> 与其他命令语法保持一致
fix(queue): 随机模式下 !pn 插入的歌真正下一首播放
docs(readme): document save/load queues + restart resume + playKeepsQueue
```

dev 上的移植提交示例：

```
feat(web): 接管 Tailwind 前端（替换上游 web/，接口适配见后续提交）
chore(fork): web/ 配置 merge=ours 隔离未来上游合并冲突
feat(api): 歌曲收藏挂载为 /api/song-favorites（避开上游歌单收藏路由）
feat(queue): 队列手动重排序与 !reorder 命令
feat(bot): TS 服务器频道树接口 server-tree
```

## 三、交接后的 UI 缺口 backlog（全部 Tailwind 自建，按需排期）

| 优先级 | 缺口 | 理由 |
|--------|------|------|
| P1 | 设置页：用户管理 / 游客模式 / 命令权限 / 行为设置 四个管理区块 | 管理员功能只能改 config.json，不够用 |
| P1 | 搜索页分类标签 + 翻页（上游已支持 API） | 点歌主路径的体验升级 |
| P2 | 已存队列页（!save/!load 已可用，纯 UI） | 命令行先行，UI 缓做 |
| P2 | Library 音乐库页（歌单收藏展示） | 上游 favorite_playlists 的 UI |
| P2 | 本地音视频上传入口 | 后端在，UI 缓做 |
| P3 | Jellyfin / Spotify 设置卡 | 未启用这些音源则不需要 |

## 四、风险与对策

| 风险 | 对策 |
|------|------|
| `/api/favorites` 语义冲突导致静默错乱 | 已定改名方案；Step 3 验收明确覆盖 |
| 上游 player/bot API 与我们前端调用不完全对齐 | Step 2 第 5 条端点对照强制执行，缺的先补薄适配 |
| merge=ours 后上游 web 新增文件污染 | FORK.md 写入每次 merge 后的清理命令 |
| 存量部署升级意外 | Step 6 用 data/ 副本演练，不碰生产 |
| 双线维护期两边都要修 bug | 时间盒：整个 Step 0–5 控制在一周内；期间 main 只修致命 bug 并记录，dev 完成后重放 |
| 上游底座依赖变化（koa 等） | 直接全盘接受，本机已验证 Node 22.15 满足 engines |

## 五、估算

| 步骤 | 估算 |
|------|------|
| Step 0–1 建支+前端接管 | 1 天 |
| Step 2 前后端接口适配 | 1.5–3 天 |
| Step 3–4 后端移植+语义重放 | 1.5–3 天 |
| Step 5–6 CI/文档/验收 | 1–1.5 天 |
| 试用期 | 1–2 周（并行使用） |
| **合计（专注工作）** | **约 5–8.5 天** |

对比留在 main 的路线（逐项移植约 2.5–3 周 + 永久搬运税），本路线多花的前端鉴权接缝工作，换来上游 28000 行及未来零成本同步。
