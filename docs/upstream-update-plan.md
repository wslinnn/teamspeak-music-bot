# 上游功能更新方案（按选择项制定）

> ⚠️ **状态：备用路线（2026-08-24）**。当前已选定 dev 分支收敛路线，见 `dev-restack-plan.md`——该路线下本文件的阶段 1–4 绝大部分内容随上游底座自动获得，无需逐项移植。本方案仅在决定**留在 main 旧底座**时启用。

> 依据：`docs/upstream-diff-checklist.xlsx`（2026-08-24 选择：A 类仅 A7/A8，B–H 全做；同日二次确认：**多用户相关 B1–B4 移除，保留现有 JWT 双角色鉴权**；N 类补漏项建议随相邻项一起做）
> 原则：**从简单到复杂**，每个阶段独立可交付、可验证、可回滚
> 参考上游：`upstream/main`（af1dac8，2026-08-14）——后端逻辑可参考/移植，前端 UI 一律按我们自己的 Tailwind 体系重写

## 已核实的代码实况（方案依据）

| 项 | 结论 |
|----|------|
| F1 自回显 | `src/bot/instance.ts` `handleTextMessage` 无"发送者是机器人自身"过滤，bug 确认存在 |
| F3 B站断流 | `src/audio/player.ts:112` 已有 `-reconnect 1`，缺 `-reconnect_at_eof` 与卡死看门狗 |
| F4 音量曲线 | `src/audio/player.ts:287` 为线性 `×0.2`：`vol 99` 仅满音量 20%，`vol 100` 直接跳满——悬崖比上游修的更严重 |
| F5 头像时机 | `src/bot/profile.ts:41` 注释表明我们已按 onSongChange/onConnect 时机，无需修，C10 实现时保持 |
| F7 站点图标 | `web/public/` 为空，favicon/manifest 确认缺失 |
| N1 网易云 UA | `player.ts:110` 仅 bilibili 路径带 Referer/UA，网易云 CDN 未设 |
| N3 FM 重复 | `src/bot/instance.ts:837` 注释确认 FM 使用 RandomLoop（上游 PR #45 已改 Random） |
| C8 自动暂停 | `autoPauseOnEmpty` 是死字段，无任何实现 |
| 鉴权 | 我们：`src/auth/`（JWT + config 双密码）；上游：DB 多用户 + 会话——已决定**不做**多用户替换，仅保留 B5/B6/B7 |

---

## 阶段 0：文档与依赖锁定（约半天，零代码风险）

| 任务 | 内容 | 改动点 |
|------|------|--------|
| H1/H4/H5/G2/G5/G6 | README 增补：FAQ（Node ABI、同名歌曲、忘记密码、公网防暴力）、配置逐字段说明（含 `trustProxy`/`idleTimeoutMinutes`/`publicUrl` 补写 + `autoPauseOnEmpty` 死字段警示）、反向代理小节、Node 20/22 LTS 策略 | `README.md` |
| H6 | 技术栈表勘误：Express 4 → Express 5 | `README.md` |
| H2 | 更新日志改按版本分节（为后续阶段留出 v 版本骨架） | `README.md` |
| H3 | "重启后保留的设置"表——现阶段如实写"均不保留"，C4 完成后更新 | `README.md` |
| B6 | 忘记密码 FAQ：按我们现有 JWT 体系写重置流程（改 config 密码重启） | `README.md` |
| A8 | `NeteaseCloudMusicApi` 锁 `~4.32.0`，`npm install` 验证启动 | `package.json` |
| F2 | `@sansenjian/qq-music-api` 从 `^2.2.10` 改为 `~2.4.0`（跟随上游；需 Node ≥ 20.17），启动验证 QQ 搜索/扫码；同时做 sidecar 端口强制对齐（参考上游 846ee30） | `package.json`、`src/music/api-server.ts` |

**验收**：`npm install && npm run build` 通过；网易云/QQ 搜索与播放正常；README 渲染正常。

## 阶段 1：小修复包（1–2 天，每项一个 commit，互相独立）

