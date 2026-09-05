/**
 * 通用 TTL + LRU 内存缓存，供 provider 内容方法（歌词/歌单/专辑/详情/搜索）
 * 使用。设计要点见 docs/server-cache-plan.md。
 *
 * 利用 JS Map「插入序 = 迭代序」实现紧凑 LRU：get 命中删了重插保持最新端，
 * set 满员删首键（最久未使用）；过期在读取时惰性检查，不做定时清扫。
 */

interface Entry {
  value: unknown;
  expiresAt: number;
}

export class TtlLruCache {
  private map = new Map<string, Entry>();
  hits = 0;
  misses = 0;

  constructor(
    /** 最大条目数，满员后新写入驱逐最久未使用条目。 */
    private readonly maxEntries: number,
    /** 单条序列化长度上限，超过则拒存（防病态大 payload 撑内存）。 */
    private readonly maxValueLen = 256 * 1024,
  ) {}

  /** 命中返回值并触碰；未命中/已过期返回 undefined 并计 miss。 */
  get<T = unknown>(key: string): T | undefined {
    const entry = this.map.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (entry.expiresAt <= Date.now()) {
      this.map.delete(key);
      this.misses++;
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    this.hits++;
    return entry.value as T;
  }

  set(key: string, value: unknown, ttlMs: number): void {
    const serialized = JSON.stringify(value ?? null);
    if (serialized.length > this.maxValueLen) return;
    if (this.map.has(key)) {
      // 覆盖也算一次使用：删了重插，刷新到最新端
      this.map.delete(key);
    } else if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs });
  }
}
