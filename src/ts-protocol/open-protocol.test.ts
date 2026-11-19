import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenProtocolManager,
  buildIdentityPayloadJson,
  buildCommandsListAckJson,
  buildOpenProtocolCommands,
  IDENTITY_PLUGIN,
  COMMANDS_PLUGIN,
  MAX_PAYLOAD_BYTES,
  ANNOUNCE_DEBOUNCE_MS,
  IDENTITY_ANNOUNCE_COOLDOWN_MS,
} from "./open-protocol.js";
import type { TS3PluginCommand } from "./client.js";

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} } as never;

function makeTransport(clientId = 10) {
  const sent: Array<{ name: string; data: string; target: unknown }> = [];
  return {
    sent,
    transport: {
      getClientId: () => clientId,
      sendPluginCommand: vi.fn(async (name: string, data: string, target?: unknown) => {
        sent.push({ name, data, target });
      }),
    },
  };
}

function makeManager(overrides: { locale?: "zh" | "en"; commandPrefix?: string; clientId?: number } = {}) {
  const t = makeTransport(overrides.clientId ?? 10);
  const manager = new OpenProtocolManager({
    transport: t.transport,
    getConfig: () => ({
      locale: overrides.locale ?? "zh",
      commandPrefix: overrides.commandPrefix ?? "!",
    }),
    logger: silentLogger,
  });
  return { manager, ...t };
}

function cmd(over: Partial<TS3PluginCommand> = {}): TS3PluginCommand {
  return {
    name: IDENTITY_PLUGIN,
    data: JSON.stringify({ v: 1, action: "query" }),
    invokerId: 42,
    invokerUid: "peer-uid",
    invokerName: "Peer",
    ...over,
  };
}

describe("identity payload", () => {
  it("announces the bot identity with capabilities", () => {
    const parsed = JSON.parse(buildIdentityPayloadJson("announce", "1.2.3", "!"));
    expect(parsed).toMatchObject({
      v: 1,
      action: "announce",
      client_type: "bot",
      app_name: "TSMusicBot",
      app_version: "1.2.3",
      capabilities: ["chat:slash_commands"],
    });
  });

  it("withholds capabilities when the prefix is not discoverable", () => {
    for (const prefix of ["", "  !", "! ", "a".repeat(9)]) {
      const parsed = JSON.parse(buildIdentityPayloadJson("announce", "1", prefix));
      expect(parsed.capabilities).toEqual([]);
    }
  });

  it("advertises capabilities for a usable prefix", () => {
    const parsed = JSON.parse(buildIdentityPayloadJson("announce", "1", "!"));
    expect(parsed.capabilities).toEqual(["chat:slash_commands"]);
  });

  it("truncates app metadata to the field cap", () => {
    const parsed = JSON.parse(buildIdentityPayloadJson("announce", "v".repeat(100), "!"));
    expect(Array.from(parsed.app_version as string)).toHaveLength(32);
  });

  it("stays under the payload cap", () => {
    expect(Buffer.byteLength(buildIdentityPayloadJson("announce"), "utf8")).toBeLessThan(
      MAX_PAYLOAD_BYTES,
    );
  });
});

describe("command list payload", () => {
  it("returns null when the prefix is not discoverable", () => {
    expect(buildCommandsListAckJson("zh", "")).toBeNull();
    expect(buildCommandsListAckJson("zh", " !")).toBeNull();
  });

  it("includes the literal prefix the bot listens for", () => {
    const parsed = JSON.parse(buildCommandsListAckJson("zh", "!")!);
    expect(parsed.command_prefix).toBe("!");
    expect(parsed.action).toBe("list_ack");
    expect(Array.isArray(parsed.commands)).toBe(true);
    expect(parsed.commands.length).toBeGreaterThan(0);
  });

  it("localises descriptions", () => {
    const zh = buildOpenProtocolCommands("zh")[0];
    const en = buildOpenProtocolCommands("en")[0];
    expect(zh.desc).not.toBe(en.desc);
    expect(zh.name).toBe(en.name);
  });

  it("caps every field", () => {
    for (const spec of buildOpenProtocolCommands("zh")) {
      expect(Array.from(spec.name).length).toBeLessThanOrEqual(24);
      expect(Array.from(spec.desc).length).toBeLessThanOrEqual(64);
      if (spec.args) expect(Array.from(spec.args).length).toBeLessThanOrEqual(32);
    }
  });

  it("always fits the payload cap, dropping from the tail if needed", () => {
    const json = buildCommandsListAckJson("zh", "!")!;
    expect(Buffer.byteLength(json, "utf8")).toBeLessThan(MAX_PAYLOAD_BYTES);
  });
});

