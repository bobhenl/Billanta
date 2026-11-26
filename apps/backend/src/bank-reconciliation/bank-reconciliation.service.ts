import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { normalizeVariableSymbol } from "@faktur/cz-compliance";
import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { computeInvoiceTotal, round2 } from "../invoices/invoice-total.util";
import { ExpensesService } from "../expenses/expenses.service";
import { InvoicesService, PAYMENT_DRAFT_PLACEHOLDER } from "../invoices/invoices.service";
import { NotificationsService } from "../notifications/notifications.service";
import { compileRule, decideAfterMatch, type CompiledRule, type PaymentForRules, type RuleAction, type RuleConditions } from "./bank-rules";
import type { ParsedBankTransactionRow } from "./csv-parser";
import { splitDuplicates } from "./dedupe";
import {
  findInvoiceMatch,
  findPaidInvoiceLink,
  PAID_LINK_WINDOW_DAYS,
  type MatchCandidateInvoice,
  type MatchOutcome,
  type PaidLinkCandidate,
} from "./matching";
import { paypalPaymentNote } from "./payment-note";
import { parseUploadedStatement } from "./statement-upload";

type TenantDb = PostgresJsDatabase<typeof schema>;

export type BankTransactionStatusFilter = "unmatched" | "matched" | "ignored";

type InvoiceLineItemRow = typeof schema.invoiceLineItems.$inferSelect;

export type BankImportSource = "csv" | "camt053" | "gpc" | "fio" | "psd2" | "paypal" | "stripe";
type IncomingRow = ParsedBankTransactionRow & {
  externalId?: string | null;
  fee?: string | null;
  netAmount?: string | null;
  netCurrency?: string | null;
  payerCountry?: string | null;
};
type StoredRow = typeof schema.bankTransactions.$inferSelect;
interface MatchPools {
  issued: MatchCandidateInvoice[];
  paid: PaidLinkCandidate[];
}
export type StoredRule = Omit<typeof schema.bankRules.$inferSelect, "conditions" | "action"> & { conditions: RuleConditions; action: RuleAction };

export function paymentForRules(tx: StoredRow): PaymentForRules {
  return {
    amount: Number(tx.amount),
    currency: tx.currency,
    counterpartyName: tx.counterpartyName,
    counterpartyAccount: tx.counterpartyAccount,
    message: tx.message,
    variableSymbol: tx.variableSymbol,
  };
}

type AppliedMatch =
  | { type: "matched" | "linked"; invoiceId: string; updated: StoredRow }
  | Extract<MatchOutcome, { type: "unmatched" }>;

/** What a stored payment tells the invoice it pays: amount, fee, PayPal's or Stripe's conversion and the note line. */
function receivedFrom(tx: StoredRow) {
  const fee = tx.fee ? Number(tx.fee) : undefined;
  const net = tx.netAmount && tx.netCurrency ? { amount: Number(tx.netAmount), currency: tx.netCurrency } : null;
  const provider = tx.externalId?.startsWith("paypal:") ? "PayPal" : tx.externalId?.startsWith("stripe:") ? "Stripe" : null;
  return {
    amount: Number(tx.amount),
    currency: tx.currency,
    fee,
    paidAt: tx.transactionDate,
    net,
    note: provider
      ? paypalPaymentNote({ amount: Number(tx.amount), currency: tx.currency, fee, netAmount: net?.amount, netCurrency: net?.currency }, provider)
      : null,
  };
}
const DAY_MS = 24 * 60 * 60 * 1000;
const startOfUtcDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

@Injectable()
export class BankReconciliationService {
  private readonly logger = new Logger(BankReconciliationService.name);

