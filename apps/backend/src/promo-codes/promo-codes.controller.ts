import { Body, Controller, Get, HttpException, HttpStatus, Ip, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SlidingWindowLimiter, visitorIp } from "../guest-invoices/guest-limits";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { RedeemPromoDto } from "./dto/promo-codes.dto";
import { PromoCodesService } from "./promo-codes.service";

/**
 * A company redeems one promo code (Billing, or the `?promo=` cookie after
 * sign-up). Under `v1/billing`, so only owners and admins redeem. Attempts
 * are limited per visitor and per company: a short code space would
 * otherwise be easy to walk.
 */
@ApiTags("promo-codes")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("v1/billing/promo-code")
export class PromoCodesController {
  private readonly perVisitor = new SlidingWindowLimiter(60 * 60 * 1000, 10);
  private readonly perCompany = new SlidingWindowLimiter(24 * 60 * 60 * 1000, 10);

  constructor(private readonly promoCodes: PromoCodesService) {}

  @Get()
  @ApiOperation({ summary: "The promo code this company redeemed, if any" })
  current(@Req() req: TenantScopedRequest) {
    return this.promoCodes.current(req.tenantDb!);
  }

  @Post()
  @ApiOperation({ summary: "Redeem a promo code: extra trial days or free months of a plan. One per company." })
  redeem(@Req() req: TenantScopedRequest, @Body() dto: RedeemPromoDto, @Ip() ip: string) {
    const tenantId = req.user!.tenantId;
    if (!this.perVisitor.hit(visitorIp(ip, req)) || !this.perCompany.hit(tenantId)) {
      throw new HttpException({ error: "promo_rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.promoCodes.redeem(req.tenantDb!, tenantId, dto.code, dto.source);
  }
}
