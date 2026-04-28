export interface RateLimiterOptions {
  maxAttempts: number;
  windowMs: number;
}

interface AttemptRecord {
  count: number;
  windowStart: number;
}

export interface RateLimiter {
  check(ip: string): boolean;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const records = new Map<string, AttemptRecord>();

  function check(ip: string): boolean {
    const now = Date.now();
    const record = records.get(ip);

    if (!record || now - record.windowStart >= options.windowMs) {
      records.set(ip, { count: 1, windowStart: now });
      return true;
    }

    record.count++;
    if (record.count > options.maxAttempts) {
      return false;
    }
    return true;
  }

  return { check };
}
