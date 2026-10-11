import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { computeInvoiceTotal } from "../invoices/invoice-total.util";
import { InvoicesService } from "../invoices/invoices.service";
import { parseBankStatementCsv } from "./csv-parser";
import { findInvoiceMatch, type MatchCandidateInvoice } from "./matching";

type TenantDb = PostgresJsDatabase<typeof schema>;

export type BankTransactionStatusFilter = "unmatched" | "matched" | "ignored";

type InvoiceLineItemRow = typeof schema.invoiceLineItems.$inferSelect;

@Injectable()
export class BankReconciliationService {
  private readonly logger = new Logger(BankReconciliationService.name);

  constructor(private readonly invoicesService: InvoicesService) {}

  /**
   * Parses + persists every row of an uploaded CSV, then runs auto-match
   * against issued invoices for each newly-created transaction. Runs inside
   * the single per-request transaction `TenantContextMiddleware` already
   * opened (`db` here is `req.tenantDb`), so a parse/insert failure partway
   * through rolls back the whole import — never a half-imported statement.
   */
  async importCsv(db: TenantDb, tenantId: string, filename: string, fileContent: string) {
    const parsedRows = parseBankStatementCsv(fileContent);

    const [importRow] = await db
      .insert(schema.bankStatementImports)
      .values({ tenantId, filename, source: "csv" })
      .returning();

    const insertedTransactions = await db
      .insert(schema.bankTransactions)
      .values(
        parsedRows.map((row) => ({
          tenantId,
          importId: importRow.id,
          transactionDate: row.transactionDate,
          amount: row.amount,
          currency: row.currency,
          variableSymbol: row.variableSymbol,
          counterpartyAccount: row.counterpartyAccount,
          counterpartyName: row.counterpartyName,
          status: "unmatched" as const,
        })),
      )
      .returning();

    const matchCandidates = await this.loadMatchCandidates(db);

    const finalTransactions: (typeof insertedTransactions)[number][] = [];
    let matchedCount = 0;

    for (const tx of insertedTransactions) {
      const outcome = findInvoiceMatch(
        {
          variableSymbol: tx.variableSymbol,
          amount: Number(tx.amount),
          currency: tx.currency,
          transactionDate: tx.transactionDate,
        },
        matchCandidates,
      );

      if (outcome.type === "matched") {
        const [updated] = await db
          .update(schema.bankTransactions)
          .set({ matchedInvoiceId: outcome.invoiceId, status: "matched" })
          .where(eq(schema.bankTransactions.id, tx.id))
          .returning();
        await this.invoicesService.markPaidFromReconciliation(db, outcome.invoiceId, tenantId);
        finalTransactions.push(updated);
        matchedCount++;
      } else {
        if (outcome.reason === "ambiguous") {
          // Correctness over completeness (see matching.ts doc comment):
          // logged, not guessed — left `unmatched` for a human to resolve
          // via the manual match endpoint.
          this.logger.warn(
            `Bank transaction ${tx.id} (import ${importRow.id}, tenant ${tenantId}) has multiple ` +
              "equally-good invoice match candidates — left unmatched for manual review.",
          );
        }
        finalTransactions.push(tx);
      }
    }

    return {
      import: importRow,
      transactions: finalTransactions,
      summary: {
        total: finalTransactions.length,
        matched: matchedCount,
        unmatched: finalTransactions.length - matchedCount,
      },
    };
  }

  list(db: TenantDb, status?: BankTransactionStatusFilter) {
    // RLS on `bank_transactions` already restricts this to the current
    // tenant — no manual `WHERE tenant_id = ...` needed (same pattern as
    // ContactsService.list / InvoicesService.list).
    if (status) {
      return db.select().from(schema.bankTransactions).where(eq(schema.bankTransactions.status, status));
    }
    return db.select().from(schema.bankTransactions);
  }

  /** Manual override for the leftovers auto-match couldn't (or shouldn't)
   * resolve on its own. Requires the target invoice to be `status =
   * 'issued'` — same rule the auto-match path follows — so this can't be
   * used to "pay" a draft or an already-cancelled invoice. */
  async manualMatch(db: TenantDb, tenantId: string, transactionId: string, invoiceId: string) {
    const [transaction] = await db
      .select()
      .from(schema.bankTransactions)
      .where(eq(schema.bankTransactions.id, transactionId))
      .limit(1);
    if (!transaction) {
      throw new NotFoundException("Bank transaction not found");
    }

    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
    if (!invoice) {
      throw new NotFoundException("Invoice not found");
    }
    if (invoice.status !== "issued") {
      throw new BadRequestException(
        `Invoice ${invoiceId} is not in "issued" status (currently "${invoice.status}") — only issued ` +
          "invoices can be reconciled against a payment.",
      );
    }

    const [updated] = await db
      .update(schema.bankTransactions)
      .set({ matchedInvoiceId: invoiceId, status: "matched" })
      .where(eq(schema.bankTransactions.id, transactionId))
      .returning();

    await this.invoicesService.markPaidFromReconciliation(db, invoiceId, tenantId);

    return updated;
  }

  async ignore(db: TenantDb, transactionId: string) {
    const [updated] = await db
      .update(schema.bankTransactions)
      .set({ status: "ignored" })
      .where(eq(schema.bankTransactions.id, transactionId))
      .returning();
    if (!updated) {
      throw new NotFoundException("Bank transaction not found");
    }
    return updated;
  }

  /**
   * Builds the candidate list `findInvoiceMatch` scores against: every
   * `status = 'issued'` invoice for the tenant (RLS-scoped via `db`), with
   * its total computed from `invoice_line_items`. One query for invoices +
   * one query for all their line items (grouped in memory), rather than an
   * N+1 per-invoice query.
   */
  private async loadMatchCandidates(db: TenantDb): Promise<MatchCandidateInvoice[]> {
    const issuedInvoices = await db.select().from(schema.invoices).where(eq(schema.invoices.status, "issued"));

    if (issuedInvoices.length === 0) {
      return [];
    }

    const invoiceIds = issuedInvoices.map((invoice) => invoice.id);
    const lineItems = await db
      .select()
      .from(schema.invoiceLineItems)
      .where(inArray(schema.invoiceLineItems.invoiceId, invoiceIds));

    const lineItemsByInvoice = new Map<string, InvoiceLineItemRow[]>();
    for (const item of lineItems) {
      const list = lineItemsByInvoice.get(item.invoiceId) ?? [];
      list.push(item);
      lineItemsByInvoice.set(item.invoiceId, list);
    }

    return issuedInvoices.map((invoice) => ({
      id: invoice.id,
      variableSymbol: invoice.variableSymbol,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      total: computeInvoiceTotal(lineItemsByInvoice.get(invoice.id) ?? []),
    }));
  }
}
