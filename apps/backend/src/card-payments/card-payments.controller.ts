import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { CardPaymentsService } from "./card-payments.service";

const connectSchema = z.object({ secretKey: z.string().min(10).max(255) });
const enabledSchema = z.object({ enabled: z.boolean() });
const checkoutSchema = z.object({ locale: z.string().max(5).optional() });
const confirmSchema = z.object({ sessionId: z.string().min(10).max(255) });

/** Settings → Payment methods → Card payments (owner/admin: under `v1/tenants`, see RoleAccessGuard). */
@ApiTags("card-payments")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/tenants/me/card-payments")
export class CardPaymentsSettingsController {
  constructor(private readonly service: CardPaymentsService) {}

  @Get()
  @ApiOperation({ summary: "Whether a Stripe account is connected for card payments (the key itself is never returned)" })
  get(@Req() req: TenantScopedRequest) {
    return this.service.getSettings(req.tenantDb!, req.user!.tenantId);
  }

  @Put()
  @ApiOperation({ summary: "Connect the company's own Stripe account with a secret or restricted key (verified with Stripe)" })
  connect(@Req() req: TenantScopedRequest, @Body() body: unknown) {
    const parsed = connectSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("invalid_key_format");
    return this.service.connect(req.tenantDb!, req.user!.tenantId, parsed.data.secretKey);
  }

  @Post("enabled")
  @HttpCode(200)
  @ApiOperation({ summary: "Show or hide the 'Pay by card' button on invoice links" })
  setEnabled(@Req() req: TenantScopedRequest, @Body() body: unknown) {
    const parsed = enabledSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid body");
    return this.service.setEnabled(req.tenantDb!, req.user!.tenantId, parsed.data.enabled);
  }

  @Delete()
  @ApiOperation({ summary: "Disconnect Stripe (deletes the stored key)" })
  disconnect(@Req() req: TenantScopedRequest) {
    return this.service.disconnect(req.tenantDb!, req.user!.tenantId);
  }
}

/**
 * PUBLIC card checkout from the invoice link. Like `PublicInvoicesController`:
 * no auth, no tenant middleware; the token is resolved by the
 * `get_public_card_payment_target` SECURITY DEFINER function.
 */
@ApiTags("public-invoices")
@Controller("v1/public/invoices")
export class PublicCardPaymentsController {
  constructor(private readonly service: CardPaymentsService) {}

  @Post(":token/card-checkout")
  @HttpCode(200)
  @ApiOperation({ summary: "Start a Stripe Checkout for the unpaid rest of the invoice; returns the URL to redirect to" })
  checkout(@Param("token") token: string, @Body() body: unknown) {
    const parsed = checkoutSchema.safeParse(body ?? {});
    return this.service.createCheckout(token, parsed.success ? (parsed.data.locale ?? "cs") : "cs");
  }

  @Post(":token/card-confirm")
  @HttpCode(200)
  @ApiOperation({ summary: "After returning from Stripe: record the payment if it went through" })
  confirm(@Param("token") token: string, @Body() body: unknown) {
    const parsed = confirmSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid body");
    return this.service.confirm(token, parsed.data.sessionId);
  }
}
