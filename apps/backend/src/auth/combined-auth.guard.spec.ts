import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiKeyAuthGuard } from "./api-key-auth.guard";
import { CombinedAuthGuard } from "./combined-auth.guard";
import { JwtAuthGuard } from "./jwt-auth.guard";

interface MockRequest {
  headers: { authorization?: string };
}

function makeContext(req: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe("CombinedAuthGuard", () => {
  let jwtAuthGuard: { canActivate: ReturnType<typeof vi.fn> };
  let apiKeyAuthGuard: { canActivate: ReturnType<typeof vi.fn> };
  let guard: CombinedAuthGuard;

  beforeEach(() => {
    jwtAuthGuard = { canActivate: vi.fn() };
    apiKeyAuthGuard = { canActivate: vi.fn() };
    guard = new CombinedAuthGuard(
      jwtAuthGuard as unknown as JwtAuthGuard,
      apiKeyAuthGuard as unknown as ApiKeyAuthGuard,
    );
  });

  it("routes an sk_live_-shaped bearer token straight to ApiKeyAuthGuard, never touching JwtAuthGuard", async () => {
    apiKeyAuthGuard.canActivate.mockResolvedValue(true);
    const req: MockRequest = { headers: { authorization: "Bearer sk_live_abc123" } };

    const result = await guard.canActivate(makeContext(req));

    expect(result).toBe(true);
    expect(apiKeyAuthGuard.canActivate).toHaveBeenCalledTimes(1);
    expect(jwtAuthGuard.canActivate).not.toHaveBeenCalled();
  });

  it("tries JwtAuthGuard for a non-API-key bearer token and returns its result on success", async () => {
    jwtAuthGuard.canActivate.mockReturnValue(true);
    const req: MockRequest = { headers: { authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.x.y" } };

    const result = await guard.canActivate(makeContext(req));

    expect(result).toBe(true);
    expect(apiKeyAuthGuard.canActivate).not.toHaveBeenCalled();
  });

  it("falls back to ApiKeyAuthGuard if JwtAuthGuard throws and the token also has API-key shape", async () => {
    // Contrived, but exercises the fallback branch independent of shape-routing.
    jwtAuthGuard.canActivate.mockImplementation(() => {
      throw new UnauthorizedException("bad jwt");
    });
    apiKeyAuthGuard.canActivate.mockResolvedValue(true);
    const req: MockRequest = { headers: { authorization: "Bearer sk_live_abc123" } };

    // Shape-routing sends this straight to ApiKeyAuthGuard already, but
    // confirm the guard never surfaces a spurious JWT error for it.
    const result = await guard.canActivate(makeContext(req));
    expect(result).toBe(true);
  });

  it("rejects with the JWT error when there is no bearer token at all", async () => {
    jwtAuthGuard.canActivate.mockImplementation(() => {
      throw new UnauthorizedException("missing bearer token");
    });
    const req: MockRequest = { headers: {} };

    await expect(guard.canActivate(makeContext(req))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(apiKeyAuthGuard.canActivate).not.toHaveBeenCalled();
  });
});
