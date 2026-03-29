# TSMusicBot 设计文档

**日期**: 2026-03-29
**状态**: 已批准

## 概述

TSMusicBot 是一个从零构建的 TeamSpeak 音乐机器人，支持播放网易云音乐和 QQ 音乐。机器人作为 TeamSpeak 客户端连接服务器，用户可通过精美的 WebUI 或 TeamSpeak 内文字命令进行操控。安装体验为一键式，面向不懂代码的用户。

## 1. 架构设计

### 整体架构

单体架构（Monolith），所有组件运行在一个 Node.js 进程中。

```
┌─────────────────────────────────────────────────────────────────┐
│                      TSMusicBot (单体进程)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │   WebUI 层    │  │  TS 命令层   │  │     Bot 管理器        │  │
│  │              │  │              │  │                       │  │
│  │  Vue.js SPA  │  │ !play !next  │  │  BotInstance #1       │  │
│  │  Express API │  │ !pause !vol  │  │  BotInstance #2       │  │
│  │  WebSocket   │  │ !queue !skip │  │  BotInstance #N       │  │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘  │
│         │                 │                      │              │
│         └─────────────────┴──────────────────────┘              │
│                           │                                     │
│              ┌────────────┴────────────┐                        │
│              │      核心服务层          │                        │
│              │                         │                        │
│              │  ┌───────────────────┐  │                        │
│              │  │   播放引擎        │  │                        │
│              │  │  FFmpeg 解码      │  │                        │
│              │  │  Opus 编码        │  │                        │
│              │  │  播放队列管理     │  │                        │
│              │  └───────────────────┘  │                        │
│              │                         │                        │
│              │  ┌───────────────────┐  │                        │
│              │  │   音乐源服务      │  │                        │
│              │  │  网易云 API       │  │                        │
│              │  │  QQ音乐 API      │  │                        │
│              │  │  搜索/歌单/专辑   │  │                        │
│              │  └───────────────────┘  │                        │
│              │                         │                        │
│              │  ┌───────────────────┐  │                        │
│              │  │   TS 协议层       │  │                        │
│              │  │  TCP 命令通道     │  │                        │
│              │  │  UDP 语音通道     │  │                        │
│              │  │  (无加密)         │  │                        │
│              │  └───────────────────┘  │                        │
│              └─────────────────────────┘                        │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                     数据层                                │   │
│  │   SQLite (用户数据/播放记录)  +  JSON (配置/Cookie)       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 六大核心模块

1. **TS 协议层** — 实现 TeamSpeak 3 客户端协议（参考 TSLib），包括 TCP 命令通道（登录、频道操作、文字消息）和 UDP 语音通道（Opus 音频包发送）。不实现加密。
2. **播放引擎** — 通过 FFmpeg 子进程解码音频源（MP3/FLAC/AAC），输出 PCM 数据，再用 node-opus 编码为 Opus 格式，按 20ms 帧发送到 TS 语音通道。管理播放队列、循环模式、音量控制。
3. **音乐源服务** — 内嵌启动 NeteaseCloudMusicApi 和 QQMusicApi 服务，提供统一的搜索、获取歌曲 URL、歌单、专辑、歌词等接口。处理账号登录（扫码/短信/Cookie）和 Cookie 自动刷新。
4. **WebUI + API** — Express 提供 REST API 和静态文件服务（Vue.js SPA）。WebSocket 实现实时状态推送（当前播放、队列变化、在线用户）。
5. **Bot 管理器** — 管理多个 BotInstance 的生命周期。每个实例拥有独立的 TS 连接、播放引擎和队列。支持通过 WebUI 创建/删除/配置实例。
6. **TS 命令层** — 监听 TS 频道文字消息，解析命令（如 !play、!next、!vol），权限检查后转发给对应的 BotInstance 执行。支持自定义命令前缀和别名。

### 数据流

```
用户点歌 (!play 晴天 或 WebUI 搜索)
  → 命令层/API 层调用音乐源服务搜索歌曲
  → 音乐源服务从网易云/QQ音乐 API 获取歌曲 URL
  → 播放引擎: FFmpeg 下载并解码为 PCM → Opus 编码
  → TS 协议层: 通过 UDP 将 Opus 音频包发送到 TS 服务器
  → WebSocket: 推送播放状态更新到 WebUI
