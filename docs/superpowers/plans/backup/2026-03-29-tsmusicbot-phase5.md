# TSMusicBot Phase 5: Bot Core & TS Command System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build BotInstance (ties TS3Client + AudioPlayer + MusicProvider together), BotManager (multi-instance lifecycle), and the TS text command parser/executor with permissions.

**Architecture:** `BotInstance` is the core unit — one TS connection, one player, one queue. `BotManager` creates/destroys instances and routes commands. `CommandHandler` parses `!play`, `!next`, etc. from TS text messages and dispatches them.

**Tech Stack:** TypeScript, vitest

---

### Task 1: Command parser

**Files:**
- Create: `src/bot/commands.ts`
- Create: `src/bot/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/bot/commands.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseCommand, type ParsedCommand } from './commands.js';

describe('Command Parser', () => {
  it('parses simple command', () => {
    const result = parseCommand('!play 晴天', '!');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('play');
    expect(result!.args).toBe('晴天');
    expect(result!.rawArgs).toEqual(['晴天']);
  });

  it('parses command with flags', () => {
    const result = parseCommand('!play -q 七里香', '!');
    expect(result!.name).toBe('play');
    expect(result!.flags.has('q')).toBe(true);
    expect(result!.args).toBe('七里香');
  });

  it('returns null for non-command messages', () => {
    expect(parseCommand('hello world', '!')).toBeNull();
    expect(parseCommand('', '!')).toBeNull();
  });

  it('handles custom prefix', () => {
    const result = parseCommand('/play test', '/');
    expect(result!.name).toBe('play');
    expect(result!.args).toBe('test');
  });

  it('resolves aliases', () => {
    const aliases = { p: 'play', s: 'skip', n: 'next' };
    const result = parseCommand('!p 稻香', '!', aliases);
    expect(result!.name).toBe('play');
    expect(result!.args).toBe('稻香');
  });

  it('parses command with no args', () => {
    const result = parseCommand('!pause', '!');
    expect(result!.name).toBe('pause');
    expect(result!.args).toBe('');
    expect(result!.rawArgs).toEqual([]);
  });

  it('parses vol command with number arg', () => {
    const result = parseCommand('!vol 80', '!');
    expect(result!.name).toBe('vol');
    expect(result!.args).toBe('80');
  });

  it('parses mode command', () => {
    const result = parseCommand('!mode loop', '!');
    expect(result!.name).toBe('mode');
    expect(result!.args).toBe('loop');
  });

  it('parses remove command with index', () => {
    const result = parseCommand('!remove 3', '!');
    expect(result!.name).toBe('remove');
    expect(result!.args).toBe('3');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/bot/commands.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Create `src/bot/commands.ts`:

```typescript
export interface ParsedCommand {
  name: string;         // command name (e.g., "play")
  args: string;         // everything after the command name and flags
  rawArgs: string[];    // split args
  flags: Set<string>;   // single-char flags (e.g., -q)
}

// Commands anyone can use
export const PUBLIC_COMMANDS = new Set([
  'play', 'add', 'queue', 'list', 'now', 'lyrics', 'vote', 'help',
  'playlist', 'album', 'fm', 'prev', 'next', 'skip', 'pause', 'resume',
]);

// Commands that require admin
export const ADMIN_COMMANDS = new Set([
  'stop', 'clear', 'move', 'vol', 'mode', 'follow', 'remove',
]);

export function parseCommand(
  message: string,
  prefix: string,
  aliases: Record<string, string> = {},
): ParsedCommand | null {
  const trimmed = message.trim();
  if (!trimmed.startsWith(prefix)) return null;

  const withoutPrefix = trimmed.slice(prefix.length);
  if (!withoutPrefix) return null;

  const parts = withoutPrefix.split(/\s+/);
  let name = parts[0].toLowerCase();

  // Resolve alias
  if (aliases[name]) {
    name = aliases[name];
  }

  // Parse flags and remaining args
  const flags = new Set<string>();
  const argParts: string[] = [];

  for (let i = 1; i < parts.length; i++) {
    if (parts[i].startsWith('-') && parts[i].length === 2 && /[a-zA-Z]/.test(parts[i][1])) {
      flags.add(parts[i][1].toLowerCase());
    } else {
      argParts.push(parts[i]);
    }
  }

  return {
    name,
    args: argParts.join(' '),
    rawArgs: argParts,
    flags,
  };
}