describe("inbound filtering", () => {
  it("ignores unknown plugin names", async () => {
    const { manager, sent } = makeManager();
    await manager.handlePluginCommand(cmd({ name: "tsclient:evil" }));
    expect(sent).toHaveLength(0);
  });

  it("ignores its own messages", async () => {
    const { manager, sent } = makeManager({ clientId: 42 });
    await manager.handlePluginCommand(cmd({ invokerId: 42 }));
    expect(sent).toHaveLength(0);
  });

  it("ignores an unnamed or server-originated invoker", async () => {
    const { manager, sent } = makeManager();
    await manager.handlePluginCommand(cmd({ invokerId: 0 }));
    expect(sent).toHaveLength(0);
  });

  it("ignores an oversized payload", async () => {
    const { manager, sent } = makeManager();
    await manager.handlePluginCommand(
      cmd({ data: JSON.stringify({ v: 1, action: "query", pad: "x".repeat(MAX_PAYLOAD_BYTES) }) }),
    );
    expect(sent).toHaveLength(0);
  });

  it("ignores malformed JSON", async () => {
    const { manager, sent } = makeManager();
    await manager.handlePluginCommand(cmd({ data: "{not json" }));
    expect(sent).toHaveLength(0);
  });

  it("ignores a non-object payload and an array", async () => {
    const { manager, sent } = makeManager();
    await manager.handlePluginCommand(cmd({ data: "[]" }));
    await manager.handlePluginCommand(cmd({ data: "42" }));
    expect(sent).toHaveLength(0);
  });

  it("ignores an unknown protocol version", async () => {
    const { manager, sent } = makeManager();
    await manager.handlePluginCommand(cmd({ data: JSON.stringify({ v: 2, action: "query" }) }));
    expect(sent).toHaveLength(0);
  });

  it("ignores a missing action", async () => {
    const { manager, sent } = makeManager();
    await manager.handlePluginCommand(cmd({ data: JSON.stringify({ v: 1 }) }));
    expect(sent).toHaveLength(0);
  });
});

