# 上游 v1.15.4 → v1.16.1 借鉴改造方案

> 状态：**已评审，决策已定（见 §0.1），尚未改动任何代码**
> 分析基线：`merge-base HEAD upstream/main` = `17008ae`（我们 v2.4.0 所在点）
> 上游区间：69 个提交，77 文件，+9715 / −1167
> 我们当前：v2.4.1（`0457ff1`），已含网易 `crypto:"api"` 风控绕过

## 0.1 评审决策记录

| 议题 | 决定 | 影响 |
|---|---|---|
| P1–P4 首批范围 | **四项全做** | 首轮交付 4 个低风险批次 |
| P5 重试层 | **降级，等真出问题再上** | 不做 `url-retry.ts`；`getFallbackQualities` 一并缓做 |
| P6 历史删除 | **落地，DELETE 保持 `requireNotGuest`（选项 A）** | 语义自洽：能看才能删 |
| P7 缓存隔离 | **做**（P8 的前置门禁，不可省） | 缓存键加账号维度 + 个人 view 独立实例 |
| P8 账号池 | **四平台全量做** | 含分配 / 容量 / 偏好 / 前端 Tailwind 新组件 |
| P9 SDK | **完整迁移 + OpenProtocol v1** | 最高风险，放最后 |

**P5 降级后的连带调整**：

- `getFallbackQualities()` 属于重试层，缓做。`SongUrlRequestOptions` 仍保留（P3 的 `avoidHosts` 需要），但只实现 `avoidHosts` / `refresh` 两个字段，不含阶梯扫描。
- P2 的 `SongUrlUnavailable` 仍有价值（失败原因分类不依赖重试层），照常做。

---

## 0. 总览与执行顺序

按「依赖关系 + 风险递增」编排。P 表示建议的批次，同批内可并行，跨批必须按序。

| 批次 | 内容 | 风险 | 预估改动 | 依赖 | 状态 |
|---|---|---|---|---|---|
| **P1** | cookie 规范化 + 日志脱敏 | 极低 | ~110 行 + 测试 | 无 | ✅ 已批准 |
| **P2** | 播放失败原因分类（消灭 9 处硬编码） | 低 | ~250 行 | 无 | ✅ 已批准 |
| **P3** | B 站四补丁（分 P / CDN 轮换 / 域名表） | 低 | ~120 行 | P2 的 `SongUrlRequestOptions` | ✅ 已批准 |
| **P4** | TS 连接围栏（代次校验 + 恢复条件） | 低 | ~60 行 | 无 | ✅ 已批准 |
| ~~P5~~ | ~~播放链接重试层~~ | — | — | — | ⏸ **降级，缓做** |
| **P6** | 播放历史删除 | 中 | 后端 ~60 行 + 前端面板 | 无 | ✅ 已批准（选项 A） |
| **P7** | 缓存键账号维度（**前置门禁**） | 中高 | ~80 行 | 无 | ✅ 已批准（P8 前置） |
| **P8** | 多用户音乐账号池 | 高 | ~900 行 | **P7 必须先完成** | ✅ 已批准（四平台） |
| **P9** | SDK 迁移 + OpenProtocol v1 | 最高 | ~1600 行 | P4（围栏先落地） | ✅ 已批准 |

**关键顺序约束（不可调换）**：

1. **P7 必须早于 P8**。我们 `cached-provider.ts` 的缓存键没有账号维度，先上账号池等于制造跨用户数据泄漏。
2. **P9 必须晚于 P4**。`client.ts` 会整体重写，先修好围栏能让迁移期间的回归更容易定位。
3. **P3 依赖 P2**。`SongUrlRequestOptions`（`avoidHosts`）是 P2 引入的接口改动，先做 P3 会重复改 8 个 provider 的签名。

---

## P1 — cookie 规范化 + 日志脱敏

### P1.1 cookie 规范化

**问题实测**：我们 `data/cookies/netease.json` 的 cookie 长度 **3958 字节**，含 **28 个 `Max-Age`**。用户粘贴的是整条 `Set-Cookie` 头，`Max-Age`/`Expires`/`Path` 被当成 cookie 名塞进 `?cookie=` 查询串。上游实测「34/34 次 `/song/url/v1` 全失败」，且症状伪装成版权限制。

我上一轮已确认这个 cookie 污染**不影响** `crypto:"api"` 的取链（实测过），但它是真实隐患：查询串 URL-encode 后可能膨胀到近 10KB，会撞 HTTP 请求行上限，且对风控是不友好信号。

**新增** `src/music/cookie-normalize.ts`（照搬上游，91 行）：

- `SET_COOKIE_ATTRIBUTES` 集合：`max-age / expires / path / domain / secure / httponly / samesite / priority / partitioned / version / comment / size / sameparty`
- `TOKEN` 正则做 RFC 6265 cookie-name 校验，过滤表头噪音
- 按 `indexOf("=")` 首个位置切分，**保留值里的 `=`**（base64 padding）
- 用 `Map` 去重同名键，后写覆盖（Set-Cookie 头里 `MUSIC_A_T` 会重复十几次，载荷相同）
- 处理多行粘贴：全局 `gim` 替换 `^[ \t]*(?:set-)?cookie[ \t]*:[ \t]*` → `;`
- 导出 `normalizeCookie()` 与 `isNormalizedCookie()`