| 任务 | 内容 | 改动点 | 参考上游 |
|------|------|--------|---------|
| F1 | `handleTextMessage` 入口丢弃 `invokerId === 自身 clid` 的消息（拿到自身 clid 后过滤；更彻底可在协议层做） | `src/bot/instance.ts` 或 `src/ts-protocol/client.ts` | 3b2d6a7 |
| F4 | `applyVolume` 改 `0.2x + 0.8x^8` 连续曲线，删除 `vol===100` 特判 | `src/audio/player.ts:284` | #84 |
| F3 | ffmpeg 参数加 `-reconnect_at_eof 1`；新增"远离结尾的卡死看门狗"（连续 N 秒无帧且非暂停 → 触发 trackEnd 跳下一首） | `src/audio/player.ts` | #89 |
| N1 | 网易云播放 URL 请求带浏览器 UA + Referer | `src/audio/player.ts` 或 `src/music/netease.ts` | f76500c |
| N3 | FM 启动改 `PlayMode.Random` | `src/bot/instance.ts`（约 :837） | fe78bf8 |
| N6 | 队列边界三修复：playAt 清 playedIndices、空闲 play-next 用 insertedAt、暂停时停用 stall/EOF 检测（若与 F3 看门狗同处则一起改） | `src/audio/queue.ts`、`player.ts` | 20fd8a1 / fab8d19 / 4cd269d |
| D4 | `!lyrics` 发完整歌词 + UTF-8 字节安全分片函数（供所有长回复复用） | `src/bot/instance.ts` | 81b8953 |
| F6 + N7(文案) | 登录二维码确认浅底深码；QQ 扫码提示改"请使用手机QQ" | `web/src/components/settings/SettingsPlatforms.vue` | 4cb1da2 / db2e70f |
| F7 | 站点图标 + Web App Manifest（生成 favicon/png 图标 + `web/public/` + `index.html` 引用） | `web/public/`、`web/index.html` | 55695c2 |
| B7 | `X-Robots-Tag: noindex` 全响应 + `/robots.txt` + meta 标签；CSRF Origin/Referer 同源校验（适配现有 JWT Cookie）+ `X-Frame-Options: DENY` / CSP 安全头 | `src/web/server.ts`、`web/index.html` | ea0f7c1 / d1c9e14 |

**验收**：`npm test`；手动冒烟：`!help` 不再自动点歌、`!vol 50/99/100` 平滑、B站长视频播完不断流、FM 不重复、`!lyrics` 长歌词完整分段显示；登录/登出回归正常（CSRF 校验不影响正常使用）。

## 阶段 2：命令与搜索（2–4 天）

| 任务 | 内容 | 改动点 | 参考上游 |
|------|------|--------|---------|
| D1 + N9 + D5 | `!search <词> [-q/-b/-y/-n]` 列结果存 lastSearch；`!play #N`；`!play id <id>`（含旧写法 `id:<id>`）；粘贴网易云/QQ/B站链接解析；QQ 按 ID 播放回填元数据；顺手加 `-n` 标志 | `src/bot/commands.ts`、`src/bot/instance.ts`、`src/music/provider.ts`（songRef 解析） | 287dd24 / 6d56f1f / 74ea8d2 / 1519041 |
| D2 + D3 | 搜索 API 返回 歌曲/歌单/专辑 三分类 + `offset` 翻页；前端 Search 页分类标签 + 加载更多 + 平台徽章（**Tailwind 自研**，只参考上游交互逻辑） | `src/web/api/music.ts`、各 provider、`web/src/views/Search.vue` | PR #57 / a1cc0b8 / a97e72e |
| D6 | `!album` 支持名称模糊搜索（数字 ID 兼容） | `src/bot/instance.ts` | — |
| B5 | 设置页「命令权限」区块：adminGroups 编辑（逗号分隔组 ID），保存走现有 config API | `web/src/views/Settings.vue`（或其子模块） | 215e328 |

