import { describe, it, expect } from "vitest";
import { ChannelView } from "./channel-view.js";

const CH_A = 1n;
const CH_B = 2n;

/** Fresh view seeded like a connected bot sitting alone in channel A. */
function seededBot(): ChannelView {
  const v = new ChannelView();
  v.onSelfKnown(100, CH_A);
  return v;
}

describe("ChannelView (event-sourced occupancy)", () => {
  it("is unknown before self is known", () => {
    const v = new ChannelView();
    v.onEnter({ id: 1, channelID: CH_A });
    expect(v.occupancy()).toEqual({ count: 0, known: false });
  });

  it("seeding self establishes the view — alone means KNOWN empty (replay delivered nobody)", () => {
    expect(seededBot().occupancy()).toEqual({ count: 0, known: true });
  });

  it("enter into my channel is positive knowledge", () => {
    const v = seededBot();
    v.onEnter({ id: 1, channelID: CH_A });
    expect(v.occupancy()).toEqual({ count: 1, known: true });
  });

  it("enter elsewhere does not count (my channel stays known-empty)", () => {
    const v = seededBot();
    v.onEnter({ id: 1, channelID: CH_B });
    expect(v.occupancy()).toEqual({ count: 0, known: true });
  });

  it("the last known member leaving yields KNOWN empty (the auto-pause case)", () => {
    const v = seededBot();
    v.onEnter({ id: 1, channelID: CH_A });
    v.onLeave(1);
    expect(v.occupancy()).toEqual({ count: 0, known: true });
  });

  it("member moving out of my channel yields known empty without a leave", () => {
    const v = seededBot();
    v.onEnter({ id: 1, channelID: CH_A });
    v.onMoved({ id: 1, targetChannelID: CH_B });
    expect(v.occupancy()).toEqual({ count: 0, known: true });
  });

  it("member moving into my channel counts", () => {
    const v = seededBot();
    v.onEnter({ id: 1, channelID: CH_B });
    v.onMoved({ id: 1, targetChannelID: CH_A });
    expect(v.occupancy()).toEqual({ count: 1, known: true });
  });

  it("reconcile makes the mirror authoritative, including known-empty", () => {
    const v = seededBot();
    v.reconcileAll([{ id: 100, channelID: CH_A }], 100, CH_A);
    expect(v.occupancy()).toEqual({ count: 0, known: true });
  });

  it("reconcile corrects drifted membership (missed events)", () => {
    const v = seededBot();
    v.reconcileAll(
      [
        { id: 100, channelID: CH_A },
        { id: 1, channelID: CH_A },
        { id: 2, channelID: CH_B },
      ],
      100,
      CH_A,
    );
    expect(v.occupancy()).toEqual({ count: 1, known: true });
  });

  it("self being moved resets to unknown until re-seeded (new view)", () => {
    const v = seededBot();
    v.onEnter({ id: 1, channelID: CH_A });
    v.onMoved({ id: 100, targetChannelID: CH_B });
    expect(v.occupancy()).toEqual({ count: 0, known: false });
    // Members of the new channel replay as enterviews → positive again.
    v.onEnter({ id: 5, channelID: CH_B });
    expect(v.occupancy()).toEqual({ count: 1, known: true });
  });

  it("the bot's own enterview identifies its channel", () => {
    const v = new ChannelView();
    v.onSelfKnown(100, CH_A);
    v.reset();
    expect(v.occupancy().known).toBe(false);
    v.onSelfKnown(100, CH_B);
    v.onEnter({ id: 3, channelID: CH_B });
    expect(v.occupancy()).toEqual({ count: 1, known: true });
  });

  it("leave of an untracked id is a harmless no-op", () => {
    const v = seededBot();
    v.reconcileAll([{ id: 100, channelID: CH_A }], 100, CH_A);
    v.onLeave(999);
    expect(v.occupancy()).toEqual({ count: 0, known: true });
  });
});
