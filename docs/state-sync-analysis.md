# 状态同步问题分析与优化建议

## 一、Footer（Player）偶发不显示问题

### 现象
首次进入页面时底部播放器（Player.vue）不显示，刷新页面后正常出现。

### 根因：HTTP `fetchBots()` 与 WebSocket `init` 的竞态条件

在 `App.vue:onMounted` 中同时启动了两条独立的状态填充通道：

```ts
onMounted(() => {
  connect();              // 启动 WebSocket
  playerStore.fetchBots(); // 发起 HTTP GET /api/bot
  startSyncTimer();       // 启动 3s 轮询
});
```

两者都是异步且无协调的，存在以下风险时序：

1. **WebSocket `init` 先到**：WS 连接建立后，后端立即推送 `{ type: 'init', bots: [...] }`，前端通过 `updateBotStatus()` 将 bot 状态写入 store，此时 `currentSong` 已存在。
2. **HTTP `fetchBots()` 后到**：`fetchBots()` 内部执行 `this.bots = res.data.bots`（整表替换）。如果 `/api/bot` 返回的数据快照与 WS 不一致（例如请求发得较早，后端状态尚未完全就绪），会**覆盖**掉 WS 已经写入的正确状态，导致 `currentSong` 短暂或持续为 null，Player 的 `v-if="currentSong"` 不成立，Footer 消失。

#### 具体风险点

| 位置 | 问题 |
|------|------|
| `App.vue:62` | `fetchBots()` 未 `await`，异常会成为 unhandled rejection |
| `player.ts:192-209` | `fetchBots()` 使用 `this.bots = res.data.bots` 整表替换，无合并逻辑 |
| `useWebSocket.ts:86-94` | `init` 处理器只调用 `updateBotStatus()`，从不主动设置 `activeBotId` |

#### 为什么刷新后正常？

刷新时后端已完全启动，HTTP 和 WS 拿到的状态快照几乎一致，整表替换也不会造成可见的数据回退，因此 Footer 能正确渲染。

### 修复建议

**方案 A（推荐）：消除整表替换，改为合并更新**

将 `fetchBots()` 的整表替换改为逐条 merge，与 WS 更新走同一路径：

```ts
async fetchBots() {
  const res = await http.get('/api/bot');
  const fetchedBots: BotStatus[] = res.data.bots;

  // 用 merge 代替整表替换，避免覆盖 WS 已推送的更新
  for (const bot of fetchedBots) {
    this.updateBotStatus(bot.id, bot);
  }

  // 兜底：如果仍无 activeBotId，取第一个
  if (!this.activeBotId && this.bots.length > 0) {
    this.activeBotId = this.bots[0].id;
    await this.fetchQueue();
  }

  // 清理已不存在的 bot
  const aliveIds = new Set(fetchedBots.map(b => b.id));
  for (const bot of this.bots) {
    if (!aliveIds.has(bot.id)) {
      this.removeBotStatus(bot.id);
    }
  }

  // 同步 elapsed
  for (const bot of this.bots) {
    if (bot.elapsed !== undefined) {
      this._setTiming(bot.id, {
        serverElapsed: bot.elapsed,
        serverSyncTime: Date.now(),
        wasPlaying: bot.playing && !bot.paused,
      });
    }
  }
}
```

**方案 B：顺序化初始化**

在 `App.vue` 中先等 WS `init` 到达（或超时）再调 `fetchBots()`，但实现复杂且拖慢首屏。

**方案 C：给 Player.vue 增加保底显示逻辑（不推荐）**

将 `v-if="currentSong"` 改为始终渲染但内容区根据状态变化，改动面太大，治标不治本。

**结论**：采用方案 A，改动最小且能从根源消除竞态。

---

## 二、WebSocket + 轮询策略的优化空间

### 当前架构

| 通道 | 职责 | 触发方式 |
|------|------|----------|
| WebSocket | 实时推送 bot 状态变更（play/pause/stop/切歌/上下线） | 事件驱动 |
| HTTP 轮询 3s | `syncElapsed()` 校准播放进度、volume、playMode | 定时轮询 |
| HTTP 轮询 5s | ServerTreeDrawer 中的频道树刷新 | 面板打开时轮询 |

