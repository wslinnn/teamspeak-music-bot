# 上游 v1.16 借鉴改造 —— 补完方案（Phase 2）

> 状态：**已全部实施完成**（11 个提交，`7620d1c..HEAD`）
> 前置：Phase 1 已完成 19 个提交
> 最终：1739 项测试全绿，`tsc` 与 `vite build` 通过

---

## 0. 验收时发现的问题总览

Phase 1 的代码本身是通的（测试全绿），但**接线不完整**。以下每一项都是实测确认的，不是推测。

| # | 问题 | 严重度 | 影响 |
|---|---|---|---|
| A1 | `resolveProviderForRequest` 零调用 | **致命** | P8 全部后端 + 前端 UI 是死代码 |
| A2 | `withSharedPlaybackFallback` 零调用 | **致命** | 随 A1 |
| A3 | `music.ts` 路由级 `searchCache` 键无账号维度 | **致命** | 接线后立即跨用户泄漏搜索 |
| A4 | FM 播放仍走旧 `withCookie` | 高 | 偏好/分配对 FM 无效 |
| B1 | `/api/music-accounts` 无功能开关门控 | 中 | 功能关闭仍可改数据 |
| B2 | `playbackRequestFailure` 零调用 | 中 | QQ/酷狗失败无可读原因 |
| B3 | `summarizePlayFailures` 零调用 | 中 | 批量场景无聚合文案 |
| C1 | README / FORK.md 零改动 | 中 | 新功能无文档 |
| C2 | `package.json` 版本仍 0.1.0 | 中 | OpenProtocol 上报错误版本 |
| C3 | OpenProtocol 无协议说明 | 中 | 第三方无法对接 |
| D1 | 前端 `Song` 缺 `rowId` | 低 | 类型契约割裂 |
| D2 | `openProtocol?.` 可选链 | 低 | 为迁就测试夹具 |

**验证方式**：`grep -r "resolveProviderForRequest\|withSharedPlaybackFallback\|summarizePlayFailures" src/` 在生产代码中零命中；`git diff v2.4.1..HEAD --stat -- README.md FORK.md` 输出为空。

---

## A. 账号池接线（必须，否则 P8 等于没做）

### A1 + A2 — 把 scope 接入真实路由

**现状**：`src/web/api/music.ts:156`

```ts
function resolveProvider(platform: unknown, res: Response): MusicProvider | null {
  const requested = typeof platform === "string" && platform ? platform : undefined;
  const target = requested ?? (config ? defaultPlatform(config) : "netease");
  // ...enabled 检查...
  return getProvider(target);   // ← 永远返回共享 provider
}
```

11 个调用点（`music.ts` 的 228 / 321 / 338 / 353 / 364 / 377 / 388 / 418 / 434 / 450 / 466 行）全部拿不到 `req.user`。

**核心障碍**：`createMusicRouter` 是 10 个位置参数的函数，且**不接收 `database`**：

```ts
export function createMusicRouter(
  neteaseProvider, qqProvider, bilibiliProvider, logger,
  localProvider?, config?, kugouProvider?, spotifyProvider?, jellyfinProvider?,
  configPath?,
): Router
```

再追加两个位置参数（`database`、`perUserMusicAccounts`）会变成 12 个——继续恶化的方向。

**方案（已定）：改为 options 对象**

```ts
export interface MusicRouterOptions {
  neteaseProvider: MusicProvider;
  qqProvider: MusicProvider;
  bilibiliProvider: MusicProvider;
  logger: Logger;
  localProvider?: MusicProvider;
  config?: BotConfig;
  kugouProvider?: MusicProvider;
  spotifyProvider?: MusicProvider;
  jellyfinProvider?: MusicProvider;
  configPath?: string;
  /** Per-user music accounts. Omitted in unit tests → scope disabled. */
  database?: BotDatabase;
}
export function createMusicRouter(options: MusicRouterOptions): Router
```

**接线后的 `resolveProvider`**：

