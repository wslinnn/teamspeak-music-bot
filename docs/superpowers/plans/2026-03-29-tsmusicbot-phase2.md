# TSMusicBot Phase 2: TeamSpeak 3 Protocol Layer

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a TS3 client protocol layer that can connect to a TeamSpeak server (without encryption), authenticate, join a channel, send/receive text messages, and send Opus voice data over UDP.

**Architecture:** The protocol layer lives in `src/ts-protocol/`. It implements the TS3 client protocol: TCP for commands (login, channel ops, text messages) and UDP for voice packets. No encryption. The `TS3Client` class provides a high-level EventEmitter-based API for the rest of the application.

**Tech Stack:** Node.js net/dgram modules, tweetnacl (Ed25519 identity), vitest

**Reference:** TeamSpeak 3 protocol documentation and Splamy/TSLib (C#) source code for packet structures and handshake flow.

---

### Task 1: TS3 Identity generation

**Files:**
- Create: `src/ts-protocol/identity.ts`
- Create: `src/ts-protocol/identity.test.ts`

- [ ] **Step 1: Install tweetnacl**

```bash
npm install tweetnacl
npm install -D @types/tweetnacl
```

- [ ] **Step 2: Write the failing test**

Create `src/ts-protocol/identity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateIdentity, exportIdentity, importIdentity } from './identity.js';

describe('TS3 Identity', () => {
  it('generates a valid identity with keypair', () => {
    const identity = generateIdentity();
    expect(identity.publicKey).toBeInstanceOf(Uint8Array);
    expect(identity.privateKey).toBeInstanceOf(Uint8Array);
    expect(identity.publicKey.length).toBe(32);
    expect(identity.privateKey.length).toBe(64);
    expect(identity.uid).toBeTruthy();
    expect(typeof identity.uid).toBe('string');
  });

  it('exports and imports identity consistently', () => {
    const identity = generateIdentity();
    const exported = exportIdentity(identity);
    const imported = importIdentity(exported);
    expect(imported.uid).toBe(identity.uid);
    expect(imported.publicKey).toEqual(identity.publicKey);
  });

  it('generates unique identities each time', () => {
    const id1 = generateIdentity();
    const id2 = generateIdentity();
    expect(id1.uid).not.toBe(id2.uid);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/ts-protocol/identity.test.ts`
Expected: FAIL with "cannot find module"

- [ ] **Step 4: Write implementation**

Create `src/ts-protocol/identity.ts`:

```typescript
import nacl from 'tweetnacl';
import crypto from 'node:crypto';

export interface TS3Identity {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
  uid: string; // base64-encoded SHA1 of public key
}

export function generateIdentity(): TS3Identity {
  const keypair = nacl.sign.keyPair();
  const uid = computeUid(keypair.publicKey);
  return {
    publicKey: keypair.publicKey,
    privateKey: keypair.secretKey,
    uid,
  };
}

export function computeUid(publicKey: Uint8Array): string {
  const hash = crypto.createHash('sha1').update(publicKey).digest('base64');
  return hash;
}

export function exportIdentity(identity: TS3Identity): string {
  return JSON.stringify({
    publicKey: Buffer.from(identity.publicKey).toString('base64'),
    privateKey: Buffer.from(identity.privateKey).toString('base64'),
  });
}

export function importIdentity(data: string): TS3Identity {
  const parsed = JSON.parse(data) as { publicKey: string; privateKey: string };
  const publicKey = new Uint8Array(Buffer.from(parsed.publicKey, 'base64'));
  const privateKey = new Uint8Array(Buffer.from(parsed.privateKey, 'base64'));
  const uid = computeUid(publicKey);
  return { publicKey, privateKey, uid };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/ts-protocol/identity.test.ts`
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/ts-protocol/identity.ts src/ts-protocol/identity.test.ts package.json package-lock.json
git commit -m "feat: add TS3 identity generation with Ed25519 keypairs"
```

---

### Task 2: TS3 Command encoding/decoding

**Files:**
- Create: `src/ts-protocol/commands.ts`
- Create: `src/ts-protocol/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/ts-protocol/commands.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { encodeCommand, decodeResponse, escapeValue, unescapeValue } from './commands.js';

describe('TS3 Commands', () => {
  it('encodes a simple command', () => {
    const encoded = encodeCommand('login', { client_login_name: 'bot', client_login_password: 'pass' });
    expect(encoded).toBe('login client_login_name=bot client_login_password=pass\n');
  });

  it('escapes special characters in values', () => {
    expect(escapeValue('hello world')).toBe('hello\\sworld');
    expect(escapeValue('foo|bar')).toBe('foo\\pbar');
    expect(escapeValue('a/b')).toBe('a\\/b');
    expect(escapeValue('line\nnew')).toBe('line\\nnew');
  });

  it('unescapes special characters', () => {
    expect(unescapeValue('hello\\sworld')).toBe('hello world');
    expect(unescapeValue('foo\\pbar')).toBe('foo|bar');
    expect(unescapeValue('a\\/b')).toBe('a/b');
  });

  it('decodes a single response', () => {
    const response = 'virtualserver_name=My\\sServer virtualserver_port=9987';
    const result = decodeResponse(response);
    expect(result).toHaveLength(1);
    expect(result[0].virtualserver_name).toBe('My Server');
    expect(result[0].virtualserver_port).toBe('9987');
  });

  it('decodes a piped multi-entry response', () => {
    const response = 'clid=1 client_nickname=User1|clid=2 client_nickname=User2';
    const result = decodeResponse(response);
    expect(result).toHaveLength(2);
    expect(result[0].client_nickname).toBe('User1');
    expect(result[1].client_nickname).toBe('User2');
  });

  it('handles command with no params', () => {
    const encoded = encodeCommand('quit', {});
    expect(encoded).toBe('quit\n');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/ts-protocol/commands.test.ts`
Expected: FAIL

- [ ] **Step 3: Write implementation**

Create `src/ts-protocol/commands.ts`:

```typescript
const ESCAPE_MAP: [string, string][] = [
  ['\\', '\\\\'],
  ['/', '\\/'],
  [' ', '\\s'],
  ['|', '\\p'],
  ['\n', '\\n'],
  ['\r', '\\r'],
  ['\t', '\\t'],
  ['\x07', '\\a'], // bell
  ['\x08', '\\b'], // backspace
  ['\x0C', '\\f'], // form feed
  ['\x0B', '\\v'], // vertical tab
];

const UNESCAPE_MAP: [string, string][] = ESCAPE_MAP.map(([plain, escaped]) => [escaped, plain]).reverse();

export function escapeValue(value: string): string {
  let result = value;
  for (const [plain, escaped] of ESCAPE_MAP) {
    result = result.replaceAll(plain, escaped);
  }
  return result;
}

export function unescapeValue(value: string): string {
  let result = value;
  for (const [escaped, plain] of UNESCAPE_MAP) {
    result = result.replaceAll(escaped, plain);
  }
  return result;
}

export function encodeCommand(command: string, params: Record<string, string | number>): string {
  const parts = [command];
  for (const [key, value] of Object.entries(params)) {
    parts.push(`${key}=${escapeValue(String(value))}`);
  }
  return parts.join(' ') + '\n';
}

export function decodeResponse(raw: string): Record<string, string>[] {
  const entries = raw.split('|');
  return entries.map((entry) => {
    const result: Record<string, string> = {};
    const pairs = entry.trim().split(' ');
    for (const pair of pairs) {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) {
        result[pair] = '';
      } else {
        const key = pair.substring(0, eqIndex);
        const value = unescapeValue(pair.substring(eqIndex + 1));
        result[key] = value;
      }
    }
    return result;
  });
}

export interface TS3Response {
  errorId: number;
  errorMessage: string;
  data: Record<string, string>[];
}

export function parseErrorLine(line: string): { id: number; msg: string } {
  const decoded = decodeResponse(line.replace(/^error\s+/, ''))[0];
  return {
    id: parseInt(decoded.id ?? '0', 10),
    msg: decoded.msg ?? 'ok',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/ts-protocol/commands.test.ts`
Expected: 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/ts-protocol/commands.ts src/ts-protocol/commands.test.ts
git commit -m "feat: add TS3 command encoding/decoding with escape handling"
```

---

### Task 3: TCP Connection (ServerQuery-style command channel)

**Files:**
- Create: `src/ts-protocol/connection.ts`

- [ ] **Step 1: Write implementation**

Create `src/ts-protocol/connection.ts`:

```typescript
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { encodeCommand, decodeResponse, parseErrorLine } from './commands.js';

export interface ConnectionOptions {
  host: string;
  port: number; // ServerQuery port, typically 10011
}

export interface CommandResult {
  errorId: number;
  errorMessage: string;
  data: Record<string, string>[];
}

/**
 * TCP connection to TeamSpeak 3 server.
 * Handles the ServerQuery text protocol for command/control operations.
 * Voice data is handled separately via UDP (see voice.ts).
 */
export class TS3Connection extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = '';
  private commandQueue: Array<{
    resolve: (result: CommandResult) => void;
    reject: (err: Error) => void;
  }> = [];
  private connected = false;
  private responseLines: string[] = [];

  constructor(private options: ConnectionOptions) {
    super();
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.options.port, this.options.host, () => {
        this.connected = true;
        resolve();
      });

      this.socket.setEncoding('utf-8');
      this.socket.on('data', (data: string) => this.handleData(data));
      this.socket.on('error', (err) => {
        if (!this.connected) {
          reject(err);
        }
        this.emit('error', err);
      });
      this.socket.on('close', () => {
        this.connected = false;
        this.emit('close');
      });
    });
  }

  private handleData(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n\r');

    // Keep the incomplete last part in buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Skip welcome messages (TS3 banner)
      if (trimmed.startsWith('TS3') || trimmed.startsWith('Welcome')) continue;

      // Notifications start with "notify"
      if (trimmed.startsWith('notify')) {
        this.handleNotification(trimmed);
        continue;
      }

      // Error line completes a command response
      if (trimmed.startsWith('error ')) {
        const error = parseErrorLine(trimmed);
        const pending = this.commandQueue.shift();
        if (pending) {
          pending.resolve({
            errorId: error.id,
            errorMessage: error.msg,
            data: this.responseLines.length > 0
              ? decodeResponse(this.responseLines.join('\n'))
              : [],
          });
        }
        this.responseLines = [];
        continue;
      }

      // Data line (part of command response)
      this.responseLines.push(trimmed);
    }
  }

  private handleNotification(line: string): void {
    // Extract notification name: "notifytextmessage" -> "textmessage"
    const spaceIndex = line.indexOf(' ');
    const notifyPart = spaceIndex === -1 ? line : line.substring(0, spaceIndex);
    const eventName = notifyPart.replace(/^notify/, '');
    const data = spaceIndex === -1 ? {} : decodeResponse(line.substring(spaceIndex + 1))[0];
    this.emit('notify', eventName, data);
    this.emit(`notify:${eventName}`, data);
  }

  async send(command: string, params: Record<string, string | number> = {}): Promise<CommandResult> {
    if (!this.socket || !this.connected) {
      throw new Error('Not connected');
    }

    const encoded = encodeCommand(command, params);

    return new Promise((resolve, reject) => {
      this.commandQueue.push({ resolve, reject });
      this.socket!.write(encoded);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
      this.connected = false;
    }
  }

  isConnected(): boolean {
    return this.connected;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ts-protocol/connection.ts
git commit -m "feat: add TCP connection with command queue and notification handling"
```

---

### Task 4: UDP Voice channel

**Files:**
- Create: `src/ts-protocol/voice.ts`

- [ ] **Step 1: Write implementation**

Create `src/ts-protocol/voice.ts`:

```typescript
import dgram from 'node:dgram';
import { EventEmitter } from 'node:events';

/**
 * TS3 voice packet structure (simplified, no encryption):
 *
 * Header (variable):
 *   - packetId: uint16 (2 bytes)
 *   - clientId: uint16 (2 bytes) — assigned by server after login
 *   - packetType: uint8 (1 byte) — 0=voice, 1=voice_whisper, etc.
 *   - flags: uint8 (1 byte)
 *
 * Payload:
 *   - codec: uint8 (1 byte) — 4 = Opus Voice, 5 = Opus Music
 *   - audioData: Opus-encoded frame
 */

export interface VoiceOptions {
  host: string;
  port: number; // same as virtual server port, typically 9987
}

export const CODEC_OPUS_VOICE = 4;
export const CODEC_OPUS_MUSIC = 5;

export class VoiceConnection extends EventEmitter {
  private socket: dgram.Socket | null = null;
  private packetCounter = 0;
  private clientId = 0;

  constructor(private options: VoiceOptions) {
    super();
  }

  setClientId(id: number): void {
    this.clientId = id;
  }

  async connect(): Promise<void> {
    return new Promise((resolve) => {
      this.socket = dgram.createSocket('udp4');

      this.socket.on('message', (msg) => {
        this.emit('voiceData', msg);
      });

      this.socket.on('error', (err) => {
        this.emit('error', err);
      });

      // UDP is connectionless, but we "connect" to set default destination
      this.socket.connect(this.options.port, this.options.host, () => {
        resolve();
      });
    });
  }

  /**
   * Send an Opus-encoded audio frame to the TS3 server.
   * Frame should be 20ms of Opus-encoded audio (48kHz, mono or stereo).
   */
  sendVoicePacket(opusData: Buffer, codec: number = CODEC_OPUS_MUSIC): void {
    if (!this.socket) return;

    const packetId = this.packetCounter++;
    if (this.packetCounter > 0xFFFF) this.packetCounter = 0;

    // Build packet header
    const header = Buffer.alloc(5);
    header.writeUInt16BE(packetId, 0);     // packet id
    header.writeUInt16BE(this.clientId, 2); // client id
    header.writeUInt8(codec, 4);            // codec type

    const packet = Buffer.concat([header, opusData]);
    this.socket.send(packet);
  }

  /**
   * Send a keepalive/ping packet to maintain the UDP connection.
   */
  sendKeepAlive(): void {
    if (!this.socket) return;
    const ping = Buffer.alloc(4);
    ping.writeUInt16BE(this.packetCounter++, 0);
    ping.writeUInt16BE(this.clientId, 2);
    if (this.packetCounter > 0xFFFF) this.packetCounter = 0;
    this.socket.send(ping);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ts-protocol/voice.ts
git commit -m "feat: add UDP voice connection for sending Opus audio packets"
```

---

### Task 5: High-level TS3 Client

**Files:**
- Create: `src/ts-protocol/client.ts`

- [ ] **Step 1: Write implementation**

Create `src/ts-protocol/client.ts`:

```typescript
import { EventEmitter } from 'node:events';
import { TS3Connection, type CommandResult } from './connection.js';
import { VoiceConnection, CODEC_OPUS_MUSIC } from './voice.js';
import { generateIdentity, importIdentity, exportIdentity, type TS3Identity } from './identity.js';
import type { Logger } from '../logger.js';

export interface TS3ClientOptions {
  host: string;
  port: number;            // Voice/virtual server port (default 9987)
  queryPort: number;       // ServerQuery port (default 10011)
  nickname: string;
  identity?: string;       // Exported identity JSON, or undefined to generate new
  defaultChannel?: string;
  channelPassword?: string;
}

export interface TS3TextMessage {
  invokerName: string;
  invokerId: string;
  invokerUid: string;
  message: string;
  targetMode: number; // 1=private, 2=channel, 3=server
}

export class TS3Client extends EventEmitter {
  private connection: TS3Connection;
  private voice: VoiceConnection;
  private identity: TS3Identity;
  private clientId = 0;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private logger: Logger;

  constructor(private options: TS3ClientOptions, logger: Logger) {
    super();
    this.logger = logger;

    this.connection = new TS3Connection({
      host: options.host,
      port: options.queryPort,
    });

    this.voice = new VoiceConnection({
      host: options.host,
      port: options.port,
    });

    if (options.identity) {
      this.identity = importIdentity(options.identity);
    } else {
      this.identity = generateIdentity();
    }
  }

  async connect(): Promise<void> {
    this.logger.info({ host: this.options.host, port: this.options.port }, 'Connecting to TeamSpeak server');

    // Connect TCP (ServerQuery)
    await this.connection.connect();
    this.logger.debug('TCP connection established');

    // Select virtual server by port
    await this.sendCommand('use', { port: this.options.port });

    // Login with client nickname
    const loginResult = await this.sendCommand('clientupdate', {
      client_nickname: this.options.nickname,
    });

    // Get own client ID
    const whoami = await this.sendCommand('whoami', {});
    if (whoami.data.length > 0) {
      this.clientId = parseInt(whoami.data[0].client_id ?? '0', 10);
      this.logger.info({ clientId: this.clientId }, 'Logged in');
    }

    // Join default channel if specified
    if (this.options.defaultChannel) {
      await this.joinChannel(this.options.defaultChannel, this.options.channelPassword);
    }

    // Connect UDP voice
    await this.voice.connect();
    this.voice.setClientId(this.clientId);
    this.logger.debug('UDP voice connection established');

    // Register for text message notifications
    await this.sendCommand('servernotifyregister', { event: 'textchannel' });
    await this.sendCommand('servernotifyregister', { event: 'textprivate' });

    // Listen for text messages
    this.connection.on('notify:textmessage', (data: Record<string, string>) => {
      const msg: TS3TextMessage = {
        invokerName: data.invokername ?? '',
        invokerId: data.invokerid ?? '',
        invokerUid: data.invokeruid ?? '',
        message: data.msg ?? '',
        targetMode: parseInt(data.targetmode ?? '0', 10),
      };
      this.emit('textMessage', msg);
    });

    // Start keepalive
    this.keepAliveInterval = setInterval(() => {
      this.voice.sendKeepAlive();
    }, 5000);

    this.connection.on('close', () => {
      this.logger.warn('Connection closed');
      this.emit('disconnected');
    });

    this.emit('connected');
  }

  async sendCommand(command: string, params: Record<string, string | number>): Promise<CommandResult> {
    return this.connection.send(command, params);
  }

  async joinChannel(channelName: string, password?: string): Promise<void> {
    // Find channel by name
    const channels = await this.sendCommand('channellist', {});
    const channel = channels.data.find(
      (ch) => ch.channel_name === channelName
    );

    if (!channel) {
      this.logger.warn({ channelName }, 'Channel not found');
      return;
    }

    const params: Record<string, string | number> = {
      cid: channel.cid,
      clid: this.clientId,
    };
    if (password) {
      params.cpw = password;
    }

    await this.sendCommand('clientmove', params);
    this.logger.info({ channelName, cid: channel.cid }, 'Joined channel');
  }

  async moveToChannel(channelNameOrId: string, password?: string): Promise<void> {
    await this.joinChannel(channelNameOrId, password);
  }

  async sendTextMessage(message: string, targetMode: number = 2): Promise<void> {
    // targetMode: 1=private, 2=channel, 3=server
    await this.sendCommand('sendtextmessage', {
      targetmode: targetMode,
      target: targetMode === 2 ? 0 : this.clientId, // 0 = current channel for mode 2
      msg: message,
    });
  }

  async getClientsInChannel(): Promise<Record<string, string>[]> {
    const result = await this.sendCommand('clientlist', {});
    return result.data;
  }

  sendVoiceData(opusFrame: Buffer): void {
    this.voice.sendVoicePacket(opusFrame, CODEC_OPUS_MUSIC);
  }

  getIdentityExport(): string {
    return exportIdentity(this.identity);
  }

  getClientId(): number {
    return this.clientId;
  }

  disconnect(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    this.connection.disconnect();
    this.voice.disconnect();
    this.logger.info('Disconnected from TeamSpeak server');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/ts-protocol/client.ts
git commit -m "feat: add high-level TS3Client with connect, channel, text message, and voice API"
```

---

### Task 6: Verify TypeScript compilation

- [ ] **Step 1: Run tsc**

Run: `npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (identity: 3, commands: 6, config: 3, database: 4 = 16 tests)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: Phase 2 complete — TS3 protocol layer (identity, commands, TCP, UDP, client)"
```
