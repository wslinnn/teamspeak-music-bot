# TSMusicBot Phase 1: Project Scaffold, Data Layer & Config

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Set up the project from scratch with TypeScript, build tooling, data layer (SQLite + JSON config), and logger — producing a runnable `npm start` that boots and logs "TSMusicBot started".

**Architecture:** Monorepo with backend (`src/`) and frontend (`web/`). This phase focuses on backend scaffold only. Express server serves a placeholder page. Data layer uses better-sqlite3 for structured data and JSON files for user-editable config.

**Tech Stack:** Node.js 20, TypeScript 5, Express 4, better-sqlite3, pino, vitest

---

### Task 1: Initialize project and install dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

- [ ] **Step 1: Initialize git repo**

```bash
cd "/c/Users/saopig1/Music/teamspeak music bot"
git init
```

- [ ] **Step 2: Create package.json**

```bash
npm init -y
```

Then edit `package.json`:

```json
{
  "name": "tsmusicbot",
  "version": "0.1.0",
  "description": "TeamSpeak music bot with NetEase Cloud Music and QQ Music support",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "license": "MIT"
}
```

- [ ] **Step 3: Install dependencies**

```bash
npm install express ws better-sqlite3 pino
npm install -D typescript tsx vitest @types/node @types/express @types/better-sqlite3 @types/ws
```

- [ ] **Step 4: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "web"]
}
```

- [ ] **Step 5: Create .gitignore**

```
node_modules/
dist/
data/
*.db
.env
.superpowers/
```

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore package-lock.json
git commit -m "chore: initialize project with TypeScript and dependencies"
```

---

### Task 2: Config module (JSON-based)

**Files:**
- Create: `src/data/config.ts`
- Create: `src/data/config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/config.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, saveConfig, getDefaultConfig } from './config.js';

const TEST_CONFIG_PATH = path.join(import.meta.dirname, '../../test-config.json');

describe('Config', () => {
  afterEach(() => {
    if (fs.existsSync(TEST_CONFIG_PATH)) {
      fs.unlinkSync(TEST_CONFIG_PATH);
    }
  });

  it('returns default config when file does not exist', () => {
    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config.webPort).toBe(3000);
    expect(config.locale).toBe('zh');
    expect(config.theme).toBe('dark');
    expect(config.commandPrefix).toBe('!');
  });

  it('creates config file on save', () => {
    const config = getDefaultConfig();
    config.webPort = 8080;
    saveConfig(TEST_CONFIG_PATH, config);
    expect(fs.existsSync(TEST_CONFIG_PATH)).toBe(true);

    const loaded = loadConfig(TEST_CONFIG_PATH);
    expect(loaded.webPort).toBe(8080);
  });

  it('merges partial config with defaults', () => {
    fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify({ webPort: 9000 }));
    const config = loadConfig(TEST_CONFIG_PATH);
    expect(config.webPort).toBe(9000);
    expect(config.locale).toBe('zh'); // default preserved
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/config.test.ts`
Expected: FAIL with "cannot find module './config.js'"

- [ ] **Step 3: Write implementation**

Create `src/data/config.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';

export interface BotConfig {
  webPort: number;
  locale: 'zh' | 'en';
  theme: 'dark' | 'light';
  commandPrefix: string;
  commandAliases: Record<string, string>;
  neteaseApiPort: number;
  qqMusicApiPort: number;
  adminPassword: string;
  adminGroups: number[];
  autoReturnDelay: number; // seconds, 0 = disabled
  autoPauseOnEmpty: boolean;
}

export function getDefaultConfig(): BotConfig {
  return {
    webPort: 3000,
    locale: 'zh',
    theme: 'dark',
    commandPrefix: '!',
    commandAliases: {
      p: 'play',
      s: 'skip',
      n: 'next',
    },
    neteaseApiPort: 3001,
    qqMusicApiPort: 3002,
    adminPassword: '',
    adminGroups: [],
    autoReturnDelay: 300,
    autoPauseOnEmpty: true,
  };
}

export function loadConfig(configPath: string): BotConfig {
  const defaults = getDefaultConfig();
  if (!fs.existsSync(configPath)) {
    return defaults;
  }
  const raw = fs.readFileSync(configPath, 'utf-8');
  const partial = JSON.parse(raw) as Partial<BotConfig>;
  return { ...defaults, ...partial };
}

export function saveConfig(configPath: string, config: BotConfig): void {
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/config.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/config.ts src/data/config.test.ts
git commit -m "feat: add JSON config module with load/save/defaults"
```