```ts
function resolveProvider(platform: unknown, req: Request, res: Response): MusicProvider | null {
  const requested = typeof platform === "string" && platform ? platform : undefined;
  const target = requested ?? (config ? defaultPlatform(config) : "netease");
  if (config && !isProviderEnabled(config, target)) {
    res.status(400).json({ error: `音源未启用：${target} (provider disabled)` });
    return null;
  }
  // No database (unit-test router) → shared provider, exactly as before.
  if (!database) return getProvider(target);
  return resolveProviderForRequest(
    { database, perUserMusicAccounts: config?.perUserMusicAccounts === true, shared: getProvider },
    req.user,
    target,
  ).provider;
}
```

**11 个调用点的改法**：`resolveProvider(x, res)` → `resolveProvider(x, req, res)`。逐个核对每个 handler 的 `req` 变量名（都是 `req`，但我必须逐个看，不能盲改）。

**`withSharedPlaybackFallback`**：由 `resolveProviderForRequest` 内部调用（已在 `provider-scope.ts` 实现），接线 A1 后自动生效。**不需要单独改**——这点我原先以为是两个缺口，核实后是一个。

### A3 — 路由级搜索缓存必须带账号维度（**接线前必须做，否则立即泄漏**）

**这是 Phase 1 的 P7 漏掉的第二处泄漏点**，比缓存装饰器更靠外层：

`src/web/api/music.ts:233`

```ts
const cacheKey = `${typeof platform === "string" ? platform : ""}|${parsedOffset}|${parseInt(limit as string) || 20}|${q}`;
```

TTL 30 秒、容量 200。**只要 A1 接线而 A3 不修，成员 A 搜索后 30 秒内成员 B 的相同关键词会命中 A 的结果。**

**方案（已定）：复用 `cacheScopeForCookie`，scope 由 `ResolvedProvider` 提供**

```ts
const resolved = resolveProvider(target, req, res);   // 返回 { provider, source, scope }
if (!resolved) return;
const cacheKey = `${resolved.scope}|${platform}|${offset}|${limit}|${q}`;
```

`scope` 为空串即共享登录，行为与现状一致。`local` / `youtube` 等无 cookie 的 provider 恒为共享，scope 恒为 ""。

> 传 `scope` 而非在路由层调 `getCookie()`：`resolveProviderForRequest` 已经知道用的是哪个凭据，再让路由层重新推导一次是重复劳动，且空/非空的分支判断散落两处容易写错。

### A4 — FM 播放路径

`src/web/api/player.ts:187`

```ts
if (cookie && supportsPersonalLogin(provider)) provider = provider.withCookie(cookie);
```

用的是 `getUserMusicCookie` 的裸查，不认 `preferShared` 也不认管理员分配。

**方案**：改为

```ts
const cookie = personalCookieFor(database, req.user, "netease");
if (cookie && supportsPersonalLogin(provider)) provider = provider.withCookie(cookie);
```

**为什么不改成 `resolveProviderForRequest`**：私人 FM 在账号池功能上线前就存在，语义是「我的口味」，**必须始终用我自己的账号**，不能被 `preferShared` 关闭，也不该用管理员分配的账号（那是给房间用的）。这正是 `personalCookieFor` 存在的理由——它有 `alwaysPersonal` 语义。

> **需要确认**：当前 `player.ts:166` 已有 `user.role !== "guest"` 判断，`personalCookieFor` 内部也有 guest 拒绝。保留外层判断（防御性重复无害）。

---

## B. 功能完整性

### B1 — `/api/music-accounts` 加功能开关门控

**现状**：`music-accounts.ts` 只挂 `requireAdmin`，不检查 `perUserMusicAccounts`。功能关闭时管理员仍能增删账号。

**对照惯例**：`saved-queues.ts` 的每个路由在 `savedQueuesEnabled` 关闭时 403。

**方案**：构造函数加 `getEnabled: () => boolean`，`router.use` 里检查：

```ts
export function createMusicAccountsRouter(database, logger, getEnabled: () => boolean): Router {
  const router = Router();
  router.use(requireAdmin);
  router.use((_req, res, next) => {
    if (!getEnabled()) {
      res.status(403).json({ error: "音乐账号池未启用", code: "per_user_accounts_disabled" });
      return;
    }
    next();
  });
  // ...原有路由...
}
```

