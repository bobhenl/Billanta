import { Controller, Get, HttpCode, Ip, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { visitorIp } from "../guest-invoices/guest-limits";
import { PARTNER_CATEGORIES, PartnersService, type PartnerCategory } from "./partners.service";

/**
 * PUBLIC partners directory: the /partneri page, the footer strip and the
 * counting redirect behind `/partneri/go/:slug`. Like the guest invoice, its
 * own module, no JWT guard, no tenant context.
 */
@ApiTags("public-partners")
@Controller("v1/public/partners")
export class PublicPartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @ApiOperation({ summary: "Active partners (`?category=`, `?footer=1` for the footer strip)" })
  list(@Query("category") category?: string, @Query("footer") footer?: string) {
    const known = (PARTNER_CATEGORIES as readonly string[]).includes(category ?? "") ? (category as PartnerCategory) : undefined;
    return this.partners.listPublic({ category: known, footer: footer === "1" || footer === "true" });
  }

  @Post(":slug/click")
  @HttpCode(200)
  @ApiOperation({ summary: "Counts a click (bots and repeats within an hour excluded) and returns the partner URL" })
  click(@Param("slug") slug: string, @Ip() ip: string, @Req() req: Request) {
    const ua = req.headers["x-guest-ua"] ?? req.headers["user-agent"];
    return this.partners.click(slug.slice(0, 60), visitorIp(ip, req), typeof ua === "string" ? ua : undefined);
  }
}