```

## 2. WebUI 设计

### 设计风格

参考 YesPlayMusic（Apple Music 风格），核心设计要素：

- 深色主题为默认，支持浅色主题切换
- 毛玻璃导航栏和播放栏 (`backdrop-filter: blur(20px)`)
- 专辑封面彩色阴影效果（`node-vibrant` 动态提取主色）
- 大字号标题（22-42px），Barlow + PingFang SC / Microsoft YaHei 字体
- 圆角卡片（10-14px radius），充足留白
- 流畅微交互（hover scale 1.04, active scale 0.96, 0.3s transitions）
- 沉浸式歌词页 — 全屏、模糊背景、动态色彩

### 整体布局

- 固定毛玻璃导航栏（56px，顶部）：Logo、导航链接（发现/搜索/歌单/播放历史）、Bot 状态指示、管理入口
- 主内容区：10vw 水平内边距，Bot 实例切换器 + 主要内容 + 右侧边栏（队列/频道信息）
- 固定毛玻璃播放栏（56px，底部）：当前歌曲信息、播放控制、音量/队列/歌词入口

### 页面清单

1. **发现（首页）** — 推荐歌单、热门排行、正在播放状态、快速搜索入口
2. **搜索** — 跨平台搜索（网易云/QQ音乐切换），结果展示歌曲/歌单/专辑/歌手
3. **歌单详情** — 歌单封面、歌曲列表、一键播放全部、逐首添加到队列
4. **歌词页** — 沉浸式全屏歌词，动态背景（专辑色彩提取），逐行高亮
5. **播放历史** — 播放记录，按时间/平台筛选，快速重播
6. **设置/管理** — Bot 实例管理、TS 服务器连接配置、音乐账号登录（扫码/短信/Cookie）、命令前缀设置、频道行为配置

## 3. TeamSpeak 命令系统

用户在 TeamSpeak 频道内发送文字消息控制机器人。默认命令前缀 `!`，可在 WebUI 中自定义。支持私聊和频道消息两种触发方式。

### 播放控制

| 命令 | 说明 |
|------|------|
| `!play <歌名/URL/ID>` | 搜索并播放歌曲（默认网易云，加 -q 切 QQ 音乐） |
| `!play -q <歌名>` | 从 QQ 音乐搜索并播放 |
| `!pause` | 暂停播放 |
| `!resume` | 恢复播放 |
| `!stop` | 停止播放并清空队列 |
| `!next` / `!skip` | 下一首 |
| `!prev` | 上一首 |
| `!vol <0-100>` | 设置音量 |
| `!now` | 显示当前播放歌曲信息 |

### 队列管理

| 命令 | 说明 |
|------|------|
| `!add <歌名/URL/ID>` | 添加歌曲到队列尾部（不立即播放） |
| `!queue` / `!list` | 显示当前播放队列 |
| `!clear` | 清空播放队列 |
| `!remove <序号>` | 移除队列中指定位置的歌曲 |
| `!mode <seq\|loop\|random\|rloop>` | 切换播放模式：顺序/单曲循环/随机/随机循环 |

### 歌单 & 专辑

| 命令 | 说明 |
|------|------|
| `!playlist <歌单ID/URL>` | 加载歌单并开始播放 |
| `!album <专辑ID/URL>` | 加载专辑并开始播放 |
| `!fm` | 开启私人 FM 模式（网易云） |

### 社交互动

| 命令 | 说明 |
|------|------|
| `!vote` | 发起投票切歌（频道内过半数同意即跳过） |
| `!lyrics` | 在频道消息中显示当前歌词片段 |

### 管理命令

| 命令 | 说明 |
|------|------|
| `!move <频道名/ID>` | 移动机器人到指定频道 |
| `!follow` | 机器人跟随你到你所在的频道 |
| `!help` | 显示命令帮助列表 |

### 命令系统特性

- 命令前缀可自定义（默认 `!`），在 WebUI 设置页修改
- 命令别名可配置（如 `!p` → `!play`）
- 搜索结果多首时，回复序号选择
- 支持私聊和频道消息两种触发方式

### 权限系统

- **所有人**: play, add, queue, now, lyrics, vote, help
- **管理员**: stop, clear, move, vol, mode, follow
- 管理员通过 TS Server Group 或 WebUI 配置指定
- WebUI 管理页面需要密码登录

## 4. 技术栈

### 后端

| 依赖 | 用途 |
|------|------|
| Node.js 20 LTS | 运行时 |
| TypeScript 5.x | 开发语言 |
| Express 4.x | Web 框架 |
| ws | WebSocket |
| better-sqlite3 | SQLite 数据库 |
| FFmpeg (子进程) | 音频解码 |
| @discordjs/opus 或 opusscript | Opus 编码 |
| 自研 TS3 协议 (参考 TSLib) | TeamSpeak 连接 |
| Node.js crypto + tweetnacl | Ed25519 身份 |
| NeteaseCloudMusicApi (内嵌) | 网易云音乐 API |
| QQMusicApi (内嵌) | QQ 音乐 API |
| pino | 日志 |

### 前端

| 依赖 | 用途 |
|------|------|
| Vue 3 + Composition API | UI 框架 |
| Vite 5.x | 构建工具 |
| Vue Router 4 | 路由 |
| Pinia | 状态管理 |
| SCSS + CSS Variables | 样式 / 主题 |
| node-vibrant | 专辑封面主色提取 |
| Iconify | 图标 (按需加载) |
| axios | HTTP 客户端 |
| Barlow + 系统中文字体 | 排版 |

### 数据存储

- **SQLite** (better-sqlite3): 用户数据、播放记录、Bot 实例信息
- **JSON 文件**: 应用配置（方便手动编辑）、音乐平台 Cookie

## 5. 项目结构

```
TSMusicBot/
├── package.json
├── tsconfig.json
├── config.json                  # 用户配置（JSON，可手动编辑）
│
├── src/                         # 后端源码
│   ├── index.ts                 # 入口：启动所有服务
│   │
│   ├── ts-protocol/             # TeamSpeak 3 客户端协议实现（无加密）
│   │   ├── connection.ts        # TCP/UDP 连接管理
│   │   ├── identity.ts          # TS3 身份生成与管理
│   │   ├── commands.ts          # TS3 命令编解码
│   │   ├── voice.ts             # 语音数据包发送/接收
│   │   └── client.ts            # 高层 TS3 Client 封装
│   │
│   ├── audio/                   # 音频处理
│   │   ├── player.ts            # 播放引擎（FFmpeg → Opus → TS）
│   │   ├── queue.ts             # 播放队列管理
│   │   └── encoder.ts           # Opus 编码封装
│   │
│   ├── music/                   # 音乐源服务
│   │   ├── provider.ts          # 统一音乐源接口
│   │   ├── netease.ts           # 网易云适配器
│   │   ├── qq.ts                # QQ音乐适配器
│   │   ├── auth.ts              # 账号认证（扫码/短信/Cookie）
│   │   └── api-server.ts        # 内嵌 API 服务启动器
│   │
│   ├── bot/                     # Bot 核心
│   │   ├── instance.ts          # BotInstance（一个TS连接+播放引擎）
│   │   ├── manager.ts           # 多实例管理器
│   │   └── commands.ts          # TS 文字命令解析与执行
│   │
│   ├── web/                     # Web 服务
│   │   ├── server.ts            # Express + 静态文件 + WebSocket
│   │   ├── api/                 # REST API 路由
│   │   │   ├── bot.ts           # Bot 管理接口
│   │   │   ├── music.ts         # 搜索/歌单/歌曲接口
│   │   │   ├── player.ts        # 播放控制接口
│   │   │   └── auth.ts          # 登录认证接口
│   │   └── websocket.ts         # WebSocket 事件推送
│   │
│   └── data/                    # 数据层
│       ├── database.ts          # SQLite 封装
│       ├── config.ts            # JSON 配置读写
│       └── migrations/          # 数据库迁移脚本
│
├── web/                         # 前端源码 (Vue.js SPA)
│   ├── index.html
│   ├── vite.config.ts
│   ├── src/
│   │   ├── App.vue
│   │   ├── main.ts
│   │   ├── router/              # 路由定义
│   │   ├── stores/              # Pinia 状态管理
│   │   ├── views/               # 页面组件
│   │   │   ├── Home.vue         # 发现/首页
│   │   │   ├── Search.vue       # 搜索
│   │   │   ├── Playlist.vue     # 歌单详情
│   │   │   ├── Lyrics.vue       # 沉浸式歌词
│   │   │   ├── History.vue      # 播放历史
│   │   │   └── Settings.vue     # 设置/管理
│   │   ├── components/          # 可复用组件
│   │   │   ├── Player.vue       # 底部播放栏
│   │   │   ├── Navbar.vue       # 顶部导航栏
│   │   │   ├── Queue.vue        # 播放队列面板
│   │   │   ├── SongCard.vue     # 歌曲卡片
│   │   │   └── CoverArt.vue     # 带彩色阴影的封面组件
│   │   ├── composables/         # 组合式函数
│   │   │   ├── useWebSocket.ts  # WebSocket 连接
│   │   │   └── usePlayer.ts     # 播放器状态
│   │   └── styles/              # 全局样式
│   │       ├── variables.scss   # CSS 变量 / 主题
│   │       └── global.scss      # 全局样式
│   └── public/
│
├── scripts/                     # 部署脚本
│   ├── install.sh               # Linux 一键安装
│   ├── install.bat              # Windows 一键安装
│   └── docker/
│       ├── Dockerfile
│       └── docker-compose.yml
│
└── data/                        # 运行时数据（gitignore）
    ├── tsmusicbot.db            # SQLite 数据库
    ├── cookies/                 # 音乐平台 Cookie
    └── logs/                    # 日志文件
