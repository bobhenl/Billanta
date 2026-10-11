import { describe, expect, it } from "vitest";
import { isPrivateAddress, publicUrlProblem } from "./public-url";

describe("isPrivateAddress", () => {
  it("flags internal ranges", () => {
    for (const a of ["127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(a), a).toBe(true);
    }
  });
  it("allows public addresses", () => {
    for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700::1111", "172.32.0.1"]) expect(isPrivateAddress(a), a).toBe(false);
  });
});

describe("publicUrlProblem (production)", () => {
  it("refuses literal internal IPs and http", async () => {
    expect(await publicUrlProblem("https://169.254.169.254/latest", true)).toBe("private_host");
    expect(await publicUrlProblem("http://example.com/hook", true)).toBe("https_only");
    expect(await publicUrlProblem("https://[::1]/x", true)).toBe("private_host");
  });
  it("refuses names that resolve to loopback", async () => {
    expect(await publicUrlProblem("https://localhost.localdomain.invalid-tld-xyz/x", true)).not.toBeNull();
  });
});
