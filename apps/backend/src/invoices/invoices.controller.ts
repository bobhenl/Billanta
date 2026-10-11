import { Body, Controller, Get, NotImplementedException, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { CombinedAuthGuard } from "../auth/combined-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequireActiveSubscription } from "../billing/require-active-subscription.guard";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import { CreateInvoiceDraftDto } from "./dto/create-invoice-draft.dto";
import { InvoicesService } from "./invoices.service";

/**
 * No controller-level `@UseGuards(...)` here (deliberately, since a recent
 * pass added the public API): the two representative "call our API to
 * create/list invoices programmatically" endpoints below (`list`,
 * `createDraft`) accept EITHER a dashboard/AI-service JWT OR an `sk_live_...`
 * API key via `CombinedAuthGuard`, while the rest of the controller stays
 * JWT-only via plain `JwtAuthGuard` — see combined-auth.guard.ts's doc
 * comment for the OR-composition mechanics, and
 * api-key-or-jwt-tenant-context.middleware.ts (registered in
 * AppModule.configure() for this controller specifically) for how tenant
 * context gets resolved for an API-key request before any guard here runs.
 */
@ApiTags("invoices")
@ApiBearerAuth()
@Controller("v1/invoices")
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({
    summary: "List invoices for the current tenant",
    description: "Accepts either a dashboard JWT or a public-API key (Authorization: Bearer sk_live_...).",
  })
  list(@Req() req: TenantScopedRequest) {
    return this.invoicesService.list(req.tenantDb!);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get an invoice by id" })
  findOne(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.invoicesService.findOne(req.tenantDb!, id);
  }

  /**
   * The contract the AI microservice depends on (blueprint §6 step 8).
   * Always creates `status = pending_review`; never allocates an invoice
   * number; never auto-finalizes (blueprint §6, §9). See the DTO's doc
   * comment for the wire-format deviation from this module's original
   * brief, made to match the already-implemented `apps/ai-service` caller.
   *
   * Auth: accepts a dashboard/AI-service JWT OR a public-API key
   * (`CombinedAuthGuard`) — architecturally just another authenticated REST
   * client, same role as the dashboard frontend (blueprint §3) or a
   * third-party integration.
   *
   * Plan-gated (blueprint §5): the representative endpoint
   * `@RequireActiveSubscription()` is wired up on — see
   * `SubscriptionActiveGuard` for what it does and does not enforce.
   */
  @Post("drafts")
  @UseGuards(CombinedAuthGuard)
  @RequireActiveSubscription()
  @ApiOperation({
    summary: "Create an invoice draft from AI voice-to-invoice extraction",
    description:
      "Called by the FastAPI AI microservice after transcription + GPT-4o structured " +
      "extraction + ARES enrichment. Always creates status=pending_review; never " +
      "allocates an invoice number and never auto-finalizes (blueprint §6, §9).",
  })
  createDraft(@Req() req: TenantScopedRequest, @Body() dto: CreateInvoiceDraftDto) {
    // tenantId comes from the same body field the tenant-context layer used
    // to resolve `req.tenantDb`'s SET LOCAL value (dto.tenant_id) — see
    // TenantContextMiddleware.handleServiceRequest (JWT/AI-service path) or
    // ApiKeyOrJwtTenantContextMiddleware.handleApiKeyRequest (API-key path).
    // RLS's WITH CHECK policy rejects the insert outright if these two ever
    // disagreed.
    return this.invoicesService.createDraft(req.tenantDb!, dto.tenant_id, dto);
  }

  /**
   * Emails the invoice to its contact via `EmailService.sendInvoiceEmail`
   * and stamps `sent_at`. Loads the invoice/contact through the normal
   * RLS-scoped `req.tenantDb` — NOT the public `get_public_invoice_view`
   * SECURITY DEFINER function, which exists only for the no-auth
   * client-portal view (`drizzle/rls-policies.sql`).
   */
  @Post(":id/send")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Email an invoice to its contact",
    description:
      "Loads the invoice and its contact via the caller's RLS-scoped tenant context, " +
      "sends the invoice email via Resend (EmailService), and sets sent_at. Fails with " +
      "400 if the invoice has no contact, or the contact has no email on file.",
  })
  send(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.invoicesService.sendInvoice(req.tenantDb!, id);
  }

  @Post(":id/issue")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Issue a reviewed draft (TODO: not yet implemented)",
    description:
      "The legal moment of responsibility transfer (§9): allocates the sequential " +
      "invoice number, sets issued_by_user_id/issued_at (and ai_draft_reviewed_at for " +
      "AI-sourced drafts), generates PDF/ISDOC/SPAYD QR via @faktur/cz-compliance, " +
      "and locks the record.",
  })
  issue(): never {
    // TODO: implement — depends on invoice_number_sequences allocation and
    // @faktur/cz-compliance's ISDOC/SPAYD generators, neither of which
    // exist yet.
    throw new NotImplementedException();
  }
}
