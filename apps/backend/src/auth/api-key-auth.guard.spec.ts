import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiKeysService, ValidatedApiKey } from "../api-keys/api-keys.service";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";
import { ApiKeyAuthGuard } from "./api-key-auth.guard";

type MockApiKeysService = {
  validateKey: ReturnType<typeof vi.fn>;
  touchLastUsed: ReturnType<typeof vi.fn>;
};

interface MockRequest {
  headers: { authorization?: string };
  body?: unknown;
  user?: AuthenticatedUser;
}

function makeContext(req: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as unknown as ExecutionContext;
}

describe("ApiKeyAuthGuard", () => {
  let apiKeysService: MockApiKeysService;
  let guard: ApiKeyAuthGuard;

  beforeEach(() => {
    apiKeysService = { validateKey: vi.fn(), touchLastUsed: vi.fn() };
    guard = new ApiKeyAuthGuard(apiKeysService as unknown as ApiKeysService);
  });

  it("throws UnauthorizedException when there is no bearer token at all", async () => {
    const req: MockRequest = { headers: {} };
    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(apiKeysService.validateKey).not.toHaveBeenCalled();
  });

  it("throws UnauthorizedException for an unknown (never-issued) key", async () => {
    apiKeysService.validateKey.mockResolvedValue(null);
    const req: MockRequest = { headers: { authorization: "Bearer sk_live_unknown" } };

    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(apiKeysService.validateKey).toHaveBeenCalledWith("sk_live_unknown");
  });

  it("throws UnauthorizedException for a revoked key", async () => {
    // find_active_api_key_by_hash (rls-policies.sql) filters `revoked_at IS
    // NULL`, so validateKey returns null for a revoked key — identical to
    // an unknown one, by design (see that function's doc comment).
    apiKeysService.validateKey.mockResolvedValue(null);
    const req: MockRequest = { headers: { authorization: "Bearer sk_live_wasRevoked" } };

    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("accepts a valid key, sets req.user to the key's own tenant, and fires the last_used_at touch", async () => {
    const validated: ValidatedApiKey = { apiKeyId: "key-1", tenantId: "tenant-1" };
    apiKeysService.validateKey.mockResolvedValue(validated);
    const req: MockRequest = { headers: { authorization: "Bearer sk_live_valid" } };

    const result = await guard.canActivate(makeContext(req));

    expect(result).toBe(true);
    expect(req.user).toEqual({ id: "key-1", email: "", tenantId: "tenant-1", role: "service" });
    expect(apiKeysService.touchLastUsed).toHaveBeenCalledWith("tenant-1", "key-1");
  });

  it("rejects with ForbiddenException when the request body names a different tenant than the key's own", async () => {
    const validated: ValidatedApiKey = { apiKeyId: "key-1", tenantId: "tenant-1" };
    apiKeysService.validateKey.mockResolvedValue(validated);
    const req: MockRequest = {
      headers: { authorization: "Bearer sk_live_valid" },
      body: { tenant_id: "tenant-OTHER" },
    };

    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(ForbiddenException);
    expect(req.user).toBeUndefined();
  });

  it("allows a body tenant_id that matches the key's own tenant", async () => {
    const validated: ValidatedApiKey = { apiKeyId: "key-1", tenantId: "tenant-1" };
    apiKeysService.validateKey.mockResolvedValue(validated);
    const req: MockRequest = {
      headers: { authorization: "Bearer sk_live_valid" },
      body: { tenant_id: "tenant-1" },
    };

    await expect(guard.canActivate(makeContext(req))).resolves.toBe(true);
  });

  it("trusts an already-resolved req.user (set by ApiKeyOrJwtTenantContextMiddleware) without re-querying the database", async () => {
    const req: MockRequest = {
      headers: { authorization: "Bearer sk_live_valid" },
      user: { id: "key-1", email: "", tenantId: "tenant-1", role: "service" },
    };

    const result = await guard.canActivate(makeContext(req));

    expect(result).toBe(true);
    expect(apiKeysService.validateKey).not.toHaveBeenCalled();
    expect(apiKeysService.touchLastUsed).toHaveBeenCalledWith("tenant-1", "key-1");
  });
});
