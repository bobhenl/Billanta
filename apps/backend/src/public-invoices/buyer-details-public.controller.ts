import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Ip, NotFoundException, Param, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { toPublicHit } from "../contacts/company-lookup-public.controller";
import { ContactsService, hasSlowPart, registryForCountry, registryPartOf } from "../contacts/contacts.service";
import { DailyCap, SlidingWindowLimiter, visitorBucket } from "../guest-invoices/guest-limits";
import { BuyerDetailsService } from "../invoices/buyer-details.service";
import { sameCompanyName, TOKEN_PATTERN } from "../invoices/buyer-details.util";
import { registryLookup, registryQueryOf } from "./registry-lookup";

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
  // Typeahead: two requests per pause in typing (fast and slow half), so a looser limit than the exact lookup.
  private readonly searchLimiter = new SlidingWindowLimiter(10 * 60 * 1000, 160);
  private readonly lookupDaily = new DailyCap(Number(process.env.BUYER_LOOKUP_DAILY_LIMIT ?? 4000));

  constructor(
    private readonly buyerDetails: BuyerDetailsService,
    private readonly contacts: ContactsService,
  ) {}

  @Get(":token")
  @ApiOperation({ summary: "The draft the customer is asked to complete: supplier, items, amount (read-only)" })
  async view(@Param("token") token: string, @Ip() ip: string, @Req() req: Request) {
    this.throttle(this.viewLimiter, visitorOf(ip, req));
    if (!TOKEN_PATTERN.test(token)) throw new NotFoundException("Link not found");
    const view = await this.buyerDetails.publicView(token);
    return { ...view, supplierVerified: await this.supplierVerified(view.supplier) };
  }

  /**
   * True only when the register (ARES, RPO for a Slovak supplier) knows the
   * supplier's IČO under the same name. Cached in ares_cache; any outage or
   * mismatch is simply "not verified", and the page then says nothing.
   */
  private async supplierVerified(supplier: { name: string; ico: string | null; country: string }): Promise<boolean> {
    if (!supplier.ico || !/^\d{8}$/.test(supplier.ico) || !["CZ", "SK"].includes(supplier.country)) return false;
    try {
      const hit = await this.contacts.lookupById(supplier.ico, supplier.country);
      return hit.ico === supplier.ico && sameCompanyName(hit.legalName, supplier.name);
    } catch {
      return false;
    }
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
  @ApiOperation({
    summary: "Company details by Czech/Slovak IČO (ARES/RPO) or EU VAT ID (VIES), for this link only",
    description:
      "With ?q= instead: a name typeahead in the register of ?country= (CZ + SK when unknown), returning { hits }. " +
      "?part=fast leaves out the slow Slovak name search, ?part=slow returns only it.",
  })
  async lookup(
    @Param("token") token: string,
    @Query("ico") rawIco: string | undefined,
    @Query("vat") rawVat: string | undefined,
    @Query("q") rawQ: string | undefined,
    @Query("country") country: string | undefined,
    @Query("part") rawPart: string | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ) {
    const q = (rawQ ?? "").trim().slice(0, 120);
    if (q) {
      if (q.length < 2) return { hits: [] };
      const registry = registryForCountry(country);
      const part = registryPartOf(rawPart);
      if (part === "slow" && !hasSlowPart(q, registry)) return { hits: [] };
      this.throttle(this.searchLimiter, visitorOf(ip, req));
      await this.buyerDetails.assertOpen(token);
      if (!this.lookupDaily.take()) throw new HttpException({ error: "busy" }, HttpStatus.SERVICE_UNAVAILABLE);
      const hits = await this.contacts.registrySearch(q, registry, part);
      return { hits: hits.slice(0, 8).map(toPublicHit) };
    }
    this.throttle(this.lookupLimiter, visitorOf(ip, req));
    const query = registryQueryOf(rawIco, rawVat);
    if (!query) throw new BadRequestException({ error: "invalid_id" });
    await this.buyerDetails.assertOpen(token);
    if (!this.lookupDaily.take()) throw new HttpException({ error: "busy" }, HttpStatus.SERVICE_UNAVAILABLE);
    return registryLookup(this.contacts, query, country);
  }

  private throttle(limiter: SlidingWindowLimiter, visitor: string) {
    if (!limiter.hit(visitor)) throw new HttpException({ error: "rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
