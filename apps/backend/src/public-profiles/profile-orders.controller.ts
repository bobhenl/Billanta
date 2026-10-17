import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Ip, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { ContactsService } from "../contacts/contacts.service";
import { DailyCap, SlidingWindowLimiter, visitorIp } from "../guest-invoices/guest-limits";
import { registryLookup, registryQueryOf } from "../public-invoices/registry-lookup";
import { ProfileOrdersService } from "./profile-orders.service";

/**
 * PUBLIC, unauthenticated orders from a company profile ("Objednat" next to
 * each service). No JWT guard and no tenant middleware: `ProfileOrdersService`
 * resolves the slug through a SECURITY DEFINER function and answers 404
 * unless the owner switched on "Přijímat objednávky z profilu". Every route
 * is rate-limited per visitor; the company also has a daily cap, and the
 * registry lookup a global one, since it calls third-party services.
 */
@ApiTags("public-profile-orders")
@Controller("v1/public/profiles/:slug/orders")
export class ProfileOrdersController {
  private readonly submitLimiter = new SlidingWindowLimiter(60 * 60 * 1000, 5);
  private readonly lookupLimiter = new SlidingWindowLimiter(10 * 60 * 1000, 20);
  private readonly lookupDaily = new DailyCap(Number(process.env.PROFILE_ORDER_LOOKUP_DAILY_LIMIT ?? 1000));

  constructor(
    private readonly orders: ProfileOrdersService,
    private readonly contacts: ContactsService,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: "Order a service from a public profile",
    description:
      "Creates a draft (pending_review) for the company to review; never issued, nothing is e-mailed to the customer. " +
      "404 when the profile takes no orders, 400 for invalid input, 429 for too many orders (visitor or company). " +
      "With Platba předem on, returns the payment details (amount, account, variable symbol) for the thank-you page.",
  })
  async submit(@Param("slug") slug: string, @Body() body: unknown, @Ip() ip: string, @Req() req: Request) {
    this.throttle(this.submitLimiter, visitorIp(ip, req));
    return this.orders.submit(slug, body);
  }

  @Get("lookup")
  @ApiOperation({ summary: "Company details by Czech/Slovak IČO (ARES/RPO) or EU VAT ID (VIES), for a profile that takes orders" })
  async lookup(
    @Param("slug") slug: string,
    @Query("ico") rawIco: string | undefined,
    @Query("vat") rawVat: string | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    this.throttle(this.lookupLimiter, visitorIp(ip, req));
    const query = registryQueryOf(rawIco, rawVat);
    if (!query) throw new BadRequestException({ error: "invalid_id" });
    await this.orders.assertOpen(slug);
    if (!this.lookupDaily.take()) throw new HttpException({ error: "busy" }, HttpStatus.SERVICE_UNAVAILABLE);
    return registryLookup(this.contacts, query);
  }

  private throttle(limiter: SlidingWindowLimiter, visitor: string) {
    if (!limiter.hit(visitor)) throw new HttpException({ error: "rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
