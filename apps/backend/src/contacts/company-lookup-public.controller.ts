import { Controller, Get, HttpException, HttpStatus, Ip, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { DailyCap, SlidingWindowLimiter, visitorIp } from "../guest-invoices/guest-limits";
import type { AresContactPrefill } from "./ares-mapper.util";
import { COMPANY_REGISTRIES, ContactsService, registryForCountry, type CompanyRegistry } from "./contacts.service";

/** One company from a public register, in the shape the public forms fill in. */
export interface PublicCompanyHit {
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  source: string | null;
  regNumber: string | null;
}

export const toPublicHit = (h: AresContactPrefill): PublicCompanyHit => ({
  name: h.legalName,
  ico: h.ico || null,
  dic: h.dic,
  street: h.addressStreet,
  city: h.addressCity,
  postalCode: h.addressPostalCode,
  country: h.addressCountry,
  source: h.source ?? (h.addressCountry === "SK" ? "RPO" : "ARES"),
  regNumber: h.regNumber ?? null,
});

/**
 * PUBLIC company lookup for forms filled in without an account (the buyer
 * details page, the order form on a public profile): name, IČO or EU VAT
 * number in the register of the picked country (ARES, RPO, VIES …), or in
 * CZ + SK when the country is unknown. Only public register data, never
 * anyone's contacts. Rate-limited per visitor plus a global daily cap,
 * since every miss costs a call to a third-party service.
 */
@ApiTags("public-company-lookup")
@Controller("v1/public/company-lookup")
export class CompanyLookupPublicController {
  private readonly searchLimiter = new SlidingWindowLimiter(10 * 60 * 1000, 80);
  private readonly vatLimiter = new SlidingWindowLimiter(10 * 60 * 1000, 20);
  private readonly daily = new DailyCap(Number(process.env.PUBLIC_LOOKUP_DAILY_LIMIT ?? 5000));

  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @ApiOperation({ summary: "Typeahead over public company registers: ?q= (name, IČO or VAT number) and optional ?country= or ?registry=" })
  async search(
    @Query("q") q = "",
    @Query("country") country: string | undefined,
    @Query("registry") registry: string | undefined,
    @Ip() ip: string,
    @Req() req: Request,
  ): Promise<{ hits: PublicCompanyHit[] }> {
    const query = q.trim().slice(0, 120);
    if (query.length < 2) return { hits: [] };
    this.take(this.searchLimiter, ip, req);
    const picked: CompanyRegistry =
      registry && (COMPANY_REGISTRIES as readonly string[]).includes(registry) && registry !== "none"
        ? (registry as CompanyRegistry)
        : registryForCountry(country);
    const hits = await this.contacts.registrySearch(query, picked);
    return { hits: hits.slice(0, 8).map(toPublicHit) };
  }

  @Get("vat-check")
  @ApiOperation({ summary: "Whether a DIČ / EU VAT number is registered for VAT (CZ register of VAT payers, VIES)" })
  async vatCheck(@Query("dic") dic = "", @Ip() ip: string, @Req() req: Request) {
    this.take(this.vatLimiter, ip, req);
    const check = await this.contacts.vatCheck(dic);
    // The published bank accounts are for a signed-in supplier checking a customer, not for anonymous visitors.
    return check ? { vatId: check.vatId, state: check.state, source: check.source, name: check.name } : null;
  }

  private take(limiter: SlidingWindowLimiter, ip: string, req: Request) {
    if (!limiter.hit(visitorIp(ip, req))) throw new HttpException({ error: "rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
    if (!this.daily.take()) throw new HttpException({ error: "busy" }, HttpStatus.SERVICE_UNAVAILABLE);
  }
}