**验收**：同名歌曲可通过 `!search`+`#N` 播放指定版本；链接可直接 `!play`；搜索页可切分类、翻页；设置页改 adminGroups 即时生效。

## 阶段 3：持久化与队列（3–5 天）

| 任务 | 内容 | 改动点 | 参考上游 |
|------|------|--------|---------|
| C4 | `bot_instances` 加 `volume`/`play_mode` 列（自动迁移）；音质按平台落 `config.audioQuality`；命令/WebUI/REST 三入口改动均落盘；重启恢复 | `src/data/database.ts`、`config.ts`、`src/bot/instance.ts`、`manager.ts` | fbd94c4 |
| C5 | 队列 `addNext()`（插入当前歌后）；`!pn` 命令 + `POST /api/player/:id/play-next`；前端 SongCard「下一首播放」；随机模式插入位置正确（直接按修复后语义实现） | `src/audio/queue.ts`、`commands.ts`、`src/web/api/player.ts`、前端 SongCard | 11c6a3f / 3e795d9 / cc3684f |
| C1 + C2 + N10 | `saved_queues` 表（所有者/名称/共享/歌曲列表，上限 50×1000）；`!save/!load [-a]/!queues`；REST + 前端「已存队列」页；`savedQueuesEnabled` 开关门控；重启恢复队列（当前曲目从头播）；文件清理引用感知 | `src/data/database.ts`、新 `src/web/api/saved-queues.ts`、`web/src/views/SavedQueues.vue`（自研） | 69a2e8c / 0b10f95 / e849db2 |
| C3 | `playKeepsQueue` 开关：单曲直接播放插入当前歌后而非清队列 | `src/bot/instance.ts` + 设置页行为区块 | 同上 |
| C6 | `forwardStack`：prev 按真实播放历史回退，next 消费栈前进 | `src/audio/queue.ts` | 63f1ced / 390d3fa |
| H3 更新 | 「重启后保留的设置」表按 C4/C1 实况更新 | `README.md` | — |

**验收**：调音量/切模式/改音质后重启机器人自动恢复；保存清单 → 替换/追加加载；开启开关后重启从上次队列继续播放。

## 阶段 4：行为功能（3–5 天）

| 任务 | 内容 | 改动点 | 参考上游 |
|------|------|--------|---------|
| C8 | 频道无人自动暂停：新 `src/bot/auto-pause.ts`（clientlist 占用检测、查询失败按"未知"不误暂停、区分用户手动暂停）；行为设置开关；README 删除死字段警示改为正式文档 | 新 `src/bot/auto-pause.ts`、`src/bot/instance.ts`、设置页 | v1.9.0 auto-pause |
| C7 | 语音闪避：频道内说话事件 → 平滑压低音量（0.2x+0.8x^8 曲线复用），停止说话平滑恢复；`voiceDucking` config（enabled + volumePercent）；设置页开关 | `src/audio/player.ts`、`src/bot/instance.ts` | 97e8a87 / bc71175 |
| C10 | 自定义机器人头像：`data/avatars/` 文件存储 + `custom_avatar_path` 列 + `GET/PUT/DELETE /api/bot/:id/avatar` + 设置页上传组件；空闲=自定义头像、播放=专辑封面 优先级；**保持 onConnect 上传时机**（F5 结论） | `src/data/`、`src/bot/profile.ts`、`src/web/api/bot.ts`、设置页 | ffa27d7 系列 / 88ff62c |
| E1 + N10 | 本地音频上传：`local` provider + 上传端点（存 `data/local-audio`，配额上限）+ Search 页上传入口 + 播放完/清队列引用感知清理 + 行为设置开关 | 新 `src/music/local.ts`、`src/web/api/`、`Search.vue` | e12cbf8 / e849db2 |
| E2 | 本地视频上传：上传后无损 remux 只留音轨（ffmpeg `-c copy`），无音轨上传即拒，500MB 上限，进度/处理中状态 | 建立在 E1 上 | 28b3cd7 / af1dac8 |
| A7 | 试听识别：Song 增加 `vip`/`trialDuration`，网易云/QQ 解析真实可播链接，队列与 UI 标识"仅试听/VIP" | `src/music/provider.ts`、`netease.ts`、`qq.ts`、前端 SongCard | 7b2bd0e / fbb127a |
| N4/N5 | QQ 搜索与播放可靠性修复（若阶段 1–3 核对确认适用）：搜索端点切换、歌单字段、批量预检、首曲失败自动跳 | `src/music/qq.ts`、`player.ts` | 0e68e28 等 5 个 |

