/**
 * In-memory abuse limits for the public guest-invoice endpoints (single
 * backend instance; nothing here is persisted). Kept free of Nest so it can
 * be unit-tested with a fake clock.
 */

/**
 * The bucket a visitor is counted under. IPv6 addresses are grouped by /64,
 * because one connection usually gets a whole /64 and could otherwise rotate
 * through practically unlimited addresses.
 */
export function visitorBucket(ip: string): string {
  const raw = ip.trim().toLowerCase().replace(/^::ffff:/, "");
  if (!raw.includes(":")) return raw;
  const [head, tail = ""] = raw.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = raw.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups
    .slice(0, 4)
    .map((g) => (g || "0").replace(/^0+(?=.)/, ""))
    .join(":")}::/64`;
}

/**
 * Sliding-window counter per key. When the map grows past `maxKeys`, stale
 * keys are dropped first and then the oldest ones — never everything at once,
 * so flooding it with fresh addresses can't reset the counters of others.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Records a hit; returns false (and records nothing) when the key is over its limit. */
  hit(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    // Re-insert so Map order stays "least recently active first".
    this.hits.delete(key);
    this.hits.set(key, recent);
    if (this.hits.size > this.maxKeys) this.evict(now);
    return true;
  }

  get size() {
    return this.hits.size;
  }

  private evict(now: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
    }
    const overflow = this.hits.size - this.maxKeys;
    if (overflow <= 0) return;
    let dropped = 0;
    for (const key of this.hits.keys()) {
      if (dropped++ >= overflow) break;
      this.hits.delete(key);
    }
  }
}

/** A counter that resets at UTC midnight. */
export class DailyCap {
  private day = "";
  private used = 0;

  constructor(readonly limit: number) {}

  /** Takes one unit; false when today's cap is used up. */
  take(now = new Date()): boolean {
    this.roll(now);
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }

  remaining(now = new Date()): number {
    this.roll(now);
    return Math.max(0, this.limit - this.used);
  }

  private roll(now: Date) {
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
  }
}

/** Caps how many expensive jobs (PDF rendering) run at once. */
export class ConcurrencyGate {
  private running = 0;

  constructor(private readonly max: number) {}

  async run<T>(job: () => Promise<T>): Promise<T | typeof GATE_BUSY> {
    if (this.running >= this.max) return GATE_BUSY;
    this.running++;
    try {
      return await job();
    } finally {
      this.running--;
    }
  }
}

export const GATE_BUSY = Symbol("gate-busy");