```

## 6. 部署与安装

### Windows

- **安装包 (.exe)**: 使用 pkg 打包 Node.js + 应用为单个 .exe，FFmpeg 作为附带二进制文件，Inno Setup 生成安装程序。双击安装 → 桌面快捷方式 → 双击启动 → 自动打开浏览器。
- **便携版 (.zip)**: 解压即用，包含所有依赖，双击 `start.bat` 启动。

### Linux

- **一键脚本**: `curl -fsSL https://get.tsmusicbot.com | bash` — 自动检测系统、安装 Node.js/FFmpeg、下载 TSMusicBot、配置 systemd 服务、启动。
- **Docker**: `docker run -d -p 3000:3000 tsmusicbot/tsmusicbot` — 镜像基于 node:20-slim，内含 FFmpeg，映射 `./data` 持久化。

### 首次运行引导 (Setup Wizard)

4 步引导流程，在 WebUI 中完成：

1. **欢迎** — 设置 WebUI 管理员密码、选择语言（中/英）、选择主题（深色/浅色）
2. **连接 TS 服务器** — 输入服务器地址、端口、昵称、默认频道，点击"测试连接"验证
3. **音乐账号（可选）** — 扫码/短信/Cookie 登录网易云或 QQ 音乐账号，跳过则只能播放免费歌曲
4. **完成** — Bot 已连接到 TS 服务器，跳转到主界面

