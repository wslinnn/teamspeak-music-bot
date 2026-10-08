# 上游 v1.15.2 合并后跟进任务方案（T1–T5）

> 状态：T1 已完成（2026-10-08）；T2–T5 未动工。本文档是各任务启动前的
> 执行方案（工作稿，暂不提交；若希望入库可移至 docs/ 提交——仓库已有
> docs/rebuild-gap-fix-plan.md 的 D 编号任务先例）。后端契约随 v1.15.2
> 合并（2254dca）已全部就位，各任务相互独立，可按任意顺序单独发起。

## 总览与建议顺序

| 任务 | 内容 | 类型 | 规模 | 依赖 |
|------|------|------|------|------|
| T1 | reconcileChannelView 移植上游四重围栏 | 后端 | 小（半天） | 无 |
| T2 | 艺人搜索/艺人页/歌手全目录入队 | 前端 | 中（1 天级） | 无 |
| T3 | B 站多 P 选择弹窗 | 前端 | 中小（半天） | 无 |
| T4 | 个人网易云账号绑定 UI | 前端 | 中（半天到 1 天） | 无 |
| T5 | REST API key 管理 UI | 前端 | 小（半天） | 无 |

T2/T3 共享 stores/player.ts 的移植面（playArtist / checkBilibiliMultiPart），
若同批做可一次重构 store。T4/T5 都在 Settings 页加区块，互不影响。

---

## T1 reconcileChannelView 移植上游四重围栏 ✅（2026-10-08 完成）

**完成记录**：四重围栏（connected/请求序号 `reconcileRequest`/生命周期代际/
tsClient 身份）已移植进 reconcileChannelView，围栏失配静默丢弃不记失败；
refreshOccupancy 顺带加了 self-presence 自洽判别（快照不含 bot 自身即按
未知占用处理，挡住频道迁移中途快照的差一误判），上游原生的 enter 前陈旧
快照竞态按计划维持现状。新增 6 个守护用例（instance-recovery.test.ts）。
两查询保持分离、未合并（下述理由成立）。

**P3 新发现（维持现状，记录在案）**：connected 处理器里的
`void this.reconcileChannelView()` 与 `applyChannelView()` 实为空转——
包装器在 `connect()` resolve 之前就 emit "connected"，彼时 `this.connected`
尚为 false，两道守卫直接返回；连接后的首次对账实际是 +30s 的轮询（无碍，
自愈播种注释里的「30s 内被纠正」仍然成立）。若要「连接即对账」需把调用挪
到 connect() 成功置位之后，且须先理顺与 restoreQueueFromSnapshot 的时序
（播种后 count=0 的视图不能在恢复播放前触发自动暂停），收益有限，暂不动。

**目标**：fork 的 30s 对账查询目前只有 `connected` 一道检查；重连/快速连续
移动频道时，过期快照可能污染 channelView。上游 refreshOccupancy 的四重围栏
（in-flight 请求序号 + lifecycleGeneration + tsClient 身份 + connected）已证明
必要（instance-recovery.test.ts 有 10 个测试专门守护这套语义）。

**现状**（src/bot/instance.ts）：
- `reconcileChannelView()`：getClientList 全量查询 → channelView.reconcileAll
  修复视图 → applyChannelView；失败走 noteReconcileFailure（只计数+日志，
  不承担决策）。缺：请求序号、generation、tsClient 身份比对。
- `refreshOccupancy()`：getClientsInChannel 频道级查询 → 四重围栏 →
  handleOccupancy 决策。已接线（事件 + 轮询）。

**方案**：
1. 给 fork 侧新增独立的 `reconcileRequest` 序号字段（不与 occupancyRequest
   混用——两条路径并发在途，序号语义不同）。
2. reconcileChannelView 开头快照 `const request = ++this.reconcileRequest;
   const generation = this.lifecycleGeneration; const client = this.tsClient;`
   ，await 返回后全部复核，任一失配即静默放弃（与 refreshOccupancy 同款）。
3. 轮询内的顺序保持「先 reconcileChannelView 后 refreshOccupancy」不变——
   前者修复视图（不决策），后者围栏决策，职责不动。
4. **不做**两查询合一：getClientList 全量（≥2 客户端时库会超时，channel-view.ts
   有记载）与 getClientsInChannel 频道级（超时更少）服务不同故障域，合并反而
   把决策绑到最脆的查询上。P2 观察项（轮询周期可能被双查询拉长）记录在案，
   若实测成问题再考虑并行化 `Promise.allSettled`。