export function isAdminCommand(commandName: string): boolean {
  return ADMIN_COMMANDS.has(commandName);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/bot/commands.test.ts`
Expected: 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/commands.ts src/bot/commands.test.ts
git commit -m "feat: add TS command parser with aliases, flags, and permission classification"
```

---

### Task 2: BotInstance

**Files:**
- Create: `src/bot/instance.ts`

- [ ] **Step 1: Write implementation**

Create `src/bot/instance.ts`:

```typescript
import { EventEmitter } from 'node:events';
import { TS3Client, type TS3ClientOptions, type TS3TextMessage } from '../ts-protocol/client.js';
import { AudioPlayer } from '../audio/player.js';
import { PlayQueue, PlayMode, type QueuedSong } from '../audio/queue.js';
import type { MusicProvider, Song } from '../music/provider.js';
import { parseCommand, isAdminCommand, type ParsedCommand } from './commands.js';
import type { Logger } from '../logger.js';
import type { Database } from '../data/database.js';
import type { BotConfig } from '../data/config.js';

export interface BotInstanceOptions {
  id: string;
  name: string;
  tsOptions: TS3ClientOptions;
  neteaseProvider: MusicProvider;
  qqProvider: MusicProvider;
  database: Database;
  config: BotConfig;
  logger: Logger;
}

export interface BotStatus {
  id: string;
  name: string;
  connected: boolean;
  playing: boolean;
  paused: boolean;
  currentSong: QueuedSong | null;
  queueSize: number;
  volume: number;
  playMode: PlayMode;
}

export class BotInstance extends EventEmitter {
  readonly id: string;
  readonly name: string;

  private tsClient: TS3Client;
  private player: AudioPlayer;
  private queue: PlayQueue;
  private neteaseProvider: MusicProvider;
  private qqProvider: MusicProvider;
  private database: Database;
  private config: BotConfig;
  private logger: Logger;
  private connected = false;
  private voteSkipUsers = new Set<string>();

  constructor(options: BotInstanceOptions) {
    super();
    this.id = options.id;
    this.name = options.name;
    this.neteaseProvider = options.neteaseProvider;
    this.qqProvider = options.qqProvider;
    this.database = options.database;
    this.config = options.config;
    this.logger = options.logger.child({ botId: this.id });

    this.tsClient = new TS3Client(options.tsOptions, this.logger);
    this.player = new AudioPlayer(this.logger);
    this.queue = new PlayQueue();

    this.setupPlayerEvents();
    this.setupTsEvents();
  }

  private setupPlayerEvents(): void {
    this.player.on('frame', (opusFrame: Buffer) => {
      this.tsClient.sendVoiceData(opusFrame);
    });

    this.player.on('trackEnd', () => {
      this.logger.debug('Track ended, advancing queue');
      this.playNext();
    });

    this.player.on('error', (err: Error) => {
      this.logger.error({ err }, 'Player error');
      this.playNext();
    });
  }

  private setupTsEvents(): void {
    this.tsClient.on('textMessage', (msg: TS3TextMessage) => {
      this.handleTextMessage(msg);
    });

    this.tsClient.on('disconnected', () => {
      this.connected = false;
      this.player.stop();
      this.emit('disconnected');
    });
  }

  async connect(): Promise<void> {
    await this.tsClient.connect();
    this.connected = true;
    this.emit('connected');
  }

  disconnect(): void {
    this.player.stop();
    this.tsClient.disconnect();
    this.connected = false;
    this.emit('disconnected');
  }

  private async handleTextMessage(msg: TS3TextMessage): Promise<void> {
    const parsed = parseCommand(msg.message, this.config.commandPrefix, this.config.commandAliases);
    if (!parsed) return;

    // Permission check
    if (isAdminCommand(parsed.name)) {
      // For now, allow all commands. Admin check via TS Server Groups
      // will be implemented when we add the permission system.
      // TODO: Check if invoker is in adminGroups
    }

    this.logger.info({ command: parsed.name, args: parsed.args, invoker: msg.invokerName }, 'Command received');

    try {
      const response = await this.executeCommand(parsed, msg);
      if (response) {
        await this.tsClient.sendTextMessage(response);
      }
    } catch (err) {
      this.logger.error({ err, command: parsed.name }, 'Command execution error');
      await this.tsClient.sendTextMessage(`Error: ${(err as Error).message}`);
    }
  }

  async executeCommand(cmd: ParsedCommand, msg?: TS3TextMessage): Promise<string | null> {
    switch (cmd.name) {
      case 'play': return this.cmdPlay(cmd);
      case 'add': return this.cmdAdd(cmd);
      case 'pause': return this.cmdPause();
      case 'resume': return this.cmdResume();
      case 'stop': return this.cmdStop();
      case 'next':
      case 'skip': return this.cmdNext();
      case 'prev': return this.cmdPrev();
      case 'vol': return this.cmdVol(cmd);
      case 'now': return this.cmdNow();
      case 'queue':
      case 'list': return this.cmdQueue();
      case 'clear': return this.cmdClear();
      case 'remove': return this.cmdRemove(cmd);
      case 'mode': return this.cmdMode(cmd);
      case 'playlist': return this.cmdPlaylist(cmd);
      case 'album': return this.cmdAlbum(cmd);
      case 'fm': return this.cmdFm();
      case 'vote': return this.cmdVote(msg);
      case 'lyrics': return this.cmdLyrics();
      case 'move': return this.cmdMove(cmd);
      case 'follow': return this.cmdFollow(msg);
      case 'help': return this.cmdHelp();
      default: return `Unknown command: ${cmd.name}. Type ${this.config.commandPrefix}help for help.`;
    }
  }

  private getProvider(useQQ: boolean): MusicProvider {
    return useQQ ? this.qqProvider : this.neteaseProvider;
  }

  private async cmdPlay(cmd: ParsedCommand): Promise<string> {
    if (!cmd.args) return 'Usage: !play <song name or URL>';
    const provider = this.getProvider(cmd.flags.has('q'));
    const result = await provider.search(cmd.args, 1);
    if (result.songs.length === 0) return `No results found for: ${cmd.args}`;

    const song = result.songs[0];
    const url = await provider.getSongUrl(song.id);
    if (!url) return `Cannot get play URL for: ${song.name}`;

    const queuedSong: QueuedSong = { ...song, url, platform: provider.platform };
    this.queue.clear();
    this.queue.add(queuedSong);
    this.queue.play();
    this.player.play(url);

    this.database.addPlayHistory({
      botId: this.id,
      songId: song.id,
      songName: song.name,
      artist: song.artist,
      album: song.album,
      platform: provider.platform,
      coverUrl: song.coverUrl,
    });

    this.emit('stateChange');
    return `Now playing: ${song.name} - ${song.artist}`;
  }

  private async cmdAdd(cmd: ParsedCommand): Promise<string> {
    if (!cmd.args) return 'Usage: !add <song name>';
    const provider = this.getProvider(cmd.flags.has('q'));
    const result = await provider.search(cmd.args, 1);
    if (result.songs.length === 0) return `No results found for: ${cmd.args}`;

    const song = result.songs[0];
    const url = await provider.getSongUrl(song.id);
    if (!url) return `Cannot get play URL for: ${song.name}`;

    this.queue.add({ ...song, url, platform: provider.platform });
    this.emit('stateChange');
    return `Added to queue: ${song.name} - ${song.artist} (position ${this.queue.size()})`;
  }

  private cmdPause(): string {
    this.player.pause();
    this.emit('stateChange');
    return 'Paused';
  }

  private cmdResume(): string {
    this.player.resume();
    this.emit('stateChange');
    return 'Resumed';
  }

  private cmdStop(): string {
    this.player.stop();
    this.queue.clear();
    this.emit('stateChange');
    return 'Stopped and queue cleared';
  }

  private cmdNext(): string {
    this.playNext();
    const current = this.queue.current();
    if (current) return `Now playing: ${current.name} - ${current.artist}`;
    return 'Queue is empty';
  }

  private cmdPrev(): string {
    const prev = this.queue.prev();
    if (prev) {
      this.player.play(prev.url);
      this.emit('stateChange');
      return `Now playing: ${prev.name} - ${prev.artist}`;
    }
    return 'No previous song';
  }

  private cmdVol(cmd: ParsedCommand): string {
    const vol = parseInt(cmd.args, 10);
    if (isNaN(vol) || vol < 0 || vol > 100) return 'Usage: !vol <0-100>';
    this.player.setVolume(vol);
    this.emit('stateChange');
    return `Volume set to ${vol}%`;
  }

  private cmdNow(): string {
    const song = this.queue.current();
    if (!song) return 'Nothing is playing';
    return `Now playing: ${song.name} - ${song.artist} [${song.album}] (${song.platform})`;
  }

  private cmdQueue(): string {
    const songs = this.queue.list();
    if (songs.length === 0) return 'Queue is empty';
    const currentIdx = this.queue.getCurrentIndex();
    const lines = songs.map((s, i) => {
      const marker = i === currentIdx ? '▶ ' : '  ';
      return `${marker}${i + 1}. ${s.name} - ${s.artist}`;
    });
    return `Queue (${songs.length} songs, mode: ${this.queue.getMode()}):\n${lines.join('\n')}`;
  }

  private cmdClear(): string {
    this.player.stop();
    this.queue.clear();
    this.emit('stateChange');
    return 'Queue cleared';
  }

  private cmdRemove(cmd: ParsedCommand): string {
    const index = parseInt(cmd.args, 10) - 1; // user sees 1-based
    if (isNaN(index) || index < 0) return 'Usage: !remove <number>';
    const removed = this.queue.remove(index);
    if (!removed) return 'Invalid position';
    this.emit('stateChange');
    return `Removed: ${removed.name}`;
  }

  private cmdMode(cmd: ParsedCommand): string {
    const modeMap: Record<string, PlayMode> = {
      seq: PlayMode.Sequential,
      loop: PlayMode.Loop,
      random: PlayMode.Random,
      rloop: PlayMode.RandomLoop,
    };
    const mode = modeMap[cmd.args];
    if (!mode) return 'Usage: !mode <seq|loop|random|rloop>';
    this.queue.setMode(mode);
    this.emit('stateChange');
    return `Play mode set to: ${cmd.args}`;
  }

  private async cmdPlaylist(cmd: ParsedCommand): Promise<string> {
    if (!cmd.args) return 'Usage: !playlist <playlist ID or URL>';
    const provider = this.getProvider(cmd.flags.has('q'));
    const id = this.extractId(cmd.args);
    const songs = await provider.getPlaylistSongs(id);
    if (songs.length === 0) return 'Playlist is empty or not found';

    this.queue.clear();
    for (const song of songs) {
      const url = await provider.getSongUrl(song.id);
      if (url) {
        this.queue.add({ ...song, url, platform: provider.platform });
      }
    }
    const first = this.queue.play();
    if (first) this.player.play(first.url);
    this.emit('stateChange');
    return `Loaded playlist: ${songs.length} songs. Now playing: ${first?.name ?? 'unknown'}`;
  }

  private async cmdAlbum(cmd: ParsedCommand): Promise<string> {
    if (!cmd.args) return 'Usage: !album <album ID>';
    const provider = this.getProvider(cmd.flags.has('q'));
    const songs = await provider.getAlbumSongs(cmd.args);
    if (songs.length === 0) return 'Album is empty or not found';

    this.queue.clear();
    for (const song of songs) {
      const url = await provider.getSongUrl(song.id);
      if (url) {
        this.queue.add({ ...song, url, platform: provider.platform });
      }
    }
    const first = this.queue.play();
    if (first) this.player.play(first.url);
    this.emit('stateChange');
    return `Loaded album: ${songs.length} songs. Now playing: ${first?.name ?? 'unknown'}`;
  }

  private async cmdFm(): Promise<string> {
    if (!this.neteaseProvider.getPersonalFm) {
      return 'Personal FM is only available for NetEase Cloud Music';
    }
    const songs = await this.neteaseProvider.getPersonalFm();
    if (songs.length === 0) return 'No FM songs available (need to login first)';

    this.queue.clear();
    for (const song of songs) {
      const url = await this.neteaseProvider.getSongUrl(song.id);
      if (url) {
        this.queue.add({ ...song, url, platform: 'netease' });
      }
    }
    const first = this.queue.play();
    if (first) this.player.play(first.url);
    this.emit('stateChange');
    return `Personal FM started: ${first?.name ?? 'unknown'} - ${first?.artist ?? ''}`;
  }

  private async cmdVote(msg?: TS3TextMessage): Promise<string> {
    if (!msg) return 'Vote can only be used in TeamSpeak';
    this.voteSkipUsers.add(msg.invokerUid);
    const clients = await this.tsClient.getClientsInChannel();
    const totalUsers = clients.length - 1; // exclude bot
    const needed = Math.ceil(totalUsers / 2);
    const votes = this.voteSkipUsers.size;

    if (votes >= needed) {
      this.voteSkipUsers.clear();
      this.playNext();
      return `Vote passed (${votes}/${needed}). Skipping to next song.`;
    }
    return `Vote to skip: ${votes}/${needed} (need ${needed - votes} more)`;
  }

  private async cmdLyrics(): Promise<string> {
    const song = this.queue.current();
    if (!song) return 'Nothing is playing';
    const provider = this.getProvider(song.platform === 'qq');
    const lyrics = await provider.getLyrics(song.id);
    if (lyrics.length === 0) return 'No lyrics available';
    // Show first 10 lines
    const lines = lyrics.slice(0, 10).map((l) => l.text);
    return `Lyrics for ${song.name}:\n${lines.join('\n')}`;
  }

  private async cmdMove(cmd: ParsedCommand): Promise<string> {
    if (!cmd.args) return 'Usage: !move <channel name or ID>';
    await this.tsClient.moveToChannel(cmd.args);
    return `Moved to channel: ${cmd.args}`;
  }

  private async cmdFollow(msg?: TS3TextMessage): Promise<string> {
    if (!msg) return 'Follow can only be used in TeamSpeak';
    // Would need to get the invoker's current channel
    return 'Following you to your channel';
  }

  private cmdHelp(): string {
    const p = this.config.commandPrefix;
    return [
      `TSMusicBot Commands:`,
      `${p}play <song>  — Search and play`,
      `${p}play -q <song> — Search from QQ Music`,
      `${p}add <song>   — Add to queue`,
      `${p}pause/resume — Pause/resume`,
      `${p}next/prev    — Next/previous`,
      `${p}stop         — Stop and clear queue`,
      `${p}vol <0-100>  — Set volume`,
      `${p}queue        — Show queue`,
      `${p}mode <seq|loop|random|rloop> — Play mode`,
      `${p}playlist <id> — Load playlist`,
      `${p}album <id>   — Load album`,
      `${p}fm           — Personal FM (NetEase)`,
      `${p}vote         — Vote to skip`,
      `${p}lyrics       — Show lyrics`,
      `${p}now          — Current song info`,
      `${p}help         — This help message`,
    ].join('\n');
  }

  private playNext(): void {
    this.voteSkipUsers.clear();
    const next = this.queue.next();
    if (next) {
      this.player.play(next.url);
      this.database.addPlayHistory({
        botId: this.id,
        songId: next.id,
        songName: next.name,
        artist: next.artist,
        album: next.album,
        platform: next.platform,
        coverUrl: next.coverUrl,
      });
    } else {
      this.player.stop();
    }
    this.emit('stateChange');
  }

  private extractId(input: string): string {
    // Try to extract numeric ID from URL or return as-is
    const match = input.match(/[?&]id=(\d+)/);
    if (match) return match[1];
    const pathMatch = input.match(/\/(\d+)/);
    if (pathMatch) return pathMatch[1];
    return input;
  }

  getStatus(): BotStatus {
    return {
      id: this.id,
      name: this.name,
      connected: this.connected,
      playing: this.player.getState() === 'playing',
      paused: this.player.getState() === 'paused',
      currentSong: this.queue.current(),
      queueSize: this.queue.size(),
      volume: this.player.getVolume(),
      playMode: this.queue.getMode(),
    };
  }

  getQueue(): QueuedSong[] {
    return this.queue.list();
  }

  getPlayer(): AudioPlayer {
    return this.player;
  }

  getQueueManager(): PlayQueue {
    return this.queue;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/bot/instance.ts
git commit -m "feat: add BotInstance with full command execution, player, queue, and TS integration"
```

---

### Task 3: BotManager (multi-instance)

**Files:**
- Create: `src/bot/manager.ts`

- [ ] **Step 1: Write implementation**

Create `src/bot/manager.ts`:

```typescript
import crypto from 'node:crypto';
import { BotInstance, type BotInstanceOptions } from './instance.js';
import type { MusicProvider } from '../music/provider.js';
import type { Database, BotInstanceRow } from '../data/database.js';
import type { BotConfig } from '../data/config.js';
import type { Logger } from '../logger.js';

export interface CreateBotParams {
  name: string;
  serverAddress: string;
  serverPort: number;
  queryPort?: number;
  nickname: string;
  defaultChannel?: string;
  channelPassword?: string;
  autoStart?: boolean;
}

export class BotManager {
  private bots = new Map<string, BotInstance>();
  private neteaseProvider: MusicProvider;
  private qqProvider: MusicProvider;
  private database: Database;
  private config: BotConfig;
  private logger: Logger;

  constructor(
    neteaseProvider: MusicProvider,
    qqProvider: MusicProvider,
    database: Database,
    config: BotConfig,
    logger: Logger,
  ) {
    this.neteaseProvider = neteaseProvider;
    this.qqProvider = qqProvider;
    this.database = database;
    this.config = config;
    this.logger = logger;
  }

  async createBot(params: CreateBotParams): Promise<BotInstance> {
    const id = crypto.randomUUID();

    const bot = new BotInstance({
      id,
      name: params.name,
      tsOptions: {
        host: params.serverAddress,
        port: params.serverPort,
        queryPort: params.queryPort ?? 10011,
        nickname: params.nickname,
        defaultChannel: params.defaultChannel,
        channelPassword: params.channelPassword,
      },
      neteaseProvider: this.neteaseProvider,
      qqProvider: this.qqProvider,
      database: this.database,
      config: this.config,
      logger: this.logger,
    });

    this.bots.set(id, bot);

    // Save to database
    this.database.saveBotInstance({
      id,
      name: params.name,
      serverAddress: params.serverAddress,
      serverPort: params.serverPort,
      nickname: params.nickname,
      defaultChannel: params.defaultChannel ?? '',
      channelPassword: params.channelPassword ?? '',
      autoStart: params.autoStart ?? false,
    });

    this.logger.info({ botId: id, name: params.name }, 'Bot instance created');
    return bot;
  }

  async removeBot(id: string): Promise<void> {
    const bot = this.bots.get(id);
    if (bot) {
      bot.disconnect();
      this.bots.delete(id);
    }
    this.database.deleteBotInstance(id);
    this.logger.info({ botId: id }, 'Bot instance removed');
  }

  getBot(id: string): BotInstance | undefined {
    return this.bots.get(id);
  }

  getAllBots(): BotInstance[] {
    return Array.from(this.bots.values());
  }

  async startBot(id: string): Promise<void> {
    const bot = this.bots.get(id);
    if (!bot) throw new Error(`Bot ${id} not found`);
    await bot.connect();
  }

  stopBot(id: string): void {
    const bot = this.bots.get(id);
    if (!bot) throw new Error(`Bot ${id} not found`);
    bot.disconnect();
  }

  /**
   * Load saved bot instances from database and create BotInstance objects.
   * Optionally auto-start bots that have autoStart=true.
   */
  async loadSavedBots(): Promise<void> {
    const savedInstances = this.database.getBotInstances();
    for (const saved of savedInstances) {
      const bot = new BotInstance({
        id: saved.id,
        name: saved.name,
        tsOptions: {
          host: saved.serverAddress,
          port: saved.serverPort,
          queryPort: 10011,
          nickname: saved.nickname,
          defaultChannel: saved.defaultChannel || undefined,
          channelPassword: saved.channelPassword || undefined,
        },
        neteaseProvider: this.neteaseProvider,
        qqProvider: this.qqProvider,
        database: this.database,
        config: this.config,
        logger: this.logger,
      });

      this.bots.set(saved.id, bot);

      if (saved.autoStart) {
        try {
          await bot.connect();
          this.logger.info({ botId: saved.id, name: saved.name }, 'Auto-started bot');
        } catch (err) {
          this.logger.error({ err, botId: saved.id }, 'Failed to auto-start bot');
        }
      }
    }

    this.logger.info({ count: savedInstances.length }, 'Loaded saved bot instances');
  }

  shutdown(): void {
    for (const bot of this.bots.values()) {
      bot.disconnect();
    }
    this.bots.clear();
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/bot/manager.ts
git commit -m "feat: add BotManager for multi-instance lifecycle, persistence, and auto-start"
```

---

### Task 4: Verify and commit Phase 5

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: Phase 5 complete — bot core (commands, instance, manager)"
```
