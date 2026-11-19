# OpenProtocol v1 —— 插件发现协议

机器人通过 TeamSpeak 的 **plugin command** 通道向用户端插件宣告自己是什么、
支持哪些聊天命令。插件不需要 HTTP 接口、API key 或任何登录。

> 协议版本：`v: 1`。载荷里 `v !== 1` 的一律忽略。

---

## 1. 通道与插件名

plugin command 是 TeamSpeak 原生的「具名载荷」通道：服务器只转发，不解析
内容。双方必须约定同一个插件名。

本协议只使用两个：

| 插件名 | 方向 | 用途 |
|---|---|---|
| `tsclient:identity` | 双向 | 机器人身份宣告与查询 |
| `tsclient:commands` | 双向 | 聊天命令目录 |

**其他插件名一律忽略**，机器人不会响应也不会记录。

---

## 2. 载荷约束

| 约束 | 值 | 说明 |
|---|---|---|
| 载荷上限 | **1024 字节** (UTF-8) | 入站与出站都校验。超限静默丢弃 |
| 格式 | JSON 对象 | 数组、原始值、非法 JSON 一律丢弃 |
| 编码 | UTF-8 | |

载荷超过上限时**没有错误回复**——协议有意保持单向静默，避免被当作放大器。

---

## 3. 身份宣告（`tsclient:identity`）

### 3.1 机器人主动广播

机器人在以下时机向**所在频道**广播：

- 连接成功后
- 机器人自己换到新频道后
- 本频道有新客户端进入时

广播做了 **2 秒去抖**（一串人同时进只发一次，尾随补发一次）；发送失败会
在 **500ms 后重试一次**，之后不再重试。

```json
{
  "v": 1,
  "action": "announce",
  "client_type": "bot",
  "app_name": "TSMusicBot",
  "app_version": "2.4.1",
  "capabilities": ["chat:slash_commands"]
}
```

| 字段 | 说明 |
|---|---|
| `client_type` | 固定 `"bot"`，用于与其它插件区分 |
| `app_name` | 最长 32 字符 |
| `app_version` | 最长 32 字符，取自构建时的 package.json |
| `capabilities` | 前缀不可用时为空数组 `[]`（见 §5） |

### 3.2 插件发起查询

插件可以向机器人发送（单播或频道广播均可）：

```json
{ "v": 1, "action": "query" }
```

机器人**单播**回复 `announce_ack`（字段同 `announce`，仅 `action` 不同）。
也接受插件发来的 `action: "announce"`，同样回 `announce_ack`。

---

## 4. 命令目录（`tsclient:commands`）

插件发送：

```json
{ "v": 1, "action": "list_req" }
```

机器人**单播**回复：

```json
{
  "v": 1,
  "action": "list_ack",
  "command_prefix": "!",
  "commands": [
    { "name": "play", "args": "<歌曲>", "desc": "点歌并立即播放" },
    { "name": "pause", "desc": "暂停播放" }
  ]
}
```

### 字段上限

| 字段 | 上限 |
|---|---|
| `name` | 24 字符 |
| `args` | 32 字符（可省略） |
| `desc` | 64 字符 |
| 命令条数 | 最多 16 |

**超长处理**：字段按**码点**（不是 UTF-16 单元）截断，不会把 emoji 或
CJK 切成半个，也会先剥离控制字符。

**载荷超限处理**：若完整目录超过 1024 字节，机器人从**末尾逐条删除**命令
直到装得下。目录按重要性排序，所以被裁掉的总是最不常用的命令。

**语言**：`desc` 与 `args` 跟随机器人配置的 `locale`（`zh` / `en`）。

---

## 5. `command_prefix` 是「告知」，不是「接受」

`command_prefix` 告诉插件机器人实际监听的字面前缀（例如 `!`）。插件据此
把用户的斜杠输入转换成正确的命令文本。

**机器人不会因此接受 `/` 斜杠命令。** 它始终只按配置的前缀解析聊天消息，
这条规则没有因为本协议而改变。

当前缀不可用于发现时（空串、含首尾空格、超过 8 字符、含控制字符）：

- `announce` 的 `capabilities` 返回空数组
- `list_req` **不回复**（机器人不会宣告一个它无法履行的能力）

---

## 6. 限流

两重限制同时生效：

### 每 peer 冷却（按 `invokerUid`，无 UID 时按 `invokerId`）

| action | 冷却 |
|---|---|
| `announce` | 10 秒 |
| `query` | 5 秒 |
| `list_req` | 5 秒 |

### 全局令牌桶（跨所有 peer 共享）

| 参数 | 值 |
|---|---|
| 突发容量 | 4 |
| 补充速率 | 2 / 秒 |

只靠冷却不够：peer 可以换身份，多个 peer 也可以各自守着自己的冷却同时刷屏。
令牌桶封住总量。

**令牌在发送失败时同样消耗**——否则一个发送必然失败的客户端能无限重试。

---

## 7. 入站过滤清单

机器人会静默丢弃以下所有情况：

- 插件名不是上述两个之一
- `invokerID` 为 0（服务器代为发起）
- `invokerID` 等于机器人自己的 client id（自己的回声）
- 载荷 ≥ 1024 字节
- 非 JSON / JSON 但不是对象 / JSON 数组
- `v` 不等于 1
- `action` 不是字符串
- `action` 与插件名不匹配（如往 identity 发 `list_req`）

---

## 8. 插件侧最小实现

```
1. 连接后广播 {v:1, action:"announce"} 到 tsclient:identity
   → 收到 announce_ack，记录 app_name / app_version
2. 需要命令列表时发 {v:1, action:"list_req"} 到 tsclient:commands
   → 收到 list_ack，用 command_prefix + commands 构建补全
3. 收到 action:"announce" 时，可回 {v:1, action:"query"} 确认
4. 对所有消息：先校验 v === 1，再按 action 分派
```

注意：冷却与令牌桶是**机器人侧**的限制。插件自己重试时请把间隔放在
冷却之上（例如 query 至少 5 秒一次），否则请求会被静默丢弃。

---

## 9. 与实现的对应

| 概念 | 代码位置 |
|---|---|
| 协议常量、载荷构造、限流 | `src/ts-protocol/open-protocol.ts` |
| plugin command 收发 | `src/ts-protocol/client.ts`（`sendPluginCommand` / `pluginCommand` 事件） |
| 触发时机（连接/换频道/有人进入） | `src/bot/instance.ts` |
| 版本号来源 | `src/version.ts`（读 `package.json`） |
