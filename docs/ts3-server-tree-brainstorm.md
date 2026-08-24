# TS3 服务器树可视化 — 功能设计方案（Superpower 头脑风暴）

> 目标：在 Web 端实时展示 TeamSpeak 服务器频道树，让管理员直观看到 Bot 所在位置、在线用户，并支持切换频道等操控。

---

## 一、功能范围定义

### 核心功能（MVP）
1. **频道树渲染** — 层级频道结构，支持嵌套（parentID → 子频道）
2. **在线用户列表** — 每个频道下显示当前在线的客户端
3. **Bot 位置高亮** — 当前 Bot 所在频道特殊标识，带"播放中"脉冲动画
4. **切换频道** — 点击频道即可让 Bot 移动到该频道（需密码时弹窗）
5. **实时刷新** — WebSocket 推送频道/用户变更，或轮询后备

### 扩展功能（Phase 2）
6. **右键菜单** — 加入频道、发送频道消息、查看频道信息
7. **特殊频道标识** — cspacer/rspacer 等装饰性频道的视觉区分
8. **用户详情** — 点击用户查看昵称、UID、服务器组
9. **Whisper 目标切换** — 将音频从"频道广播"改为"Whisper 到指定用户/频道"
10. **搜索过滤** — 按频道名/用户名快速定位

---

## 二、后端 API 设计

### 2.1 新增 BotInstance 方法

```typescript
// src/bot/instance.ts

async getServerTree(): Promise<ServerTree> {
  if (!this.connected) {
    throw new Error("Bot is not connected");
  }
  const [channels, clients] = await Promise.all([
    this.tsClient.listChannels(), // 需要暴露底层 client
    this.tsClient.listClients(),  // 需要暴露底层 client
  ]);

  const currentChannelId = this.tsClient.getChannelId();

  return {
    channels: channels.map((ch) => ({
      id: String(ch.id),
      parentId: ch.parentID === 0n ? null : String(ch.parentID),
      name: ch.name,
      description: ch.description,
      hasPassword: ch.name.includes('[spacer]') ? undefined : false, // 库可能不返回 password flag，需要评估
      sortOrder: ch.sortOrder, // 如果有
    })),
    clients: clients.map((c) => ({
      id: String(c.id),
      nickname: c.nickname,
      uid: c.uid,
      channelId: String(c.channelID),
      isBot: c.id === this.tsClient.getClientId(), // 需要暴露 getClientId
      serverGroups: c.serverGroups,
      type: c.type, // 0=normal, 1=query
    })),
    botChannelId: String(currentChannelId),
    botClientId: String(this.tsClient.getClientId()),
  };
}

async joinChannelById(channelId: string, password?: string): Promise<void> {
  if (!this.connected) throw new Error("Bot is not connected");
  await this.tsClient.joinChannelById(BigInt(channelId), password);
  // 需要新增底层方法，或复用 joinChannel(name) 但按 ID 移动更可靠
}
```

### 2.2 需要扩展的 TS3Client 方法

当前 `TS3Client` 没有直接暴露 `listChannels` / `listClients` 给外部（只在内部使用）。需要新增：

```typescript
// src/ts-protocol/client.ts

async getChannelList(): Promise<ChannelInfo[]> {
  if (!this.client) return [];
  return listChannels(this.client);
}

async getClientList(): Promise<ClientInfo[]> {
  if (!this.client) return [];
  return listClients(this.client);
}

getClientId(): number {
  return this.clientId;
}

async joinChannelById(channelId: bigint, password?: string): Promise<void> {
  if (!this.client) return;
  await clientMove(this.client, this.clientId, channelId, password);
  this.logger.info({ channelId: channelId.toString() }, "Moved to channel by ID");
}
```

### 2.3 Express 路由

