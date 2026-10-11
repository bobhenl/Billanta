import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { desc, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { computeInvoiceTotal } from "../invoices/invoice-total.util";
import { InvoicesService } from "../invoices/invoices.service";
import { NotificationsService } from "../notifications/notifications.service";
import { parseBankStatementCsv, type ParsedBankTransactionRow } from "./csv-parser";
import { findInvoiceMatch, type MatchCandidateInvoice } from "./matching";

type TenantDb = PostgresJsDatabase<typeof schema>;

export type BankTransactionStatusFilter = "unmatched" | "matched" | "ignored";

type InvoiceLineItemRow = typeof schema.invoiceLineItems.$inferSelect;

@Injectable()
export class BankReconciliationService {
  private readonly logger = new Logger(BankReconciliationService.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Parses + persists every row of an uploaded CSV, then runs auto-match
   * against issued invoices for each newly-created transaction. Runs inside
   * the single per-request transaction `TenantContextMiddleware` already
   * opened (`db` here is `req.tenantDb`), so a parse/insert failure partway
   * through rolls back the whole import — never a half-imported statement.
   */
  async importCsv(db: TenantDb, tenantId: string, filename: string, fileContent: string) {
    const parsedRows = parseBankStatementCsv(fileContent);
    const result = await this.persistAndMatch(db, tenantId, filename, "csv", parsedRows);
    this.notifications?.notify(tenantId, "bank_import", {
      title: `Výpis ${filename} naimportován`,
      body: `${result.summary.total} pohybů, ${result.summary.matched} spárováno automaticky, ${result.summary.unmatched} čeká na vás.`,
      link: "/bank",
    });
    return result;
  }

  /**
   * Shared by the CSV import and the bank API sync: records one import,
   * inserts its rows and auto-matches the new ones against issued invoices.
   * Rows carrying an `externalId` already stored for this tenant are skipped
   * (unique index), so overlapping sync windows are harmless.
   */
  async persistAndMatch(
    db: TenantDb,
    tenantId: string,
    filename: string,
    source: "csv" | "fio" | "psd2" | "paypal",
    parsedRows: (ParsedBankTransactionRow & { externalId?: string; fee?: string | null })[],
  ) {
    const [importRow] = await db
      .insert(schema.bankStatementImports)
      .values({ tenantId, filename, source })
      .returning();

    const insertedTransactions =
      parsedRows.length === 0
        ? []
        : await db
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
                externalId: row.externalId ?? null,
                fee: row.fee ?? null,
                status: "unmatched" as const,
              })),
            )
            .onConflictDoNothing()
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
        await this.invoicesService.markPaidFromReconciliation(db, outcome.invoiceId, tenantId, { amount: Number(tx.amount), currency: tx.currency, fee: tx.fee ? Number(tx.fee) : undefined });
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
    const order = [desc(schema.bankTransactions.transactionDate), desc(schema.bankTransactions.createdAt)];
    if (status) {
      return db.select().from(schema.bankTransactions).where(eq(schema.bankTransactions.status, status)).orderBy(...order);
    }
    return db.select().from(schema.bankTransactions).orderBy(...order);
  }

  /** One transaction plus the statement import it came from. */
  async findOne(db: TenantDb, transactionId: string) {
    const [row] = await db
      .select({ transaction: schema.bankTransactions, import: schema.bankStatementImports })
      .from(schema.bankTransactions)
      .innerJoin(schema.bankStatementImports, eq(schema.bankStatementImports.id, schema.bankTransactions.importId))
      .where(eq(schema.bankTransactions.id, transactionId))
      .limit(1);
    if (!row) {
      throw new NotFoundException("Bank transaction not found");
    }
    return { ...row.transaction, import: row.import };
  }

  /** Undo "ignore": put an ignored transaction back into the to-review pile. */
  async restore(db: TenantDb, transactionId: string) {
    const [current] = await db
      .select({ status: schema.bankTransactions.status })
      .from(schema.bankTransactions)
      .where(eq(schema.bankTransactions.id, transactionId))
      .limit(1);
    if (!current) {
      throw new NotFoundException("Bank transaction not found");
    }
    if (current.status !== "ignored") {
      throw new BadRequestException("Only ignored transactions can be restored");
    }
    const [updated] = await db
      .update(schema.bankTransactions)
      .set({ status: "unmatched" })
      .where(eq(schema.bankTransactions.id, transactionId))
      .returning();
    return updated;
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

    await this.invoicesService.markPaidFromReconciliation(db, invoiceId, tenantId, { amount: Number(transaction.amount), currency: transaction.currency, fee: transaction.fee ? Number(transaction.fee) : undefined });

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
