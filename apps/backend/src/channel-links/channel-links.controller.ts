import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { ServiceTokenGuard } from "../auth/service-token.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { ChannelLinksService } from "./channel-links.service";
import { ActivateChannelLinkDto } from "./dto/activate-channel-link.dto";
import { CreateLinkingTokenDto } from "./dto/create-linking-token.dto";
import { VerifyChannelLinkDto } from "./dto/verify-channel-link.dto";

/**
 * AI-microservice-only routes. NOT under `TenantContextMiddleware`: their job
 * is resolving a tenant that isn't known yet. `ServiceTokenGuard` rejects any
 * token without the `ai-service` scope, so a dashboard user can't look up or
 * claim other people's chats.
 */
@ApiTags("channel-links")
@ApiBearerAuth()
@UseGuards(ServiceTokenGuard)
@Controller("v1/internal/channel-links")
export class ChannelLinksServiceController {
  constructor(private readonly channelLinksService: ChannelLinksService) {}

  @Post("verify")
  @HttpCode(200)
  @ApiOperation({
    summary: "Resolve a channel + external user id to a tenant (AI microservice only)",
    description: "404 means 'unlinked sender'; the AI microservice then stops without touching invoice data.",
  })
  verify(@Body() dto: VerifyChannelLinkDto) {
    return this.channelLinksService.verify(dto);
  }

  @Post("activate")
  @HttpCode(200)
  @ApiOperation({ summary: "Consume a linking token sent to the bot (AI microservice only)" })
  activate(@Body() dto: ActivateChannelLinkDto) {
    return this.channelLinksService.activate(dto);
  }
}

/**
 * Settings → Kanály. Tenant-scoped through `TenantContextMiddleware`; writes
 * are owner/admin only (`ADMIN_PREFIXES` in `RoleAccessGuard`) because a
 * linked chat creates invoices on the company's behalf.
 */
@ApiTags("channel-links")
@ApiBearerAuth()
@Controller("v1/channel-links")
export class ChannelLinksController {
  constructor(private readonly channelLinksService: ChannelLinksService) {}

  @Get()
  @ApiOperation({ summary: "Active channel links of the current company" })
  list(@Req() req: TenantScopedRequest) {
    return this.channelLinksService.list(req.user!.tenantId);
  }

  @Post()
  @ApiOperation({ summary: "Generate a short-lived channel-linking token for the current company" })
  createLinkingToken(@Req() req: TenantScopedRequest, @Body() dto: CreateLinkingTokenDto) {
    return this.channelLinksService.createLinkingToken(req.user!.tenantId, dto);
  }

  @Delete(":id")
  @HttpCode(204)
  @ApiOperation({ summary: "Unlink a chat" })
  async remove(@Req() req: TenantScopedRequest, @Param("id", new ParseUUIDPipe()) id: string) {
    await this.channelLinksService.remove(req.user!.tenantId, id);
  }
}
