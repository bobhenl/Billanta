import { describe, expect, it } from "vitest";
import { ConcurrencyGate, DailyCap, GATE_BUSY, SlidingWindowLimiter, visitorBucket } from "./guest-limits";

describe("visitorBucket", () => {
  it("keeps IPv4 as is and strips the IPv4-mapped prefix", () => {
    expect(visitorBucket("203.0.113.7")).toBe("203.0.113.7");
    expect(visitorBucket("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("groups IPv6 addresses of one /64", () => {
    const a = visitorBucket("2001:db8:abcd:12:1::1");
    const b = visitorBucket("2001:0db8:abcd:0012:ffff:ffff:ffff:fffe");
    expect(a).toBe("2001:db8:abcd:12::/64");
    expect(b).toBe(a);
    expect(visitorBucket("2001:db8:abcd:13::1")).not.toBe(a);
  });

  it("expands a :: inside the first four groups", () => {
    expect(visitorBucket("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(visitorBucket("::1")).toBe("0:0:0:0::/64");
  });
});

describe("SlidingWindowLimiter", () => {
  it("allows up to max hits per window, then frees up after the window", () => {
    const limiter = new SlidingWindowLimiter(1000, 2);
    expect(limiter.hit("a", 0)).toBe(true);
    expect(limiter.hit("a", 10)).toBe(true);
    expect(limiter.hit("a", 20)).toBe(false);
    expect(limiter.hit("b", 20)).toBe(true);
    expect(limiter.hit("a", 1011)).toBe(true);
  });

  it("stays bounded under a flood, dropping the least recently active keys", () => {
    const limiter = new SlidingWindowLimiter(60_000, 2, 100);
    limiter.hit("victim", 0);
    limiter.hit("victim", 1);
    for (let i = 0; i < 150; i++) limiter.hit(`spoof-${i}`, 2);
    // The map stays bounded and only the least recently active keys were dropped.
    expect(limiter.size).toBeLessThanOrEqual(100);
    expect(limiter.hit("spoof-149", 3)).toBe(true);
    expect(limiter.hit("spoof-149", 4)).toBe(false);
  });

  it("drops stale keys before live ones", () => {
    const limiter = new SlidingWindowLimiter(100, 5, 3);
    limiter.hit("old1", 0);
    limiter.hit("old2", 0);
    limiter.hit("live", 150);
    limiter.hit("new", 160);
    expect(limiter.size).toBe(2);
  });
});

describe("DailyCap", () => {
  it("caps per UTC day and resets at midnight", () => {
    const cap = new DailyCap(2);
    const day1 = new Date("2026-10-04T10:00:00Z");
    expect(cap.take(day1)).toBe(true);
    expect(cap.take(day1)).toBe(true);
    expect(cap.take(day1)).toBe(false);
    expect(cap.remaining(day1)).toBe(0);
    expect(cap.take(new Date("2026-10-05T00:00:01Z"))).toBe(true);
  });
});

describe("ConcurrencyGate", () => {
  it("rejects jobs beyond the limit instead of queueing them", async () => {
    const gate = new ConcurrencyGate(1);
    let release!: () => void;
    const first = gate.run(() => new Promise<string>((r) => (release = () => r("done"))));
    expect(await gate.run(async () => "second")).toBe(GATE_BUSY);
    release();
    expect(await first).toBe("done");
    expect(await gate.run(async () => "third")).toBe("third");
  });
});