**接线点**：

| 文件 | 位置 | 改动 |
|---|---|---|
| `src/music/auth.ts` | `save()` | 落盘前 `normalizeCookie(cookie)` |
| `src/music/auth.ts` | `load()` | 读出后规范化；**与磁盘内容不一致时写回**（repair in place），写回失败不阻断（只读卷场景） |
| `src/music/auth.ts` | `load()` | 修 `JSON.parse(...).cookie ?? ""` → `typeof data?.cookie === "string" ? ... : ""`（防数字/对象漏入） |
| `src/music/netease.ts` | `setCookie()` | `this.cookie = normalizeCookie(cookie)` |
| `src/music/qq.ts` / `bilibili.ts` / `kugou.ts` | `setCookie()` | 同上各一行 |

**排除项**：`jellyfin` 的 "cookie" 是 JSON 串（access token / userId / deviceId），**不能**规范化。上游的做法是 `storesCookieHeader(platform)` 白名单，我们照此加。

**测试**（新增 `src/music/cookie-normalize.test.ts`，~85 行）：

- 真实 Set-Cookie 头 → 只剩 name=value
- 幂等性 `normalizeCookie(normalizeCookie(x)) === normalizeCookie(x)`
- base64 等号保留
- 重复键取最后一个
- CR/LF 剥离（多行粘贴）
- 空值丢弃；无 `=` 碎片丢弃
- 有效 cookie 不受影响（关键回归）

**验收**：现存 `data/cookies/*.json` 在下次启动后被自动洗成干净格式；`GET /song/url/v1` 查询串长度显著下降。

### P1.2 日志脱敏

**问题**：`src/logger.ts` **无任何 serializer**。你给我的那份诊断日志里，`axios` 错误的 `config.params.cookie` 明文出现了 **3 次**，每次约 4KB。若该日志被分享/上传，即等于泄露账号凭据。

**改动** `src/logger.ts`（约 20 行）：

```ts
// 两个出口都要挂（console 版与 pino-roll 文件版）
serializers: { err: serializeHttpError, reason: serializeHttpError }
```

`serializeHttpError` 逻辑：
- 是 AxiosError → 只输出 `{ type: "AxiosError", code, status, upstreamCode }`
  - `upstreamCode` 取 `response.data.code`，**仅当是数字**（网易的 -460 在这里）
- 非 Axios 错误 → 回落 `pino.stdSerializers.err`

**兼容性检查（已做）**：我们也在用 `reason` 键（`instance.ts:367` 的 `{sessionId, reason:"recovery-error"}`、`music/spotify/backend.ts:10`），都是字符串。序列化器对非 Error 值原样返回，不会破坏现有日志格式。

**测试**：照上游手法——用 `spawnSync(tsx --eval)` 跑子进程，断言真实 stdout **不含** cookie 片段。这个手法本身值得抄，因为它验证的是真实输出而非 mock。

---

## P2 — 播放失败原因分类

### 问题

`src/web/api/player.ts` 有 **9 处**硬编码「区域/版权限制」，行号：**461、496、552、579、642、673、710、752、791**。上游 `4c25cfe` 的注释点明了这个病的代价：

> a genuine -460, a lapsed membership and a delisted track were indistinguishable for **weeks of debugging**

我当时诊断你的问题时也走过这条路——先怀疑版权，再怀疑 cookie，最后才测出是加密方式。

### 设计

**`src/music/provider.ts` 新增类型**（照搬上游结构）：

```ts
export const RISK_CONTROL_CODE = -460;

export class RiskControlError extends Error { code = RISK_CONTROL_CODE; }

export type PlayFailureCode =
  | "risk_control"                    // -460，瞬态
  | "vip_required"                    // fee 1/4 且未付费
  | "no_copyright"                    // 上游 404，下架/区域
  | "quality_denied"                  // 曲目存在但当前音质无权
  | "upstream_request_failed"         // HTTP 失败/不可达
  | "provider_verification_required"  // 要求人工验证
  | "unknown";

export interface PlayFailure {
  platform: string;
  songId: string;
  code: PlayFailureCode;
  message: string;                      // 可直接渲染的一行中文
  upstream?: Record<string, unknown>;   // 仅日志，不含密钥
}

export class SongUrlUnavailable extends Error { failure: PlayFailure; }

export function toPlayFailure(platform, songId, error): PlayFailure;
export function playbackRequestFailure(platform: "qq"|"kugou", songId, error): SongUrlUnavailable;
```

**`src/music/netease.ts` 新增**：

- `riskControlFrom(err)`：**必须读 body**——axios 把所有 4xx 都报成 `ERR_BAD_REQUEST`，仅看 status 分不出来。判定 `status === 400 && data.code === -460`
- `diagnoseNeteaseMiss(songId, level, item, body): PlayFailure`：读上游字段判读
  - `item.code === 404` → `no_copyright`「无版权或已下架」
  - `fee ∈ {1,4} && !payed` → `vip_required`，`fee===4` 时文案为「需要购买该专辑」，否则「需要会员」
  - 其余无 URL → `quality_denied`「当前音质无播放权限」
  - 带 `（level）` 后缀便于区分

