# 前端性能优化分析报告 — requestAnimationFrame 及相关优化

> **范围：** `web/src/` 下的 Vue/TypeScript 代码
> **分析维度：** 动画循环、布局重排（Layout Thrashing）、后台标签页资源浪费、高频事件节流

---

## 执行摘要

共发现 **9 处** 值得优化的代码，其中 **2 处为 P0（严重影响性能）**，**3 处为 P1（明显浪费资源）**。其余为 P2/P3 级别的可改进项。

| 优先级 | 数量 | 典型影响 |
|--------|------|----------|
| P0 | 2 | 每帧触发布局重排，低端设备明显掉帧 |
| P1 | 3 | 后台标签页持续消耗 CPU/电池 |
| P2 | 2 | 高频事件导致多余计算 |
| P3 | 2 | 算法或 API 选择可优化 |

---

## P0 — 每帧触发布局重排（Critical）

### 1. Player.vue 进度条使用 `width` 属性驱动动画

**位置：** `web/src/components/Player.vue:15-16`

```vue
<div class="absolute top-0 left-0 h-full bg-primary rounded-sm" :style="{ width: progressPercent + '%' }" />
<div class="absolute top-1/2 ..." :style="{ left: progressPercent + '%' }" />
```

**问题：**
- `updateProgress` 通过 `requestAnimationFrame` 每帧更新 `progressPercent`
- `width` 和 `left` 都是**布局属性（Layout Properties）**，每帧变化会触发完整的 Layout → Paint → Composite 流水线
- 在 60fps 下，浏览器每 16.6ms 就要重排一次进度条，低端设备或复杂页面下容易掉帧

**优化方案：**

将进度条改为 `transform: scaleX()` + 固定宽度容器，仅触发 Composite（GPU 加速）：

```vue
<!-- 轨道容器 -->
<div class="w-full h-0.5 bg-border-color relative rounded-sm">
  <!-- 填充层：scaleX 仅触发合成 -->
  <div
    class="absolute top-0 left-0 h-full w-full bg-primary rounded-sm origin-left"
    :style="{ transform: `scaleX(${progressPercent / 100})` }"
  />
</div>
```

> 注意：如果当前 DOM 结构不允许直接替换（有 group hover 效果），需要同步调整 handle 的位移方式（同样改用 `translateX`）。

---

### 2. PlayingIndicator.vue 使用 `height` CSS 动画

**位置：** `web/src/components/PlayingIndicator.vue:26-39`

```css
@keyframes bar-bounce {
  0%, 100% { height: 4px; }
  50% { height: 16px; }
}
```

**问题：**
- `height` 是布局属性，CSS 动画每帧都会触发重排
- 3 个柱子同时动画，叠加效应更明显
- 虽然当前使用 CSS animation（非 JS 驱动），但仍属于可以避免的重排

**优化方案：**

改用 `transform: scaleY()`，配合 `transform-origin: bottom`：

```css
@keyframes bar-bounce {
  0%, 100% { transform: scaleY(0.25); }
  50% { transform: scaleY(1); }
}
.animate-bar1 {
  transform-origin: bottom;
  animation: bar-bounce 0.8s ease-in-out infinite;
}
```

> 注意：需要同步移除 `:style="isPlaying ? {} : { height: '4px' }"` 的绑定，改用 `transform: scaleY(0.25)` 控制暂停状态。

---

## P1 — 后台标签页资源浪费（High）

### 3. Player.vue rAF 在后台标签页自动暂停

**位置：** `web/src/components/Player.vue:147-159`

**问题：**
- 当用户切换到其他标签页时，浏览器会自动**减速或暂停** `requestAnimationFrame`（节能机制）
- 但音乐仍在播放，`store.elapsed` 通过插值继续推进
- 用户切回标签页时，进度条会从暂停位置瞬间跳到正确位置，视觉上产生**跳变**
- 更严重的是：如果后台停留时间较长，大量挂起的 rAF 回调可能在可见时集中执行，导致卡顿

**优化方案：**

使用 `document.visibilityState` 在后台时切换到 `setInterval`：

```ts
let backupTimer: ReturnType<typeof setInterval> | null = null;

function onVisibilityChange() {
  if (document.hidden) {
    cancelAnimationFrame(rafId!);
    rafId = null;
    backupTimer = setInterval(updateProgress, 250);
  } else {
    clearInterval(backupTimer!);
    backupTimer = null;
    if (store.isPlaying && rafId === null) {
      rafId = requestAnimationFrame(updateProgress);
    }
  }
}

document.addEventListener('visibilitychange', onVisibilityChange);
```

