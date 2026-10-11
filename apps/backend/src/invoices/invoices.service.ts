import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { EmailService } from "../email/email.service";
import type { CreateInvoiceDraftDto } from "./dto/create-invoice-draft.dto";
import { computeInvoiceTotal, formatInvoiceAmount } from "./invoice-total.util";

// TODO: once packages/cz-compliance is ready, ARES-resolve
// counterparty_ico / counterparty_name_raw into a real `contacts` row here
// instead of leaving contactId null on drafts:
// import { lookupIco } from "@faktur/cz-compliance";

type TenantDb = PostgresJsDatabase<typeof schema>;

/** Maps the AI microservice's bare channel identifier to this backend's
 * `invoice_source` enum value. See the long comment in
 * `dto/create-invoice-draft.dto.ts` for why these two vocabularies differ. */
function toInvoiceSource(channel: "telegram" | "whatsapp"): "ai_telegram" | "ai_whatsapp" {
  return channel === "telegram" ? "ai_telegram" : "ai_whatsapp";
}

@Injectable()
export class InvoicesService {
  constructor(private readonly emailService: EmailService) {}

  list(db: TenantDb) {
    // RLS on `invoices` already restricts this to the current tenant — no
    // manual `WHERE tenant_id = ...` needed.
    return db.select().from(schema.invoices);
  }

  findOne(db: TenantDb, id: string) {
    return db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
  }

  /**
   * The contract the AI microservice depends on (blueprint §6 step 8, §9).
   * Always creates `status = 'pending_review'`; never allocates an invoice
   * number; never auto-finalizes. `tenantId` is passed explicitly (rather
   * than trusted implicitly) so callers can't accidentally rely on it
   * matching `db`'s bound tenant context without saying so — RLS's
   * `WITH CHECK` policy will reject the insert outright if it doesn't.
   */
  async createDraft(db: TenantDb, tenantId: string, dto: CreateInvoiceDraftDto) {
    // TODO: resolve/create the `contacts` row from
    // dto.extracted_data.counterparty_name_raw /
    // dto.extracted_data.counterparty_ico via @faktur/cz-compliance's ARES
    // client (blueprint §6 step 7) instead of leaving contactId null.
    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        tenantId,
        contactId: null,
        currency: dto.extracted_data.currency,
        status: "pending_review",
        source: toInvoiceSource(dto.source),
        aiConfidenceScore: dto.ai_confidence_score.toString(),
        // due_date_hint is free text ("do 14 dnů"), not a parsable date —
        // deliberately left unset; the reviewer sets a real due_date during
        // human review (blueprint §6 step 6/9).
        dueDate: null,
        needsAttention: dto.needs_attention,
        rawAiPayload: {
          rawTranscript: dto.raw_transcript,
          extractedData: dto.extracted_data,
          aresEnrichment: dto.ares_enrichment ?? null,
        },
      })
      .returning();

    if (dto.extracted_data.line_items.length > 0) {
      await db.insert(schema.invoiceLineItems).values(
        dto.extracted_data.line_items.map((item, index) => ({
          tenantId,
          invoiceId: invoice.id,
          description: item.description,
          quantity: item.quantity.toString(),
          unitPrice: item.unit_price.toString(),
          vatRate: item.vat_rate != null ? item.vat_rate.toString() : null,
          sortOrder: index,
        })),
      );
    }

    return invoice;
  }

  /**
   * `POST /api/v1/invoices/:id/send` — loads the invoice + its contact
   * through the normal RLS-scoped `db` (never the public
   * `get_public_invoice_view` SECURITY DEFINER function, which exists only
   * for the no-auth client-portal view), emails it via
   * `EmailService.sendInvoiceEmail`, then stamps `sent_at`.
   */
  async sendInvoice(db: TenantDb, id: string) {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
    if (!invoice) {
      throw new NotFoundException(`Invoice ${id} not found`);
    }

    if (!invoice.contactId) {
      throw new BadRequestException("Invoice has no contact to send it to");
    }

    const [contact] = await db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.id, invoice.contactId))
      .limit(1);

    if (!contact?.email) {
      throw new BadRequestException("This invoice's contact has no email address on file");
    }

    const lineItems = await db
      .select()
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoiceId, id));
    const total = computeInvoiceTotal(lineItems);

    await this.emailService.sendInvoiceEmail({
      to: contact.email,
      invoiceNumber: invoice.invoiceNumber ?? invoice.id,
      amount: formatInvoiceAmount(total, invoice.currency),
      dueDate: invoice.dueDate,
      publicToken: invoice.publicToken,
    });

    const [updated] = await db
      .update(schema.invoices)
      .set({ sentAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.invoices.id, id))
      .returning();

    return updated;
  }

  /**
   * Marks an invoice paid as a side effect of automated or manual bank-
   * statement reconciliation (`BankReconciliationService`, both its
   * auto-match path and the manual `.../match` override). Only transitions
   * `status = 'issued' -> 'paid'` — the `WHERE` clause guards the status,
   * not just a blind `UPDATE ... SET status = 'paid'` — so calling this
   * twice for the same invoice (e.g. a re-run import, or a race between
   * auto-match and a manual override) is a no-op the second time rather
   * than silently re-stamping `updatedAt`, and an invoice that was
   * meanwhile cancelled can't be resurrected into "paid" by a late-arriving
   * bank transaction. `tenantId` is required explicitly (not inferred from
   * `db`'s bound context) for the same reason `createDraft` takes it
   * explicitly — RLS's `WITH CHECK`/`USING` still enforces it either way,
   * but requiring it here makes the caller's intent explicit at the call
   * site. Returns `null` (not a thrown error) when no row transitioned, so
   * callers can decide for themselves whether that's worth surfacing.
   */
  async markPaidFromReconciliation(db: TenantDb, invoiceId: string, tenantId: string) {
    const [updated] = await db
      .update(schema.invoices)
      .set({ status: "paid", updatedAt: new Date() })
      .where(
        and(
          eq(schema.invoices.id, invoiceId),
          eq(schema.invoices.tenantId, tenantId),
          eq(schema.invoices.status, "issued"),
        ),
      )
      .returning();

    return updated ?? null;
  }
}
