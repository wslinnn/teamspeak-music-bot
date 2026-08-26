# 前端差异对比：main vs 上游（frontend-diff-vs-upstream）

> **基准**：main = `1eb14fe`（2026-08-26）；upstream = `upstream/main` = `1407cad`
> （2026-08-24 11:19 +0800，PR #154 合并后）。
> 拉取核对：`upstream/main` 无新增提交（`upstream-ref` 已同步等于 `1407cad`）；
> 新出现的远端分支 `fix/152-setup-console-eio` 内容已全部并入 main，无增量。
> 本文档是第五轮对账（承接 `rebuild-gap-fix-plan.md` 四轮），对照对象是**整前端**：
> 架构、路由、逐页、组件、状态管理、API/WS 消费面，并标注每处差异的定性
> （等价 / fork 领先 / 上游领先 / 设计性分歧 / 残留缺口）。

---

## 一、总体结论

| 维度 | 结论 |
|------|------|
| 功能覆盖 | ✅ **上游功能面已全覆盖**（2026-08-26 第五轮对账后清完 9 项缺口，见第九节）；剩余差异仅为设计性分歧（见下） |
| fork 领先项 | 存量优势：歌曲收藏（含独立页）、服务器频道树、队列拖拽重排、已存清单收纳进抽屉、播放历史搜索+分页、WS 4001 断线语义+指数退避、PWA **离线缓存（SW 层）**、移动端控制抽屉、D14 门控口径统一；本轮追赶中反超：音源六项管理开关 |
| 框架版本 | **两边等价**：Vue 3.5 + TypeScript 5.8 + Vite 6.3。FORK.md 旧表述"上游 Vite 5"已过时（本次勘误） |
| 样式体系 | 设计性分歧：上游 SCSS（global/mobile/variables 三文件）；main Tailwind 4 + CSS 变量 + 自研 Base* 组件族（10 个） |
| 前端测试 | main 已移植 useDecoupledSlider（6 条）与 searchPagination（15 条）两组单测；上游另有 scope/elapsed/savedQueues/useSpotifySettings 四组暂未跟 |

---

## 二、架构与构建

| 项 | 上游 | main | 定性 |
|----|------|------|------|
| 构建 | Vite ^6.3 | Vite ^6.3 + **vite-plugin-pwa**（sw 离线缓存，构建产物含 workbox） | fork 领先（PWA） |
| 样式 | SCSS + sass 依赖 | Tailwind 4（`styles/index.css`） | 设计性分歧（接管前提，见 FORK.md） |
| HTTP 层 | `api/http.ts`（axios）+ 大量裸 `fetch()`（useSession/Settings 用户管理/审计/改密/public-url） | `utils/http.ts` 统一 axios：401 拦截跳登录 + `selfHandled401` 集合 + 全局错误 toast | 等价（main 更集中） |
| 组件体系 | 无通用组件层 | `common/` 10 个 Base 组件 + settings 9 个子组件拆分（上游 Settings 是 2400 行单文件） | fork 领先（可维护性） |
| 移动端 | `mobile.scss` 响应式覆盖 + App 级 mini player（`.m-player`） | Tailwind 响应式断点 + `MobilePlayerControls` 底部抽屉（音量+播放模式） | 设计性分歧 |
| 文件规模 | 42 个源文件 | 62 个源文件 | 结构差异，非功能差异 |

---

## 三、路由与导航