**`getSongUrl` 行为变更**：`return null` → `throw SongUrlUnavailable(diagnoseNeteaseMiss(...))`

> 这是**破坏性接口变更**，必须同批改完所有消费者。上游 review note 自己也提醒：「Anything that wraps `getSongUrl` itself needs a `catch`」。

### 我们这边需要同步修改的 5 个消费者

| 位置 | 现状 | 改法 |
|---|---|---|
| `src/bot/instance.ts:1281` | 在 `try` 内，`if (!result?.url) return false` | 已在 try 内可兜住；改为捕 `SongUrlUnavailable` 取 `failure` |
| `src/bot/instance.ts:1477` | `tryResumeAgedUrl`，需确认是否在 try 内 | **逐个核实**，不在则补 catch |
| `src/bot/instance.ts:1586` | 断流恢复路径 | 同上 |
| `src/music/cached-provider.ts` | 透传 `getSongUrl` | 无需改（异常自然穿透），但**不要**缓存异常 |
| `src/web/api/player.ts` | 9 处硬编码文案 | 改为消费 `PlayFailure.message` |

**`resolveAndPlay` 增加可选回调**（上游刻意用回调用法而非返回元组，因为约 20 个调用点和现有布尔语义被测试锁定）：

```ts
async resolveAndPlay(song, onFailure?: (f: PlayFailure) => void, commitQueue?: () => void): Promise<boolean>
```

### 9 处文案改造对照

| 行 | 现文案 | 新来源 |
|---|---|---|
| 461 / 552 / 642 | 歌单/专辑/歌手 N 首均无版权（区域/版权限制） | 汇总各曲 `PlayFailure.code` 分布，如「12 首需会员、3 首无版权」 |
| 496 / 579 / 673 | 其余区域/版权限制 | 同上 |
| 710 / 752 / 791 | 无法播放（区域/版权限制） | `failure.message` 直出 |

**注意**：批量场景（歌单/专辑/歌手）需要聚合多个 `PlayFailure`，建议加一个纯函数 `summarizePlayFailures(failures): string`，按 code 分组计数，取占比最高的 1–2 类。这个函数上游没有，是我们的增量。

### 测试

- `diagnoseNeteaseMiss` 的字段判读矩阵（fee 0/1/4/8 × payed 0/1 × code 200/404）
- `toPlayFailure` 对 `RiskControlError` / `SongUrlUnavailable` / 裸 Error 的分派
- `summarizePlayFailures` 的分组文案
- 回归：现有 9 处文案的调用路径不再抛未捕获异常

---

## P3 — B 站四补丁

### P3.1 分 P 参数丢失（`79e9cd7`）——**必须只取这一版**

我们 `src/bot/song-ref.ts:70-71`：`return { id: bv[0], platform: "bilibili" }`，**粘贴链接的 `?p=N` 直接丢失**。

上游第一版（`b7779ab`）有 bug：取整串 query，遇到 `[URL=https://…?p=2]` 或多行粘贴会取错。修正版（`79e9cd7`）逻辑：

```ts
const q = text.slice(bv.index + bv[0].length);
const m = q.match(/^\/?\?([^#\s\[\]]*)/);
```

只接受紧邻 BV 号、以 `?` 开头、到 `#`/空白/`[`/`]` 为止的 query。

**我们已有基础**：`bilibili.ts:80-91` 的 `parseBilibiliId` 已认 `?p=` / `:pN`，`getCid(bvid, page)` + `cidCache` 也是分 P 的。**只差聊天链接解析这一环**。

### P3.2 CDN host 轮换（`1b57af6`）

- `bilibili.ts` 新增 `pickStableAudioUrl(stream, avoidHosts?)`：选择顺序「未试过的稳定 host → 未试过的任意 host → 稳定 host → primary」
- `instance.ts` 的 `streamRecovery` 结构加 `failedHosts: Set<string>`；每次恢复前把当前失败 URL 的 hostname 记入，重取时传下去——**换 CDN 而不是回同一个死节点**
- 依赖 `SongUrlRequestOptions.avoidHosts`（P2 引入）

### P3.3 域名表补漏（`b7779ab`）

`src/audio/player.ts:100-101` 的 B 站域名表（`["bilivideo.com", "bilivideo.cn", "bilibili.com", "szbdyd.com"]`）缺 `mountaintoys.cn`。缺了它就没有 Referer/UA、也不是 input-side seek，**长视频续播会从头拉**。

### P3.4 接口签名扩展

`MusicProvider.getSongUrl(songId, quality?, options?)`，`SongUrlRequestOptions { avoidHosts?: ReadonlySet<string>; refresh?: boolean }`。

**必须一次性改完 8 个 provider**：netease / qq / kugou / bilibili / jellyfin / local / spotify / youtube，否则 `tsc` 立刻红。

> **坑点**：`cached-provider.ts` 里所有方法包装都是显式列举形参的形式（如 `search(query, limit?, offset?)`）。加第 3 参时**必须同步更新包装器的形参列表**，否则参数会被**静默丢弃**——这是个不会报错的 bug。

---

