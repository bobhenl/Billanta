import { describe, expect, it } from "vitest";
import { visitorBucket } from "../guest-invoices/guest-limits";
import { ipBucket } from "./ip-bucket";

describe("ipBucket", () => {
  it("is a 64-char hex digest that never contains the address", () => {
    const h = ipBucket("203.0.113.7", "salt");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain("203");
  });

  it("depends on the salt", () => {
    expect(ipBucket("203.0.113.7", "a")).not.toBe(ipBucket("203.0.113.7", "b"));
  });

  it("puts one IPv6 /64 into one bucket", () => {
    const a = ipBucket(visitorBucket("2001:db8:1:2::1"), "s");
    const b = ipBucket(visitorBucket("2001:db8:1:2:ffff::9"), "s");
    const c = ipBucket(visitorBucket("2001:db8:1:3::1"), "s");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