| 路由 | 上游 | main | 定性 |
|------|------|------|------|
| `/` `/search` `/library` `/playlist/:id` `/album/:id` `/lyrics` `/history` `/settings` `/login` `/first-run` `/bot/:id` | ✅ | ✅（`/album/:id` 于 `615776a` 补齐） | 等价 |
| `/saved-queues` | ✅ 独立页（Navbar 入口，`savedQueuesEnabled && !guest` 门控） | ❌ 无页面；功能并入 Queue 抽屉（保存/加载/追加/删除/共享） | 设计性分歧（功能等价，入口位置不同） |
| `/setup` | ✅ 四步引导向导（建 bot autoStart:true + Jellyfin 初始化） | 重定向 `/first-run`（有意不接，见方案文档 D 组备注） | 设计性分歧 |
| `/favorites` | ❌ 无此概念 | ✅ fork 歌曲收藏独立页 | fork 领先 |
| `/:pathMatch(.)*` 404 | ❌ | ✅ NotFound.vue | fork 领先 |

Navbar 导航项：上游 = 发现/搜索/音乐库/播放历史/**已存队列**（门控）；main = 发现/搜索/音乐库/播放历史/**收藏**/**服务器**（频道树入口）。

---

## 四、逐页对比

### Home（发现）
| 区块 | 上游 | main | 定性 |
|------|------|------|------|
| 搜索栏 / 正在播放 | ✅ | ✅ | 等价 |
| 私人FM | **多卡多源**：Jellyfin 电台（Instant Mix）/网易云/QQ 雷达/酷狗电台，按 enabledProviders+登录态显隐 | 单卡（netease），走服务端 `POST /fm`；有 D14 权限门控 | 上游领先（多源 FM 卡） |
| Jellyfin 四区块 | 最近添加/播放最多/收藏/流派 | ✅（`1f12789`） | 等价 |
| 每日推荐 / 推荐歌单 | **SourceTabs 可切源**（netease/qq/kugou/jellyfin，localStorage 记忆） | 固定默认源，无切换 | 上游领先（多源切换） |
| 我的歌单 | SourceTabs 多源 + 展开收起 | 默认源单列 + 展开收起；**多源版在 Library 页**（D12） | 等价（取舍不同：上游集中 Home，main 集中 Library） |
| B站热门 | ✅ | ✅ | 等价 |

### Search
| 项 | 上游 | main | 定性 |
|----|------|------|------|
| 音源页签 | 启用源逐项（jellyfin 置顶），**无"全部"聚合** | "全部"聚合（`/search/all` 多源合并首屏）+ 启用源逐项（B2 动态化） | 各有取舍 |
| 结果类目 | songs/albums/playlists 三类目 | 同 | 等价 |
| 分页 | **三类目全部 offset 分页**（searchPagination 工具 + 单测） | 仅"单曲+单源"有"加载更多"；albums/playlists 与"全部"聚合无分页 | 上游领先 |
| 本地上传 | 拖拽上传区（local 启用时） | ✅（localAudioEnabled 门控） | 等价 |
| 歌单卡红心 | ✅（歌单收藏） | ✅（D12，游客隐藏） | 等价 |

### Playlist / Album
等价（`615776a` 对齐）：双形态复用、`allSettled` 详情失败走歌曲兜底（专辑标题取首曲 `album` 字段）、收藏红心仅歌单形态、播放全部分走 play-playlist/play-album。
备注：`/api/music/album/:id/detail` **两端后端都没有该路由**——上游前端调用它靠 404 兜底（其注释明言 intentional），main 直接不发该请求，运行时行为一致。

### Library（音乐库）
等价三区块（我的收藏/我的歌单/最近播放）。差异两点：上游"我的歌单"可用源含 **spotify**（登录后）且页签选择 localStorage 记忆（sourceTabs store）；main 固定 netease/qq/kugou/jellyfin、无记忆。→ 小残留。

### History
**main 领先**：搜索框（歌名/歌手过滤）+ 分页（50/页、加载更多、上限封顶）；上游一次性全量列表、无搜索无分页。

### Lyrics
等价（逐行高亮/中文翻译/自动滚到当前行）。实现差异：上游用 CSS transform 位移滚动（0.6s 缓动）；main 用 `scrollTo` + 用户手动滚动暂停检测 + 中心比例定位。体验同级。

