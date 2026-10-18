import { Body, Controller, Get, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { SubscriptionService } from "./subscription.service";

const plan = z.enum(["start", "plus", "business"]);
const locale = z.enum(["cs", "sk", "en"]).optional();

export class CheckoutDto extends createZodDto(
  z.object({
    plan,
    interval: z.enum(["month", "year"]),
    currency: z.enum(["CZK", "EUR"]).default("CZK"),
    locale,
  }),
) {}
export class PortalDto extends createZodDto(z.object({ locale })) {}
export class BankTransferDto extends createZodDto(z.object({ plan })) {}

/**
 * The company's plan and how it pays for it. Tenant-scoped
 * (`TenantContextMiddleware`), and `v1/billing` is an admin prefix in the
 * role guard, so only owners and admins start a payment. Reads are open to
 * every member.
 */
@ApiTags("billing")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/billing/subscription")
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  @Get()
  @ApiOperation({ summary: "Effective plan (trial, prepaid, subscription), prices, payment options and proformas" })
  status(@Req() req: TenantScopedRequest) {
    return this.subscriptions.status(req.tenantDb!, req.user!.tenantId);
  }

  @Post("checkout")
  @ApiOperation({ summary: "Stripe Checkout URL for a monthly or yearly subscription" })
  checkout(@Req() req: TenantScopedRequest, @Body() dto: CheckoutDto) {
    return this.subscriptions.checkout(req.tenantDb!, req.user!.tenantId, req.user!.email, dto);
  }

  @Post("portal")
  @ApiOperation({ summary: "Stripe Customer Portal URL (payment method, invoices, cancellation)" })
  portal(@Req() req: TenantScopedRequest, @Body() dto: PortalDto) {
    return this.subscriptions.portal(req.tenantDb!, req.user!.tenantId, dto.locale);
  }

  @Post("bank-transfer")
  @ApiOperation({ summary: "Issue a proforma for a year of a plan, paid by bank transfer (QR Platba)" })
  bankTransfer(@Req() req: TenantScopedRequest, @Body() dto: BankTransferDto) {
    return this.subscriptions.requestProforma(req.tenantDb!, req.user!.tenantId, req.user!.id, dto.plan);
  }
}