**注意**：`GET /platforms` 也一并拒绝——语义统一，避免「部分可用」的困惑。

**成员侧** `/api/me/music-accounts` 已有正确的降级（返回 `perUserMusicAccounts:false` 而非 403），保持不变。

### B2 — QQ / 酷狗 / B站 复用 `playbackRequestFailure`

**现状**：`qq.ts:357-377` 内部吞异常返回裸 null；`playbackRequestFailure` 定义了从没调用。

**改法（以 QQ 为例）**：

```ts
async getSongUrl(songId, quality?, options?): Promise<SongUrlResult | null> {
  let lastError: unknown;
  try {
    const res = await this.api.get("/getMusicPlay", { params: { songmid: songId, ...} });
    const playUrl = res.data?.data?.playUrl?.[songId];
    if (playUrl?.url) return { url: playUrl.url, trialDuration: parseQqTrial(playUrl) };
  } catch (err) {
    lastError = err;
    // 原逻辑：换 songid 参数重试一次
  }
  // ...第二次尝试...
  // 两次都没拿到 URL：区分「上游报错」与「上游说没有」
  if (lastError) throw playbackRequestFailure("qq", songId, lastError);
  throw new SongUrlUnavailable({
    platform: "qq", songId, code: "quality_denied",
    message: `当前音质无播放权限（${quality ?? this.quality}）`,
  });
}
```

> **范围已定**：本轮只做 QQ + 酷狗的 `getSongUrl`。QQ 的其余 11 处 `return null`（搜索/歌单/详情等）**保持原样**——它们不影响播放提示，改动只增加风险。B 站延后，其成因判读需要额外实测。

酷狗同理，改它自己的 `getSongUrl`（`kugou.ts` 共 6 处 `return null`，只动播放那条）。

### B3 — 批量场景接 `summarizePlayFailures`（**已决定不做**）

`player.ts` 的 6 处批量文案（461/496/552/579/642/673 行）当前是「均不可播放（无版权或需会员）」。

**为什么不改**：

批量路径拿不到逐曲 `PlayFailure`——`getPlayableSongIds` 只返回可播集合。要拿到成因就得对样本逐首调 `getSongUrl`，最多多 5 次上游请求，**只为让一句已经不再撒谎的文案更精确**。

Phase 1 之前那句话是「区域/版权限制」——对所有成因都错。现在说的是「无版权或需会员」——涵盖了两个最常见的真实成因。继续提升精度的收益远小于 5 次上游请求的成本（还多一分触发风控的机会）。

`summarizePlayFailures` 函数本身**保留**（已测试、已导出），等真有人需要批量诊断时再用。这是有意的技术储备，不是遗漏。

> 若将来真要做，最小代价的做法是：仅在「全军覆没」分支里探测，且复用已拿到的第一次失败原因，不做额外请求。

---

## C. 文档

### C1 — README 补配置项与新功能

需要补的位置：

| 位置 | 内容 |
|---|---|
| 「与上游的差异」章节 | P8 账号池、P9 OpenProtocol 两项 |
| 配置文件章节 | `perUserMusicAccounts` 字段说明 |
| 更新日志 | 新版本条目（若发版） |

### C2 — 版本号对齐

`package.json` 是 `0.1.0`，tag 是 `v2.4.1`。`src/version.ts` 读的就是 `package.json`，所以 OpenProtocol 的 announce 会把 `0.1.0` 报给插件。

**方案**：把 `package.json` 的 version 改为 `2.4.1`（与最新 tag 对齐），并在发版流程里同步 bump。

> **需要确认**：是否有其他地方依赖 `0.1.0`？我搜过 `package.json` 的 version 只被 `version.ts` 读取。

### C3 — OpenProtocol 协议说明

新增 `docs/open-protocol-v1.md`，内容：
- 两个插件名与其用途
- 每种 action 的载荷格式（JSON schema）
- `command_prefix` 是「告知」不是「接受 / 命令」
- 1024 字节上限、字段截断规则
- 限流参数（per-peer 冷却 + 全局令牌桶）
- announce 时机（连接 / 机器人换频道 / 本频道有人进入）

---

## D. 一致性清理（可选）