### Login / FirstRun / Setup
等价（含游客入口、needs-setup 引导）。差异：上游另有 `/setup` 四步向导；main 的 FirstRun 仅建管理员（设计性不接）。

### BotRedirect（专属链接）
等价（`setScope` + 带 `?bot=` 跳转，D13 补齐）。

### Settings
| 分块 | 上游 | main | 定性 |
|------|------|------|------|
| 音质（默认源六档 + Jellyfin 四档） | ✅ | ✅（D5） | 等价 |
| 命令前缀 / 闲置超时 / 行为 / 头像简介同步 | ✅ | ✅ | 等价 |
| bot 表单（channelPassword/autoStart） | ✅ | ✅（D11） | 等价 |
| 用户管理（角色/重置密码/删除）+ 审计 + 修改密码 | ✅ | ✅（D2/D8） | 等价 |
| 游客模式（总开关+逐项权限） | ✅ | ✅ | 等价 |
| 平台账号（扫码/Cookie，netease/qq/bilibili/kugou） | ✅ | ✅（D7） | 等价 |
| 网易云**短信登录** | ❌ 无 UI | ❌ 同样不做（曾于 `1604623` 误加、已移除）：`loginWithSms` 调的 `/captcha/verify` 只校验验证码**不返回登录 cookie**（正确端点应为 `/login/cellphone`），链路天然走不通；且能收验证码的手机=账号本人=可扫码，场景被扫码登录完全覆盖。`sms/send`/`sms/verify` 属上游遗留死代码，按收敛策略保留后端不删 | 双方一致（不做） |
| Spotify 配置+OAuth | ✅（useSpotifySettings 含单测） | ✅（D0 配置卡 + D6 授权卡） | 等价 |
| **音源启用管理** | 仅 Jellyfin 卡可翻转 enabledProviders（其注释自述"唯一入口"） | 六项开关 + 默认音源下拉（D0） | **fork 领先** |
| **按用户细粒度权限编辑器**（capabilities 矩阵 + bot 白名单，`GET/PUT /api/users/:id/permissions`） | ✅ | ✅（`7a7bd33`，BaseModal 形态） | 等价 |
| 主题 | Settings 内切换按钮 | Navbar 按钮 + 独立主题 Tab | 等价 |

---

## 五、组件层对比

### Player
| 项 | 上游 | main | 定性 |
|----|------|------|------|
| 按钮门控（control/transport/skip/playMode） | ✅ | ✅（D14 对齐同语义） | 等价 |
| **音量滑块** | `useDecoupledSlider` + `@input/@pointerup`：拖动实时预览、不被 rAF 重渲染拽回（#111 修复，含单测） | `@change` 单事件：拖动中不预览、松手才生效（移动端抽屉有 v-model+change） | **上游领先（#111 残留实证）** |
| 进度条 | hover 圆点 + 时间 tooltip | 同（hover 圆点 + 时间 tooltip） | 等价 |
| 歌词入口 | Player 右侧独立歌词按钮（高亮当前路由） | 点击左侧歌曲信息区切换 | 设计性分歧 |
| 播放模式循环切换 | ✅ | ✅ | 等价 |

### Queue
| 项 | 上游 | main | 定性 |
|----|------|------|------|
| 移除单曲 / 清空停止（removeClear 门控） | ✅ | ✅ | 等价 |
| **拖拽重排序** | ❌ | ✅（vuedraggable，fork 特性） | fork 领先 |
| 已存清单 | 独立页（列表/共享标记/加载/追加/删除） | 抽屉内两按钮 + 两个 BaseModal（保存含共享开关、列表含加载/追加/删除） | 功能等价 |
| **清单入口运行时门控** | Navbar 入口按 `savedQueuesEnabled` 隐藏（store 从 /api/bot/settings 拉取） | ❌ **未门控**：Queue.vue:227 注释声称受控，实际按钮无 v-if，关闭设置后按钮仍在（点击后端 503/禁用报错） | **main 小缺口（一处 v-if 即可对齐）** |