---

### 4. Lyrics.vue `tick` rAF 在后台持续运行

**位置：** `web/src/views/Lyrics.vue:138-147`

**问题：**
- `tick` 函数使用 rAF 每帧检测当前歌词行，但歌词页面在后台时不需要更新
- rAF 在后台被暂停后，切回时歌词高亮会跳变到正确位置（类似进度条问题）
- 且每帧调用 `findActiveLine(store.elapsed)` 是线性搜索（见 P3 第 8 条）

**优化方案：**
- 同样监听 `visibilitychange`，后台时暂停 rAF
- 结合 P3 的指针优化，减少每帧计算量

---

### 5. App.vue 后台轮询未暂停

**位置：** `web/src/App.vue:36-43`

```ts
syncTimer = setInterval(() => playerStore.syncElapsed(), 3000);
```

**问题：**
- 每 3 秒轮询服务器获取播放状态，即使在后台标签页也持续执行
- 浪费用户电池和网络资源，且后台获取的数据对不可见页面无意义

**优化方案：**

使用 `Page Visibility API` 暂停轮询：

```ts
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    clearInterval(syncTimer!);
    syncTimer = null;
  } else if (!syncTimer) {
    syncTimer = setInterval(() => playerStore.syncElapsed(), 3000);
  }
});
```

> 或者使用 `requestIdleCallback` 替代 `setInterval`，让浏览器在空闲时执行非关键同步。

---

## P2 — 高频事件未节流（Medium）

### 6. Player.vue `mousemove` tooltip 更新频率过高

**位置：** `web/src/components/Player.vue:159-180`

```ts
function onProgressHover(e: MouseEvent) {
  // ... 每帧都可能执行计算和 DOM 更新
  progressTooltipVisible.value = true;
  progressTooltipX.value = e.clientX - rect.left;
}
```

**问题：**
- `mousemove` 事件触发频率可能高达 125Hz~1000Hz（取决于鼠标 DPI 和操作系统）
- 屏幕刷新率通常只有 60Hz~120Hz，高于刷新率的事件都是浪费
- 每次事件都读取 `getBoundingClientRect()`（强制同步布局）并更新 reactive ref，触发 Vue 响应式更新

**优化方案：**

使用 rAF 节流，确保更新频率不超过屏幕刷新率：

```ts
let pendingRaf = false;

function onProgressHover(e: MouseEvent) {
  if (pendingRaf) return;
  pendingRaf = true;

  requestAnimationFrame(() => {
    pendingRaf = false;
    const bar = progressBarRef.value;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    // ... 原有计算逻辑
  });
}
```

---

### 7. Search.vue 列表交错动画使用内联 `animationDelay`

**位置：** `web/src/views/Search.vue:57`

```vue
<SongGridCard
  v-for="(song, i) in results"
  :key="`${song.platform}-${song.id}`"
  :style="{ animationDelay: `${Math.min(i * 40, 400)}ms` }"
/>
```

**问题：**
- 每个列表项都有独立的内联 style 绑定，Vue 需要为每个项创建独立的响应式绑定
- 大量 DOM 元素同时进入（如 50 首歌曲），浏览器需要处理 50 个独立的 CSS 动画启动
- 虽然使用 CSS transition（性能尚可），但 `animationDelay` 内联设置可能导致样式计算开销

**优化方案：**

使用 CSS `:nth-child()` 替代内联 style：

```css
.stagger-enter-active:nth-child(1) { transition-delay: 0ms; }
.stagger-enter-active:nth-child(2) { transition-delay: 40ms; }
/* ... 或者使用 CSS 变量 + nth-child */
```

或者限制同时渲染的最大数量（虚拟列表），减少 DOM 节点总数。

---

## P3 — 算法/API 效率（Low）

### 8. Lyrics.vue `findActiveLine` 每帧线性搜索

**位置：** `web/src/views/Lyrics.vue:113-124`

```ts
function findActiveLine(elapsed: number): number {
  let idx = -1;
  for (let i = 0; i < lines.value.length; i++) {
    if (lines.value[i].time <= elapsed) {
      idx = i;
    } else {
      break;
    }
  }
  return idx;
}
```

