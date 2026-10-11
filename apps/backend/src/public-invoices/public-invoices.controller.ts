import { BadRequestException, Body, Controller, Get, HttpCode, HttpException, HttpStatus, Ip, Param, Post, Req, Res } from "@nestjs/common";
import { z } from "zod";
import type { Request, Response } from "express";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { PublicInvoicesService } from "./public-invoices.service";
import { SlidingWindowLimiter, visitorBucket } from "../guest-invoices/guest-limits";

/**
 * PUBLIC, unauthenticated client-portal endpoint. A client clicking an
 * emailed invoice link has no session, no JWT, and no tenant context — so,
 * like `ChannelLinksController`'s `verify` route (see `AppModule.configure`'s
 * comment on `TenantContextMiddleware.forRoutes(...)`), this controller is
 * deliberately:
 *   - NOT decorated with `@UseGuards(JwtAuthGuard)` — there is no bearer
 *     token to check, and requiring one would defeat the entire point of a
 *     no-auth client portal;
 *   - NOT listed in `TenantContextMiddleware.forRoutes(...)` in
 *     `app.module.ts` — there is no tenant to resolve `req.tenantDb`
 *     against yet, and `PublicInvoicesService` never touches `req.tenantDb`
 *     in the first place. Every read instead goes through one of the three
 *     narrow `SECURITY DEFINER` SQL functions in `drizzle/rls-policies.sql`
 *     keyed on the invoice's unguessable `public_token`.
 *
 * Deliberately kept in its own module/controller rather than added as a
 * route on the tenant-scoped `InvoicesController` — so the "this is a
 * public, unauthenticated surface" fact is visible from the module
 * boundary itself, not just from a middleware exclude-list entry (or a
 * missing `@UseGuards`) someone could overlook later while editing
 * `InvoicesController` for an unrelated reason.
 */
const quoteResponseSchema = z.object({
  response: z.enum(["accepted", "rejected"]),
  name: z.string().trim().min(1).max(120),
  note: z.string().max(2000).optional(),
});

const abuseReportSchema = z.object({
  reason: z.enum(["fraud", "not_ordered", "spam", "other"]),
  message: z.string().max(2000).optional(),
  email: z.string().trim().max(200).email().optional().or(z.literal("")),
});

/** The reporter's IP; the frontend's server action forwards it as x-guest-ip, trusted only from local addresses. */
function reporterBucket(ip: string, req: Request): string {
  const forwarded = req.headers["x-guest-ip"];
  const local = /^(::1|127\.|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(10|192\.168|172)\.)/.test(ip);
  return visitorBucket(local && typeof forwarded === "string" && forwarded ? forwarded.slice(0, 64) : ip);
}

@ApiTags("public-invoices")
@Controller("v1/public/invoices")
export class PublicInvoicesController {
  private readonly reportLimiter = new SlidingWindowLimiter(60 * 60 * 1000, 5);

  constructor(private readonly publicInvoicesService: PublicInvoicesService) {}

  @Get(":token")
  @ApiOperation({
    summary: "Get a client-portal view of an invoice by its public token",
    description:
      "No authentication required. `token` is the invoice's unguessable `public_token` " +
      "(see `invoices.publicToken` in `drizzle/schema.ts`) — the id embedded in the " +
      "shareable link a client is sent, distinct from the invoice's internal `id`. " +
      "Returns 404 for both an unmatched and a malformed token (never a different error " +
      "shape that would let a caller distinguish the two). Only fields explicitly reviewed " +
      "as safe for an external client are returned — see the `get_public_invoice_view` / " +
      "`get_public_invoice_line_items` / `get_public_invoice_supplier_info` SECURITY DEFINER " +
      "functions in `drizzle/rls-policies.sql` for exactly what is excluded (AI-draft " +
      "transcript/extraction metadata, the liability audit trail, dunning bookkeeping, " +
      "every other tenant's data, and every `tenants` column beyond company name + bank " +
      "account).",
  })
  findByToken(@Param("token") token: string) {
    return this.publicInvoicesService.findByPublicToken(token);
  }

  @Get(":token/attachments/:attachmentId")
  @ApiOperation({
    summary: "Download a file attached to the invoice",
    description: "No authentication required. Only attachments marked show_in_portal, never for drafts.",
  })
  async downloadAttachment(
    @Param("token") token: string,
    @Param("attachmentId") attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.publicInvoicesService.downloadAttachment(token, attachmentId);
    res.set({
      "Content-Type": file.mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    res.send(file.content);
  }

  @Post(":token/respond")
  @HttpCode(204)
  @ApiOperation({
    summary: "Accept or reject a quote from the client portal",
    description: "No authentication required. Only issued quotes without an answer; 409 otherwise.",
  })
  async respond(@Param("token") token: string, @Body() body: unknown): Promise<void> {
    const parsed = quoteResponseSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid response");
    await this.publicInvoicesService.respondToQuote(token, parsed.data.response, parsed.data.name, parsed.data.note?.trim() || null);
  }

  @Post(":token/view")
  @HttpCode(204)
  @ApiOperation({
    summary: "Count one client-portal view of an invoice",
    description:
      "No authentication required. Always 204 — an unknown token, a draft, or a malformed " +
      "value is silently ignored so the endpoint reveals nothing about which tokens exist.",
  })
  recordView(@Param("token") token: string) {
    return this.publicInvoicesService.recordView(token);
  }

  @Post(":token/report")
  @HttpCode(204)
  @ApiOperation({
    summary: "Report a suspicious document (possible fake invoice)",
    description:
      "No authentication required. Always 204 for a valid body, also for an unknown token. " +
      "Limited to 5 reports per hour per visitor; repeated reports of the same document by " +
      "the same visitor count once.",
  })
  async report(@Param("token") token: string, @Body() body: unknown, @Ip() ip: string, @Req() req: Request): Promise<void> {
    const parsed = abuseReportSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("Invalid report");
    const bucket = reporterBucket(ip, req);
    if (!this.reportLimiter.hit(bucket)) throw new HttpException("Too many reports", HttpStatus.TOO_MANY_REQUESTS);
    await this.publicInvoicesService.reportAbuse(
      token,
      parsed.data.reason,
      parsed.data.message?.trim() || null,
      parsed.data.email?.trim() || null,
      bucket,
    );
  }
}