---

### Task 3: Logger setup

**Files:**
- Create: `src/logger.ts`

- [ ] **Step 1: Create logger module**

Create `src/logger.ts`:

```typescript
import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';

export function createLogger(logDir?: string) {
  const targets: pino.TransportTargetOptions[] = [
    {
      target: 'pino/file',
      options: { destination: 1 }, // stdout
      level: 'info',
    },
  ];

  if (logDir) {
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    targets.push({
      target: 'pino/file',
      options: { destination: path.join(logDir, 'tsmusicbot.log') },
      level: 'debug',
    });
  }

  return pino({
    level: 'debug',
    transport: { targets },
  });
}

export type Logger = pino.Logger;
```

- [ ] **Step 2: Commit**

```bash
git add src/logger.ts
git commit -m "feat: add pino logger with file and stdout transports"
```

---

### Task 4: Database module (SQLite)

**Files:**
- Create: `src/data/database.ts`
- Create: `src/data/database.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/data/database.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { createDatabase, type Database } from './database.js';

const TEST_DB_PATH = ':memory:';

describe('Database', () => {
  let db: Database;

  beforeEach(() => {
    db = createDatabase(TEST_DB_PATH);
  });

  afterEach(() => {
    db.close();
  });

  it('creates tables on init', () => {
    const tables = db.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('play_history');
    expect(names).toContain('bot_instances');
  });

  it('records and retrieves play history', () => {
    db.addPlayHistory({
      botId: 'bot-1',
      songId: '12345',
      songName: '晴天',
      artist: '周杰伦',
      album: '叶惠美',
      platform: 'netease',
      coverUrl: 'https://example.com/cover.jpg',
    });

    const history = db.getPlayHistory('bot-1', 10);
    expect(history).toHaveLength(1);
    expect(history[0].songName).toBe('晴天');
    expect(history[0].platform).toBe('netease');
  });

  it('saves and loads bot instances', () => {
    db.saveBotInstance({
      id: 'bot-1',
      name: 'Music Bot',
      serverAddress: 'ts.example.com',
      serverPort: 9987,
      nickname: 'MusicBot',
      defaultChannel: '音乐频道',
      channelPassword: '',
      autoStart: true,
    });

    const instances = db.getBotInstances();
    expect(instances).toHaveLength(1);
    expect(instances[0].name).toBe('Music Bot');
    expect(instances[0].serverAddress).toBe('ts.example.com');
  });

  it('deletes bot instance', () => {
    db.saveBotInstance({
      id: 'bot-1',
      name: 'Music Bot',
      serverAddress: 'ts.example.com',
      serverPort: 9987,
      nickname: 'MusicBot',
      defaultChannel: '',
      channelPassword: '',
      autoStart: false,
    });

    db.deleteBotInstance('bot-1');
    expect(db.getBotInstances()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/data/database.test.ts`
Expected: FAIL with "cannot find module './database.js'"

- [ ] **Step 3: Write implementation**

Create `src/data/database.ts`:

```typescript
import BetterSqlite3 from 'better-sqlite3';

export interface PlayHistoryEntry {
  botId: string;
  songId: string;
  songName: string;
  artist: string;
  album: string;
  platform: 'netease' | 'qq';
  coverUrl: string;
}

export interface PlayHistoryRow extends PlayHistoryEntry {
  id: number;
  playedAt: string;
}

export interface BotInstanceRow {
  id: string;
  name: string;
  serverAddress: string;
  serverPort: number;
  nickname: string;
  defaultChannel: string;
  channelPassword: string;
  autoStart: boolean;
}

export interface Database {
  db: BetterSqlite3.Database;
  close(): void;
  addPlayHistory(entry: PlayHistoryEntry): void;
  getPlayHistory(botId: string, limit: number): PlayHistoryRow[];
  saveBotInstance(instance: BotInstanceRow): void;
  getBotInstances(): BotInstanceRow[];
  deleteBotInstance(id: string): void;
}

export function createDatabase(dbPath: string): Database {
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS play_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      botId TEXT NOT NULL,
      songId TEXT NOT NULL,
      songName TEXT NOT NULL,
      artist TEXT NOT NULL,
      album TEXT NOT NULL,
      platform TEXT NOT NULL,
      coverUrl TEXT NOT NULL,
      playedAt TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS bot_instances (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      serverAddress TEXT NOT NULL,
      serverPort INTEGER NOT NULL DEFAULT 9987,
      nickname TEXT NOT NULL,
      defaultChannel TEXT NOT NULL DEFAULT '',
      channelPassword TEXT NOT NULL DEFAULT '',
      autoStart INTEGER NOT NULL DEFAULT 0
    );
  `);

  const stmts = {
    insertHistory: db.prepare(`
      INSERT INTO play_history (botId, songId, songName, artist, album, platform, coverUrl)
      VALUES (@botId, @songId, @songName, @artist, @album, @platform, @coverUrl)
    `),
    getHistory: db.prepare(`
      SELECT * FROM play_history WHERE botId = ? ORDER BY playedAt DESC LIMIT ?
    `),
    upsertInstance: db.prepare(`
      INSERT OR REPLACE INTO bot_instances (id, name, serverAddress, serverPort, nickname, defaultChannel, channelPassword, autoStart)
      VALUES (@id, @name, @serverAddress, @serverPort, @nickname, @defaultChannel, @channelPassword, @autoStart)
    `),
    getInstances: db.prepare(`SELECT * FROM bot_instances`),
    deleteInstance: db.prepare(`DELETE FROM bot_instances WHERE id = ?`),
  };

  return {
    db,
    close() {
      db.close();
    },
    addPlayHistory(entry: PlayHistoryEntry) {
      stmts.insertHistory.run(entry);
    },
    getPlayHistory(botId: string, limit: number): PlayHistoryRow[] {
      return stmts.getHistory.all(botId, limit) as PlayHistoryRow[];
    },
    saveBotInstance(instance: BotInstanceRow) {
      stmts.upsertInstance.run({
        ...instance,
        autoStart: instance.autoStart ? 1 : 0,
      });
    },
    getBotInstances(): BotInstanceRow[] {
      const rows = stmts.getInstances.all() as (Omit<BotInstanceRow, 'autoStart'> & { autoStart: number })[];
      return rows.map((r) => ({ ...r, autoStart: r.autoStart === 1 }));
    },
    deleteBotInstance(id: string) {
      stmts.deleteInstance.run(id);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/data/database.test.ts`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/database.ts src/data/database.test.ts
git commit -m "feat: add SQLite database module with play history and bot instances"
```

---

### Task 5: Application entry point

**Files:**
- Create: `src/index.ts`

- [ ] **Step 1: Create the entry point**

Create `src/index.ts`:

```typescript
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, saveConfig, getDefaultConfig } from './data/config.js';
import { createDatabase } from './data/database.js';
import { createLogger } from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT_DIR, 'data');
const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
const DB_PATH = path.join(DATA_DIR, 'tsmusicbot.db');
const LOG_DIR = path.join(DATA_DIR, 'logs');

async function main() {
  // Load config
  const config = loadConfig(CONFIG_PATH);

  // Save config to ensure file exists with all defaults
  saveConfig(CONFIG_PATH, config);

  // Create logger
  const logger = createLogger(LOG_DIR);

  // Create database
  const db = createDatabase(DB_PATH);

  logger.info({ webPort: config.webPort }, 'TSMusicBot started');

  // Graceful shutdown
  const shutdown = () => {
    logger.info('Shutting down...');
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the application**

Run: `npx tsx src/index.ts`
Expected: Log output containing "TSMusicBot started", then `data/` directory is created with `tsmusicbot.db` and `logs/`, and `config.json` is created at root.

- [ ] **Step 3: Verify files were created**

Run: `ls data/ && cat config.json`
Expected: `tsmusicbot.db`, `logs/` directory exist. `config.json` contains default config with `webPort: 3000`.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat: add application entry point with config, database, and logger initialization"
```

---

### Task 6: Run all tests and verify clean build

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (7 tests across 2 files)

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Final commit for Phase 1**

```bash
git add -A
git commit -m "chore: Phase 1 complete — project scaffold, config, database, logger"
```
