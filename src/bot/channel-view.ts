/**
 * Event-sourced view of "who is in MY channel" (fork).
 *
 * The authoritative source for auto-pause / idle decisions. TeamSpeak pushes
 * view events that carry channel membership: cliententerview has the target
 * cid, clientmoved has ctid, and clientleftview carries none — so we keep a
 * clid→channel mirror fed by enter/moved and consult it at leave time. This
 * is the same model the official client UI uses for its channel user list.
 *
 * Why not query: the full-server `clientlist` only ever succeeds when the bot
 * is essentially alone (the library times out with ≥2 clients connected),
 * which made the old poll-based auto-pause silently inert whenever anyone
 * else was on the server. Queries are demoted to a reconcile attempt — used
 * when they succeed, never load-bearing.
 *
 * Fail-safe invariant: occupancy is reported as KNOWN only when positively
 * established (a successful reconcile, or live-tracked members in my
 * channel). "Unknown" must never be read as "empty" — 宁可多播，不误停.
 */

export interface Occupancy {
  /** Other humans/clients in my channel (bot excluded). */
  count: number;
  /** False = we lack positive knowledge; callers must not act on it. */
  known: boolean;
}

interface MemberLike {
  id: number;
  channelID: bigint;
}

interface MovedLike {
  id: number;
  targetChannelID: bigint;
}

export class ChannelView {
  private selfId: number | null = null;
  private selfChannel: bigint | null = null;
  /** clid → channelId mirror (includes the bot itself). */
  private readonly members = new Map<number, bigint>();
  /**
   * View establishment: the bot's own enterview means the server has already
   * replayed the existing members of its channel view — so an empty mirror
   * from that point on is POSITIVE evidence of an empty channel, not absence
   * of information. Reset on self-move (new view) until re-seeded.
   */
  private established = false;

  reset(): void {
    this.selfId = null;
    this.selfChannel = null;
    this.members.clear();
    this.established = false;
  }

  /** Seed self identity (from the wrapper's client id / channel, or reconcile). */
  onSelfKnown(selfId: number, selfChannel: bigint): void {
    this.selfId = selfId;
    this.selfChannel = selfChannel;
    this.members.set(selfId, selfChannel);
    this.established = true;
  }

  onEnter(info: MemberLike): void {
    this.members.set(info.id, info.channelID);
    // The bot's own enterview (connect, or being moved) tells us its channel
    // and marks the view as established (member replay has been delivered).
    if (info.id === this.selfId) {
      this.selfChannel = info.channelID;
      this.established = true;
    }
  }

  onMoved(ev: MovedLike): void {
    if (ev.id === this.selfId) {
      // New view: the old channel's membership is meaningless and the new
      // channel's occupants arrive as enterview replays / reconcile. Until
      // then occupancy is unknown — never guessed as empty.
      this.selfChannel = ev.targetChannelID;
      this.members.clear();
      this.members.set(ev.id, ev.targetChannelID);
      this.established = false;
      return;
    }
    this.members.set(ev.id, ev.targetChannelID);
  }

  onLeave(id: number): void {
    this.members.delete(id);
  }

  /** Replace the mirror with an authoritative clientlist snapshot (query
   *  succeeded). `clients` includes the bot itself; self ids are re-seeded. */
  reconcileAll(clients: MemberLike[], selfId: number, selfChannel: bigint): void {
    this.onSelfKnown(selfId, selfChannel);
    this.members.clear();
    for (const c of clients) this.members.set(c.id, c.channelID);
    this.members.set(selfId, selfChannel);
    this.established = true;
  }

  occupancy(): Occupancy {
    if (this.selfId === null || this.selfChannel === null) {
      return { count: 0, known: false };
    }
    let count = 0;
    for (const [id, channel] of this.members) {
      if (id !== this.selfId && channel === this.selfChannel) count++;
    }
    return { count, known: this.established || count > 0 };
  }
}
