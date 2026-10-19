import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Ip, NotFoundException, Post, Query, Req, Res } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { z } from "zod";
import { AiService } from "../ai/ai.service";
import { ContactsService } from "../contacts/contacts.service";
import { GuestInvoicesService, guestInvoiceSchema, guestLetterSchema } from "./guest-invoices.service";
import { ConcurrencyGate, DailyCap, GATE_BUSY, SlidingWindowLimiter, visitorIp } from "./guest-limits";

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 20;
/** AI fill tries per visitor per UTC day, and for all visitors together (it costs real tokens). */
const AI_PER_VISITOR = Number(process.env.GUEST_AI_PER_VISITOR ?? 3);
const AI_GLOBAL_DAILY = Number(process.env.GUEST_AI_DAILY_LIMIT ?? 200);
/** All visitors together per UTC day: PDFs (CPU) and ARES lookups (a third-party service). */
const PDF_GLOBAL_DAILY = Number(process.env.GUEST_PDF_DAILY_LIMIT ?? 3000);
const LOOKUP_GLOBAL_DAILY = Number(process.env.GUEST_LOOKUP_DAILY_LIMIT ?? 2000);
/** PDFs rendered at the same time; more get a 503 instead of queueing up. */
const PDF_CONCURRENCY = 4;

const aiBodySchema = z.object({ text: z.string().trim().min(3).max(1500), vatPayer: z.boolean().default(false) });

/**
 * PUBLIC, unauthenticated "make an invoice without an account" endpoint.
 * Like `PublicInvoicesController`, it lives in its own module, has no JWT
 * guard and no tenant context, and never touches the database. Requests
 * are capped per IP with a small in-memory window (single backend
 * instance; the PDF is cheap but not free).
 */
@ApiTags("public-guest-invoice")
@Controller("v1/public/guest-invoice")
export class GuestInvoicesController {
  private readonly limiter = new SlidingWindowLimiter(WINDOW_MS, MAX_PER_WINDOW);
  private readonly pdfDaily = new DailyCap(PDF_GLOBAL_DAILY);
  private readonly lookupDaily = new DailyCap(LOOKUP_GLOBAL_DAILY);
  private readonly pdfGate = new ConcurrencyGate(PDF_CONCURRENCY);
  private aiDay = "";
  private aiTotal = 0;
  private readonly aiUses = new Map<string, number>();

  constructor(
    private readonly guestInvoices: GuestInvoicesService,
    private readonly ai: AiService,
    private readonly contacts: ContactsService,
  ) {}

  @Get("ai")
  @ApiOperation({ summary: "Whether the AI fill is available and how many tries this visitor has left today" })
  aiStatus(@Ip() ip: string, @Req() req: Request) {
    return this.aiQuota(visitorIp(ip, req));
  }

  @Post("ai")
  @HttpCode(200)
  @ApiOperation({
    summary: "Free-text description -> invoice fields for the guest form",
    description: `No authentication, nothing stored. ${AI_PER_VISITOR} tries per visitor per day plus a global daily cap.`,
  })
  async aiSuggest(@Body() body: unknown, @Ip() ip: string, @Req() req: Request) {
    const visitor = visitorIp(ip, req);
    this.throttle(visitor);
    const parsed = aiBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ error: "invalid_input" });
    const quota = this.aiQuota(visitor);
    if (!quota.available) throw new HttpException({ error: "ai_unavailable" }, HttpStatus.SERVICE_UNAVAILABLE);
    if (quota.remaining <= 0) {
      throw new HttpException({ error: quota.globalExhausted ? "ai_global_limit" : "ai_guest_limit", limit: AI_PER_VISITOR }, HttpStatus.TOO_MANY_REQUESTS);
    }
    // Counted before the call: a failed or slow request still used a try.
    this.aiTotal++;
    this.aiUses.set(visitor, (this.aiUses.get(visitor) ?? 0) + 1);
    const result = await this.ai.suggestGuestInvoice(parsed.data.text, parsed.data.vatPayer);
    return { ...result, remaining: this.aiQuota(visitor).remaining };
  }

  @Get("lookup")
  @ApiOperation({ summary: "Company details by Czech IČO from ARES (for the guest form)" })
  async lookup(@Query("ico") rawIco: string | undefined, @Ip() ip: string, @Req() req: Request) {
    this.throttle(visitorIp(ip, req));
    const ico = (rawIco ?? "").replace(/\s+/g, "");
    if (!/^\d{8}$/.test(ico)) throw new BadRequestException({ error: "invalid_ico" });
    if (!this.lookupDaily.take()) throw new HttpException({ error: "busy" }, HttpStatus.SERVICE_UNAVAILABLE);
    try {
      return await this.contacts.aresLookup(ico);
    } catch {
      throw new NotFoundException({ error: "not_found" });
    }
  }

  @Post("pdf")
  @HttpCode(200)
  @ApiOperation({
    summary: "Render a one-off invoice PDF for a visitor without an account",
    description: "No authentication. Nothing is stored; the PDF is built from the request body and returned. Rate-limited per IP.",
  })
  async pdf(@Body() body: unknown, @Ip() ip: string, @Req() req: Request, @Res() res: Response) {
    this.throttle(visitorIp(ip, req));
    const parsed = guestInvoiceSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ error: "invalid_input", issues: parsed.error.issues });
    if (!this.pdfDaily.take()) throw new HttpException({ error: "busy" }, HttpStatus.SERVICE_UNAVAILABLE);
    const buffer = await this.pdfGate.run(() => this.guestInvoices.generatePdf(parsed.data));
    if (buffer === GATE_BUSY) throw new HttpException({ error: "busy" }, HttpStatus.SERVICE_UNAVAILABLE);
    const filename = `faktura-${parsed.data.invoiceNumber.replace(/[^\w.-]+/g, "_")}.pdf`;
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    });
    res.send(buffer);
  }

  @Post("letter")
  @HttpCode(200)
  @ApiOperation({
    summary: "Render a payment reminder letter PDF for a visitor without an account",
    description: "No authentication. Nothing is stored; the PDF is the title and text from the request body. Shares the PDF limits with the invoice.",
  })
  async letter(@Body() body: unknown, @Ip() ip: string, @Req() req: Request, @Res() res: Response) {
    this.throttle(visitorIp(ip, req));
    const parsed = guestLetterSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException({ error: "invalid_input", issues: parsed.error.issues });
    if (!this.pdfDaily.take()) throw new HttpException({ error: "busy" }, HttpStatus.SERVICE_UNAVAILABLE);
    const buffer = await this.pdfGate.run(() => this.guestInvoices.generateLetterPdf(parsed.data));
    if (buffer === GATE_BUSY) throw new HttpException({ error: "busy" }, HttpStatus.SERVICE_UNAVAILABLE);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="letter.pdf"',
      "Cache-Control": "no-store",
    });
    res.send(buffer);
  }

  private aiQuota(visitor: string) {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.aiDay) {
      this.aiDay = day;
      this.aiTotal = 0;
      this.aiUses.clear();
    }
    const globalExhausted = this.aiTotal >= AI_GLOBAL_DAILY;
    const own = Math.max(0, AI_PER_VISITOR - (this.aiUses.get(visitor) ?? 0));
    return {
      available: this.ai.platformAvailable,
      limit: AI_PER_VISITOR,
      remaining: globalExhausted ? 0 : own,
      globalExhausted,
    };
  }

  private throttle(visitor: string) {
    if (!this.limiter.hit(visitor)) throw new HttpException({ error: "rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
  }
}
