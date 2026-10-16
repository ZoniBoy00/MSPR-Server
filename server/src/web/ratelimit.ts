/**
 * Fixed-window request counter per client address. The status site and API are readable by anyone who can reach
 * the port, so a single address must not be able to keep the server busy. The window is one minute.
 */
export class RateLimiter {
  private hits = new Map<string, { start: number; n: number }>();

  constructor(private readonly limit: number, private readonly windowMs = 60_000) {}

  /** True when the request may proceed. */
  allow(ip: string, now = Date.now()): boolean {
    if (this.hits.size > 5000) this.sweep(now);
    const h = this.hits.get(ip);
    if (!h || now - h.start >= this.windowMs) {
      this.hits.set(ip, { start: now, n: 1 });
      return true;
    }
    h.n++;
    return h.n <= this.limit;
  }

  private sweep(now: number): void {
    for (const [ip, h] of this.hits) if (now - h.start >= this.windowMs) this.hits.delete(ip);
  }
}

/** Answers from `compute` are reused for `ttlMs`; the status site polls every few seconds from every open tab. */
export function memo<T>(ttlMs: number, compute: () => T): () => T {
  let at = 0;
  let value: T;
  return () => {
    const now = Date.now();
    if (now - at >= ttlMs) {
      value = compute();
      at = now;
    }
    return value;
  };
}