**验收**：频道人走空自动暂停/回来恢复；说话时音乐自动压低；自定义头像重启保留；上传 mp3/mp4 可播、无音轨被拒、清理不误删；VIP 试听歌有明确标识。

## 阶段 5：多用户鉴权（已移除）

> 2026-08-24 确认：多用户本轮不做。原 B1（多用户账号体系）、B2（细粒度能力与机器人白名单）、B3（游客模式）、B4（操作审计日志）全部移出计划，**保留现有 JWT 双角色鉴权**。
> B7 的 CSRF Origin 校验与安全头不依赖多用户，已并入阶段 1；B5（adminGroups 命令权限 UI）、B6（忘记密码 FAQ）与多用户无关，保留在原阶段（2 / 0）。
> 若未来需要，可按上游 v2.0.0 的 users/sessions/user_audit 三表方案在独立分支重启此项。

## 阶段 6：运维基建（2–4 天，可与前面阶段穿插）

| 任务 | 内容 | 参考上游 |
|------|------|---------|
| G1 | config.json 移到 `data/`：写入逻辑改路径 + 启动检测根目录旧文件自动迁移 + README/Docker 说明更新（`docker-compose.yml` 卷无需变化，data 已挂载） | #86 |
| G3 + N11 | `scripts/check-native.mjs`（子进程真实加载 opus/better-sqlite3，ABI 不匹配即重装，失败原子还原）+ `package.json` 加 `engines` 与 `prestart` 钩子 + setup.bat/sh 安装前 Node 版本检查、移除硬编码路径 | 03ffd09 / 5728209 / 02d8b39 |
| G4 | setup 脚本国内网络优化（npm registry 镜像可选项） | f87aaaf |
| N2（可选） | Windows 上 jdymusic CDN WinHTTP 回退 | 719ceae |

## 横切注意事项

1. **前端一律 Tailwind 自研**：上游 SCSS/Vue 代码只参考交互逻辑与 API 契约，不搬模板。新增页面（已存队列、用户管理）套用我们现有 `BaseButton/BaseModal/BaseToggle` 组件库与路由结构。
2. **提交切分**：一项一 commit（conventional commits，如 `fix(player): 音量曲线改连续单调`），阶段合并前跑 `npm test` + 手动冒烟清单。
3. **顺序可调**：G1/G3 若 Docker/部署痛点大可提前；多用户鉴权（原阶段 5）已移除，auth 全链路保持现状。
4. **每阶段结束同步 README**（我们 README 是用户唯一入口，上游每次功能 PR 都带文档更新的习惯值得保持）。
5. **N 类待定项**：本方案默认修复类 N1/N3/N6/N9 随相邻任务做（成本极低）；N4/N5 在阶段 2/3 实现时先核对再决定；N2/N10/N11 已分别归入 G/E/G3。如不需要可直接划掉。

## 工作量汇总（估算）

| 阶段 | 内容 | 估算 |
|------|------|------|
| 0 | 文档 + 依赖锁定 | 0.5 天 |
| 1 | 小修复包（11 项，含 B7 CSRF/安全头） | 1–2 天 |
| 2 | 命令与搜索 | 2–4 天 |
| 3 | 持久化与队列 | 3–5 天 |
| 4 | 行为功能 | 3–5 天 |
| ~~5~~ | ~~多用户鉴权~~（已移除，2026-08-24） | — |
| 6 | 运维基建 | 2–4 天 |
| **合计** | | **约 2.5–3 周**（业余时间酌情拉长） |
