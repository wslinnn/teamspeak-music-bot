import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { TS3Client, type TS3VoiceSendFailure } from "./client.js";
import type { Logger } from "../logger.js";

/**
 * Voice-send failure lifecycle.
 *
 * The SDK client is replaced wholesale through the `sdkClientFactory` test
 * seam, so these tests exercise the REAL TS3Client state machine (failure
 * timers, first/terminal events, sanitisation) without opening a socket or
 * depending on the SDK's private internals — which changed shape in 1.0.
 */

type Failure = TS3VoiceSendFailure;

/** Minimal stand-in for the SDK client: just what TS3Client touches. */
class FakeSdk extends EventEmitter {
  clientID = 42;
  channelID = 1n;
  session = 1;
  sendVoice = vi.fn((_data: Uint8Array, _codec: number) => {});
  connect = vi.fn(async () => {});
  disconnect = vi.fn(async () => {});
  exec = vi.fn(async () => [] as Record<string, string>[]);
  execNoWait = vi.fn(async () => {});
  uploadFileData = vi.fn(async () => {});
  /** Simulate the SDK reporting a dropped connection. */
  dropConnection(): void {
    this.emit("disconnected", new Error("synthetic connection loss"));
  }
}

type Harness = { client: FakeSdk | null; voiceFramesSent: number };

