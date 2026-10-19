import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { CombinedAuthGuard } from "../auth/combined-auth.guard";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { RequireActiveSubscription } from "../billing/require-active-subscription.guard";
import { parseIdempotencyKey } from "../common/idempotency";
import { MAX_VOICE_NOTE_BYTES, voiceNoteType } from "../ai/voice-transcription";
import type { TenantScopedRequest } from "../tenancy/tenant-context.middleware";
import {
  ConvertInvoiceDto,
  CreateInvoiceDto,
  listInvoicesQuerySchema,
  UpdateInvoiceDto,
} from "./dto/create-invoice.dto";
import { CreateInvoiceDraftDto } from "./dto/create-invoice-draft.dto";
import { getHomeRate } from "../exports/home-rates";
import { tenantHomeCurrency } from "../tenants/home-currency";
import { InvoiceAttachmentsService, MAX_ATTACHMENT_BYTES } from "./invoice-attachments.service";
import { InvoiceImportService } from "./invoice-import.service";
import { InvoicesService } from "./invoices.service";
import { BUYER_DETAILS_FIELDS } from "./buyer-details.util";
import { BuyerDetailsService } from "./buyer-details.service";
import { customSlugSchema } from "../public-links/public-link";

const MAX_IMPORT_CSV_BYTES = 5 * 1024 * 1024;

const buyerDetailsRequestSchema = z.object({
  email: z.string().trim().max(200).email().optional().or(z.literal("")),
  autoIssue: z.boolean().optional(),
  // Which fields the customer must fill in; omitted = the company default.
  required: z.array(z.enum(BUYER_DETAILS_FIELDS)).max(4).optional(),
  saveAsDefault: z.boolean().optional(),
});

class BitfakturaImportDto extends createZodDto(
  z.object({
    account: z.string().trim().min(1).max(200),
    apiToken: z.string().trim().min(8).max(200),
    dryRun: z.boolean().optional(),
    /** Only the invoices of this supplier IČO (the preview lists them when there are several). */
    sellerIco: z.string().regex(/^\d{8}$/).optional(),
  }),
) {}

class PublicSlugDto extends createZodDto(z.object({ slug: customSlugSchema })) {}

class FakturoidImportDto extends createZodDto(
  z.object({
    clientId: z.string().trim().min(8).max(200),
    clientSecret: z.string().trim().min(8).max(200),
    /** The account slug; only needed when the Fakturoid user has several accounts. */
    account: z.string().trim().max(200).optional(),
    dryRun: z.boolean().optional(),
    sellerIco: z.string().regex(/^\d{8}$/).optional(),
  }),
) {}