### 评估：是否需要迁移到 SSE？

**结论：不建议迁移到 SSE。**

理由：
1. **成本收益不成正比**：项目已稳定使用 WebSocket，迁移到 SSE 需要重写后端广播层和前端连接层，收益仅限于"技术栈更纯"。
2. **功能适配差**：SSE 是单向通道，无法优雅处理需要双向通信的场景（如未来可能的客户端直接 WS 控制 bot）。
3. **代理兼容性**：现代 CDN 和反向代理对 WebSocket 支持已非常成熟。

### 真正的优化点：消除 `syncElapsed()` HTTP 轮询

#### 问题

`syncElapsed()` 每 3 秒发一次 HTTP 请求，仅为了校准播放进度和确认 playing/paused 状态。这会带来：
- 不必要的网络开销（空闲时也在请求）
- 电池/流量消耗（移动端）
- 后端处理 1 个 bot 就要响应 N 个客户端的轮询

#### 优化方案：在 WebSocket 层增加周期性 `tick` 广播

后端 `websocket.ts` 增加定时广播，每隔 2-3 秒推送一次精确的 `elapsed` 和状态：

```ts
// 在 setupWebSocket 中
const tickId = setInterval(() => {
  for (const bot of botManager.getAllBots()) {
    const status = bot.getStatus();
    broadcast({
      type: 'tick',
      botId: bot.id,
      elapsed: status.elapsed,
      playing: status.playing,
      paused: status.paused,
      volume: status.volume,
      playMode: status.playMode,
    });
  }
}, 2500);
```

前端 `useWebSocket.ts` 增加 `tick` 处理：

```ts
case 'tick':
  if (typeof data.botId === 'string') {
    store.updateBotStatus(data.botId, {
      ...store.bots.find(b => b.id === data.botId),
      elapsed: data.elapsed,
      playing: data.playing,
      paused: data.paused,
      volume: data.volume,
      playMode: data.playMode,
    } as any);
    store._setTiming(data.botId, {
      serverElapsed: data.elapsed as number,
      serverSyncTime: Date.now(),
      wasPlaying: data.playing && !data.paused,
    });
  }
  break;
```

然后 `App.vue` 中可以移除 `startSyncTimer()` 和 `syncElapsed()` 轮询。

**收益**：
- 消除 3 秒一次的 HTTP 轮询，减少约 33% 的常态请求量
- 进度条精度不变（前端仍然用 `requestAnimationFrame` 本地插值）
- 状态变更（暂停/播放）仍然由事件驱动的 `stateChange` 立即推送，无延迟

### ServerTreeDrawer 的轮询是否优化？

ServerTreeDrawer 的 5 秒轮询仅在面板打开时运行，且频道树不是高频变化数据，当前策略合理。若要优化，可考虑：
- 在 WebSocket 中增加 `serverTreeChanged` 事件（当 bot 切换频道时由后端主动推送）
- 面板打开时先请求一次，之后依赖事件推送，无事件则不再轮询

但这需要后端在 `joinChannel` 等操作后显式广播，改动成本高于收益，建议保持现状。

---

## 三、总结与优先级

| 优先级 | 事项 | 影响 | 建议方案 |
|--------|------|------|----------|
| P0 | Footer 偶发不显示 | 用户体验 | `fetchBots()` 改为 merge 更新，避免整表替换 |
| P1 | 消除 `syncElapsed()` 3s 轮询 | 性能、移动端续航 | WS 增加 2.5s `tick` 广播，前端移除轮询 |
| P2 | SSE 迁移 | 技术债务 | **不做**，当前 WS 架构足够 |
| P3 | ServerTree 轮询优化 | 轻微性能 | 保持现状，收益有限 |

### 下一步行动

1. 修复 `fetchBots()` 竞态（约 10 行改动）
2. 后端 WebSocket 增加 `tick` 广播（约 15 行改动）
3. 前端消费 `tick` 并移除 `syncElapsed` 轮询（约 20 行改动）
4. 验证：首屏 Footer 稳定出现 + 进度条正常走动 + 网络面板无 3s 周期请求