5. P2 已知竞态（上游原生即有，非合并引入）：clientEnter 同步恢复后，
   refreshOccupancy 若拿到尚未含新成员的陈旧快照（userCount=0 且 playing）
   会立刻再 pause，直至下一轮事件/语音活动/对账再恢复；失败查询已被
   occupancyFromClientList(0→null) 挡住，仅成功但陈旧的快照有影响。T1 动
   围栏时顺带评估：成功快照里「包含 bot 自身」是可校验的自洽性条件，
   可作为陈旧快照的廉价判别。

**测试**：仿照 instance-recovery.test.ts 的 occupancy describe（274-388 行）
为 reconcileChannelView 补一组同构围栏测试（过期响应不污染视图、断连后
响应被弃、旧生命周期轮询不再查询）。

**验收**：`npm test` 全绿（新增用例 + 既有 1498 不回退）。

---

## T2 艺人搜索 / 艺人页 / 歌手全目录入队

**后端契约（已在位）**：
- `GET /api/music/search` 响应新增 `artists` 字段（仅 netease/qq 贡献），
  元素 `{ id, name, avatarUrl, platform }`
- `GET /api/music/artist/:id?platform=` → `{ artist, songs, albums }`；
  不支持 501，查无 404，songs/albums 分项独立降级（一方失败不拖垮整体）
- `POST /api/player/:botId/play-artist` body `{ artistId, platform }`：
  上限 500 首、分页 100、去重、QQ 版权批量过滤；501/403/`ok:false` 分支齐全；
  权限挂 play 门控（permissions-enforcement.test.ts 已覆盖）

**蓝本**（上游 SCSS 版，只参考交互与数据流，UI 用 Tailwind 重写）：
```
git show upstream-ref:web/src/views/Artist.vue          # 421 行：歌曲/专辑分栏、全部播放
git show upstream-ref:web/src/stores/player.ts          # playArtist action + skipPartCheck 形参
```

**fork 侧改动清单**：
1. `web/src/router/index.ts`：加 `{ path: '/artist/:id', name: 'artist', component: () => import('../views/Artist.vue') }`
2. 新建 `web/src/views/Artist.vue`（Tailwind）：路由参数 id + query platform；
   顶部艺人名/头像 + 「播放全部/随机播放」；歌曲列表复用现有列表行组件
   （参考 Playlist.vue 的 content-visibility 模式）；专辑网格复用
   `aspect-square + CoverArt fill` 响应式封面写法（AGENTS.md 既有约定）
3. `web/src/views/Search.vue`：搜索结果顶部加「艺人」横排（头像+名字，
   点击跳艺人页）；数据取响应的 `artists` 字段，无则整段不渲染
4. `web/src/stores/player.ts`：移植 playArtist（走
   `POST /api/player/${botId}/play-artist` + 乐观更新，注意多 bot 下
   传目标 botId——沿用 v2.2.2 的 `_targetBotId(botId)` 模式）
5. 权限门控：无 play 权限不渲染播放按钮（SongGridCard 的 showPlay 模式）；
   游客语义照旧

**坑**：
- Artist 页内「随机播放」依赖后端 playMode 权限校验，前端按钮同样按
  capabilities 隐藏
- 迟到请求：切艺人时旧请求返回不得覆盖新页面（上游用页面代际守卫，
  蓝本 Artist.vue 有现成写法，移植其逻辑）
- 搜索响应的 `artists` 字段向后兼容（无艺人的平台不返回），Search.vue
  不该假设字段恒在

**测试**：store 层 playArtist 请求目标与乐观更新单测（仿
stores/player.test.ts 的跨 bot describe）；Artist 页的路由参数→API 调用
映射可做轻量组件测试。

---

## T3 B 站多 P 选择弹窗

**后端契约（已在位）**：`GET /api/music/bilibili/parts?bvid=` →
`{ bvid, title, coverUrl, artist, parts: [{ part, cid, title, duration }] }`；
不支持 501，视频不存在 404。

**蓝本**：
```
git show upstream-ref:web/src/components/BilibiliPartModal.vue   # 293 行
git show upstream-ref:web/src/stores/player.ts                   # biliPartModal state + checkBilibiliMultiPart/selectBilibiliPart/closeBilibiliPartModal
git show upstream-ref:web/src/App.vue                            # 挂载点（+2 行）
```

**fork 侧改动清单**：
1. `web/src/stores/player.ts`：移植 `BiliPart`/`BiliPartModalState` 类型、
   `biliModal` state、`checkBilibiliMultiPart`（在 playSong 入口拦截：
   platform=bilibili 且 id 含 `?p=` → 拉分P列表 → 置弹窗状态）、
   `selectBilibiliPart`（用所选 cid 组装播放）、`closeBilibiliPartModal`
2. 新建 `web/src/components/BilibiliPartModal.vue`（Tailwind）：封面+标题+
   分P列表（时长右侧对齐），点击即播；Esc/遮罩关闭