  constructor(
    private readonly invoicesService: InvoicesService,
    private readonly expensesService: ExpensesService,
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
    const { total, matched, unmatched, ruled, duplicates } = result.summary;
    this.notifications?.notify(tenantId, "bank_import", {
      title: `Výpis ${filename} naimportován`,
      body:
        `${total} pohybů, ${matched} spárováno automaticky, ` +
        (ruled > 0 ? `${ruled} vyřídila pravidla, ` : "") +
        `${unmatched} čeká na vás.` +
        (duplicates > 0 ? ` ${duplicates} už v Billantě byly, ty jsme přeskočili.` : ""),
      link: "/bank",
    });
    return result;
  }

  /**
   * A row synced before its source sent a description (PayPal invoice items
   * came later) gets it now. Only an empty message is filled, never replaced,
   * and a draft made from it swaps its placeholder line for the real text
   * while it still waits for review (an issued invoice is never touched).
   * Reads every incoming row: a stored one was split off as a duplicate before.
   */
  async fillLateDescriptions(db: TenantDb, incomingRows: IncomingRow[], inserted: { externalId: string | null }[]) {
    await this.applyFixedDraftLine(db, incomingRows);
    const insertedIds = new Set(inserted.map((t) => t.externalId));
    const late = incomingRows
      .filter((r) => r.externalId && r.message && !insertedIds.has(r.externalId))
      .map((r) => ({ id: r.externalId, message: r.message!.slice(0, 500) }));
    if (late.length === 0) return;
    await db.execute(sql`
      WITH filled AS (
        UPDATE bank_transactions t SET message = v.message
        FROM jsonb_to_recordset(${JSON.stringify(late)}::jsonb) AS v(id text, message text)
        WHERE t.external_id = v.id AND t.message IS NULL
        RETURNING t.matched_invoice_id, t.message
      )
      UPDATE invoice_line_items li SET description = f.message
      FROM filled f JOIN invoices i ON i.id = f.matched_invoice_id
      WHERE li.invoice_id = i.id AND i.status = 'pending_review'
        AND li.description IN (${PAYMENT_DRAFT_PLACEHOLDER}, (SELECT btrim(tn.invoice_form_prefs->>'paymentDraftDescription') FROM tenants tn WHERE tn.id = i.tenant_id))
        AND (SELECT tn.invoice_form_prefs->>'paymentDraftDescriptionAlways' FROM tenants tn WHERE tn.id = i.tenant_id) IS DISTINCT FROM 'true'`);
  }

