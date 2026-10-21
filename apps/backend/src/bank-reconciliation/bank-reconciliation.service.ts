import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { normalizeVariableSymbol } from "@faktur/cz-compliance";
import { and, desc, eq, gte, inArray, isNull, lt, ne } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { computeInvoiceTotal, round2 } from "../invoices/invoice-total.util";
import { InvoicesService } from "../invoices/invoices.service";
import { NotificationsService } from "../notifications/notifications.service";
import type { ParsedBankTransactionRow } from "./csv-parser";
import { splitDuplicates } from "./dedupe";
import { findInvoiceMatch, type MatchCandidateInvoice } from "./matching";
import { parseUploadedStatement } from "./statement-upload";

type TenantDb = PostgresJsDatabase<typeof schema>;

export type BankTransactionStatusFilter = "unmatched" | "matched" | "ignored";

type InvoiceLineItemRow = typeof schema.invoiceLineItems.$inferSelect;

export type BankImportSource = "csv" | "camt053" | "gpc" | "fio" | "psd2" | "paypal";
type IncomingRow = ParsedBankTransactionRow & { externalId?: string | null; fee?: string | null };
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class BankReconciliationService {
  private readonly logger = new Logger(BankReconciliationService.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /**
   * Parses + persists every row of an uploaded statement (CSV, camt.053 or
   * GPC, see `statement-upload.ts`), then runs auto-match against issued
   * invoices for each newly-created transaction. Runs inside
   * the single per-request transaction `TenantContextMiddleware` already
   * opened (`db` here is `req.tenantDb`), so a parse/insert failure partway
   * through rolls back the whole import — never a half-imported statement.
   */
  async importStatement(db: TenantDb, tenantId: string, filename: string, file: Buffer) {
    const { source, rows } = parseUploadedStatement(filename, file);
    const result = await this.persistAndMatch(db, tenantId, filename, source, rows);
    const { total, matched, unmatched, duplicates } = result.summary;
    this.notifications?.notify(tenantId, "bank_import", {
      title: `Výpis ${filename} naimportován`,
      body:
        `${total} pohybů, ${matched} spárováno automaticky, ${unmatched} čeká na vás.` +
        (duplicates > 0 ? ` ${duplicates} už v Billantě byly, ty jsme přeskočili.` : ""),
      link: "/bank",
    });
    return result;
  }

  /**
   * Shared by the statement upload and the bank API sync: drops movements
   * we already have (`dedupe.ts`: the same bank id, or the same payment
   * seen from another source), records one import, inserts the rest and
   * auto-matches them against issued invoices. With `skipEmpty` (the API
   * sync) nothing is recorded when every movement was known, so a quiet
   * hour leaves no empty import behind. The unique index on external_id
   * stays as the last guard against a concurrent sync.
   */
  async persistAndMatch(
    db: TenantDb,
    tenantId: string,
    filename: string,
    source: BankImportSource,
    incomingRows: IncomingRow[],
    options: { skipEmpty?: boolean } = {},
  ) {
    const { fresh: parsedRows, duplicates, claims } = splitDuplicates(incomingRows, await this.storedAround(db, incomingRows));
    for (const claim of claims) {
      await db
        .update(schema.bankTransactions)
        .set({ externalId: claim.externalId })
        .where(and(eq(schema.bankTransactions.id, claim.id), isNull(schema.bankTransactions.externalId)));
    }
    if (parsedRows.length === 0 && options.skipEmpty) {
      return { import: null, transactions: [], summary: { total: 0, matched: 0, unmatched: 0, duplicates } };
    }

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
                // "0002026001" and "2026001" are one symbol; a non-numeric one is kept as typed.
                variableSymbol: normalizeVariableSymbol(row.variableSymbol) ?? row.variableSymbol,
                counterpartyAccount: row.counterpartyAccount,
                counterpartyName: row.counterpartyName,
                externalId: row.externalId ?? null,
                fee: row.fee ?? null,
                message: row.message ? row.message.slice(0, 500) : null,
                status: "unmatched" as const,
              })),
            )
            .onConflictDoNothing()
            .returning();

    let matchCandidates = await this.loadMatchCandidates(db);

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
        await this.invoicesService.markPaidFromReconciliation(db, outcome.invoiceId, tenantId, {
          amount: Number(tx.amount),
          currency: tx.currency,
          fee: tx.fee ? Number(tx.fee) : undefined,
          paidAt: tx.transactionDate,
        });
        finalTransactions.push(updated);
        matchedCount++;
        // Settled now: a second payment in the same batch must not pay it again.
        matchCandidates = matchCandidates.filter((c) => c.id !== outcome.invoiceId);
      } else {
        if (outcome.reason === "ambiguous") {
          // Correctness over completeness (see matching.ts doc comment):
          // logged, not guessed — left `unmatched` for a human to resolve
          // via the manual match endpoint.
          this.logger.warn(
            `Bank transaction ${tx.id} (import ${importRow.id}, tenant ${tenantId}) has multiple ` +
              "equally-good invoice match candidates – left unmatched for manual review.",
          );
        } else if (outcome.reason === "amount_mismatch") {
          this.logger.log(
            `Bank transaction ${tx.id} (tenant ${tenantId}) carries the VS of invoice ${outcome.invoiceId} ` +
              "but not the amount due (partial payment, overpayment or other currency) – left for manual review.",
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
        duplicates,
      },
    };
  }

  /** Stored movements on the days the incoming ones cover (RLS keeps them to this tenant). */
  private async storedAround(db: TenantDb, rows: IncomingRow[]) {
    if (rows.length === 0) return [];
    const days = rows.map((r) =>
      Date.UTC(r.transactionDate.getUTCFullYear(), r.transactionDate.getUTCMonth(), r.transactionDate.getUTCDate()),
    );
    const t = schema.bankTransactions;
    return db
      .select({
        id: t.id,
        externalId: t.externalId,
        transactionDate: t.transactionDate,
        amount: t.amount,
        currency: t.currency,
        variableSymbol: t.variableSymbol,
        counterpartyAccount: t.counterpartyAccount,
      })
      .from(t)
      .where(and(gte(t.transactionDate, new Date(Math.min(...days))), lt(t.transactionDate, new Date(Math.max(...days) + DAY_MS))));
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
        `Invoice ${invoiceId} is not in "issued" status (currently "${invoice.status}") – only issued ` +
          "invoices can be reconciled against a payment.",
      );
    }

    const [updated] = await db
      .update(schema.bankTransactions)
      .set({ matchedInvoiceId: invoiceId, status: "matched" })
      .where(eq(schema.bankTransactions.id, transactionId))
      .returning();

    await this.invoicesService.markPaidFromReconciliation(db, invoiceId, tenantId, {
      amount: Number(transaction.amount),
      currency: transaction.currency,
      fee: transaction.fee ? Number(transaction.fee) : undefined,
      paidAt: transaction.transactionDate,
    });

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
   * `status = 'issued'` invoice for the tenant (RLS-scoped via `db`) except
   * quotes, with what is still due (total from `invoice_line_items` minus
   * `amount_paid`). One query for invoices +
   * one query for all their line items (grouped in memory), rather than an
   * N+1 per-invoice query.
   */
  private async loadMatchCandidates(db: TenantDb): Promise<MatchCandidateInvoice[]> {
    // A quote can be "issued" (sent to the customer) but is never paid.
    const issuedInvoices = await db
      .select()
      .from(schema.invoices)
      .where(and(eq(schema.invoices.status, "issued"), ne(schema.invoices.documentType, "quote")));

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
      amountDue: round2(
        computeInvoiceTotal(lineItemsByInvoice.get(invoice.id) ?? [], { reverseCharge: invoice.reverseCharge }) -
          Number(invoice.amountPaid),
      ),
    }));
  }
}