3. `web/src/App.vue`：挂载弹窗（对照蓝本的 +2 行位置）
4. `playSong/playNextSong/addSong` 加 `skipPartCheck` 形参（弹窗内选择后
   重入播放时跳过拦截，防死循环）

**坑（重要）**：拦截与弹窗**必须成套上线**——只移植 store 拦截不挂弹窗，
多 P 视频会静默不播（`handled=true` 直接 return）。这是单原子任务，
不可拆成两次部署。

**测试**：store 层拦截逻辑单测（多P → 弹窗状态置位；skipPartCheck=true →
直接播；非多P → 不拦截）。

---

## T4 个人网易云账号绑定 UI

**后端契约（已在位）**：
- `GET /api/me/music/netease/status`——绑定状态（requireNotGuest，游客 403）
- `POST /api/me/music/netease/qrcode`——生成登录二维码
- `GET /api/me/music/netease/qrcode/status`——轮询扫码状态
- `DELETE /api/me/music/netease`——解绑（服务端删 cookie，凭据不回传浏览器）
- 生效路径：`POST /api/player/:botId/fm` 且 platform=netease 时，已绑定用户
  自动获得个人口味 FM（后端已实现，无需前端再传任何参数）

**蓝本**：
```
git show upstream-ref:web/src/components/PersonalNeteaseAccount.vue   # 261 行：二维码轮询/解绑交互
git show upstream-ref:web/src/views/Settings.vue                      # 挂载位置与文案（搜 PersonalNeteaseAccount）
```

**fork 侧改动清单**：
1. 新建 `web/src/components/settings/SettingsNeteaseAccount.vue`（Tailwind，
   放 settings/ 目录与既有区块并列）
2. `web/src/views/Settings.vue`：账户区附近挂载
3. 轮询交互照蓝本：生成二维码 → 定时轮询 status（过期自动重生成）→
   成功提示并刷新状态；解绑需二次确认
4. 权限门控：游客不渲染整个区块（后端 requireNotGuest 会 403，前端按
   「无权限按钮不渲染」约定处理）

**坑**：
- 二维码是网易云协议二维码，蓝本用 `qrcode` 库前端渲染——fork web 已有
  该依赖（web/package.json qrcode ^1.5.4，随合并已在），无需新增
- 轮询组件卸载时必须清定时器（蓝本 onUnmounted 有处理，移植别丢）
- 绑定成功后 FM 的口味变化发生在后端，UI 只需提示「已绑定，私人 FM 将
  按你的账号推荐」

**测试**：轻量——状态三态（未绑/已绑/轮询中）的渲染分支 + 解绑确认交互。

---

## T5 REST API key 管理 UI

**后端契约（已在位）**：
- `GET /api/keys`——本人 key 列表（仅前缀 `tsmb_xxxxxxxx`，无明文）
- `POST /api/keys` body `{ name }`——创建；响应 `{ key, rawKey }`，**明文仅此
  一次返回**；写审计 `api_key.created`
- `DELETE /api/keys/:id`——吊销；写审计 `api_key.deleted`
- 路由仅限交互会话（requireNotGuest；key 认证调 /api/keys 被后端拒绝）
- 改密/管理员重置/删用户会联动吊销该用户全部 key（b9c79c8，已并集）

**蓝本**：
```
git show upstream-ref:web/src/views/Settings.vue   # 搜「API 密钥」区（模板+脚本+文案）
git show docs/API.md                               # 既有 REST API 文档（合并已入库），UI 可链接过去
```

**fork 侧改动清单**：
1. 新建 `web/src/components/settings/SettingsApiKeys.vue`（Tailwind）：
   key 列表（名称/前缀/创建时间/最后使用）+ 创建（输入名称）+ 吊销（二次确认）
2. `web/src/views/Settings.vue`：开发者/高级区挂载
3. 明文 key 的一次性展示：创建成功弹出复制框（含「关闭后无法再查看」警示），
   关闭即丢——照蓝本交互
4. 文案旁链接 docs/API.md 的调用说明

**坑**：列表只有前缀可识别，删除按 id；明文框要防浏览器扩展嗅探的提示
（蓝本有措辞，移植）。

**测试**：三态渲染 + 明文一次性展示逻辑的组件测试。

---

## 完成定义（所有前端任务通用）

- 中文 UI 文案；语义 token（bg-surface-card 等）不写死色值；深浅色都适配
- 图标 @iconify/vue，新增 `mdi:` 字面量后跑 `npm --prefix web run icons:build`
- 游客不可见的功能不渲染入口（无权限点按钮会 403）
- 长列表行 `content-visibility: auto`（参照 Playlist.vue 底部 scoped 样式）
- `npm test` + `npm run build` 全绿；部署后强刷验证（PWA SW 缓存）
