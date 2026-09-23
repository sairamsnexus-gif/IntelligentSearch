/**
 * Two limiters:
 *  - SlidingWindowLimiter: inbound API protection (per client key).
 *  - TokenBucket: outbound politeness per external provider/host.
 * In-memory by design (single-node dev). For multi-instance deployments put
 * inbound limiting at the edge (see docs/SECURITY.md).
 */

export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): { ok: boolean; retryAfterMs: number; remaining: number } {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.limit) {
      this.hits.set(key, arr);
      return { ok: false, retryAfterMs: this.windowMs - (now - arr[0]), remaining: 0 };
    }
    arr.push(now);
    this.hits.set(key, arr);
    if (this.hits.size > 10_000) this.gc(now);
    return { ok: true, retryAfterMs: 0, remaining: this.limit - arr.length };
  }

  private gc(now: number) {
    for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
  }
}

export class TokenBucket {
  private tokens: number;
  private last: number;
  private queue: (() => void)[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
  ) {
    this.tokens = capacity;
    this.last = Date.now();
  }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
  }

  /** Resolves when a token is available. */
  take(): Promise<void> {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.drain();
    });
  }

  private drain() {
    this.refill();
    while (this.queue.length && this.tokens >= 1) {
      this.tokens -= 1;
      this.queue.shift()!();
    }
    if (this.queue.length && !this.timer) {
      const waitMs = Math.ceil(((1 - this.tokens) / this.refillPerSec) * 1000);
      this.timer = setTimeout(() => {
        this.timer = null;
        this.drain();
      }, waitMs);
    }
  }
}

const g = globalThis as unknown as { __isBuckets?: Map<string, TokenBucket> };
const buckets = (g.__isBuckets ??= new Map());

/** Shared per-provider bucket (e.g. 1 req/s for SearXNG, 0.5 req/s for Reddit). */
export function bucketFor(name: string, capacity = 3, refillPerSec = 1): TokenBucket {
  let b = buckets.get(name);
  if (!b) {
    b = new TokenBucket(capacity, refillPerSec);
    buckets.set(name, b);
  }
  return b;
}

/** Run async tasks with a concurrency cap (no dependency on p-limit). */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
