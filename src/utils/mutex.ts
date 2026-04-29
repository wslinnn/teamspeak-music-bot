export class Mutex {
  private queue: Promise<unknown> = Promise.resolve();

  run<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.queue.then(async () => fn());
    this.queue = next.catch(() => {});
    return next;
  }
}