## P4 — TS 连接围栏

### P4.1 代次围栏（`17b092f`）——我们比上游更暴露

**我们现状**：`instance.ts:1000` 的 `await this.isCommandAllowed(...)` 内部还有一次 `getClientServerGroups()` **远程查询**，这是最长的 await 窗口；而 `instance.ts:1019-1025` 之后**完全不校验代次**。

**上游做法**：`handleTextMessage` 开头捕获 `lifecycleGeneration`，在「异步权限检查之后」和「每次回复分片之前」都断言 `isCurrent()`。理由：TS 的数字 invokerId 只属于那一条连接。

**改动量**：约 20 行，纯防御性，无行为变更风险。

### P4.2 恢复条件（`d130652`）——**不能照搬**

上游 `_resumeIfReturning` 增加四道门：`listenerId > 0`、非自己、`channelId !== 0n`、`channelId === getChannelId()`；触发点从「仅 clientEnter」扩展为「clientEnter + clientMoved 移入本频道」。

**冲突点**：我们 `instance.ts:642-649` 的 `_resumeIfReturning(source)` 只接一个字符串来源，且有两个调用点都是 **fork 自加的**：

- `clientEnter`（`instance.ts:560`）
- **`voiceActivity` 语音包**（`instance.ts:546`）——中文注释说明是为应对「部分环境 leave 可达而 enter 不可达」

直接照搬频道断言会**收紧掉这个有意放宽的兜底**。

**正确做法**：
- 给 `clientEnter` 路径加频道过滤（用已有 `channelView` / `getChannelId()`）
- **保留** `voiceActivity` 触发，但**自行判定频道归属**（当前 `voiceDucking.handleVoiceActivity` 也不校验频道，`voice-ducking.ts:76`）
- `clientMoved` 的「移入本频道」可以采纳，这是纯增量

---

## P5 — 播放链接重试层（⏸ 已降级，缓做）

> **决策：本轮不实现。** 理由：`crypto:"api"` 实测六档音质全通；上游重试层是为「无法绕过风控」场景设计的，当前投入产出比低。
> 以下内容保留为**技术储备**，待真出现 `crypto:"api"` 失效或间歇性取链失败时再启用。

### 设计（新增 `src/bot/url-retry.ts`，~300 行）

抽成**独立纯函数**（不挂在 BotInstance 上），理由：便于单测，且保证所有入口（web 点击 / 聊天 `!play` / 自动切歌 / FM）**构造性获得相同预算**。

**常量（上游实测调优结果，直接采用）**：

| 常量 | 值 | 依据 |
|---|---|---|
| `MAX_URL_RETRIES` | 5 | 硬上限，防手改配置导致长停滞 |
| `DEFAULT_URL_RETRY_BACKOFF_MS` | 250 | 同音质重试，**线性**增长 250 / 500 / … |
| `QUALITY_SWITCH_BACKOFF_MS` | 120 | 换档位是另一个请求，不需等同窗口抖动 |
| `RISK_CONTROL_BACKOFF_MS` | **2500** | 从 800 上调，依据「点一次失败、toast 挂 2-3 秒、再点就成功」 |
| `MAX_RISK_CONTROL_REQUESTS` | **2** | 1 原始 + 1 重试；实测 `-460,-460,-460,-460,200` 说明是「过会儿放几个」而非定时解锁 |

**请求预算**：正常（`playUrlRetries=2`, exhigh）→ 3 次同档 + 2 个低档 = 5 次请求 ≈1.1s；-460 状态 → 2 次请求 2.5s。

**核心逻辑**：

```ts
// 两阶段 plan
for (let i = 0; i <= retries; i++) plan.push({ quality: undefined, fallback: false });
for (const q of opts.fallbacks ?? []) plan.push({ quality: q, fallback: true });

// -460 时提前退出：与音质无关，逐级重试只买到沉默
if (riskControlled && (step.fallback || requestsMade >= MAX_RISK_CONTROL_REQUESTS)) break;
```

**取消检查（`90a4d80`，最重要的一处）**：在**三个点**检查 `isCancelled()`
1. 每次尝试前
2. `await sleep()` 之后
3. **`await resolve()` 返回之后** ← 这处是后补的，之前重取成功也会把已切歌的 URL 推上去

`onExhausted` **取消时不触发**——「用户按了停止」不是值得上报的失败。

**音质降级阶梯**（`netease.ts`）：

```ts
getFallbackQualities(): string[] {
  const order = NETEASE_QUALITY_LEVELS.map(l => l.value);  // 低→高
  const index = order.indexOf(this.quality);
  if (index <= 0) return [];
  return order.slice(0, index).reverse();   // exhigh → ["higher", "standard"]
}
```

**为什么不直接降到最低**：上游实测「同一首歌在 192k(higher) 可播，而 320k(exhigh) 和 128k(standard) 都返回 null」——阶梯不连续，「退到最便宜」会漏掉唯一能播的档。必须扫遍当前档之下**每一档**。

### 与我们 `crypto:"api"` 的关系（重要）