describe("TS3Client voice send failure lifecycle", () => {
  let client: TS3Client;
  let sdk: FakeSdk;
  let logger: Logger;
  let records: Array<{ level: string; args: unknown[] }>;
  let connectGate: { wait: Promise<void>; open: () => void } | null;
  let cancelledHandshake: boolean;

  function makeClient(): TS3Client {
    sdk = new FakeSdk();
    if (connectGate) {
      sdk.connect = vi.fn(() => connectGate!.wait);
    }
    return new TS3Client(
      {
        host: "localhost",
        port: 9987,
        queryPort: 10011,
        nickname: "VoiceTest",
        serverProtocol: "ts3",
        sdkClientFactory: () => sdk as never,
      },
      logger,
    );
  }

  beforeEach(async () => {
    vi.useFakeTimers();
    connectGate = null;
    cancelledHandshake = false;
    sdk = new FakeSdk();
    records = [];
    const capture = (level: string) => (...args: unknown[]) => records.push({ level, args });
    logger = {
      info: capture("info"),
      warn: capture("warn"),
      error: capture("error"),
      debug() {},
      child() { return this; },
    } as unknown as Logger;
    client = makeClient();
    await client.connect();
    // Discard connection-scoped log lines: the assertions below are about the
    // voice-failure burst, not about connect().
    records.length = 0;
  });

  afterEach(async () => {
    client.disconnect();
    await vi.advanceTimersByTimeAsync(0);
    vi.restoreAllMocks();
    vi.useRealTimers();
    void cancelledHandshake;
  });

  it.each([false, true])("reports a sanitized first failure after earlier accepted send=%s without throwing", (acceptedFirst) => {
    if (acceptedFirst) client.sendVoiceData(Buffer.from([1]));
    const failures: Failure[] = [];
    client.on("voiceSendFailure", (event) => failures.push(event));
    sdk.sendVoice.mockImplementation(() => {
      throw Object.assign(new Error("https://user:password@host/?token=credential-secret"), {
        code: "ERR_SOCKET_DGRAM_NOT_RUNNING",
        spawnargs: ["credential-secret"],
      });
    });

    let result: unknown;
    expect(() => {
      result = client.sendVoiceData(Buffer.from([2]));
    }).not.toThrow();
    expect(result).toBe("retrying");
    expect(failures).toEqual([
      { code: "ERR_SOCKET_DGRAM_NOT_RUNNING", consecutiveFailures: 1, durationMs: 0 },
    ]);
    expect((client as unknown as Harness).voiceFramesSent).toBe(acceptedFirst ? 1 : 0);
    expect(records.filter((record) => record.level === "warn")).toHaveLength(1);
    expect(JSON.stringify(records)).not.toContain("password");
    expect(JSON.stringify(records)).not.toContain("credential-secret");
  });

  it.each([
    { code: "credential-secret", message: "credential-secret" },
    "credential-secret",
  ])("omits untrusted error codes and primitive error text: %s", (error) => {
    const failures: Failure[] = [];
    client.on("voiceSendFailure", (event) => failures.push(event));
    sdk.sendVoice.mockImplementation(() => {
      throw error;
    });
    client.sendVoiceData(Buffer.from([1]));
    expect(failures).toEqual([{ consecutiveFailures: 1, durationMs: 0 }]);
    expect(JSON.stringify(records)).not.toContain("credential-secret");
  });

  it("emits one recovery and cancels terminal failure when the next send succeeds", async () => {
    const recovered: Failure[] = [];
    const terminal: Failure[] = [];
    client.on("voiceSendRecovered", (event) => recovered.push(event));
    client.on("voiceSendFailed", (event) => terminal.push(event));
    sdk.sendVoice.mockImplementation(() => {
      throw { code: "ENOBUFS" };
    });
    client.sendVoiceData(Buffer.from([1]));
    await vi.advanceTimersByTimeAsync(20);
    sdk.sendVoice.mockImplementation(() => {});
    expect(client.sendVoiceData(Buffer.from([2]))).toBe("accepted");
    client.sendVoiceData(Buffer.from([3]));
    await vi.advanceTimersByTimeAsync(3000);
    expect(recovered).toEqual([{ code: "ENOBUFS", consecutiveFailures: 1, durationMs: 20 }]);
    expect(terminal).toEqual([]);
    expect((client as unknown as Harness).voiceFramesSent).toBe(2);
  });

  it("bounds persistent failure reporting to one first event and one terminal event per burst", async () => {
    const first: Failure[] = [];
    const terminal: Failure[] = [];
    client.on("voiceSendFailure", (event) => first.push(event));
    client.on("voiceSendFailed", (event) => terminal.push(event));
    sdk.sendVoice.mockImplementation(() => {
      throw { code: "ERR_SOCKET_DGRAM_NOT_RUNNING" };
    });
    for (let i = 0; i < 100; i++) {
      client.sendVoiceData(Buffer.from([1]));
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(first).toHaveLength(1);
    expect(terminal).toEqual([
      { code: "ERR_SOCKET_DGRAM_NOT_RUNNING", consecutiveFailures: 100, durationMs: 2000 },
    ]);
    for (let i = 0; i < 100; i++) expect(client.sendVoiceData(Buffer.from([1]))).toBe("failed");
    await vi.advanceTimersByTimeAsync(10000);
    expect(terminal).toHaveLength(1);
    expect(
      records.filter((record) => ["warn", "error"].includes(record.level)).length,
    ).toBeLessThanOrEqual(2);
    expect((client as unknown as Harness).voiceFramesSent).toBe(0);
  });

  it("recovers after the terminal event and allows a fresh failure burst", async () => {
    const first: Failure[] = [];
    const recovered: Failure[] = [];
    const terminal: Failure[] = [];
    client.on("voiceSendFailure", (event) => first.push(event));
    client.on("voiceSendRecovered", (event) => recovered.push(event));
    client.on("voiceSendFailed", (event) => terminal.push(event));
    sdk.sendVoice.mockImplementation(() => {
      throw { code: "EPIPE" };
    });
    client.sendVoiceData(Buffer.from([1]));
    await vi.advanceTimersByTimeAsync(2000);
    sdk.sendVoice.mockImplementation(() => {});
    expect(client.sendVoiceData(Buffer.from([1]))).toBe("accepted");
    sdk.sendVoice.mockImplementation(() => {
      throw { code: "EPIPE" };
    });
    client.sendVoiceData(Buffer.from([1]));
    await vi.advanceTimersByTimeAsync(2000);
    expect(first).toHaveLength(2);
    expect(recovered).toHaveLength(1);
    expect(terminal).toHaveLength(2);
  });

  it("cancels failure timers on explicit disconnect", async () => {
    const terminal: Failure[] = [];
    client.on("voiceSendFailed", (event) => terminal.push(event));
    sdk.sendVoice.mockImplementation(() => {});
    client.sendVoiceData(Buffer.from([1]));
    sdk.sendVoice.mockImplementation(() => {
      throw { code: "EPIPE" };
    });
    client.sendVoiceData(Buffer.from([1]));
    client.disconnect();
    expect(client.sendVoiceData(Buffer.from([1]))).toBe("unavailable");
    await vi.advanceTimersByTimeAsync(3000);
    expect(terminal).toEqual([]);
    expect((client as unknown as Harness).voiceFramesSent).toBe(0);
  });

  it("cancels failure timers on SDK connection loss", async () => {
    const terminal: Failure[] = [];
    client.on("voiceSendFailed", (event) => terminal.push(event));
    sdk.sendVoice.mockImplementation(() => {});
    client.sendVoiceData(Buffer.from([1]));
    sdk.sendVoice.mockImplementation(() => {
      throw { code: "EPIPE" };
    });
    client.sendVoiceData(Buffer.from([1]));
    sdk.dropConnection();
    await vi.advanceTimersByTimeAsync(3000);
    expect(terminal).toEqual([]);
    expect((client as unknown as Harness).voiceFramesSent).toBe(0);
    sdk.sendVoice.mockClear();
    client.sendVoiceData(Buffer.from([1]));
    expect(sdk.sendVoice).not.toHaveBeenCalled();
  });
});
