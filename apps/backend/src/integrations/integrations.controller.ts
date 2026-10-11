import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { IntegrationsService } from "./integrations.service";
import { MAX_WEBHOOKS, webhookInputSchema } from "./webhooks";

const webhooksBody = z.object({ webhooks: z.array(webhookInputSchema).max(MAX_WEBHOOKS) });

/** Settings → Integrace: calendar/RSS feed secret (per member) and webhooks (admins). */
@ApiTags("integrations")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/integrations")
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @ApiOperation({ summary: "Feed token of the current member and the company's webhooks (admins only)" })
  get(@Req() req: TenantScopedRequest) {
    return this.integrations.get(req.tenantDb!, req.user!.tenantId, req.user!.id, req.user!.role);
  }

  @Post("feed")
  @HttpCode(200)
  @ApiOperation({ summary: "Create or rotate the secret calendar/RSS feed address (old address stops working)" })
  rotateFeed(@Req() req: TenantScopedRequest) {
    return this.integrations.setFeed(req.tenantDb!, req.user!.tenantId, req.user!.id, true);
  }

  @Delete("feed")
  @ApiOperation({ summary: "Switch the calendar/RSS feeds off" })
  disableFeed(@Req() req: TenantScopedRequest) {
    return this.integrations.setFeed(req.tenantDb!, req.user!.tenantId, req.user!.id, false);
  }

  @Put("webhooks")
  @ApiOperation({ summary: "Replace the company's webhooks (Discord, Slack or signed JSON)" })
  saveWebhooks(@Req() req: TenantScopedRequest, @Body() body: unknown) {
    const parsed = webhooksBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.integrations.saveWebhooks(req.tenantDb!, req.user!.tenantId, req.user!.role, parsed.data.webhooks);
  }

  @Post("webhooks/:id/test")
  @HttpCode(200)
  @ApiOperation({ summary: "Send a test message to one webhook" })
  test(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.integrations.testWebhook(req.tenantDb!, req.user!.tenantId, req.user!.role, id);
  }
}