| 维度 | 说明 |
|---|---|
| 主路径 | 保留 `crypto:"api"`。这是上游没覆盖的维度，我们的实测有效 |
| 重试层定位 | **兜底**。若 `crypto:"api"` 哪天失效被风控，重试层接管 |
| 已知局限 | `crypto:"api"` 生效时返回 200，上游的 `riskControlFrom` 分支基本是**死代码**，-460 相关单测无法覆盖真实行为 |
| UA 叠加 | `crypto:"api"`（api 加密）与上游 `ua:` 参数的消费路径**不同**（eapi vs api），是否叠加有效**未验证**，合并时必须实测 |

### 配置

`src/data/config.ts` 新增 `playUrlRetries: number`（默认 **2**，夹在 0..5）。遵循我们的强校验风格：非数字回落默认值（不是禁用），因为「禁用重试」是反直觉结果。

### 测试

上游的测试思路值得完整照搬：把 `sleep` 注入化，测试**不真实等待**。

- 正常重试：第 2 次成功
- 音质阶梯：exhigh → higher → standard
- -460：2 次请求封顶、2500ms 退避、**跳过** fallback
- 取消：sleep 中取消 → 不再发请求、`onExhausted` **不触发**
- resolve 返回后取消 → 结果被丢弃（`90a4d80` 的回归）
- `normalizeRetryCount` 对 `"3"` / `null` / `NaN` 的处理

---

## P6 — 播放历史删除

### 后端

**DB 层**（`src/data/database.ts`）：
- `play_history` 表已有 `id INTEGER PRIMARY KEY AUTOINCREMENT`（`:318`），rowId 天然可用
- 新增 `deletePlayHistory(botId, ids): number`——单事务批量删，**每条 SQL 都带 `botId` 谓词**（一个 bot 永远删不到另一个 bot 的行）
- 新增 `clearPlayHistory(botId): number`

**路由**（`src/web/api/player.ts`，当前读取在 `:900`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/:botId/history` | **增补 `rowId`**，保留 `id` = 平台歌曲 id（不破坏既有播放器） |
| `DELETE` | `/:botId/history/:rowId` | 单条 |
| `DELETE` | `/:botId/history` | body `{ids}` 批量 或 `{all:true}` 清空 |

鉴权：`authorize({ capability: "player.queue", guestFlag: "removeClear" })`

**校验收紧（`84e04ee`）**：
- `rowId` 必须 `/^\d+$/` 且安全正整数（原来 `parseInt("12x")` 会通过）
- 批量必须 **1–500 且全部合法**（原来静默过滤 + `slice(0,500)`）
- `all:true` 与 `ids` 同时出现 → 400（消除歧义）

### 前端（Tailwind 重写，不可照抄）

我们对应物是 `web/src/components/library/HistoryPanel.vue`（Library 的 history Tab，含搜索 + 分页）。改动是**纯增量**。

要点：
- 门控：`canDelete = can('player.queue') || guestCan('removeClear')`，工具栏/复选框/行删除按钮**均在 `canDelete` 为真时才渲染**（符合我们「渲染层门控」约定）
- `deleting` 防重入
- `historyVersion` 计数丢弃过期响应
- `watch(activeBotId)` + `AbortController` 保证切换 bot 不串数据

### 需你决策的语义冲突 — 已决策

我们 `GET history` 挂了 `requireNotGuest`。若 `DELETE` 允许游客（`removeClear`），会出现**「游客能删自己看不到的记录」**。

> **已决策：选项 A —— `DELETE` 同样保持 `requireNotGuest`。**
> 语义自洽：能看才能删。游客既看不到历史，也不能删除。
> 实现要点：`DELETE` 两个路由都挂 `requireNotGuest`，与 `GET` 一致；`guestFlag: "removeClear"` 仅对**非游客角色**生效（member/admin 的细粒度权限）。

---

## P7 — 缓存键账号维度（P8 的前置门禁）

### 问题（已核实代码）

`src/music/cached-provider.ts` 的缓存键**全部没有账号维度**：

| 行 | 键 |
|---|---|
| 63 | `lyrics:${songId}` |
| 66 | `playlist:${playlistId}` |
| 70 | `album:${albumId}` |
| 74 | `song:${songId}` |
| 78 | `search:${query}:${limit}:${offset}` |
| 86 | `recommendPlaylists` |

**后果**：一旦个人账号 view 也过共享 cache，**成员 A 会读到成员 B 的搜索结果和歌单**。

**另一个隐患**：`withCookie()` 被 bind 到内层 provider，返回的是**全新裸 `NeteaseProvider`**，完全不经过 `withContentCache`。上池后每个带个人账号的请求都会**丢掉全部内容缓存**（歌词/歌单/详情恰是命中率最高的）。

### 方案（两道防线，都要做）

**防线一：缓存键加身份后缀**

```ts
function cacheKey(scope: string) { return scope ? `${scope}:${key}` : key; }
// scope = cookie 的 sha256 前缀（不可逆，避免原始凭据进内存键）
```

由 `withContentCache(provider, cache, scope?)` 的第三参传入。

**防线二：个人 view 永不进共享 cache 实例**

明确约束：`resolveProviderForRequest()` 返回的个人 provider **不包** `withContentCache`，或包裹时使用**独立的 cache 实例**。

> 我建议**两道都做**：只靠键隔离，任何一次重构都可能让键拼错；只靠实例隔离，未来有人把 cache 提到外层又会破功。

### 测试

- 同一 query 不同 scope → 不命中同一键
- 同 scope 重复 query → 命中
- 个人 view 不走共享实例

---

## P8 — 多用户音乐账号池

### 数据层（纯增量 DDL，无迁移风险）

三张新表：

```sql
music_accounts(id, platform, label, cookie, ownerId, capacity, enabled, createdAt, updatedAt)
  -- ownerId NULL = 从共享登录导入
