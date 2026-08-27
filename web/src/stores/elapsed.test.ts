import { describe, it, expect, vi, afterEach } from "vitest";
import { interpolateElapsed, type TimingState } from "./player.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function timing(partial: Partial<TimingState>): TimingState {
  return { serverElapsed: 0, serverSyncTime: 0, wasPlaying: false, ...partial };
}

describe("interpolateElapsed", () => {
  it("returns serverElapsed before playback has a sync anchor", () => {
    expect(interpolateElapsed(timing({ serverElapsed: 12, wasPlaying: false }), false, Infinity)).toBe(12);
    // wasPlaying 但尚无锚点时间：同样返回服务器值
    expect(interpolateElapsed(timing({ serverElapsed: 5, wasPlaying: true, serverSyncTime: 0 }), false, Infinity)).toBe(5);
  });

  it("advances with wall-clock time while playing (regression: must not be frozen)", () => {
    const spy = vi.spyOn(Date, "now");
    const t = timing({ serverElapsed: 30, serverSyncTime: 10_000, wasPlaying: true });

    spy.mockReturnValue(10_000);
    expect(interpolateElapsed(t, false, Infinity)).toBeCloseTo(30, 5);
    spy.mockReturnValue(12_500);
    expect(interpolateElapsed(t, false, Infinity)).toBeCloseTo(32.5, 5);
  });

  it("freezes at the server position while paused", () => {
    const spy = vi.spyOn(Date, "now");
    const t = timing({ serverElapsed: 30, serverSyncTime: 10_000, wasPlaying: true });
    spy.mockReturnValue(20_000);
    expect(interpolateElapsed(t, true, Infinity)).toBe(30);
  });

  it("clamps to maxDuration（试听曲按 effectiveDuration 钳制，B1）", () => {
    const spy = vi.spyOn(Date, "now");
    const t = timing({ serverElapsed: 58, serverSyncTime: 10_000, wasPlaying: true });
    spy.mockReturnValue(20_000);
    expect(interpolateElapsed(t, false, 60)).toBe(60);
    expect(interpolateElapsed(t, false, Infinity)).toBeCloseTo(68, 5);
  });
});
