import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { demoEcho, VaultDemoController } from "./vault-demo.controller";

const SEALED = "enc:v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBB";
const req = { headers: {} } as never;

describe("vault demo echo", () => {
  it("returns the envelope exactly as it arrived", () => {
    const at = new Date("2026-11-27T10:00:00Z");
    expect(demoEcho({ envelope: SEALED }, at)).toEqual({ received: { envelope: SEALED }, sealed: true, receivedAt: "2026-11-27T10:00:00.000Z" });
  });

  it("refuses plain text, so it cannot be used to reflect anything else", () => {
    expect(() => demoEcho({ envelope: "Hello, this is plain" })).toThrow(BadRequestException);
  });

  it("limits one visitor to 30 tries per window", () => {
    const controller = new VaultDemoController();
    for (let i = 0; i < 30; i++) controller.echo({ envelope: SEALED }, "203.0.113.7", req);
    expect(() => controller.echo({ envelope: SEALED }, "203.0.113.7", req)).toThrow(/rate_limited|Http Exception/);
    // Another visitor is not affected.
    expect(controller.echo({ envelope: SEALED }, "198.51.100.1", req).sealed).toBe(true);
  });
});
