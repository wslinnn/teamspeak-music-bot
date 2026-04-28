export interface RateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
}

interface AttemptRecord {
  count: number;
  windowStart: number;
}

export interface RateLimiter {
  /** Check if the IP is currently rate-limited (does NOT increment counter) */
  isLimited(ip: string): boolean;
  /** Record a failed attempt for the given IP */
  recordFailure(ip: string): void;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const records = new Map<string, AttemptRecord>();

  function cleanup(): void {
    const now = Date.now();
    for (const [ip, record] of records) {
      if (now - record.windowStart >= options.windowMs) {
        records.delete(ip);
      }
    }
  }

  // Periodically clean up stale entries to prevent unbounded memory growth
  const cleanupInterval = setInterval(cleanup, options.windowMs);

  // Allow the interval to not prevent process exit
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  function getOrCreate(ip: string, now: number): AttemptRecord {
    let record = records.get(ip);
    if (!record || now - record.windowStart >= options.windowMs) {
      record = { count: 0, windowStart: now };
      records.set(ip, record);
    }
    return record;
  }

  function isLimited(ip: string): boolean {
    const now = Date.now();
    const record = getOrCreate(ip, now);
    return record.count >= options.maxAttempts;
  }

  function recordFailure(ip: string): void {
    const now = Date.now();
    const record = getOrCreate(ip, now);
    record.count++;
  }

  return { isLimited, recordFailure };
}
