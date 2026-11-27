import { HttpException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { ApiKeyOrJwtTenantContextMiddleware } from "./api-key-or-jwt-tenant-context.middleware";

const KEY = `sk_live_${"a".repeat(40)}`;

function setup(countRequest: () => Promise<void>) {
  const apiKeys = {
    validateKey: vi.fn(async () => ({ apiKeyId: "key-1", tenantId: "tenant-1", scopes: [] })),
    countRequest: vi.fn(countRequest),
    touchLastUsed: vi.fn(),
  };
  const begin = vi.fn(async () => undefined);
  const jwt = { use: vi.fn() };
  const mw = new ApiKeyOrJwtTenantContextMiddleware(apiKeys as never, { sql: { begin } } as never, jwt as never);
  const req = { headers: { authorization: `Bearer ${KEY}` }, method: "GET", body: undefined };
  return { mw, apiKeys, begin, jwt, req };
}

describe("ApiKeyOrJwtTenantContextMiddleware – API quota", () => {
  it("counts every API-key request before it runs", async () => {
    const { mw, apiKeys, begin, req } = setup(async () => undefined);
    await mw.use(req as never, {} as never, vi.fn());
    expect(apiKeys.countRequest).toHaveBeenCalledWith("tenant-1");
    expect(begin).toHaveBeenCalled();
  });

  it("stops a request over the quota before the tenant transaction opens", async () => {
    const quota = new HttpException({ error: "api_quota_exceeded" }, 429);
    const { mw, begin, req } = setup(async () => {
      throw quota;
    });
    const next = vi.fn();
    await mw.use(req as never, {} as never, next);
    expect(next).toHaveBeenCalledWith(quota);
    expect(begin).not.toHaveBeenCalled();
  });

  it("leaves dashboard (JWT) requests uncounted", async () => {
    const { mw, apiKeys, jwt } = setup(async () => undefined);
    await mw.use({ headers: { authorization: "Bearer eyJhbGciOi.x.y" } } as never, {} as never, vi.fn());
    expect(jwt.use).toHaveBeenCalled();
    expect(apiKeys.countRequest).not.toHaveBeenCalled();
  });
});