### D1 — 前端 `Song` 加 `rowId`

`web/src/stores/player.ts` 的 `Song` 加可选 `rowId?: number`，`HistoryPanel.vue` 删掉局部类型。

### D2 — 去掉 `openProtocol?.` 可选链

`instance.ts` 的 5 处 `this.openProtocol?.` 改回 `this.openProtocol.`，同时给 `instance-recovery.test.ts` 的夹具补 `openProtocol: { reset() {}, scheduleAnnounce() {}, handlePluginCommand: async () => {} }`。

**理由**：真实代码里 `openProtocol` 在构造函数中必然赋值，`?.` 是迁就测试而污染生产代码。

---

## 执行顺序与验证

```
A3（ResolvedProvider.scope + 缓存键）→ A1/A2（options 重构 + 接线）→ A4（FM）
  ↓ 每步跑 npm test
B1（门控）→ B2（QQ/酷狗错误分类）
  ↓
D2 → D1
  ↓
C2（版本）→ C1（README）→ C3（协议文档）
```

**为什么 A3 必须早于 A1**：A1 一接，泄漏通道立即打开；A3 是它的闸门。

注意 A3 依赖 `ResolvedProvider` 的 `scope` 字段，而该字段只有接线后才能被消费——两者在同一批里落地，但 **scope 字段与其不变式测试先写完**。

**每步验收**：
- `npm test` 全绿（当前基线 1711）
- `npx tsc --noEmit` 无错误
- A1 完成后新增用例：**同一关键词，两个不同账号请求，断言上游被调用两次**（证明没命中同一缓存）
- A1 完成后新增用例：**不传 database 的路由行为与改动前完全一致**（兼容性回归）
- A3 完成后新增用例：`source === "shared"` 时 `scope === ""`，二者永不同步为错
- B1 完成后新增用例：功能关闭时 POST 返回 403
- B2 完成后新增用例：QQ/酷狗上游 HTTP 失败时抛 `SongUrlUnavailable` 且 message 含 HTTP 状态码

---

## 决策记录（已拍板）

| # | 问题 | 决定 | 连带影响 |
|---|---|---|---|
| 1 | `createMusicRouter` 签名 | **改为 options 对象** | 需同步改 `server.ts` 与 `music.test.ts` 的全部调用点；10 个位置参数不再恶化 |
| 2 | A3 的 scope 来源 | **`ResolvedProvider` 新增 `scope` 字段** | 需改已提交的 `provider-scope.ts` 接口与其 25 项测试 |
| 3 | B2 错误分类范围 | **只做 QQ + 酷狗** | B 站留待后续；其失败成因（分P/版权/风控）需额外实测才能判读 |
| 4 | B3 批量文案聚合 | **不做** | 当前文案已准确；省下最多 5 次上游请求。该节保留为技术储备，不实施 |

### 决策 1 的实施细节

`MusicRouterOptions` 的字段名与现有位置参数一一对应，迁移是机械替换：

```ts
// server.ts
app.use("/api/music", createMusicRouter({
  neteaseProvider: options.neteaseProvider,
  qqProvider: options.qqProvider,
  bilibiliProvider: options.bilibiliProvider,
  logger,
  localProvider: options.localProvider,
  config: options.config,
  kugouProvider: options.kugouProvider,
  spotifyProvider: options.spotifyProvider,
  jellyfinProvider: options.jellyfinProvider,
  configPath: options.configPath,
  database: options.database,   // 新增
}));
```

`music.test.ts` 的调用点同样改为对象字面量；未传 `database` 的用例**行为不变**（scope 关闭，走共享 provider），这是兼容性保证点。

### 决策 2 的实施细节

`provider-scope.ts`：

```ts
export interface ResolvedProvider<T extends MusicProvider = MusicProvider> {
  provider: T;
  source: "shared" | "own" | "granted";
  /** Cache-key scope for this account: "" for the shared login, otherwise a
   *  short hash of the credential. Callers that key their own caches MUST
   *  include it or they will serve one account's results to another. */
  scope: string;
}
```

`source` 与 `scope` 永远同步：`source === "shared"` ⇔ `scope === ""`。加测试锁住这条不变式。
