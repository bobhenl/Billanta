import { Body, Controller, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { ChannelLinksService } from "./channel-links.service";
import { CreateLinkingTokenDto } from "./dto/create-linking-token.dto";
import { VerifyChannelLinkDto } from "./dto/verify-channel-link.dto";

@ApiTags("channel-links")
@ApiBearerAuth()
@Controller("v1/channel-links")
export class ChannelLinksController {
  constructor(private readonly channelLinksService: ChannelLinksService) {}

  /**
   * Called by the AI microservice's `resolve_tenant()` (blueprint §6 step
   * 2) — see the DTO's doc comment for the exact wire contract already in
   * use by `apps/ai-service`.
   *
   * Deliberately NOT run through `TenantContextMiddleware` (this route
   * isn't registered under it in `AppModule.configure`) — the whole point
   * of this endpoint is resolving a tenant that isn't known yet. It should
   * be protected by a distinct service-credential check (see
   * `JwtAuthGuard`'s TODO about the AI service's `BACKEND_SERVICE_JWT`),
   * not the per-tenant JWT used by dashboard-facing routes.
   */
  @UseGuards(JwtAuthGuard)
  @Post("verify")
  @ApiOperation({
    summary: "Resolve a channel + external user id to a tenant (AI microservice contract)",
    description:
      "Returns the linked tenant if this (channel, external_user_id) pair has an active " +
      "channel_links row; the AI microservice treats a 404 as 'unlinked sender' and stops " +
      "processing without ever touching invoice data (blueprint §6 step 2).",
  })
  verify(@Body() dto: VerifyChannelLinkDto) {
    return this.channelLinksService.verify(dto);
  }

  /**
   * Dashboard-user-initiated (blueprint §6 step 2, "generate a link
   * code"). NOT run through `TenantContextMiddleware` either (see
   * `AppModule.configure`'s comment) — `channel_links` has no RLS policy to
   * scope a `req.tenantDb` connection with in the first place (see
   * `ChannelLinksService.verify`'s comment). Tenant scoping for this write
   * is therefore enforced purely by trusting `req.user.tenantId` from the
   * verified dashboard JWT, never a client-supplied tenant id.
   */
  @UseGuards(JwtAuthGuard)
  @Post()
  @ApiOperation({ summary: "Generate a channel-linking token for the current tenant" })
  createLinkingToken(@Req() req: TenantScopedRequest, @Body() dto: CreateLinkingTokenDto) {
    return this.channelLinksService.createLinkingToken(req.user!.tenantId, dto);
  }
}