```typescript
// src/web/api/bot.ts  或新增 src/web/api/server-tree.ts

// GET /api/bot/:botId/server-tree
router.get("/:botId/server-tree", async (req, res) => {
  try {
    const bot = req.bot!;
    const tree = await bot.getServerTree();
    res.json(tree);
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});

// POST /api/bot/:botId/join-channel
router.post("/:botId/join-channel", async (req, res) => {
  try {
    const bot = req.bot!;
    const { channelId, password } = req.body;
    if (!channelId) {
      res.status(400).json({ success: false, error: "channelId is required" });
      return;
    }
    await bot.joinChannelById(channelId, password);
    res.json({ success: true, message: "Joined channel" });
  } catch (err) {
    res.status(500).json({ success: false, error: (err as Error).message });
  }
});
```

### 2.4 WebSocket 事件（实时同步）

当前 WebSocket 主要推送播放状态。频道树数据变化不频繁，但用户进出频道需要一定实时性。

**方案 A：主动轮询（推荐 MVP）**
- 前端每 5 秒轮询 `GET /api/bot/:botId/server-tree`
- 实现简单，不增加 WebSocket 复杂度
- TS3AudioBot 也是用轮询（每 5s 刷新一次 server tree）

**方案 B：WebSocket 推送（Phase 2）**
- 后端监听 TS3 通知事件（`clientEnter`, `clientLeft`, `clientMoved`, `channelCreated` 等）
- 需要 `@honeybbq/teamspeak-client` 支持通知事件，当前代码中有 `clientEnter` 但仅在 log
- 需要评估库的通知能力

**结论：MVP 用轮询，Phase 2 再评估 WebSocket 推送。**

---

## 三、前端设计

### 3.1 页面/组件位置

**选项 1：独立页面 `/server`**
- 优点：空间大，适合复杂树形结构
- 缺点：需要切换页面才能看到，不够即时

**选项 2：侧边栏 Drawer（推荐）**
- 在 Navbar 增加一个"服务器"图标按钮
- 点击后从右侧滑出 ServerTree 面板（宽度 320px desktop / 100% mobile）
- 优点：任何页面都能快速查看，不离开当前上下文
- TS3AudioBot 采用的就是这种方式（右侧固定 sidebar）

**选项 3：Settings 页面中的 Tab**
- 优点：集成到现有管理页面
- 缺点：非管理员看不到，普通用户也有查看需求

**推荐：选项 2（侧边栏 Drawer）**，因为：
- 所有用户都需要知道 Bot 在哪
- 频道切换是高频操作（比去 Settings 快得多）
- 与 TS3AudioBot 的 UX 模式一致，用户学习成本低

### 3.2 组件结构

```
web/src/components/
├── ServerTreeDrawer.vue      # 侧边栏容器（打开/关闭、加载状态）
├── ServerTree.vue            # 树形渲染（递归频道列表）
├── ServerTreeChannel.vue     # 单个频道行（展开/折叠、用户列表、Bot 指示器）
├── ServerTreeClient.vue      # 单个客户端行（头像、昵称、类型标识）
└── ServerTreeJoinModal.vue   # 带密码的频道加入弹窗
```

### 3.3 数据结构设计

```typescript
// web/src/stores/serverTree.ts (Pinia store)

export interface ChannelNode {
  id: string;
  parentId: string | null;
  name: string;
  description: string;
  hasPassword: boolean;
  children: ChannelNode[];      // 递归构建
  clients: ClientNode[];        // 属于此频道的用户
  isSpacer: boolean;            // name.startsWith('[spacer') 或 cspacer/rspacer
}

export interface ClientNode {
  id: string;
  nickname: string;
  uid: string;
  channelId: string;
  isBot: boolean;
  serverGroups: string[];
  type: number;
}

export interface ServerTreeState {
  rootChannels: ChannelNode[];
  botChannelId: string | null;
  botClientId: string | null;
  loading: boolean;
  error: string | null;
  lastUpdated: number;
}
```