  /**
   * With "always use my line" on, a resync puts that line back on drafts that
   * still carry the payment's own text or the placeholder. A line the owner
   * typed stays, and only drafts waiting for review are touched.
   */
  private async applyFixedDraftLine(db: TenantDb, incomingRows: IncomingRow[]) {
    const ids = incomingRows.map((r) => r.externalId).filter((id): id is string => !!id);
    if (ids.length === 0) return;
    await db.execute(sql`
      UPDATE invoice_line_items li SET description = btrim(tn.invoice_form_prefs->>'paymentDraftDescription')
      FROM bank_transactions t
        JOIN invoices i ON i.id = t.matched_invoice_id
        JOIN tenants tn ON tn.id = i.tenant_id
      WHERE li.invoice_id = i.id AND i.status = 'pending_review'
        AND t.external_id IN (SELECT jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
        AND tn.invoice_form_prefs->>'paymentDraftDescriptionAlways' = 'true'
        AND coalesce(btrim(tn.invoice_form_prefs->>'paymentDraftDescription'), '') <> ''
        AND li.description IN (${PAYMENT_DRAFT_PLACEHOLDER}, left(coalesce(t.message, ''), 500))`);
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
    options: {
      skipEmpty?: boolean;
      /** PayPal: an unmatched payment from this moment on becomes an invoice draft. */
      autoDraftFrom?: Date | null;
      /** false for a history backfill: bank rules may ignore payments but not draft from them. */
      ruleDrafts?: boolean;
    } = {},
  ) {
    const { fresh: parsedRows, duplicates, claims } = splitDuplicates(incomingRows, await this.storedAround(db, incomingRows));
    for (const claim of claims) {
      await db
        .update(schema.bankTransactions)
        .set({ externalId: claim.externalId })
        .where(and(eq(schema.bankTransactions.id, claim.id), isNull(schema.bankTransactions.externalId)));
    }
    if (parsedRows.length === 0 && options.skipEmpty) {
      // Nothing new, but a known row may now come with the description it lacked.
      await this.fillLateDescriptions(db, incomingRows, []);
      return { import: null, transactions: [], summary: { total: 0, matched: 0, unmatched: 0, drafted: 0, ruled: 0, duplicates } };
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
                netAmount: row.netAmount ?? null,
                netCurrency: row.netCurrency ?? null,
                message: row.message ? row.message.slice(0, 500) : null,
                status: "unmatched" as const,
              })),
            )
            .onConflictDoNothing()
            .returning();

    await this.fillLateDescriptions(db, incomingRows, insertedTransactions);

    const pools = await this.loadPools(db, insertedTransactions);
    // Rules run on new payments only. Older unmatched ones (e.g. a payment a
    // member restored from "ignored") are left alone, or every sync would
    // ignore them again; "Použít na existující" applies a rule to those.
    const rules = insertedTransactions.length > 0 ? await this.loadCompiledRules(db) : [];

    const finalTransactions: (typeof insertedTransactions)[number][] = [];
    let matchedCount = 0;
    let drafted = 0;
    let ruled = 0;
    const payerCountries = new Map(parsedRows.map((r) => [r.externalId ?? "", r.payerCountry ?? null]));

    for (const tx of insertedTransactions) {
      const outcome = await this.applyMatch(db, tenantId, tx, pools);
      const decision = decideAfterMatch(outcome.type !== "unmatched", paymentForRules(tx), rules, {
        drafts: options.ruleDrafts !== false,
        autoDraft:
          outcome.type === "unmatched" &&
          outcome.reason === "no_candidate" &&
          Boolean(options.autoDraftFrom) &&
          // Payment days are UTC midnights: a payment on the connection's first day counts.
          tx.transactionDate.getTime() >= startOfUtcDay(options.autoDraftFrom!),
      });

      if (outcome.type !== "unmatched") {
        finalTransactions.push(outcome.updated);
        matchedCount++;
      } else if (decision.kind === "rule") {
        finalTransactions.push(await this.applyRuleAction(db, tenantId, tx, decision.rule));
        ruled++;
      } else if (decision.kind === "auto_draft") {
        const { transaction: updated } = await this.draftAndLink(db, tenantId, tx, payerCountries.get(tx.externalId ?? "") ?? null);
        finalTransactions.push(updated);
        drafted++;
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
        unmatched: finalTransactions.length - matchedCount - drafted - ruled,
        drafted,
        ruled,
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

  async list(db: TenantDb, status?: BankTransactionStatusFilter) {
    // RLS on `bank_transactions` already restricts this to the current
    // tenant — no manual `WHERE tenant_id = ...` needed (same pattern as
    // ContactsService.list / InvoicesService.list).
    // The import's source and filename let /bank filter by connection (an
    // import has no connection id; the sync names it after the account).
    const order = [desc(schema.bankTransactions.transactionDate), desc(schema.bankTransactions.createdAt)];
    const rows = await db
      .select({
        transaction: schema.bankTransactions,
        importSource: schema.bankStatementImports.source,
        importFilename: schema.bankStatementImports.filename,
      })
      .from(schema.bankTransactions)
      .innerJoin(schema.bankStatementImports, eq(schema.bankStatementImports.id, schema.bankTransactions.importId))
      .where(status ? eq(schema.bankTransactions.status, status) : undefined)
      .orderBy(...order);
    return rows.map((r) => ({ ...r.transaction, importSource: r.importSource, importFilename: r.importFilename }));
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
      .set({ status: "unmatched", appliedRuleId: null })
      .where(eq(schema.bankTransactions.id, transactionId))
      .returning();
    return updated;
  }

  /**
   * "Spárovat znovu" and the tail of every bank sync: runs auto-match again
   * over every unmatched transaction, since an invoice issued (or imported)
   * after the payment arrived only shows up now. Issued invoices are marked
   * paid as on import; paid ones are only linked. Never drafts invoices.
   */
  async rematchUnmatched(db: TenantDb, tenantId: string) {
    const unmatched = await db.select().from(schema.bankTransactions).where(eq(schema.bankTransactions.status, "unmatched"));
    if (unmatched.length === 0) return { checked: 0, matched: 0, linked: 0 };
    const pools = await this.loadPools(db, unmatched);
    let matched = 0;
    let linked = 0;
    for (const tx of unmatched) {
      const outcome = await this.applyMatch(db, tenantId, tx, pools);
      if (outcome.type === "matched") matched++;
      else if (outcome.type === "linked") linked++;
    }
    return { checked: unmatched.length, matched, linked };
  }

  /**
   * "Vytvořit fakturu z platby": an incoming payment no invoice covers
   * becomes a pending_review draft (as the PayPal sync's auto-draft does),
   * linked to the payment. A member still reviews and issues it.
   */
  async createDraftFromPayment(db: TenantDb, tenantId: string, transactionId: string) {
    const [tx] = await db.select().from(schema.bankTransactions).where(eq(schema.bankTransactions.id, transactionId)).limit(1);
    if (!tx) throw new NotFoundException("Bank transaction not found");
    if (tx.status !== "unmatched") throw new BadRequestException("transaction_not_unmatched");
    if (!(Number(tx.amount) > 0)) throw new BadRequestException("transaction_not_incoming");
    const { transaction, invoice } = await this.draftAndLink(db, tenantId, tx, null);
    return { transaction, invoiceId: invoice.id };
  }

  private async draftAndLink(
    db: TenantDb,
    tenantId: string,
    tx: StoredRow,
    payerCountry: string | null,
    rule: { id: string; contactId: string | null } | null = null,
  ) {
    const received = receivedFrom(tx);
    const invoice = await this.invoicesService.createPaymentDraft(db, tenantId, {
      amount: received.amount,
      currency: received.currency,
      paidAt: received.paidAt,
      payerName: tx.counterpartyName,
      // A bank row carries an IBAN here, not an e-mail.
      payerEmail: tx.counterpartyAccount?.includes("@") ? tx.counterpartyAccount : null,
      payerCountry,
      description: tx.message,
      fee: received.fee ?? null,
      net: received.net,
      note: received.note ?? paypalPaymentNote(received),
      contactId: rule?.contactId ?? null,
    });
    const [transaction] = await db
      .update(schema.bankTransactions)
      .set({ matchedInvoiceId: invoice.id, status: "matched", ...(rule && { appliedRuleId: rule.id }) })
      .where(eq(schema.bankTransactions.id, tx.id))
      .returning();
    return { transaction: transaction!, invoice };
  }

  /** Enabled rules in the order they run (RLS keeps them to this tenant). */
  async loadCompiledRules(db: TenantDb): Promise<CompiledRule<StoredRule>[]> {
    const rows = await db
      .select()
      .from(schema.bankRules)
      .where(eq(schema.bankRules.enabled, true))
      .orderBy(asc(schema.bankRules.position), asc(schema.bankRules.createdAt));
    return (rows as StoredRule[]).map((rule) => compileRule(rule));
  }

  /**
   * Runs one rule's action on an unmatched payment and records the rule on
   * it. Drafts only: an expense flagged needs_review, or a pending_review
   * invoice that a member still issues by hand.
   */
  async applyRuleAction(db: TenantDb, tenantId: string, tx: StoredRow, rule: StoredRule): Promise<StoredRow> {
    if (rule.action === "draft_invoice") {
      return (await this.draftAndLink(db, tenantId, tx, null, { id: rule.id, contactId: rule.contactId })).transaction;
    }
    if (rule.action === "draft_expense") {
      const vs = normalizeVariableSymbol(tx.variableSymbol);
      const expense = await this.expensesService.create(
        db,
        tenantId,
        {
          supplierNameRaw: tx.counterpartyName?.slice(0, 200) || null,
          description: (tx.message || tx.counterpartyName || rule.name).slice(0, 500),
          // The payment is the gross amount; the VAT rate is unknown until a person checks the receipt.
          amount: Math.abs(Number(tx.amount)),
          vatRate: 0,
          currency: tx.currency,
          expenseDate: tx.transactionDate,
          category: rule.expenseCategory ?? null,
          variableSymbol: vs && /^\d{1,10}$/.test(vs) ? vs : null,
          paidAt: tx.transactionDate,
          note: `Z bankovní platby, pravidlo „${rule.name}“.`,
        },
        { needsReview: true },
      );
      const [updated] = await db
        .update(schema.bankTransactions)
        .set({ matchedExpenseId: expense!.id, status: "matched", appliedRuleId: rule.id })
        .where(eq(schema.bankTransactions.id, tx.id))
        .returning();
      return updated!;
    }
    const [updated] = await db
      .update(schema.bankTransactions)
      .set({ status: "ignored", appliedRuleId: rule.id })
      .where(eq(schema.bankTransactions.id, tx.id))
      .returning();
    return updated!;
  }

  /** Issued invoices to settle and paid ones to link, for a set of transactions. */
  private async loadPools(db: TenantDb, transactions: StoredRow[]): Promise<MatchPools> {
    if (transactions.length === 0) return { issued: [], paid: [] };
    const times = transactions.map((t) => t.transactionDate.getTime());
    const pad = (PAID_LINK_WINDOW_DAYS + 1) * DAY_MS;
    const [issued, paid] = await Promise.all([
      this.loadMatchCandidates(db),
      this.loadPaidLinkCandidates(db, new Date(Math.min(...times) - pad), new Date(Math.max(...times) + pad)),
    ]);
    return { issued, paid };
  }

  /**
   * One transaction against the pools. Issued invoices first (marked paid,
   * as always); only when none fits at all, an already paid invoice is
   * linked. Linking writes the bank row only: the invoice is never touched.
   * The pools are updated so a later payment in the same run can't use the
   * same invoice again.
   */
  private async applyMatch(db: TenantDb, tenantId: string, tx: StoredRow, pools: MatchPools): Promise<AppliedMatch> {
    const outcome = findInvoiceMatch(
      { variableSymbol: tx.variableSymbol, amount: Number(tx.amount), currency: tx.currency, transactionDate: tx.transactionDate },
      pools.issued,
    );
    if (outcome.type === "matched") {
      const [updated] = await db
        .update(schema.bankTransactions)
        .set({ matchedInvoiceId: outcome.invoiceId, status: "matched" })
        .where(eq(schema.bankTransactions.id, tx.id))
        .returning();
      await this.invoicesService.markPaidFromReconciliation(db, outcome.invoiceId, tenantId, receivedFrom(tx));
      pools.issued = pools.issued.filter((c) => c.id !== outcome.invoiceId);
      return { type: "matched", invoiceId: outcome.invoiceId, updated: updated! };
    }
    if (outcome.reason !== "no_candidate") return outcome;

    const link = findPaidInvoiceLink(
      {
        amount: Number(tx.amount),
        currency: tx.currency,
        transactionDate: tx.transactionDate,
        counterpartyAccount: tx.counterpartyAccount,
        counterpartyName: tx.counterpartyName,
      },
      pools.paid,
    );
    if (link.type === "unmatched") return link;
    const [updated] = await db
      .update(schema.bankTransactions)
      .set({ matchedInvoiceId: link.invoiceId, status: "matched" })
      .where(eq(schema.bankTransactions.id, tx.id))
      .returning();
    pools.paid = pools.paid.map((c) => (c.id === link.invoiceId ? { ...c, alreadyLinked: true } : c));
    return { type: "linked", invoiceId: link.invoiceId, updated: updated! };
  }

  /**
   * Paid invoices (not quotes) dated around the payments, by issue date or
   * paid_at, with their contact's e-mail and name, the total from the line
   * items and whether some bank transaction already points at them.
   */
  private async loadPaidLinkCandidates(db: TenantDb, from: Date, to: Date): Promise<PaidLinkCandidate[]> {
    const inv = schema.invoices;
    const rows = await db
      .select({
        id: inv.id,
        currency: inv.currency,
        issueDate: inv.issueDate,
        paidAt: inv.paidAt,
        reverseCharge: inv.reverseCharge,
        contactEmail: schema.contacts.email,
        contactName: schema.contacts.legalName,
      })
      .from(inv)
      .leftJoin(schema.contacts, eq(schema.contacts.id, inv.contactId))
      .where(
        and(
          eq(inv.status, "paid"),
          ne(inv.documentType, "quote"),
          or(and(gte(inv.issueDate, from), lt(inv.issueDate, to)), and(gte(inv.paidAt, from), lt(inv.paidAt, to))),
        ),
      );
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [lineItems, links] = await Promise.all([
      db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids)),
      db
        .select({ invoiceId: schema.bankTransactions.matchedInvoiceId })
        .from(schema.bankTransactions)
        .where(inArray(schema.bankTransactions.matchedInvoiceId, ids)),
    ]);
    const linked = new Set(links.map((l) => l.invoiceId));
    const itemsByInvoice = new Map<string, InvoiceLineItemRow[]>();
    for (const item of lineItems) itemsByInvoice.set(item.invoiceId, [...(itemsByInvoice.get(item.invoiceId) ?? []), item]);
    return rows.map((r) => ({
      id: r.id,
      currency: r.currency,
      total: round2(computeInvoiceTotal(itemsByInvoice.get(r.id) ?? [], { reverseCharge: r.reverseCharge })),
      issueDate: r.issueDate,
      paidAt: r.paidAt,
      contactEmail: r.contactEmail,
      contactName: r.contactName,
      alreadyLinked: linked.has(r.id),
    }));
  }

  /** Manual override for the leftovers auto-match couldn't (or shouldn't)
   * resolve on its own. An issued invoice is marked paid, as auto-match
   * does. A paid one (e.g. imported history) is only linked and stays as it
   * is, and only while no other payment links to it. Drafts and cancelled
   * invoices are refused. */
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
    if (invoice.status !== "issued" && invoice.status !== "paid") {
      throw new BadRequestException(
        `Invoice ${invoiceId} is not in "issued" or "paid" status (currently "${invoice.status}") – only those ` +
          "can be reconciled against a payment.",
      );
    }
    if (invoice.status === "paid") {
      const [other] = await db
        .select({ id: schema.bankTransactions.id })
        .from(schema.bankTransactions)
        .where(and(eq(schema.bankTransactions.matchedInvoiceId, invoiceId), ne(schema.bankTransactions.id, transactionId)))
        .limit(1);
      if (other) throw new BadRequestException("invoice_already_linked");
    }

    const [updated] = await db
      .update(schema.bankTransactions)
      .set({ matchedInvoiceId: invoiceId, status: "matched", appliedRuleId: null, matchedExpenseId: null })
      .where(eq(schema.bankTransactions.id, transactionId))
      .returning();

    // A paid invoice already has its payment recorded; linking must not change it.
    if (invoice.status === "issued") {
      await this.invoicesService.markPaidFromReconciliation(db, invoiceId, tenantId, receivedFrom(transaction));
    }

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
