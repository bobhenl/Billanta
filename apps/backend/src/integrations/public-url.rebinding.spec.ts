import { describe, expect, it, vi } from "vitest";

// A rebinding domain: the guard's own lookup (dns/promises) sees a public
// address, the socket's lookup (callback dns.lookup) sees loopback.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));
vi.mock("node:dns", () => ({
  lookup: vi.fn((_host: string, _opts: unknown, cb: (err: Error | null, addrs: unknown) => void) =>
    cb(null, [{ address: "127.0.0.1", family: 4 }]),
  ),
}));

import { postToPublicUrl, resolvePublicHost } from "./public-url";

describe("outgoing requests pin the checked address (production)", () => {
  it("refuses to connect when the socket's lookup rebinds to an internal address", async () => {
    await expect(postToPublicUrl("https://rebind.example.com/hook", "{}", {}, 2000, true)).rejects.toThrow(/private_host/);
  });

  it("returns the checked public address for non-HTTP clients", async () => {
    await expect(resolvePublicHost("sftp.example.com", true)).resolves.toBe("93.184.216.34");
  });

  it("refuses an internal IP literal", async () => {
    await expect(resolvePublicHost("10.0.0.5", true)).rejects.toThrow(/private_host/);
  });
});