**问题：**
- 每帧从头遍历歌词列表，时间复杂度 O(n)
- 一首 4 分钟歌曲通常有 50~100 行歌词，最坏情况下每帧遍历 100 次
- 歌词时间是单调递增的，**不需要回头搜索**

**优化方案：**

维护一个指针，只向前搜索：

```ts
let nextLineIdx = 0;

function findActiveLine(elapsed: number): number {
  while (nextLineIdx < lines.value.length && lines.value[nextLineIdx].time <= elapsed) {
    nextLineIdx++;
  }
  return nextLineIdx - 1;
}

// 切歌时重置指针
watch(() => currentSong.value?.id, () => {
  nextLineIdx = 0;
});
```

平均时间复杂度降为 O(1)（每帧最多推进 1~2 行）。

---

### 9. CoverArt.vue 主线程 Canvas 像素采样

**位置：** `web/src/components/CoverArt.vue:61-96`

```ts
function extractDominantColor(url: string): void {
  // ... 创建 canvas，drawImage，getImageData，遍历像素
  for (let i = 0; i < data.length; i += 16) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
    count++;
  }
}
```

**问题：**
- 图片加载后立即在主线程执行 Canvas 像素计算
- 虽然采样了 32x32 且跳像素，但仍阻塞主线程（尤其图片较多时）
- 这不是动画问题，但属于"不应该在主线程做的工作"

**优化方案：**

使用 `requestIdleCallback` 推迟非关键计算：

```ts
img.onload = () => {
  requestIdleCallback(() => {
    // ... 像素计算
  }, { timeout: 2000 });
};
```

> 或者使用 Web Worker 处理像素计算（更彻底，但复杂度更高）。

---

## 附录 A：其他可改进项（Minor）

### A1. BaseModal.vue 使用 `setTimeout(..., 0)` 代替 `nextTick`

**位置：** `web/src/components/common/BaseModal.vue:54`

```ts
setTimeout(() => modalRef.value?.focus(), 0);
```

应使用 Vue 的 `nextTick()` 更语义化：

```ts
import { nextTick } from 'vue';
nextTick(() => modalRef.value?.focus());
```

### A2. ServerTreeDrawer.vue `isMobile` 每次访问都读 `window.innerWidth`

**位置：** `web/src/components/ServerTreeDrawer.vue:75`

```ts
const isMobile = computed(() => window.innerWidth <= 768);
```

每次 `computed` 被访问都会读取 `window.innerWidth`，虽然不是性能瓶颈，但更好的做法是监听 `resize` 事件或使用 `matchMedia`：

```ts
const isMobile = ref(window.innerWidth <= 768);
window.addEventListener('resize', () => {
  isMobile.value = window.innerWidth <= 768;
});
```

> 可进一步用 rAF 节流 resize 回调。

### A3. 全局 CSS 缺少 `will-change` 提示

**位置：** `web/src/styles/index.css`

频繁动画的元素（如 Queue.vue 的 `translate-x`、ServerTreeDrawer.vue 的 `translate-x`）可添加 `will-change: transform` 提示浏览器提前创建合成层：

```css
.queue-panel {
  will-change: transform;
}
```

> 注意：`will-change` 应在动画前添加、动画后移除，避免长期占用 GPU 内存。

---

## 附录 B：优化优先级建议

| 优先级 | 问题 | 预估收益 | 实现复杂度 |
|--------|------|----------|------------|
| P0 | Player.vue `width` → `transform` | 高（低端设备掉帧减少） | 低 |
| P0 | PlayingIndicator.vue `height` → `scaleY` | 中（减少重排） | 低 |
| P1 | Player.vue 后台标签页切换 | 中（电池/流畅度） | 低 |
| P1 | App.vue 轮询暂停 | 中（电池/网络） | 低 |
| P1 | Lyrics.vue 后台暂停 + 指针优化 | 中（CPU） | 低 |
| P2 | Player.vue mousemove rAF 节流 | 低（减少多余计算） | 低 |
| P2 | Search.vue 交错动画优化 | 低 | 中 |
| P3 | Lyrics.vue 二分/指针搜索 | 低（微优化） | 低 |
| P3 | CoverArt.vue `requestIdleCallback` | 低（主线程减负） | 低 |

---

*报告生成时间：2026-05-04*