### Navbar
| 项 | 上游 | main | 定性 |
|----|------|------|------|
| bot 下拉 | 选卡 + **断开/连接、停止/播放、下一首**、复制专属链接 四组快捷操作 | 选卡 + 启停电源 + 复制专属链接 | 上游多"停止播放/下一首"快捷键（小项） |
| 专属模式锁定态（徽标+退出） | ✅ | ✅（D13） | 等价 |
| 复制专属链接（public-url 优先 + 剪贴板兜底） | ✅ | ✅（D13） | 等价 |

### 歌曲卡片
- 上游 SongCard：play/playNext/add 三按钮门控，**无红心**（歌曲收藏是 fork 概念）。
- main SongCard/SongGridCard：三按钮门控（D14）+ **歌曲收藏红心**（fork）+ 双击播放守卫。
- 网格卡（SongGridCard）为 main 特有形态（搜索页用）。

---

## 六、状态管理与组合式函数

| 项 | 上游 | main | 定性 |
|----|------|------|------|
| 会话/能力 | `useSession` 组合式单例：`can/guestCan/canControlBot`，**60s 轮询刷新 /me**（权限变更自愈） | auth store：同语义三函数，**无轮询**（仅登录/刷新页面时拉取） | 上游领先（自愈频率） |
| scope（?bot= 锁定） | 独立 store + 单测 | 内联 player store（D13），行为等价（setScope/守卫补参/bot 移除解锁） | 等价 |
| sourceTabs（页签记忆） | 独立 store（localStorage 按上下文记忆） | 无（Library 页签不记忆） | 上游领先（小项） |
| elapsed 插值 | 独立函数 + 单测（effectiveDuration 钳制同款） | store getter 内联（B1 同语义） | 等价 |
| 歌曲收藏 store | ❌ | ✅（favorites store + WS `favoritesChanged` 事件） | fork 领先 |
| toast | Toast.vue 组件内联 | toast store + ToastContainer + useToast | 等价 |

### WebSocket
| 项 | 上游 | main | 定性 |
|----|------|------|------|
| 消息类型 | init/stateChange/botConnected/botDisconnected/botRemoved | 同五类 + **favoritesChanged**（fork） | fork 超集 |
| 断线重连 | 固定 3s 无限重连；**无 4001 处理**（后端裸 401 → 浏览器 1006 → 永远重试） | 指数退避（上限 10 轮）+ **4001 = 认证失效即停**（B3 对齐）+ 连接状态机（connected/reconnecting/disconnected） | **fork 领先** |

---

## 七、API 消费面（归一化后真实差异）

两边共消费约 60 个端点（axios+fetch 合并口径）。差异：

**上游消费、main 未消费（2 项）**
1. `POST /api/player/:id/play-by-id` / `add-by-id` —— 按歌 ID 播放/入队；main 恒带完整 song 对象走 `play-song/add-song`，功能等价（载荷更大、不依赖对象在手）
2. `GET /api/music/album/:id/detail` —— 见第四节备注：**两端后端均未实现该路由**，上游调用即 404 走兜底，非真实能力差

**main 消费、上游未消费（fork 特性面）**
- `/api/song-favorites` 全族（歌曲收藏）
- `/api/bot/:id/server-tree` + `join-channel`（频道树抽屉）
- `/api/player/:id/queue/reorder`（拖拽重排）

（`/api/audit`、`/api/config/public-url`、`/api/session/change-password`、users 管理族上游走裸 fetch 消费，与 main 等价，非差异。`/api/auth/sms/send`+`verify` 两侧前端均不消费——上游遗留死代码，见第四节勘误。）

---

## 八、fork 独有功能汇总（上游合并候选）