**树构建算法**（前端或后端）：
```typescript
function buildChannelTree(channels: Channel[], clients: Client[]): ChannelNode[] {
  const map = new Map<string, ChannelNode>();
  channels.forEach((c) => {
    map.set(c.id, { ...c, children: [], clients: [] });
  });
  clients.forEach((c) => {
    const ch = map.get(c.channelId);
    if (ch) ch.clients.push(c);
  });
  const roots: ChannelNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  // 按 sortOrder 或 name 排序
  return roots;
}
```

### 3.4 UI/UX 细节设计

#### 频道行样式
- **普通频道**：文件夹图标 + 频道名 + 人数 badge
- **Spacer 频道**（`[spacer*`、`cspacer`、`rspacer`）：弱化显示，灰色文字，无边框，不可点击
- **Bot 所在频道**：左侧绿色竖条指示器 + 频道名高亮 + "播放中"动画（如果 playing）
- **有密码频道**：锁图标（`mdi:lock`）
- **展开/折叠**：频道名前 Chevron 图标，点击切换

#### 客户端行样式
- **Bot 自身**：头像/图标用机器人图标（`mdi:robot`），高亮背景，昵称加粗
- **普通用户**：人形图标（`mdi:account`），悬停显示 UID
- **Query 客户端**（type=1）：眼睛图标（`mdi:eye`），半透明，表示 ServerQuery 连接

#### 交互
- **单击频道行**：展开/折叠子频道
- **双击频道行**：Bot 移动到该频道（如果有密码则弹窗）
- **右键频道行**：上下文菜单（加入频道、查看信息、发送消息）
- **右键用户行**：上下文菜单（Whisper、Poke、查看信息）

#### 空状态
- Bot 未连接时：显示 "Bot 未连接到服务器" + 连接按钮
- 频道为空时：显示 "暂无在线用户"

### 3.5 响应式适配

**Desktop（>768px）**：
- Drawer 宽度 340px，从右侧滑出
- 频道名可显示完整，用户列表完整展示

**Mobile（≤768px）**：
- Drawer 全屏宽度，顶部带关闭按钮
- 频道行高度增大（touch target 44px+）
- 展开/折叠需要点击 Chevron 而非整行（避免误触）

---

## 四、与现有架构的集成点

### 4.1 路由
```typescript
// web/src/router/index.ts — 无需新增路由（Drawer 不是页面）
```

### 4.2 Navbar 集成
在 Navbar.vue 的 nav links 区域增加：
```vue
<button class="text-sm font-semibold opacity-60 hover:opacity-80" @click="serverTreeOpen = true">
  <Icon icon="mdi:server" /> 服务器
</button>
```

### 4.3 Player 组件集成
在 Player.vue 中当前显示 Bot 名称的位置，增加一个可点击的频道名：
```vue
<!-- 点击后打开 ServerTreeDrawer 并自动滚动到 Bot 位置 -->
<button v-if="botChannelName" @click="openServerTreeAndScroll">
  <Icon icon="mdi:account-voice" /> {{ botChannelName }}
</button>
```

### 4.4 Pinia Store 集成
新增 `useServerTreeStore`，或使用现有 `usePlayerStore` 的 `activeBot` 来获取 botChannelId。

---

## 五、实施难度评估

| 模块 | 难度 | 预估工时 | 依赖 |
|------|------|---------|------|
| 扩展 TS3Client（暴露 listChannels/listClients） | 低 | 30min | 无 |
| BotInstance.getServerTree() | 低 | 30min | TS3Client 扩展 |
| Express API 路由 | 低 | 30min | BotInstance 方法 |
| 前端树构建算法 | 低 | 20min | 无 |
| ServerTreeDrawer + ServerTree 组件 | 中 | 3-4h | UI 设计 |
| 右键菜单 / 上下文交互 | 中 | 1-2h | 需要阻止默认菜单 |
| 带密码的频道加入弹窗 | 低 | 30min | 复用 BaseModal |
| 实时刷新（轮询） | 低 | 20min | setInterval |
| 响应式适配 | 低 | 30min | Tailwind |
| **MVP 总计** | | **~7-8h** | |

