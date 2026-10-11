import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * Body for `POST /api/v1/invoices/drafts` — the contract the AI
 * microservice (`apps/ai-service`) depends on (blueprint §6 steps 6-8, §9).
 *
 * ============================================================================
 * KNOWN CONTRACT DEVIATION FROM THIS MODULE'S ORIGINAL SCAFFOLDING BRIEF
 * ============================================================================
 * This scaffold's brief specified a flatter, camelCase shape:
 * `{ counterpartyNameRaw, counterpartyIco?, lineItems[], currency,
 * dueDateHint?, notes?, source, aiConfidenceScore }`.
 *
 * However, `apps/ai-service` already exists and is already wired up for
 * real against a *different*, nested, snake_case shape — see
 * `apps/ai-service/app/pipeline/schemas.py::DraftInvoicePayload` /
 * `ExtractedInvoiceDraft`, posted verbatim via `pydantic`'s
 * `model_dump(mode="json")` in
 * `apps/ai-service/app/pipeline/voice_to_invoice.py::create_draft_invoice`
 * (a function explicitly documented there as "REAL — posts the draft to the
 * backend with the scoped service JWT", not a stub).
 *
 * Since these two contracts are the actual integration surface between the
 * two independently-scaffolded services, this DTO matches the AI service's
 * real wire format instead of the brief's hypothetical one — an
 * interoperable, if less idiomatically-TypeScript, contract beats a
 * prettier one nobody can call. The snake_case keys and nested
 * `extracted_data`/`ares_enrichment` objects below are intentional, not an
 * oversight.
 *
 * A second, smaller mismatch: the AI service's `Channel` enum only knows
 * "telegram" / "whatsapp" as `source`, whereas the blueprint's `invoices`
 * schema (§4) and this backend's `invoice_source` Postgres enum
 * distinguish `ai_telegram` / `ai_whatsapp` from a human-originated
 * `manual`/`api` source. `InvoicesService.createDraft` maps one to the
 * other; see the comment there. Reconciling this properly (e.g. renaming
 * one side) is flagged as follow-up work, not fixed silently in either
 * service.
 */

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.coerce.number().positive().default(1),
  unit_price: z.coerce.number().nonnegative(),
  // null/undefined = the speaker didn't mention a VAT rate; the human
  // reviewer fills it in (blueprint §6 step 6/9) — never silently defaulted
  // here.
  vat_rate: z.coerce.number().min(0).max(100).nullish(),
});

const extractedInvoiceDataSchema = z.object({
  counterparty_name_raw: z.string().min(1),
  counterparty_ico: z
    .string()
    .regex(/^\d{8}$/, "IČO must be 8 digits")
    .nullish(),
  line_items: z.array(lineItemSchema).default([]),
  currency: z.string().length(3).default("CZK"),
  // Free-text hint (e.g. "do 14 dnů"), NOT a parsed date — the reviewer
  // resolves this to a real due_date in the dashboard (blueprint §6 step 6).
  due_date_hint: z.string().nullish(),
  notes: z.string().nullish(),
});

const aresEnrichmentSchema = z.object({
  status: z.enum(["matched", "not_found", "ambiguous", "skipped_no_ico", "lookup_failed"]),
  matched_ico: z.string().nullish(),
  matched_legal_name: z.string().nullish(),
  // Tri-state on purpose — null means "unknown/unverified", never asserted
  // as a confirmed `false` (blueprint §1 ARES/ADISREG gap, §6 step 7).
  is_vat_payer: z.boolean().nullish(),
  confidence: z.number().min(0).max(1).default(0),
});

export const createInvoiceDraftSchema = z.object({
  tenant_id: z.string().uuid(),
  source: z.enum(["telegram", "whatsapp"]),
  status: z.literal("pending_review").default("pending_review"),
  raw_transcript: z.string(),
  extracted_data: extractedInvoiceDataSchema,
  ares_enrichment: aresEnrichmentSchema.nullish(),
  ai_confidence_score: z.number().min(0).max(1).default(0),
  needs_attention: z.boolean().default(false),
});

export class CreateInvoiceDraftDto extends createZodDto(createInvoiceDraftSchema) {}
