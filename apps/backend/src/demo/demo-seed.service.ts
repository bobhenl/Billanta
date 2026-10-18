import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { createInvoiceSchema, updateInvoiceSchema } from "../invoices/dto/create-invoice.dto";
import { computeInvoiceTotal, round2 } from "../invoices/invoice-total.util";
import { InvoicesService } from "../invoices/invoices.service";
import { buildBankTransactions, buildDemoDataset, type DemoInvoice, type DemoKind, type SeededInvoice } from "./dataset";

type TenantDb = PostgresJsDatabase<typeof schema>;

/**
 * Fills a fresh demo company with its dataset. Documents go through
 * InvoicesService like a person's clicks would (create, convert, issue,
 * markPaid, cancel), so numbers, snapshots and totals are the real ones;
 * only the timestamps a person cannot set (sent, responded, AI fields) are
 * written directly. Runs as `faktur_app` inside the tenant's RLS context,
 * which also keeps it under the demo row caps.
 */
@Injectable()
export class DemoSeedService {
  constructor(
    private readonly dbService: DbService,
    private readonly invoices: InvoicesService,
  ) {}

  async seed(tenantId: string, userId: string, kind: DemoKind, now = new Date()): Promise<void> {
    const ds = buildDemoDataset(kind, now);
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      await tx`SELECT set_config('app.current_user_id', ${userId}, true)`;
      await tx`SELECT set_config('app.current_actor', 'user', true)`;
      const db = drizzleTx(tx, schema);

      const contactIds = new Map<string, string>();
      const contactNames = new Map<string, string>();
      for (const c of ds.contacts) {
        const { key, ...fields } = c;
        const [row] = await db.insert(schema.contacts).values({ tenantId, ...fields }).returning({ id: schema.contacts.id });
        contactIds.set(key, row.id);
        contactNames.set(key, c.legalName);
      }
      const contactId = (key: string) => {
        const id = contactIds.get(key);
        if (!id) throw new Error(`demo dataset: unknown contact ${key}`);
        return id;
      };

      const invoiceIds = new Map<string, string>();
      const seeded: SeededInvoice[] = [];
      const ordered = [...ds.invoices].sort((a, b) => a.issueDate.getTime() - b.issueDate.getTime());
      for (const spec of ordered) {
        const id = await this.document(db, tenantId, userId, spec, contactId(spec.contactKey), invoiceIds);
        invoiceIds.set(spec.key, id);
        if (spec.state === "draft" || spec.state === "ai_draft") continue;
        const [inv] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
        const items = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, id));
        seeded.push({
          spec,
          id,
          variableSymbol: inv.variableSymbol,
          total: round2(computeInvoiceTotal(items, { reverseCharge: inv.reverseCharge })),
          counterpartyName: contactNames.get(spec.contactKey) ?? "",
        });
      }

      for (const e of ds.expenses) {
        await db.insert(schema.expenses).values({
          tenantId,
          supplierNameRaw: e.supplierName,
          description: e.description,
          amount: e.amount.toFixed(2),
          vatRate: e.vatRate.toFixed(2),
          currency: e.currency,
          exchangeRate: e.exchangeRate == null ? null : e.exchangeRate.toFixed(10),
          expenseDate: e.expenseDate,
          category: e.category,
          documentNumber: e.documentNumber,
          dueDate: e.dueDate,
          paidAt: e.paidAt,
          reverseCharge: e.reverseCharge,
          reverseChargeCode: e.reverseChargeCode,
          note: e.note,
        });
      }

      const projectIds = new Map<string, { id: string; contactId: string }>();
      for (const p of ds.time.projects) {
        const cid = contactId(p.contactKey);
        const [row] = await db
          .insert(schema.projects)
          .values({ tenantId, contactId: cid, name: p.name, hourlyRate: p.hourlyRate.toFixed(2), currency: p.currency, color: p.color })
          .returning({ id: schema.projects.id });
        projectIds.set(p.key, { id: row.id, contactId: cid });
      }
      if (ds.time.entries.length > 0) {
        await db.insert(schema.timeEntries).values(
          ds.time.entries.map((t) => {
            const project = projectIds.get(t.projectKey)!;
            return {
              tenantId,
              projectId: project.id,
              contactId: project.contactId,
              userId,
              description: t.description,
              startedAt: t.startedAt,
              endedAt: new Date(t.startedAt.getTime() + t.minutes * 60_000),
              minutes: t.minutes,
              billable: t.billable,
            };
          }),
        );
      }

      for (const r of ds.recurring) {
        await db.insert(schema.recurringInvoiceTemplates).values({
          tenantId,
          contactId: contactId(r.contactKey),
          frequency: r.frequency,
          nextRunDate: r.nextRunDate,
          currency: r.currency,
          lineItemsSnapshot: r.lines,
        });
      }

      const statement = buildBankTransactions(kind, now, seeded);
      if (statement.length > 0) {
        const [imp] = await db
          .insert(schema.bankStatementImports)
          .values({ tenantId, filename: ds.supplier.language === "sk" ? "vypis-uctu.csv" : "vypis.csv", source: "csv" })
          .returning({ id: schema.bankStatementImports.id });
        await db.insert(schema.bankTransactions).values(
          statement.map((t) => ({
            tenantId,
            importId: imp.id,
            transactionDate: t.transactionDate,
            amount: t.amount.toFixed(2),
            currency: t.currency,
            variableSymbol: t.variableSymbol,
            counterpartyName: t.counterpartyName,
            matchedInvoiceId: t.matchedInvoiceId,
            status: t.status,
            message: t.message,
          })),
        );
      }
    });
  }

  /** One document brought to the state its spec asks for; returns its id. */
  private async document(
    db: TenantDb,
    tenantId: string,
    userId: string,
    spec: DemoInvoice,
    contactId: string,
    invoiceIds: Map<string, string>,
  ): Promise<string> {
    const dates = { issue_date: spec.issueDate, due_date: spec.dueDate };
    let id: string;

    if (spec.convertFrom) {
      const sourceId = invoiceIds.get(spec.convertFrom);
      if (!sourceId) throw new Error(`demo dataset: ${spec.key} converts from unseeded ${spec.convertFrom}`);
      const draft = await this.invoices.convert(db, tenantId, sourceId, spec.documentType as "invoice" | "credit_note" | "proforma");
      id = draft.id;
      // convert() dates the draft today and writes a Czech note; the spec knows better.
      const noteAbove = spec.noteAbove ?? (spec.language === "cs" ? undefined : await this.finalNote(db, sourceId, spec.language));
      await this.invoices.update(
        db,
        tenantId,
        id,
        updateInvoiceSchema.parse({
          ...dates,
          ...(noteAbove !== undefined && { note_above: noteAbove }),
          ...(spec.lines.length > 0 && { line_items: this.lineItems(spec) }),
        }),
      );
    } else {
      const draft = await this.invoices.create(
        db,
        tenantId,
        createInvoiceSchema.parse({
          document_type: spec.documentType,
          contact_id: contactId,
          ...dates,
          currency: spec.currency,
          exchange_rate: spec.exchangeRate,
          language: spec.language,
          reverse_charge: spec.reverseCharge,
          reverse_charge_code: spec.reverseChargeCode,
          note_above: spec.noteAbove,
          line_items: this.lineItems(spec),
        }),
      );
      id = draft.id;
    }

    if (spec.state === "draft") return id;
    if (spec.state === "ai_draft") {
      await db
        .update(schema.invoices)
        .set({
          status: "pending_review",
          source: "ai_telegram",
          needsAttention: true,
          aiConfidenceScore: spec.ai?.confidence ?? null,
          rawAiPayload: spec.ai ? { rawTranscript: spec.ai.transcript } : null,
        })
        .where(eq(schema.invoices.id, id));
      return id;
    }

    let row = await this.invoices.issue(db, tenantId, id, userId);
    // The rate lookup needs the network; without it a foreign document keeps the spec's rate.
    if (row.exchangeRate == null && spec.exchangeRate != null) {
      [row] = await db
        .update(schema.invoices)
        .set({ exchangeRate: spec.exchangeRate.toFixed(10) })
        .where(eq(schema.invoices.id, id))
        .returning();
    }

    switch (spec.state) {
      case "paid":
        // A final invoice from a paid proforma is paid on issue already.
        if (row.status !== "paid") await this.invoices.markPaid(db, id, spec.paidAt ?? spec.issueDate);
        break;
      case "partial":
        await this.invoices.markPaid(db, id, spec.paidAt ?? spec.issueDate, spec.partialAmount ?? undefined);
        break;
      case "cancelled":
        await this.invoices.cancel(db, id);
        break;
      case "quote_accepted":
      case "quote_rejected": {
        const [contact] = await db
          .select({ person: schema.contacts.contactPerson, name: schema.contacts.legalName })
          .from(schema.contacts)
          .where(eq(schema.contacts.id, contactId))
          .limit(1);
        await db
          .update(schema.invoices)
          .set({
            clientResponse: spec.state === "quote_accepted" ? "accepted" : "rejected",
            clientRespondedAt: spec.respondedAt ?? spec.issueDate,
            clientResponseName: contact?.person ?? contact?.name ?? null,
          })
          .where(eq(schema.invoices.id, id));
        break;
      }
      default:
        break;
    }

    if (spec.sentAt) await db.update(schema.invoices).set({ sentAt: spec.sentAt }).where(eq(schema.invoices.id, id));
    return id;
  }

  private lineItems(spec: DemoInvoice) {
    return spec.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity,
      unit: l.unit,
      unit_price: l.unitPrice,
      vat_rate: l.vatRate,
    }));
  }

  /** The "settled by proforma" note in the document's own language. */
  private async finalNote(db: TenantDb, sourceId: string, language: "sk" | "en"): Promise<string | undefined> {
    const [src] = await db
      .select({ number: schema.invoices.invoiceNumber, status: schema.invoices.status, type: schema.invoices.documentType })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, sourceId))
      .limit(1);
    // Other conversions keep the source's own note, which is already in its language.
    if (src?.type !== "proforma") return undefined;
    const paid = src.status === "paid";
    return language === "sk"
      ? `Vyúčtovanie zálohovej faktúry č. ${src?.number ?? ""}.${paid ? " Uhradené zálohou." : ""}`
      : `Final invoice for proforma No. ${src?.number ?? ""}.${paid ? " Paid by the advance payment." : ""}`;
  }
}
