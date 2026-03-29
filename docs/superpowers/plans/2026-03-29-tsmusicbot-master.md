# TSMusicBot — Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build TSMusicBot from scratch — a TeamSpeak music bot supporting NetEase Cloud Music and QQ Music, with a YesPlayMusic-inspired WebUI, TS text commands, and one-click deployment.

**Architecture:** Node.js/TypeScript monolith, single process running TS3 client protocol + audio engine + embedded music APIs + Express/WebSocket web server + Vue.js SPA.

**Tech Stack:** Node.js 20, TypeScript 5, Express, Vue 3/Vite/Pinia, FFmpeg, @discordjs/opus, better-sqlite3, ws

---

## Phases

Each phase produces working, testable software and ends with a commit checkpoint.

- [ ] **[Phase 1: Project Scaffold, Data Layer & Config](2026-03-29-tsmusicbot-phase1.md)** (6 tasks)
  - Git init, package.json, tsconfig, dependencies
  - JSON config module (load/save/defaults)
  - Pino logger
  - SQLite database (play_history, bot_instances)
  - Application entry point
  - Result: `npm run dev` boots and logs "TSMusicBot started"

- [ ] **[Phase 2: TeamSpeak 3 Protocol Layer](2026-03-29-tsmusicbot-phase2.md)** (6 tasks)
  - TS3 identity generation (Ed25519)
  - Command encoding/decoding (escape/unescape)
  - TCP connection (ServerQuery command channel)
  - UDP voice connection (Opus packet sending)
  - High-level TS3Client (connect, join channel, send text, send voice)
  - Result: Can connect to a TS server, join a channel, send/receive messages

- [ ] **[Phase 3: Audio Engine](2026-03-29-tsmusicbot-phase3.md)** (4 tasks)
  - Opus encoder wrapper (@discordjs/opus)
  - Play queue with 4 modes (sequential, loop, random, random-loop)
  - Audio player (FFmpeg → PCM → Opus → 20ms frames)
  - Result: Can decode any audio URL and produce timed Opus frames

- [ ] **[Phase 4: Music Source Service](2026-03-29-tsmusicbot-phase4.md)** (6 tasks)
  - Embedded API server launcher
  - Unified MusicProvider interface
  - NetEase Cloud Music adapter (search, playlist, lyrics, auth)
  - QQ Music adapter (search, playlist, lyrics, auth)
  - Cookie persistence store
  - Result: Can search, get song URLs, and authenticate with both platforms

- [ ] **[Phase 5: Bot Core & TS Command System](2026-03-29-tsmusicbot-phase5.md)** (4 tasks)
  - Command parser (prefix, aliases, flags, permissions)
  - BotInstance (ties TS3Client + AudioPlayer + MusicProvider)
  - BotManager (multi-instance lifecycle, persistence)
  - Result: Full bot that plays music via TS commands (!play, !next, etc.)

- [ ] **[Phase 6: Web Backend](2026-03-29-tsmusicbot-phase6.md)** (8 tasks)
  - Express + WebSocket server bootstrap
  - Bot management API (CRUD + start/stop)
  - Music search/playlist/lyrics API
  - Player control API (play, pause, queue, volume, mode)
  - Auth API (QR code, SMS, cookie)
  - WebSocket real-time state broadcasting
  - Wire everything in index.ts
  - Result: Full REST API + WebSocket backend, ready for frontend

- [ ] **[Phase 7: WebUI Frontend](2026-03-29-tsmusicbot-phase7.md)** (10 tasks)
  - Vue.js project scaffold (Vite, Pinia, Router)
  - SCSS theme (YesPlayMusic dark/light)
  - Pinia stores + WebSocket composable
  - Router setup
  - Navbar (frosted glass)
  - Player bar (frosted glass, controls, volume)
  - CoverArt component (colored shadow)
  - Home page (bot selector, search, playlists, now playing)
  - All page views (Search, Playlist, Lyrics, History, Settings)
  - Build and verify
  - Result: Beautiful, functional WebUI

- [ ] **[Phase 8: Deployment & Packaging](2026-03-29-tsmusicbot-phase8.md)** (5 tasks)
  - Windows start script (start.bat)
  - Linux one-click install script (install.sh + systemd)
  - Docker (Dockerfile + docker-compose.yml)
  - Setup Wizard (4-step first-run flow in WebUI)
  - Final build and verify
  - Result: One-click installable on Windows and Linux

## Total: 8 phases, 49 tasks

## Implementation Order

Phases MUST be implemented in order (1 → 2 → 3 → ... → 8). Each phase depends on the previous one.