describe("inbound replies", () => {
  it("answers an identity query with a unicast ack", async () => {
    const { manager, sent } = makeManager();
    await manager.handlePluginCommand(cmd({ data: JSON.stringify({ v: 1, action: "query" }) }));
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe(IDENTITY_PLUGIN);
    expect(sent[0].target).toBe(42);
    expect(JSON.parse(sent[0].data).action).toBe("announce_ack");
  });

  it("answers an identity announce", async () => {
    const { manager, sent } = makeManager();
    await manager.handlePluginCommand(cmd({ data: JSON.stringify({ v: 1, action: "announce" }) }));
    expect(sent).toHaveLength(1);
  });

  it("answers a command list request with the catalogue", async () => {
    const { manager, sent } = makeManager();
    await manager.handlePluginCommand(
      cmd({ name: COMMANDS_PLUGIN, data: JSON.stringify({ v: 1, action: "list_req" }) }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe(COMMANDS_PLUGIN);
    const payload = JSON.parse(sent[0].data);
    expect(payload.command_prefix).toBe("!");
    expect(payload.commands.length).toBeGreaterThan(0);
  });

  it("stays silent for a list request when the prefix is undiscoverable", async () => {
    const { manager, sent } = makeManager({ commandPrefix: " " });
    await manager.handlePluginCommand(
      cmd({ name: COMMANDS_PLUGIN, data: JSON.stringify({ v: 1, action: "list_req" }) }),
    );
    expect(sent).toHaveLength(0);
  });
});

describe("rate limiting", () => {
  it("applies a per-peer cooldown", async () => {
    const { manager, sent } = makeManager();
    const query = cmd({ data: JSON.stringify({ v: 1, action: "query" }) });
    await manager.handlePluginCommand(query);
    await manager.handlePluginCommand(query);
    expect(sent).toHaveLength(1);
  });

  it("tracks peers separately", async () => {
    const { manager, sent } = makeManager();
    const body = JSON.stringify({ v: 1, action: "query" });
    await manager.handlePluginCommand(cmd({ data: body, invokerUid: "a", invokerId: 1 }));
    await manager.handlePluginCommand(cmd({ data: body, invokerUid: "b", invokerId: 2 }));
    expect(sent).toHaveLength(2);
  });

  it("caps the total burst across peers (token bucket)", async () => {
    const { manager, sent } = makeManager();
    const body = JSON.stringify({ v: 1, action: "query" });
    // Burst is 4; the 5th distinct peer must be dropped.
    for (let i = 1; i <= 10; i++) {
      await manager.handlePluginCommand(cmd({ data: body, invokerUid: `peer-${i}`, invokerId: i }));
    }
    expect(sent.length).toBeLessThanOrEqual(4);
  });

  it("consumes the budget even when the send fails", async () => {
    const { manager } = makeManager();
    const transport = (manager as unknown as { transport: { sendPluginCommand: ReturnType<typeof vi.fn> } }).transport;
    transport.sendPluginCommand.mockRejectedValue(new Error("send failed"));
    const body = JSON.stringify({ v: 1, action: "query" });
    await manager.handlePluginCommand(cmd({ data: body }));
    await manager.handlePluginCommand(cmd({ data: body }));
    // One attempt, one rejection — the retry was denied by the cooldown.
    expect(transport.sendPluginCommand).toHaveBeenCalledTimes(1);
  });
});

describe("announce broadcasting", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("broadcasts to the channel on connect", async () => {
    const { manager, sent } = makeManager();
    manager.scheduleAnnounce();
    await vi.runAllTimersAsync();
    expect(sent).toHaveLength(1);
    expect(sent[0].target).toBe("channel");
    expect(JSON.parse(sent[0].data).action).toBe("announce");
  });

  it("debounces rapid announces into one trailing broadcast", async () => {
    const { manager, sent } = makeManager();
    manager.scheduleAnnounce();
    await vi.runAllTimersAsync();
    expect(sent).toHaveLength(1);

    manager.scheduleAnnounce();
    manager.scheduleAnnounce();
    manager.scheduleAnnounce();
    await vi.advanceTimersByTimeAsync(ANNOUNCE_DEBOUNCE_MS + 10);
    // The immediate one was suppressed by the window; one trailing fire.
    expect(sent).toHaveLength(2);
  });

  it("does nothing before the client id is known", async () => {
    const { manager, sent } = makeManager({ clientId: 0 });
    manager.scheduleAnnounce();
    await vi.runAllTimersAsync();
    expect(sent).toHaveLength(0);
  });

  it("retries once after a failed broadcast", async () => {
    const t = makeTransport();
    const send = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(undefined);
    t.transport.sendPluginCommand = send;
    const manager = new OpenProtocolManager({
      transport: t.transport,
      getConfig: () => ({ locale: "zh", commandPrefix: "!" }),
      logger: silentLogger,
    });

    manager.scheduleAnnounce();
    await vi.advanceTimersByTimeAsync(600);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("reset() stops pending timers", async () => {
    const { manager, sent } = makeManager();
    manager.scheduleAnnounce();
    await vi.runAllTimersAsync();
    const before = sent.length;

    manager.scheduleAnnounce();
    manager.reset();
    await vi.advanceTimersByTimeAsync(ANNOUNCE_DEBOUNCE_MS * 3);
    expect(sent).toHaveLength(before);
  });

  it("reset() clears the per-peer cooldown", async () => {
    const { manager, sent } = makeManager();
    const body = JSON.stringify({ v: 1, action: "query" });
    await manager.handlePluginCommand(cmd({ data: body }));
    await manager.handlePluginCommand(cmd({ data: body }));
    expect(sent).toHaveLength(1);

    manager.reset();
    await manager.handlePluginCommand(cmd({ data: body }));
    expect(sent).toHaveLength(2);
  });

  it("uses the announce cooldown for identity announces", () => {
    expect(IDENTITY_ANNOUNCE_COOLDOWN_MS).toBe(10_000);
  });
});
