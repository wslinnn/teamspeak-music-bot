# 服务端内容缓存方案（歌词 / 歌单 / 专辑 / 搜索 / 歌曲详情）

状态：**已实施**（2026-09-05）。实现：`src/music/cache.ts`（TtlLruCache）、
`src/music/cached-provider.ts`（withContentCache）、`src/index.ts` 接线、
`src/web/api/music.ts` /lyrics 限流。
实施偏差：§3.2 草稿的 `Object.create` 原型委托不可行——类实例字段
（this.api 等）挂在实例上，原型委托会让 this 指向 wrapper 而丢字段；
实际实现为「原型方法 bind 回原实例 + 字段描述符复制」。
姊妹文档：tsmb-desktop `docs/lightweight-plan.md` S1（客户端侧的抖动缓解已上线，
本文档是其标注的「建议后端缓存」的落地设计）。

## 一、背景与判定

三类消费方共享同一条上游通道（服务端账号 cookie）：

1. **桌面客户端 × N**（tsmb-desktop）：每次切歌拉一次歌词
2. **Web 面板**：发现页/歌单导入/搜索
3. **bot 自身**：TS 频道 `!lyrics` 命令（`src/bot/instance.ts:1932`）

同一 bot 的听众听同一批歌：一首歌切歌时 N 个客户端就是 N 次相同的上游调用
（客户端 0–1.5s 抖动只是错峰，不是去重）。以 50 客户端、3.5 分钟/首估算：
歌词 ~0.24 req/s 全部穿透 NetEase；缓存后 ≈0.005 req/s。

### 全接口分类（判定的依据，别把状态接口也缓存了）