### 端口配置

- WebUI 默认端口：`3000`（可在 config.json 中修改）
- 内嵌网易云 API 端口：`3001`（内部使用，不对外暴露）
- 内嵌 QQ 音乐 API 端口：`3002`（内部使用，不对外暴露）

## 7. 功能清单 (V1)

### 播放功能
- 搜索并播放歌曲（网易云/QQ音乐）
- 播放/暂停/停止/上一首/下一首
- 音量调节 (0-100)
- 4 种播放模式：顺序、单曲循环、随机、随机循环

### 播放列表
- 加载网易云/QQ音乐歌单
- 加载专辑
- 创建临时播放队列（添加/移除/清空/查看）
- 私人 FM 模式（网易云）

### 频道管理
- 自动跟随用户切换频道
- 无人时自动暂停
- 自动回到默认频道（可配置延迟）
- 手动移动到指定频道

### 社交互动
- 频道描述/Bot 头像更新为当前歌曲信息
- 投票切歌（频道内过半数同意）
- 频道内显示歌词片段

### 多实例
- 一个 WebUI 管理多个 Bot 实例
- 每个实例独立连接不同 TS 服务器或频道
- 独立的播放队列和配置

### 账号认证
- 扫码登录（网易云/QQ音乐）
- 短信登录（网易云）
- Cookie 手动导入
- Cookie 自动刷新

## 8. 未来演进

- 当音频编码出现性能瓶颈时，将 Opus 编码迁移到 Worker Threads
- 可扩展的音乐源插件系统（支持添加更多平台）
- 移动端 WebUI 适配
