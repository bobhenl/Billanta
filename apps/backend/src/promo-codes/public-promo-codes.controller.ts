import { Controller, Get, Header, HttpException, HttpStatus, Ip, Param, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { SlidingWindowLimiter, visitorIp } from "../guest-invoices/guest-limits";
import { PromoCodesService } from "./promo-codes.service";

/**
 * PUBLIC: what the `/join/CODE` page shows before anyone signs in (who the
 * code is from, the benefit, the business type). No JWT, no tenant: the
 * catalogue is global. Limited per visitor because a lookup answers the
 * same question a redemption does.
 */
@ApiTags("public-promo-codes")
@Controller("v1/public/promo-codes")
export class PublicPromoCodesController {
  private readonly perVisitor = new SlidingWindowLimiter(60 * 60 * 1000, 30);

  constructor(private readonly promoCodes: PromoCodesService) {}

  @Get(":code")
  @Header("Cache-Control", "no-store")
  @ApiOperation({ summary: "A redeemable code's join-page details; promo_invalid (404) for anything else" })
  lookup(@Param("code") code: string, @Ip() ip: string, @Req() req: Request) {
    if (!this.perVisitor.hit(visitorIp(ip, req))) {
      throw new HttpException({ error: "promo_rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return this.promoCodes.lookup(code.slice(0, 64));
  }
}
