import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Ip, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { lookupVies, parseVatId } from "@faktur/cz-compliance";
import { ContactsService } from "../contacts/contacts.service";
import { DailyCap, SlidingWindowLimiter, visitorBucket } from "../guest-invoices/guest-limits";
import { BuyerDetailsService } from "../invoices/buyer-details.service";
import { TOKEN_PATTERN } from "../invoices/buyer-details.util";

/** The visitor's IP; the frontend's server action / route forwards it as x-guest-ip, trusted only from local addresses. */
function visitorOf(ip: string, req: Request): string {
  const forwarded = req.headers["x-guest-ip"];
  const local = /^(::1|127\.|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(10|192\.168|172)\.)/.test(ip);
  return visitorBucket(local && typeof forwarded === "string" && forwarded ? forwarded.slice(0, 64) : ip);
}

/**
 * PUBLIC, unauthenticated "Odběratel si doplní údaje sám" page
 * (`/d/:token` in the frontend). Like `PublicInvoicesController` it has no
 * JWT guard and no tenant middleware; `BuyerDetailsService` resolves the
 * token through a SECURITY DEFINER function and works only on drafts.
 * Every route is rate-limited per visitor; the registry lookup also has a
 * global daily cap, since it calls third-party services.
 */
@ApiTags("public-buyer-details")
@Controller("v1/public/buyer-details")
export class BuyerDetailsPublicController {
  private readonly viewLimiter = new SlidingWindowLimiter(10 * 60 * 1000, 60);
  private readonly submitLimiter = new SlidingWindowLimiter(60 * 60 * 1000, 10);
  private readonly lookupLimiter = new SlidingWindowLimiter(10 * 60 * 1000, 20);
  private readonly lookupDaily = new DailyCap(Number(process.env.BUYER_LOOKUP_DAILY_LIMIT ?? 2000));

  constructor(
    private readonly buyerDetails: BuyerDetailsService,
    private readonly contacts: ContactsService,
  ) {}

  @Get(":token")
  @ApiOperation({ summary: "The draft the customer is asked to complete: supplier, items, amount (read-only)" })
  view(@Param("token") token: string, @Ip() ip: string, @Req() req: Request) {
    this.throttle(this.viewLimiter, visitorOf(ip, req));
    if (!TOKEN_PATTERN.test(token)) throw new NotFoundException("Link not found");
    return this.buyerDetails.publicView(token);
  }

  @Post(":token")
  @HttpCode(204)
  @ApiOperation({
    summary: "Submit the customer's billing details",
    description: "Single use; 404 for an unknown/closed link, 409 once submitted or no longer a draft, 400 for invalid details.",
  })
  async submit(@Param("token") token: string, @Body() body: unknown, @Ip() ip: string, @Req() req: Request): Promise<void> {
    this.throttle(this.submitLimiter, visitorOf(ip, req));
    await this.buyerDetails.submit(token, body);
  }

  @Get(":token/lookup")
  @ApiOperation({ summary: "Company details by Czech/Slovak IČO (ARES/RPO) or EU VAT ID (VIES), for this link only" })
  async lookup(
    @Param("token") token: string,
    @Query("ico") rawIco: string | undefined,
    @Query("vat") rawVat: string | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    this.throttle(this.lookupLimiter, visitorOf(ip, req));
    const ico = (rawIco ?? "").replace(/\s+/g, "");
    const vat = (rawVat ?? "").replace(/[\s.-]/g, "").toUpperCase();
    if (ico ? !/^\d{6,8}$/.test(ico) : !parseVatId(vat)) throw new BadRequestException({ error: "invalid_id" });
    await this.buyerDetails.assertOpen(token);
    if (!this.lookupDaily.take()) throw new HttpException({ error: "busy" }, HttpStatus.SERVICE_UNAVAILABLE);
    try {
      if (ico) {
        const hit = await this.contacts.aresLookup(ico.padStart(8, "0"));
        return {
          name: hit.legalName,
          ico: hit.ico || null,
          dic: hit.dic,
          street: hit.addressStreet,
          city: hit.addressCity,
          postalCode: hit.addressPostalCode,
          country: hit.addressCountry,
        };
      }
      const [hit] = await lookupVies(vat);
      if (!hit) throw new Error("not found");
      return { name: hit.name || null, ico: null, dic: hit.vatId, street: hit.street, city: hit.city, postalCode: hit.postalCode, country: hit.country };
    } catch {
      throw new NotFoundException({ error: "not_found" });
    }
  }

  private throttle(limiter: SlidingWindowLimiter, visitor: string) {
    if (!limiter.hit(visitor)) throw new HttpException({ error: "rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