| 类别 | 接口 | 判定 |
|---|---|---|
| **内存状态读**（全服务最高频） | `GET /player/:botId/elapsed`（web 面板播放中 3s/次；桌面端 15s/3s）、`GET /player/:botId/queue`、`GET /api/bot`、WS stateChange 广播 | **不缓存**。新鲜度就是语义，且已是 O(1) 内存读（`bot.getStatus()`）。负载靠降频解决（桌面端 T4 已做；web 面板已有标签页可见性暂停），不靠缓存 |
| **上游内容读**（本文档对象） | lyrics / playlist / album / song detail / search / recommend playlists | **缓存**。内容按 key 基本不可变，多用户重复请求同一资源 |
| **个性化 / 动态** | `getPersonalFm` / `getDailyRecommendSongs` / `getUserPlaylists` / `getAuthStatus` | **不缓存**。FM 是电台语义（每次应不同）、推荐按账号个性化、鉴权状态必须实时 |
| **本地源 / 无上游** | jellyfin/*、local/* | **不缓存**。局域网自建服务，无风控无放大 |
| **流地址** | `getSongUrl`（播放时解析，instance.ts:1117） | **不缓存**。URL 自带过期时间，缓存错直接导致播放失败 |
| **写操作** | play/pause/add/queue 管理等全部 POST/DELETE | 不适用 |

## 二、缓存策略表

| 方法（MusicProvider） | key | TTL | 空结果 TTL | 说明 |
|---|---|---|---|---|
| `getLyrics(songId)` | `lyrics:{songId}` | 永续（LRU 驱逐） | 10 min | 歌词不可变；纯音乐空歌词也很稳定 |
| `getPlaylistSongs(id)` | `playlist:{id}` | 1 h | 10 min | 最大 payload（数百首），导入场景放大最狠 |
| `getPlaylistDetail(id)` | `playlistDetail:{id}` | 1 h | 10 min | `/playlist/:id/detail` 路由 |
| `getAlbumSongs(id)` | `album:{id}` | 1 h | 10 min | |
| `getSongDetail(id)` | `song:{id}` | 1 h | 10 min | |
| `search(q, limit, offset)` | `search:{q}:{limit}:{offset}` | 10 min | 10 min | 搜索是 NetEase 风控最敏感接口，短 TTL 纯当防限速保险 |
| `getRecommendPlaylists()` | `recommendPlaylists` | 1 h | 10 min | 发现页榜单，全用户同一份 |

绕过（原样透传）：`getSongUrl` / `getQrCode` / `checkQrCodeStatus` / `getAuthStatus` /
`getPersonalFm` / `getDailyRecommendSongs` / `getUserPlaylists` / `setCookie` /
`setQuality` 等一切鉴权、动态、写方法。

容量：**每个 provider 实例一个 cache**，`maxEntries = 600`；单条序列化 > 256KB
不缓存（防病态大歌单撑内存）。内存上限粗估 < 10MB。

平台范围：netease / qq / kugou 三家包装；bilibili / spotify / youtube / local /
jellyfin v1 不包（无歌词/歌单内容路径，或本地源）。bilibili 热门榜可作后续扩展
（短 TTL 即可，接口已在）。

## 三、实现设计

### 3.1 TtlLruCache（新文件 `src/music/cache.ts`）

利用 JS Map「插入序 = 迭代序」实现紧凑 LRU：get 命中删了重插保持最新；
set 满员删首键（最久未使用）；过期惰性检查（读时比对 expiresAt）。

```ts
interface Entry { value: unknown; expiresAt: number; }

export class TtlLruCache {
  private map = new Map<string, Entry>();
  hits = 0; misses = 0;   // 观测用（见六）
  constructor(private readonly maxEntries: number, private readonly maxValueLen = 256 * 1024) {}

  get<T = unknown>(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) { this.misses++; return undefined; }
    if (e.expiresAt <= Date.now()) { this.map.delete(key); this.misses++; return undefined; }
    this.map.delete(key); this.map.set(key, e);   // 触碰 → 移到最新端
    this.hits++;
    return e.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    if (JSON.stringify(value ?? null)?.length > this.maxValueLen) return;  // 大条目防撑
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
```

### 3.2 withContentCache 装饰器（新文件 `src/music/cached-provider.ts`）

用 `Object.create(provider)` 做原型委托：只覆盖要缓存的方法（自有属性），
其余一切调用（鉴权/流地址/FM/setCookie/setQuality…）原样落到原实例。
**单测要点**：`setCookie` 等变异方法必须落在原实例上（wrapper 与 bot/路由
共享同一原对象）。

```ts
const LYRICS_TTL = Number.MAX_SAFE_INTEGER;   // 永续，LRU 驱逐
const HOUR = 60 * 60 * 1000, SHORT = 10 * 60 * 1000;

export function withContentCache<P extends MusicProvider>(provider: P, cache: TtlLruCache): P {
  const wrapped = Object.create(provider) as P;
  const cached = <A extends unknown[]>(keyOf: (args: A) => string, ttlMs: number,
      fn: (...args: A) => Promise<unknown>, isEmpty: (v: unknown) => boolean) =>
    async (...args: A): Promise<unknown> => {
      const key = keyOf(args);
      const hit = cache.get(key);
      if (hit !== undefined) return hit;
      const value = await fn(...args);
      cache.set(key, value, isEmpty(value) ? SHORT : ttlMs);
      return value;
    };
  wrapped.getLyrics = cached((id) => `lyrics:${id}`, LYRICS_TTL,
    (id) => provider.getLyrics(id), (v) => (v as LyricLine[]).length === 0);
  // …getPlaylistSongs / getPlaylistDetail / getAlbumSongs / getSongDetail /
  //   search（key 含 limit/offset）/ getRecommendPlaylists 同型，逐一覆盖
  return wrapped;
}
```

注意：`getSongDetail` 可能返回 `null`（查无此曲）——`null` 视为空值走短 TTL；
`cache.get` 用 `undefined` 表示未命中，与 `null` 语义区分开。

### 3.3 接线点（`src/index.ts:68-74`）

Provider 是创建一次的单例，在创建处包一层，**所有下游自动受益**：

```ts
const neteaseProvider = withContentCache(new NeteaseProvider(apiServer.getNeteaseBaseUrl()),
  new TtlLruCache(600));
```

- 后续 `if (neteaseCookie) neteaseProvider.setCookie(neteaseCookie)` 走原型委托
  落到原实例，顺序无需调整
- music 路由（Web 面板 + 桌面客户端的歌词/歌单/专辑/搜索/详情）全部覆盖
- bot instance 持同一引用 → `!lyrics` 命令、按歌单播放等内部路径同样命中

### 3.4 /lyrics/:id 路由限流补齐（`src/web/api/music.ts`）

该路由目前是音乐类接口中唯一没有 `createRateLimit` 的（search/playlist 都有）：

```ts
router.get("/lyrics/:id", createRateLimit({ capacity: 20, refillPerSec: 0.5 }), async (req, res) => { … });
```

per-IP token bucket、10 分钟不活跃自驱逐（现有中间件行为）。突发 20 + 30/min
对单客户端绰绰有余（正常消耗 ≈ 0.3 次/min）；NAT 后多客户端共享桶也够
（50 客户端全局才 0.24 req/s）。

## 四、键规范与账号边界

- **key 不含 platform**：cache 挂在 provider 实例上，实例即平台，天然隔离
- **账号 cookie 变更不需失效**：歌词/歌单/专辑内容与登录账号无关；私有歌单
  经服务端账号解析，所有用户本来看到的就是同一份，缓存不改变可见性
- **search 键含 limit/offset**：分页参数不同即不同 key
- **重启即失效**：内存缓存不持久化，无陈旧风险，无需失效端点

## 五、测试计划

1. **cache 单测**（cache.test.ts）：TTL 过期（vi.useFakeTimers 推进）、LRU
   驱逐顺序、get 触碰改序、容量上限、>256KB 拒存、hits/misses 计数
2. **装饰器单测**（cached-provider.test.ts，spy provider 计穿透次数）：
   - 两次 `getLyrics(同 id)` → 上游 1 次；不同 id 各自穿透
   - 空歌词：10 min 内第二次不穿透，过期后穿透
   - `getSongUrl` 两次调用 → 上游两次（验证未缓存）
   - `setCookie` 后原实例拿到新值（验证变异方法委托）
3. **路由测试**（music.test.ts 追加）：带缓存的 provider 注入路由后，
   GET /lyrics 两次 → provider 一次；`/lyrics/:id` 无 token 401；同 IP 第
   21 连发 429 + Retry-After（限流）
4. **dev-server 冒烟**：给假后端 provider 加请求计数，两个桌面客户端同歌
   切歌 → 上游计数 1（对应 tsmb lightweight-plan S1 的惊群验收）

## 六、观测

- TtlLruCache 内置 hits/misses；装饰器层不做日志（避免每请求刷屏）
- 可选：index.ts 每 5 分钟 `logger.debug` 打一次各缓存命中率——用 debug 级，
  不进默认输出
- 不加 `X-Cache` 响应头、不加管理端点（保持攻击面与面小）

## 七、风险与取舍

- **1h 内歌单/专辑变更不可见**：可接受；TTL 是常量，嫌长改一行
- **内存**：600 条 × 平均 <15KB ≈ 9MB/provider，256KB guard 截住病态歌单；
  三家 provider 总上限 <30MB 最坏情况（实际远低）
- **与桌面端 0–1.5s 抖动正交**：抖动保留——首次 miss 风暴（bot 重启、新歌
  上线）时仍需要错峰
- **明确不做**：getSongUrl（过期风险）、FM/推荐歌曲/用户歌单（动态语义）、
  jellyfin/local（无上游）、缓存失效管理端点（YAGNI）

## 八、提交切分

1. `feat(cache): TtlLruCache 工具`——cache.ts + 单测
2. `feat(cache): withContentCache 装饰器并接线 provider 创建`——cached-provider.ts
   + index.ts 改动 + 单测
3. `feat(web): /lyrics/:id 补路由级限流`——music.ts 一行 + 路由测试
4. `docs: 缓存上线说明`——本文件状态改「已实施」、README 注意事项、
   tsmb-desktop lightweight-plan.md S1 回填实测