music_account_grants(userId, platform, accountId, grantedBy, grantedAt)
  -- PRIMARY KEY (userId, platform)，FK accountId ON DELETE CASCADE
user_music_prefs(userId, platform, preferShared)
```

复用已有的 `user_music_cookies`（我们 `database.ts:472` 已有）。

**关键设计**：自有账号与「管理员分配」**分表**。理由（上游注释）：成员扫码绑自己账号不能覆盖管理员分配，成员「解绑」也绝不能撤销管理员授权。

### 解析顺序（`src/web/api/provider-scope.ts`，新增）

```
preferShared（显式选择）→ own（user_music_cookies）→ granted（music_account_grants）→ null（=共享登录）
```

- `personalCookieFor` 有 `alwaysPersonal` 逃生口（私人 FM 在开关前就发布，必须继续生效）
- `grantedAccountFor` **故意没有**这个口子——开关一关分配必须立刻失效

### 可见性与安全

- `/api/music-accounts` 挂 `requireAdmin`（**不是** `bot.manage`），成员永不能看到谁被分配了什么
- cookie **永不回传浏览器**：`maskCookie` 只给 `前6…后4 (长度字符)`，`toWire` 只输出 `cookiePreview`
- 成员端 `/api/me/music/:platform/status` 只返回自己的；被分配时 `source:"granted", canUnlink:false`
- `scopedUser` 对 `role === "guest"` 直接返回 null（所有游客映射同一匿名身份，绑定会跨游客泄漏）——与我们 `requireNotGuest` 语义一致

### capacity 语义

`0` = 不限，`1` = 独占（第二个 → 409 `account_exclusive`），`>1` = 最多 N 个（满了 → 409 `account_full`）。

容量检查与 grant 写入**必须在同一个 `db.transaction`**，防并发双击把独占账号发给两人。

降容量时禁止降到现有授权数以下（`changes=0` → 409 `capacity_below_existing_grants`）。

> **注意**：`0` 代表不限，所以**没法用 0 封禁账号**。封人要用 `enabled=false`（`selectGrantedAccount` 里有 `AND a.enabled = 1`，即时可回滚）。

### VIP 缺失降级

1. **显式**：`PUT /api/me/music/:platform/preference {preferShared:true}`，只存标志不存 cookie，翻回来原账号完好。功能关闭时返回 409 `per_user_accounts_disabled`
2. **自动**：`withSharedPlaybackFallback()` —— **只包 `getSongUrl`**：

```ts
view.getSongUrl = async (songId, quality) => {
  try { const r = await ownResolve(songId, quality); if (r?.url) return r; } catch {}
  return shared.getSongUrl(songId, quality);
};
```

搜索/歌单/FM 仍走成员自己的账号——那是 per-user 登录的全部意义。

### 房间播放固定共享（`aceccc9`）

成员音源范围**只作用于浏览器端**（搜索/歌单/试听）。房间播放走 `bot.getProviderFor(platform)`，无条件用共享 provider。设计意图：**会员权益共享，音乐库隔离**。

副作用（上游文档也承认）：播放在房间发生，播放记录永远记在管理员账号名下。

### 我们需要改的调用点

`src/web/api/music.ts:156` 的 `resolveProvider(platform, res)` **完全没有 `req` 参数**——搜索/歌单永远走共享登录。需要加 `req` 并改为 `resolveProviderForRequest`。

**注意**：`/search/all` 里 5 个 provider 都要**各自 scope**，漏一个就把管理员的库混进成员结果。

### 配置

`perUserMusicAccounts: boolean`，默认 **false**，严格 `=== true` 才开启（防手改 `"yes"`/`1` 误开隔离）。

### 前端（全部重写，不可照抄）

上游 `PersonalMusicAccount.vue` 是 SCSS + `var(--border-color)`；我们 `git grep personal-music -- web/src` **无结果**——连入口组件都还不存在。

需要新建 Tailwind 组件，挂在 Settings 的相应分区。可借用上游的**文案信息设计**：

- 「**网页端**播放使用哪个账号」（而非笼统的「播放使用」）
- 「房间里播歌一直用共享账号，无论这里怎么选」

这个措辞修的是真实的理解偏差，值得照抄语义。

---

## P9 — SDK 迁移 + OpenProtocol v1

### P9.0 为什么绑在一起

OpenProtocol v1 依赖 `sendPluginCommand` / `pluginCommand` 事件。我核实了：**我们装的 `@honeybbq/teamspeak-client@0.2.3` 的 `dist/notifications.d.ts` 通知联合类型里根本没有 `pluginCommand`**。照抄代码编不过。

而 `263c1ba` 顺手把 SDK 迁到 `@honeybbq/teamspeak@^1.0.0-beta.31`——`client.ts` 改动 225 行。两者不可分割。

### SDK 差异实测（已下包对比）

| 维度 | 0.2.3（我们） | 1.0.0-beta.31（上游） |
|---|---|---|
| 包结构 | 单包 `dist/*` | **分包**：`./client` `./query` `./stream` `./versions` `/` |
| `Client` | `@honeybbq/teamspeak-client` | `@honeybbq/teamspeak/client` |
| identity | `identityFromString` / `getUidFromPublicKey` | `parseIdentity` / `uidFromPublicKey` |
| 生成 identity | `generateIdentity` | `generateIdentitySync`（+ `UIDAlgorithm`） |
| 发消息 | `sendTextMessage(client, mode, target, msg)` | `sendChannelMessage` / `sendPrivateMessage` 分开 |
| 客户端信息 | `getClientInfo` | `getClientProperties` |
| 移动客户端 | `clientMove` | `moveClient(client, asClientID(id), asChannelID(ch), opts?)` |
| 删文件 | `fileTransferDeleteFile` | `deleteFile` |
| 上传 | — | `initFileUpload(client, asChannelID(ch), path, size, opts)` |
| ID 类型 | 裸 number/bigint | **branded**：`asClientID` / `asChannelID` / `asUID` … |
| 事件类型 | `ClientLeftViewEvent` / `TextMessage` / `ClientInfo` | `ClientLeaveEvent` / `TextMessageEvent` / `ClientEnterEvent` |
| `clientID` 类型 | bigint | **number** |
| 关闭 | `handler.close()` | `disconnect()` |
| 枚举 | — | `Codec` / `TextMessageTarget` 等集中导出 |

**好消息**：事件名一一对应（`textMessage` / `voiceData` / `disconnected` / `clientEnter` / `clientLeave` / `clientMoved`），我只是给回调参数改了类型名。

### 迁移分步（每步必须 tsc 绿 + 测试绿）

1. **加测试缝（先做，零行为变更）**：`ClientOptions` 加 `@internal sdkClientFactory`，连接处改为 `this.options.sdkClientFactory ? ... : new TS3FullClient(...)`。上游有这个缝，我们正好借迁移补上。
2. **升依赖、双包并存期**：`package.json` 同时保留旧包与新包，`client.ts` 分两套 import 注释掉一套，先让 `tsc` 通过。
3. **迁移 identity**：`identityFromString`→`parseIdentity`、`getUidFromPublicKey`→`uidFromPublicKey`、`generateIdentity`→`generateIdentitySync`。
4. **迁移命令 API**：`sendTextMessage` 拆分（我们是单播/频道两种模式，对应 `sendPrivateMessage` / `sendChannelMessage`）、`getClientInfo`→`getClientProperties`、`clientMove`→`moveClient` + `asClientID`/`asChannelID`、`fileTransferDeleteFile`→`deleteFile`。
5. **迁移事件类型**：`ClientLeftViewEvent`→`ClientLeaveEvent` 等；注意 `clientID` 从 bigint 变 number，**检查所有 `Number(ev.clientID)` 与 `BigInt(...)` 转换点**。
6. **补 `sendTextReply`**（上游 `4f026aa` 相关）：`targetMode === 1` 时单播回私聊。我们 `instance.ts:1023-1024` 现在一律回频道。
7. **移除旧依赖**，`npm test` + `npm run build` 全绿。
8. **OpenProtocol v1**（最后做）：新增 `src/ts-protocol/open-protocol.ts`（473 行）。

### 我们 fork 特有的迁移风险（**上游没有这些**）

`client.ts` 里有大量**上游没有的**自有改造，迁移时必须逐项回归：

| 自有改造 | 风险 |
|---|---|
| `protocol-detect`（TS3/TS6 探测） | SDK 升级后探测逻辑不变，但 `queryPort` 语义需复核 |
| `TS6HttpQuery`（`http-query.ts`） | 独立于 SDK，不受影响 |
| `voice-endpoint` 解析器 | 依赖 `VoiceData` 事件结构，**需实测 TS6 下的端点解析** |
| `resolvedChannelId` 覆盖 | bigint→number 转换处需检查 |
| `visibleClientUids` 缓存 | `clientID` 类型变化会影响 Map 键 |
| `clientUid` 从 identity 计算 | `getUidFromPublicKey`→`uidFromPublicKey` 返回值语义需验证一致 |

### OpenProtocol v1 设计要点（照搬上游）

**通道**：TS3/TS6 **plugin-command**，非 HTTP。两端是「本机器人 TS 客户端」↔「用户客户端上的 TS 插件」。

**插件名白名单**（仅两个）：`tsclient:identity`、`tsclient:commands`。

**载荷**：`{v:1, action:...}` JSON，**硬上限 1024 字节**。

**发现流程**：
1. 连接成功后向**频道**广播 `announce`：`{client_type:"bot", app_name:"TSMusicBot", app_version, capabilities:["chat:slash_commands"]}`
2. 频道移动、他人移入本频道时再广播
3. 插件发 `announce`/`query` → 机器人**单播**回 `announce_ack`
4. 插件发 `list_req` → 单播回 `list_ack`（含 `command_prefix` + ≤16 条命令 spec：name/args/desc，中英双语，字符上限 24/32/64/32）

**`command_prefix` 语义（易被提交标题误导）**：
- 它**只是「告知」**——`list_ack` 里声明机器人实际监听的字面前缀（如 `!`），因为插件猜不到
- `263c1ba` 原本加了 `/` 斜杠回退，但 **`69b3112` 把它整段撤销**（"restore prefix-only command parsing"）
- **最终状态：不支持 `/` 斜杠执行，只按配置前缀解析**

**安全边界（`4f026aa` 核心）**：
- 入站过滤：仅两个插件名；忽略自身（`invokerId === self`）、`invokerId <= 0`、载荷 ≥1024 字节、非对象/数组、`v !== 1`、未知 action
- 出站封顶：每个载荷发送前再校验 <1024；命令表**逐条 pop 直到装得下**；`truncateChars` 先剥控制字符再按码点截断
- 限流：`peerKey+action` 冷却（announce 10s / query 5s / list_req 5s）+ **全局令牌桶**（burst 4、2/s）；冷却表 >128 项才清理
- **删掉了失败回滚**（`rollback(token)`）：发送失败照样消耗配额，避免「发送必败 → 每次重试都白送额度」的放大面

**广播去抖**：2s（尾随一次）、失败 500ms 重试一次；`generation` 计数做连接围栏；`reset()` 清定时器 + 限流器；定时器全部 `unref()`。

---

## 附录 A：不建议跟进的项目

| 项目 | 原因 |
|---|---|
| `musicProxy`（`2daae59`） | **已被 `406ecda` 整体回滚**，主线无此功能 |
| `realIP`（`2792a86` 标题） | 标题写「configurable realIP」但实际 diff **只有 UA 对齐**，realIP 从未落地（与我们实测「随机 realIP 无效」一致） |
| `/api/health` 暴露版本号（`bd03cb1`） | 与我们已修的安全审计 **SEC-11** 直接冲突（`server.ts:133` 有注释）。且我们 `package.json` 是 `0.1.0` 而 tag 是 `v2.4.1`，裸移植会报错版本 |
| QQ 会话自动续期 | 需要 QQ 登录**绕过 sidecar** 走自己的 QR 端点，与我们内嵌 API 架构正面冲突 |
| 上游 `web/` 所有组件 | SCSS + `var(--border-color)`，我们是 Tailwind 4 全接管 |
| `client.ts` 的 225 行单独摘取 | 99% 是 SDK 迁移，与 OpenProtocol 强耦合，不能 cherry-pick |

## 附录 B：可以单独摘取的小件

| 项目 | 价值 |
|---|---|
| `sendTextReply` 私聊单播 | SDK 0.2.3 的 `api.d.ts` **已支持** `sendTextMessage(client, targetMode, targetID: bigint, message)`，只需给 `client.ts:457` 的包装器加第三参，**不必升级 SDK** |
| `version.ts` 读 package.json | 顺带解决版本漂移（前提：发版脚本同步改 `package.json`） |
| 测试手法：`spawnSync(tsx --eval)` 验证真实 stdout | 比 mock 更可靠，可复用到日志脱敏测试 |

## 附录 C：我们已有的优势（勿重复造轮子）

- `play_history` 表的 `id INTEGER PRIMARY KEY AUTOINCREMENT` 已就位 → P6 的 rowId 天然可用
- `parseBilibiliId` 已认 `?p=` / `:pN`，`getCid(bvid, page)` + `cidCache` 已支持分 P → P3.1 只差聊天链接解析
- `user_music_cookies` 表已存在 → P8 是纯增量
- `authorize()` / `guestCan()` / `removeClear` 游客标志已就位 → P6/P8 鉴权无需新建
- `channelView` / `getChannelId()` 已存在 → P4.2 的频道过滤可直接用

---

## 待你决策的 4 个问题 — 已全部决策

| # | 问题 | 决定 |
|---|---|---|
| 1 | **P6 游客语义**：`DELETE history` 是否允许游客？ | **选项 A**：`DELETE` 保持 `requireNotGuest`，能看才能删 |
| 2 | **P5 与 `crypto:"api"` 主次** | **保留 `crypto:"api"` 主路径；P5 重试层降级缓做** |
| 3 | **P8 落地范围** | **四平台全量做**（网易 / QQ / 酷狗 / B 站） |
| 4 | **P9 时机** | **SDK 迁移 + OpenProtocol 同批交付** |

### 决策带来的两点额外注意

1. **P9 同批交付 = 单次回归面最大的一步**。`client.ts` 会整体重写（含 6 处我们独有的改造），同时新增 473 行 `open-protocol.ts`。建议拆成两组独立提交、但同批验证：先 SDK 迁移并让全套测试绿，再叠 OpenProtocol。这样出问题时可二分定位。
2. **P8 四平台全量** 意味着每个平台都要实现 `withCookie`（QQ / 酷狗 / B 站目前没有），且 P7 的缓存隔离必须覆盖这四家。`index.ts:74-80` 只给 netease/qq/kugou 包了缓存，bilibili 没包——这个差异要在 P7 里显式处理。