class RefreshPartiesDto extends createZodDto(
  z.object({
    party: z.enum(["seller", "buyer", "both"]).default("both"),
    reason: z.string().trim().max(500).optional(),
  }),
) {}

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
  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly attachmentsService: InvoiceAttachmentsService,
    private readonly importService: InvoiceImportService,
    private readonly buyerDetails: BuyerDetailsService,
  ) {}

  @Get()
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({
    summary: "List invoices for the current tenant",
    description:
      "Accepts either a dashboard JWT or a public-API key (Authorization: Bearer sk_live_...). " +
      "Each row carries contactName and computed totals. Filters: ?type=invoice|proforma|credit_note|quote, " +
      "?status=draft|issued|paid|cancelled|overdue, ?contact_id=, ?q= (number, customer, VS, order number), " +
      "?date_field=issue|due|paid|taxable|sent|created &from= &to=, ?source=, ?language=, ?vat_rate=, ?paid_state=, " +
      "?overdue_days=, ?reminded=, ?attachments=, ?item= and more (see ListInvoicesQuery).",
  })
  list(@Req() req: TenantScopedRequest, @Query() query: Record<string, string>) {
    return this.invoicesService.list(req.tenantDb!, listInvoicesQuerySchema.parse(query));
  }

  // Declared before `:id` so the literal path is never captured as an id.
  @Get("item-suggestions")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Line-item typeahead from this tenant's previous invoices" })
  itemSuggestions(@Req() req: TenantScopedRequest, @Query("q") q = "") {
    return this.invoicesService.itemSuggestions(req.tenantDb!, q);
  }

  @Get("exchange-rate")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({
    summary:
      "Official rate in the company's home currency (ČNB in CZK, or ECB in EUR for a Slovak company) per 1 unit of ?currency=USD&date=YYYY-MM-DD; rate is null when unavailable",
  })
  async exchangeRate(@Req() req: TenantScopedRequest, @Query("currency") currency = "", @Query("date") date?: string) {
    if (!/^[A-Za-z]{3}$/.test(currency)) throw new BadRequestException("currency must be a 3-letter code");
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T12:00:00`) : null;
    const home = await tenantHomeCurrency(req.tenantDb!, req.user!.tenantId);
    return { currency: currency.toUpperCase(), home, rate: await getHomeRate(home, currency, day) };
  }

  @Post()
  @UseGuards(CombinedAuthGuard)
  @RequireActiveSubscription()
  @ApiOperation({
    summary: "Create a draft document (invoice, proforma, credit note or quote; status=draft, no number yet)",
    description:
      "Accepts either a dashboard JWT or a public-API key. Issue it with POST /:id/issue. " +
      "With an Idempotency-Key header a retry returns the draft the first request created.",
  })
  create(@Req() req: TenantScopedRequest, @Body() dto: CreateInvoiceDto, @Headers("idempotency-key") idempotencyKey?: string) {
    return this.invoicesService.create(
      req.tenantDb!,
      req.user!.tenantId,
      dto,
      req.user!.email ? "manual" : "api",
      parseIdempotencyKey(idempotencyKey),
    );
  }

  // Declared before ":id/duplicate" so "latest" never reaches the UUID pipe.
  @Get("latest/duplicate")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "The most recent invoice (no credit notes) as a template for a new draft" })
  latestDuplicateTemplate(@Req() req: TenantScopedRequest) {
    return this.invoicesService.latestDuplicateTemplate(req.tenantDb!);
  }

  @Get(":id/duplicate")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "An invoice's customer, currency, term and items as a template for a new draft" })
  duplicateTemplate(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.invoicesService.duplicateTemplate(req.tenantDb!, id);
  }

  @Get(":id/detail")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({ summary: "Invoice with customer, line items, VAT recapitulation and linked documents" })
  detail(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.invoicesService.detail(req.tenantDb!, id);
  }

  @Get(":id")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Get an invoice by id" })
  findOne(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.invoicesService.findOne(req.tenantDb!, id);
  }

  @Patch(":id")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({ summary: "Edit a draft (line_items, when sent, replaces all items)" })
  update(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto) {
    return this.invoicesService.update(req.tenantDb!, req.user!.tenantId, id, dto);
  }

  @Delete(":id")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({ summary: "Delete an unissued draft" })
  remove(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.invoicesService.remove(req.tenantDb!, id);
  }

  @Post("import")
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMPORT_CSV_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } })
  @ApiOperation({
    summary: "Import invoice history from another system (CSV; ?dryRun=1 only previews)",
    description:
      "Rows are matched by invoice number (several rows = several line items); existing numbers are skipped. " +
      "Imported invoices are issued as-is with source=import: nothing is sent and no reminders go out.",
  })
  importCsv(@Req() req: TenantScopedRequest, @Query("dryRun") dryRun?: string, @UploadedFile() file?: { buffer: Buffer }) {
    if (!file) throw new BadRequestException({ error: "no_file" });
    // Bulk history rewrites the books' past: owner/admin only, even for members with invoice write access.
    if (req.user!.role !== "owner" && req.user!.role !== "admin") throw new ForbiddenException({ error: "forbidden" });
    return this.importService.importCsv(req.tenantDb!, req.user!.tenantId, file.buffer, dryRun === "1" || dryRun === "true");
  }

  @Post("import/bitfaktura")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Import invoice history straight from a BitFaktura / InvoiceOcean account (dryRun only previews)",
    description: "The API token is used for this request's read-only calls and is never stored. Same rules as the CSV import.",
  })
  importBitfaktura(@Req() req: TenantScopedRequest, @Body() dto: BitfakturaImportDto) {
    if (req.user!.role !== "owner" && req.user!.role !== "admin") throw new ForbiddenException({ error: "forbidden" });
    return this.importService.importFromBitfaktura(req.tenantDb!, req.user!.tenantId, dto.account, dto.apiToken, dto.dryRun ?? false, undefined, dto.sellerIco);
  }

  @Post("import/fakturoid")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Import invoice history straight from a Fakturoid account over API v3 (dryRun only previews)",
    description:
      "The Client ID and secret (Fakturoid Settings → User account) are used for this request only and never stored. " +
      "Apart from the OAuth token request only GETs are sent. Same rules as the CSV import.",
  })
  importFakturoid(@Req() req: TenantScopedRequest, @Body() dto: FakturoidImportDto) {
    if (req.user!.role !== "owner" && req.user!.role !== "admin") throw new ForbiddenException({ error: "forbidden" });
    return this.importService.importFromFakturoid(
      req.tenantDb!,
      req.user!.tenantId,
      { clientId: dto.clientId, clientSecret: dto.clientSecret, account: dto.account || undefined },
      dto.dryRun ?? false,
      undefined,
      dto.sellerIco,
    );
  }

  @Post(":id/mark-paid")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({
    summary:
      "Record a payment: in full, or a partial { amount } (optional { paid_at }, { fee } kept by the payment provider in the invoice currency, { received_czk } actually credited)",
  })
  markPaid(
    @Req() req: TenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: { paid_at?: string; amount?: number; fee?: number; received_czk?: number } = {},
  ) {
    const paidAt = body?.paid_at ? new Date(body.paid_at) : undefined;
    const amount = body?.amount == null ? undefined : Number(body.amount);
    if (amount !== undefined && !(amount > 0 && amount < 1e9)) throw new BadRequestException("Invalid amount");
    const fee = body?.fee == null ? undefined : Number(body.fee);
    if (fee !== undefined && !(fee >= 0 && fee < 1e9)) throw new BadRequestException("Invalid fee");
    const receivedCzk = body?.received_czk == null ? undefined : Number(body.received_czk);
    if (receivedCzk !== undefined && !(receivedCzk > 0 && receivedCzk < 1e11)) throw new BadRequestException("Invalid received_czk");
    return this.invoicesService.markPaid(req.tenantDb!, id, paidAt && !isNaN(paidAt.getTime()) ? paidAt : undefined, amount, { fee, receivedCzk });
  }

  @Post(":id/mark-unpaid")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({ summary: "Undo a payment" })
  markUnpaid(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.invoicesService.markUnpaid(req.tenantDb!, id);
  }

  @Post(":id/public-link/rotate")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({ summary: "Issue a new secret client link for the document (the old link stops working)" })
  rotatePublicLink(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.invoicesService.rotatePublicToken(req.tenantDb!, id);
  }

  @Patch(":id/public-link")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({ summary: "Set or clear the custom readable name in front of the client link's key (cosmetic; the key stays the secret)" })
  setPublicSlug(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: PublicSlugDto) {
    return this.invoicesService.setPublicSlug(req.tenantDb!, id, dto.slug);
  }

  @Post(":id/buyer-details-request")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Send a draft to the customer to fill in their own billing details",
    description:
      "Creates a new secret link (/d/:token; an older one stops working) and optionally e-mails it. " +
      "Only drafts. With autoIssue the draft is issued and sent once the customer submits, " +
      "unless their details differ from a saved contact.",
  })
  requestBuyerDetails(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() body: unknown) {
    const parsed = buyerDetailsRequestSchema.safeParse(body ?? {});
    if (!parsed.success) throw new BadRequestException("Invalid e-mail address");
    return this.buyerDetails.request(req.tenantDb!, req.user!.tenantId, req.user!.id, id, {
      email: parsed.data.email || null,
      autoIssue: parsed.data.autoIssue,
      required: parsed.data.required,
      saveAsDefault: parsed.data.saveAsDefault,
    });
  }

  @Delete(":id/buyer-details-request")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Close the buyer-details link of a draft (it stops working at once)" })
  cancelBuyerDetails(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.buyerDetails.cancel(req.tenantDb!, req.user!.tenantId, id);
  }

  @Post(":id/cancel")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({ summary: "Cancel (storno) an issued document; its number stays used" })
  cancel(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.invoicesService.cancel(req.tenantDb!, id);
  }

  @Post(":id/refresh-parties")
  @UseGuards(CombinedAuthGuard)
  @ApiOperation({
    summary: "Replace an issued document's supplier/buyer snapshot with the current details",
    description:
      "Issued documents keep the supplier and buyer as they were on the issue date. " +
      "This explicit, audit-logged action re-takes them from today's company settings / contact.",
  })
  refreshParties(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: RefreshPartiesDto) {
    return this.invoicesService.refreshPartySnapshot(req.tenantDb!, req.user!.tenantId, id, dto.party, dto.reason);
  }

  @Post(":id/convert")
  @UseGuards(CombinedAuthGuard)
  @RequireActiveSubscription()
  @ApiOperation({
    summary: "New draft from this document: quote→invoice/proforma, proforma→final invoice, invoice→credit note",
  })
  convert(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() dto: ConvertInvoiceDto) {
    return this.invoicesService.convert(req.tenantDb!, req.user!.tenantId, id, dto.to);
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
   * A voice note recorded in the dashboard, usually without a connection and
   * sent from the offline queue later (docs/offline-drafts-plan.md). JWT
   * only: it runs on the member's company AI mode, like the form's AI
   * fill-in. Always a `pending_review` draft, never issued.
   */
  @Post("voice-drafts")
  @UseGuards(JwtAuthGuard)
  @RequireActiveSubscription()
  @UseInterceptors(FileInterceptor("audio", { limits: { fileSize: MAX_VOICE_NOTE_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: { audio: { type: "string", format: "binary" }, language: { type: "string", enum: ["cs", "sk", "en"] } },
      required: ["audio"],
    },
  })
  @ApiOperation({
    summary: "Voice note -> transcribed invoice draft for review (status=pending_review)",
    description:
      "WebM/Ogg/MP4/MP3/WAV up to 5 MB, multipart field \"audio\". " +
      "With an Idempotency-Key header a retry returns the draft the first request created.",
  })
  createVoiceDraft(
    @Req() req: TenantScopedRequest,
    @UploadedFile() file: { mimetype: string; size: number; buffer: Buffer } | undefined,
    @Body("language") language: string | undefined,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    if (!file || file.size === 0) throw new BadRequestException({ error: "no_file" });
    const mimeType = voiceNoteType(file.mimetype);
    if (!mimeType) throw new BadRequestException({ error: "unsupported_file_type" });
    return this.invoicesService.createVoiceDraft(
      req.tenantDb!,
      req.user!.tenantId,
      { buffer: file.buffer, mimeType, language: language === "cs" || language === "sk" || language === "en" ? language : null },
      parseIdempotencyKey(idempotencyKey),
    );
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
    return this.invoicesService.sendInvoice(req.tenantDb!, id, req.user!.tenantId);
  }

  @Post(":id/remind")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Email a payment reminder for an issued invoice",
    description: "Sends the overdue-payment reminder now and bumps reminder_count / last_reminder_sent_at.",
  })
  remind(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.invoicesService.sendReminder(req.tenantDb!, id, req.user!.tenantId);
  }

  @Post(":id/issue")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Issue a reviewed draft",
    description:
      "The legal moment of responsibility transfer (§9): allocates the sequential " +
      "invoice number (invoice_number_sequences, race-safe under concurrent issuance), " +
      "sets issued_by_user_id/issued_at (and ai_draft_reviewed_at for AI-sourced drafts), " +
      "and flips status -> issued. Rejects (400) an invoice that's already " +
      "issued/paid/cancelled, or that has no contact/due date/line items yet. Does NOT " +
      "persist a PDF/ISDOC copy — see GET .../pdf and .../isdoc, which render both " +
      "on demand from the now-issued invoice's data.",
  })
  issue(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.invoicesService.issue(req.tenantDb!, req.user!.tenantId, id, req.user!.id);
  }

  /**
   * Regenerates the PDF on demand (see `InvoicesService.issue`'s doc
   * comment for why this backend never persists a rendered copy) — always
   * reflects the invoice's current stored data, so it can never drift out
   * of sync with a stale cached file.
   */
  // --- Attachments (sent with the invoice email / listed in the client portal) ---

  @Get(":id/attachments")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "List an invoice's attachments (without file contents)" })
  listAttachments(@Req() req: TenantScopedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.attachmentsService.list(req.tenantDb!, id);
  }

  @Post(":id/attachments")
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_ATTACHMENT_BYTES } }))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: { type: "object", properties: { file: { type: "string", format: "binary" } }, required: ["file"] } })
  @ApiOperation({ summary: "Attach a file (PDF, image, Office, CSV/XML/TXT; ≤ 5 MB, ≤ 10 per invoice)" })
  addAttachment(
    @Req() req: TenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFile() file?: { buffer: Buffer; size: number; mimetype: string; originalname: string },
  ) {
    if (!file) throw new BadRequestException({ error: "no_file" });
    return this.attachmentsService.add(req.tenantDb!, req.user!.tenantId, id, file);
  }

  @Patch(":id/attachments/:attachmentId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Toggle send_with_email / show_in_portal" })
  updateAttachment(
    @Req() req: TenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
    @Body() body: { send_with_email?: unknown; show_in_portal?: unknown },
  ) {
    return this.attachmentsService.update(req.tenantDb!, id, attachmentId, {
      sendWithEmail: typeof body?.send_with_email === "boolean" ? body.send_with_email : undefined,
      showInPortal: typeof body?.show_in_portal === "boolean" ? body.show_in_portal : undefined,
    });
  }

  @Delete(":id/attachments/:attachmentId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Remove an attachment" })
  removeAttachment(
    @Req() req: TenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
  ) {
    return this.attachmentsService.remove(req.tenantDb!, id, attachmentId);
  }

  @Get(":id/attachments/:attachmentId")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: "Download an attachment" })
  async downloadAttachment(
    @Req() req: TenantScopedRequest,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("attachmentId", ParseUUIDPipe) attachmentId: string,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.attachmentsService.download(req.tenantDb!, id, attachmentId);
    res.set({
      "Content-Type": file.mime,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "X-Content-Type-Options": "nosniff",
    });
    res.send(file.content);
  }

  @Get(":id/pdf")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Download an issued invoice as PDF",
    description:
      "Renders the PDF on demand from the invoice's current data (never a stored copy). " +
      "400 if the invoice hasn't been issued yet (no invoice number allocated).",
  })
  async downloadPdf(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.invoicesService.generateInvoicePdf(req.tenantDb!, req.user!.tenantId, id);
    res.set({
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${id}.pdf"`,
    });
    res.send(pdf);
  }

  /**
   * Regenerates the ISDOC 6.0.2 XML on demand — same rationale as
   * `downloadPdf` above.
   */
  @Get(":id/isdoc")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Download an issued invoice as ISDOC XML",
    description:
      "Renders the ISDOC XML on demand from the invoice's current data (never a stored " +
      "copy) via @faktur/cz-compliance's generateIsdocXml. 400 if the invoice hasn't been " +
      "issued yet.",
  })
  async downloadIsdoc(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const xml = await this.invoicesService.generateInvoiceIsdoc(req.tenantDb!, req.user!.tenantId, id);
    res.set({
      "Content-Type": "application/xml",
      "Content-Disposition": `inline; filename="invoice-${id}.isdoc.xml"`,
    });
    res.send(xml);
  }

  @Get(":id/check")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Check a document (draft or issued) for missing mandatory content",
    description:
      "CZ §29 ZDPH / §435 OZ (SK §74 ZoDPH) fields with `scheme: \"law\"`, plus Peppol BIS 3.0 rules " +
      "(`scheme: \"peppol\"`) for an issued invoice to a foreign buyer.",
  })
  check(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.invoicesService.checkInvoice(req.tenantDb!, req.user!.tenantId, id);
  }

  @Get(":id/ubl/check")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Check an issued invoice against the data-dependent Peppol BIS 3.0 rules before sending it",
    description: "Returns `{ issues: [{ rule, field, code, severity }] }`; an empty list means nothing was found.",
  })
  checkUbl(@Req() req: TenantScopedRequest, @Param("id") id: string) {
    return this.invoicesService.checkInvoiceUbl(req.tenantDb!, req.user!.tenantId, id);
  }

  /** Peppol BIS Billing 3.0 (UBL 2.1) XML, rendered on demand like the ISDOC above. */
  @Get(":id/ubl")
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: "Download an issued invoice as UBL 2.1 (Peppol BIS Billing 3.0) XML",
    description:
      "EN 16931 e-invoice for the Slovak e-invoicing mandate from 1 January 2027 and other " +
      "Peppol recipients. 400 if the invoice hasn't been issued yet or isn't a plain invoice " +
      "(`ubl_invoice_only`).",
  })
  async downloadUbl(
    @Req() req: TenantScopedRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ): Promise<void> {
    const xml = await this.invoicesService.generateInvoiceUbl(req.tenantDb!, req.user!.tenantId, id);
    res.set({
      "Content-Type": "application/xml",
      "Content-Disposition": `inline; filename="invoice-${id}.ubl.xml"`,
    });
    res.send(xml);
  }
}
