/**
 * Async mutex — serializes concurrent async operations.
 * Queues callers and runs them one at a time.
 */
export class Mutex {
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * Run `fn` exclusively. If another call is in progress,
   * this one waits until it finishes.
   */
  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => fn());
    this.queue = next.catch(() => {});
    return next;
  }
}
