import { describe, it, expect } from "vitest";
import { toTS3TextMessage } from "./client.js";
import type { TextMessageEvent } from "@honeybbq/teamspeak";

/** The SDK's event carries branded ids; tests only need the shape. */
function makeMsg(over: Record<string, unknown> = {}): TextMessageEvent {
  return {
    invokerName: "Alice",
    invokerUID: "uid-abc",
    message: "!stop",
    invokerGroups: ["6", "8"],
    targetMode: 2,
    targetID: 0n,
    invokerID: 5,
    ...over,
  } as unknown as TextMessageEvent;
}

describe("toTS3TextMessage", () => {
  it("maps core fields and stringifies invokerID", () => {
    const r = toTS3TextMessage(makeMsg());
    expect(r.invokerName).toBe("Alice");
    expect(r.invokerId).toBe("5");
    expect(r.invokerUid).toBe("uid-abc");
    expect(r.message).toBe("!stop");
    expect(r.targetMode).toBe(2);
  });

  it("preserves the sender's server groups", () => {
    expect(toTS3TextMessage(makeMsg({ invokerGroups: ["6"] })).invokerGroups).toEqual(["6"]);
  });

  it("defaults missing invokerGroups to an empty array", () => {
    const partial = {
      invokerName: "Bob",
      invokerUID: "u",
      message: "!stop",
      targetMode: 1,
      targetID: 0n,
      invokerID: 7,
    } as unknown as TextMessageEvent;
    expect(toTS3TextMessage(partial).invokerGroups).toEqual([]);
  });
});
