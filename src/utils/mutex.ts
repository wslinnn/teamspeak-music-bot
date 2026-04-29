export class Mutex {
  private queue: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => fn());
    this.queue = next.catch(() => {
      // Error already propagated to caller via `next`; this catch prevents
      // unhandled rejection on the chain used purely for serialization ordering.
    });
    return next;
  }
}
