import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { TwoFactorGuard } from "../auth/two-factor.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";

/**
 * Dashboard-only management surface for a tenant's OWN public-API keys.
 * Deliberately behind `JwtAuthGuard` only (never `ApiKeyAuthGuard`/
 * `CombinedAuthGuard`) — an API key managing other API keys (including
 * itself) is a self-escalation shape this pass doesn't need to reason
 * about; minting/revoking keys is a dashboard-user action.
 */
@ApiTags("api-keys")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/api-keys")
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @UseGuards(TwoFactorGuard)
  @ApiOperation({
    summary: "Generate a new public-API key",
    description:
      "Returns the full plaintext key in THIS response only — only its SHA-256 hash and a " +
      "12-char prefix are ever persisted (see ApiKeysService.create / hashApiKey). There is " +
      "no way to retrieve the full key again after this call; losing it means revoking it " +
      "and generating a new one.",
  })
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateApiKeyDto) {
    return this.apiKeysService.create(req.tenantDb!, req.user!.tenantId, dto);
  }

  @Get()
  @ApiOperation({
    summary: "List API keys for the current tenant",
    description: "Never returns the full key or its hash — prefix, name, and usage metadata only.",
  })
  list(@Req() req: TenantScopedRequest) {
    return this.apiKeysService.list(req.tenantDb!);
  }

  @Delete(":id")
  @ApiOperation({
    summary: "Revoke an API key",
    description: "Soft-revoke: sets revoked_at. Never hard-deletes, for audit purposes.",
  })
  revoke(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.apiKeysService.revoke(req.tenantDb!, id);
  }
}