---

## 六、风险与待确认事项

1. **`@honeybbq/teamspeak-client` 的 `listChannels` 返回值**
   - 当前 `ChannelInfo` 只有 `name, description, id, parentID`
   - **缺少**：`password` flag、`sortOrder`、`maxClients`、`topic` 等
   - **对策**：当前只用已有字段；如需密码标识，可能需要 `execCommandWithResponse("channellist")` 原始命令

2. **`listClients` 的 `serverGroups` 字段类型**
   - 当前类型是 `string[]`，但实际可能是数字数组
   - 需要实际连接后验证

3. **`clientEnter` / `clientLeft` 通知**
   - 当前 `@honeybbq/teamspeak-client` 是否支持这些事件？
   - 从代码看 `client.on("clientEnter")` 存在，但 `clientLeft` / `clientMoved` 不确定
   - 这影响 Phase 2 的 WebSocket 推送实现

4. **TS6 服务器兼容性**
   - TS6 使用 HTTP Query，`listChannels` / `listClients` 是否工作？
   - 当前 `TS3Client` 内部有 `httpQuery`，但 `listChannels` 调用的是底层 Client
   - 需要确认 TS6 下的频道树获取方式

5. **Spacer 频道处理**
   - TS3 的 spacer 频道名称格式：`[spacer0]`, `[*spacer1]`, `cspacer`, `rspacer`
   - 这些频道没有实际意义，需要视觉弱化
   - 实现时根据 name pattern 判断即可

---

## 七、推荐实施顺序

### Step 1: 后端基础设施（1h）
1. TS3Client 新增 `getChannelList()`, `getClientList()`, `getClientId()`, `joinChannelById()`
2. BotInstance 新增 `getServerTree()`, `joinChannelById()`
3. Express 路由新增 `GET /:botId/server-tree`, `POST /:botId/join-channel`

### Step 2: 前端核心组件（3-4h）
4. 创建 `useServerTreeStore`（Pinia）
5. 创建 `ServerTreeDrawer.vue`（侧边栏容器）
6. 创建 `ServerTree.vue` + `ServerTreeChannel.vue`（递归树形渲染）
7. 集成到 Navbar（打开按钮）

### Step 3: 交互增强（2h）
8. 双击/点击加入频道
9. 带密码频道的弹窗输入
10. Bot 位置高亮 + 播放中动画
11. Spacer 频道弱化显示

### Step 4:  polish（1h）
12. 响应式适配
13. 加载/空状态
14. 从 Player 组件点击频道名打开 Drawer

---

## 八、与 TS3AudioBot 的对比优势

| 特性 | TS3AudioBot | 当前项目方案 |
|------|-------------|-------------|
| 实时性 | WebSocket 推送（全量刷新） | 轮询 + 可选 WebSocket |
| UI 框架 | Vue 2 + Buefy | Vue 3 + Tailwind v4 |
| 移动端 | 不友好 | 全屏 Drawer 适配 |
| 主题 | 仅深色 | 深色/浅色自动切换 |
| 集成度 | 独立 sidebar | 与 Player/Navbar 深度集成 |
| Whisper 切换 | 支持 | Phase 2 支持 |

---

## 九、结论

TS3 服务器树可视化是**高价值、中等难度**的功能。它弥补了当前项目在"服务器状态感知"方面的空白，让管理员和普通用户都能直观了解 Bot 的运行环境。

**建议立即开始 MVP 实现**，因为：
- 后端改动小（仅需暴露几个 TS3Client 方法）
- 前端组件可复用现有设计系统（frosted-glass、Tailwind 主题）
- 轮询方案无需改动 WebSocket 架构
- 7-8 小时的工作量，用户体验提升显著

**最大未知风险**：`@honeybbq/teamspeak-client` 在 TS3 服务器上的 `listChannels`/`listClients` 实际返回数据需要连接真实服务器验证。建议先在本地 TS3 服务器测试数据格式。