> 标注口径：【存量】= 本轮工作之前就在 main 上的 fork 原生功能；【反超】= 本轮追赶上游时把其休眠后端做全 UI 而形成的超集。避免把"新近反超"误读为"历史优势"。

| 功能 | 入口 | 性质 | 备注 |
|------|------|------|------|
| 歌曲收藏（跨端按用户） | `/favorites` 页 + 卡片红心 + WS 事件 | 存量 | 上游仅有歌单收藏 |
| TS 服务器频道树/加入频道 | Navbar"服务器" + ServerTreeDrawer | 存量 | — |
| 队列拖拽重排 | Queue 抽屉 | 存量 | 上游无重排 |
| 播放历史搜索+分页 | History 页 | 存量 | 上游一次性全量 |
| WS 4001 认证失效语义 + 指数退避 | useWebSocket | 存量 | 上游为裸 401+3s 死循环；fork 前端早已等待 4001，B3 是后端对齐 |
| PWA 离线缓存（Service Worker） | vite-plugin-pwa（构建生成 sw.js + workbox 预缓存） | 存量 | **可安装基座两边都有**（site.webmanifest + icon-192/512/maskable + theme-color 为上游原有，public 文件两侧一致）；fork 独有的是 SW 离线缓存层，上游无任何 Service Worker |
| 移动端播放控制抽屉 | MobilePlayerControls | 存量 | 上游为 App 级 mini player |
| 修改密码防误登出（selfHandled401） | utils/http.ts | 反超（实现细节） | D2 配套：main 统一 axios 拦截器才需要；上游用裸 fetch 无此问题 |
| 音源六项管理开关 + 默认音源 | 设置→音源（D0） | 反超 | 底层配置/端点为上游的；上游只有 Jellyfin 卡一个翻转入口（其注释自述） |
| 浅色主题一键切换（Navbar） | Navbar/SettingsTheme | 存量（细节） | 两边都有主题；差的是入口位置 |

---

## 九、残留缺口与建议

> 2026-08-26 复核确认的 9 项缺口已全部实施（用户拍板不接 /setup 向导）；
> 全量 1070/1070（含新增前端单测 21 条）、前端构建通过。

| # | 缺口 | 状态 |
|---|------|------|
| 1 | Queue 已存清单按钮按 `savedQueuesEnabled` 运行时门控 | ✅ `d6da3bd`（store 加 fetchBotSettings，App 挂载拉取） |
| 2 | #111 音量滑块拖拽实时预览 | ✅ `c553f90`（useDecoupledSlider 原样移植 + 6 条单测） |
| 3 | 搜索三类目完整分页 | ✅ `df5fe9f`（searchPagination 移植 + 15 条单测；"全部"聚合维持不分页，后端无 offset） |
| 4 | auth 权限 60s 轮询自愈 | ✅ `7ba86f6` |
| 5 | Home 每日推荐/推荐歌单多源切换 | ✅ `69bf4c8`（含页签 localStorage 记忆与失效回退） |
| 6 | Library 我的歌单加 spotify 源 + 页签记忆 | ⏸ 不做：spotify provider 未实现 getUserPlaylists（上游同 501），页签记忆已随 #5 落地同款机制 |
| 7 | Navbar bot 卡快捷操作（停止播放/播放/下一首） | ✅ `20944b1` |
| 8 | D9 按用户权限编辑器 | ✅ `7a7bd33`（能力矩阵 + bot 白名单，BaseModal 形态） |
| 9 | 多源 FM 卡（Jellyfin 电台/QQ 雷达/酷狗电台） | ✅ `69bf4c8` |

另：Playlist"播放全部"权限门控（D14 漏网点）一并修复 `4df2e64`。

---

## 十、FORK.md 勘误（随本文档同步修正）

- "上游为 SCSS + **Vite 5**" → 上游已升级 **Vite ^6.3**（含 sass 依赖）。构建栈两边同代，样式体系（SCSS vs Tailwind 4）仍是接管边界。
