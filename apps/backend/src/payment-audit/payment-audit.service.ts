import { Injectable } from "@nestjs/common";
import { and, eq, gt, gte, inArray, isNotNull, lt, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  paymentAuditOf,
  type AuditInvoice,
  type AuditPayment,
  type AuditSource,
  type AuditTransaction,
  type HomeCurrency,
  type PaymentAuditInputs,
} from "@faktur/cz-compliance";
import * as schema from "../../drizzle/schema";
import { getHomeRate } from "../exports/home-rates";
import { computeInvoiceTotal } from "../invoices/invoice-total.util";
import { applyBuyerSnapshot } from "../invoices/party-snapshot";
import { amountsSealed } from "../vault/sealed-amounts";
import { tenantHomeCurrencyOf } from "../tenants/home-currency";

type Db = PostgresJsDatabase<typeof schema>;
type Connection = Pick<typeof schema.bankConnections.$inferSelect, "id" | "provider" | "label" | "bankName" | "accountNumber">;

/** Local calendar day, as the net income report builds its bounds. */
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const num = (v: unknown): number | null => (v == null || v === "" ? null : Number(v));

const UPLOAD_SOURCES = new Set(["csv", "camt053", "gpc", "mt940"]);
// Wise, Revolut and Stripe CSV exports are uploads too; their rows say where they came from in external_id.
const FINTECH_PREFIXES = new Set(["wise", "revolut", "stripe", "paypal"]);
const PROVIDER_OF: Record<string, Connection["provider"]> = { paypal: "paypal", stripe: "stripe", fio: "fio", psd2: "enable_banking" };
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The title bank-connections.service.ts gives a synced import; as `importPrefix` in the frontend's bank-ui.ts. */
function importPrefix(c: Connection): string {
  if (c.provider === "paypal") return squash(c.label ?? "PayPal");
  if (c.provider === "stripe") return squash(c.label ?? "Stripe");
  if (c.provider === "fio") return squash(`Fio ${c.accountNumber ?? ""}`);
  return squash(`${c.bankName ?? "Banka"} ${c.accountNumber ?? ""}`);
}

/** Same keys as `transactionSourceKey` on /bank, so the audit's sources read like its filter. */
export function auditSourceKey(importSource: string | null, filename: string | null, externalId: string | null, connections: Connection[]): string {
  const source = importSource ?? "";
  if (UPLOAD_SOURCES.has(source)) {
    const prefix = externalId?.split(":")[0] ?? "";
    return FINTECH_PREFIXES.has(prefix) ? prefix : "upload";
  }
  const provider = PROVIDER_OF[source];
  if (!provider) return source || "upload";
  const same = connections.filter((c) => c.provider === provider);
  if (same.length === 1) return `c:${same[0]!.id}`;
  const name = squash(filename ?? "");
  const hit = same.find((c) => name.startsWith(`${importPrefix(c)} `));
  return hit ? `c:${hit.id}` : source;
}

function connectionLabel(c: Connection): string {
  if (c.label) return c.label;
  if (c.provider === "paypal") return "PayPal";
  if (c.provider === "stripe") return c.bankName ?? "Stripe";
  if (c.provider === "fio") return squash(`Fio ${c.accountNumber ?? ""}`);
  return squash(`${c.bankName ?? ""} ${c.accountNumber ?? ""}`) || "PSD2";
}

/**
 * "Roční audit plateb": read-only. Everything goes through the member's
 * tenant-scoped connection, so RLS keeps it to the company and leaves out
 * the private invoices this member may not see.
 */
@Injectable()
export class PaymentAuditService {
  /** The report over plain amounts; sealed documents come back as "sealed" for the browser to open. */
  async report(db: Db, tenantId: string, year: number) {
    const inputs = await this.inputs(db, tenantId, year);
    const report = paymentAuditOf(inputs);
    return { ...report, sealed: { count: report.totals.byStatus.sealed } };
  }

  async inputs(db: Db, tenantId: string, year: number): Promise<PaymentAuditInputs> {
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    const home: HomeCurrency = tenantHomeCurrencyOf(tenant);
    const from = new Date(year, 0, 1);
    const to = new Date(year + 1, 0, 1);
    const connections: Connection[] = await db
      .select({
        id: schema.bankConnections.id,
        provider: schema.bankConnections.provider,
        label: schema.bankConnections.label,
        bankName: schema.bankConnections.bankName,
        accountNumber: schema.bankConnections.accountNumber,
      })
      .from(schema.bankConnections);

    // The income tax rule of the net income report: a paid invoice belongs to the year it was paid in.
    // An unpaid one has no such day, so it belongs to the year it was issued in.
    const rows = await db
      .select({ invoice: schema.invoices, contact: schema.contacts })
      .from(schema.invoices)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
      .where(
        and(
          isNotNull(schema.invoices.invoiceNumber),
          eq(schema.invoices.documentType, "invoice"),
          or(
            and(eq(schema.invoices.status, "paid"), gte(schema.invoices.paidAt, from), lt(schema.invoices.paidAt, to)),
            and(eq(schema.invoices.status, "issued"), gte(schema.invoices.issueDate, from), lt(schema.invoices.issueDate, to)),
          ),
        ),
      )
      .orderBy(schema.invoices.issueDate);
    const ids = rows.map((r) => r.invoice.id);
    // A final invoice settled by a paid proforma has no payment of its own: the money sits on the proforma.
    const proformaIds = [...new Set(rows.map((r) => r.invoice.relatedInvoiceId).filter((id): id is string => !!id))];
    const proformas = proformaIds.length
      ? await db
          .select({ id: schema.invoices.id })
          .from(schema.invoices)
          .where(and(inArray(schema.invoices.id, proformaIds), eq(schema.invoices.documentType, "proforma")))
      : [];
    const proformaOf = new Map(rows.filter((r) => proformas.some((p) => p.id === r.invoice.relatedInvoiceId)).map((r) => [r.invoice.relatedInvoiceId!, r.invoice.id]));
    const moneyIds = [...ids, ...proformaOf.keys()];

    const plainIds = rows.filter((r) => !amountsSealed(r.invoice)).map((r) => r.invoice.id);
    // One reserved connection per request (tenant-context middleware): the queries run one after another anyway.
    const items = plainIds.length ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, plainIds)) : [];
    const linked = moneyIds.length
      ? await db
          .select({ tx: schema.bankTransactions, importSource: schema.bankStatementImports.source, filename: schema.bankStatementImports.filename })
          .from(schema.bankTransactions)
          .leftJoin(schema.bankStatementImports, eq(schema.bankStatementImports.id, schema.bankTransactions.importId))
          .where(inArray(schema.bankTransactions.matchedInvoiceId, moneyIds))
      : [];
    const cards = moneyIds.length
      ? await db
          .select()
          .from(schema.cardPaymentSessions)
          .where(and(inArray(schema.cardPaymentSessions.invoiceId, moneyIds), eq(schema.cardPaymentSessions.status, "paid")))
      : [];
    const sealedPayments = moneyIds.length ? await db.select().from(schema.invoiceSealedPayments).where(inArray(schema.invoiceSealedPayments.invoiceId, moneyIds)) : [];
    const ownerOf = (invoiceId: string) => proformaOf.get(invoiceId) ?? invoiceId;

    // Each day's CNB list is its own request; a year of them one by one takes seconds on a cold cache.
    // Every (currency, day) is asked once, and `prefetch` starts them all before a loop awaits them.
    const rates = new Map<string, Promise<number | null>>();
    const rate = (currency: string, day: Date) => {
      const key = `${currency}|${dayOf(day)}`;
      if (!rates.has(key)) rates.set(key, getHomeRate(home, currency, day).catch(() => null));
      return rates.get(key)!;
    };
    const prefetch = (pairs: [string, Date][]) => Promise.all(pairs.filter(([c]) => c !== home).map(([c, d]) => rate(c, d)));
    const homeRateOf = async (tx: typeof schema.bankTransactions.$inferSelect) => {
      if (tx.currency === home) return 1;
      const net = num(tx.netAmount);
      // What really arrived after PayPal's own conversion beats the CNB rate of the day.
      if (net && tx.netCurrency === home) {
        const gross = Number(tx.amount) - Math.abs(num(tx.fee) ?? 0);
        if (gross > 0) return net / gross;
      }
      return rate(tx.currency, tx.transactionDate);
    };

    await prefetch([...linked.map((l): [string, Date] => [l.tx.currency, l.tx.transactionDate]), ...cards.map((c): [string, Date] => [c.currency, c.paidAt ?? c.createdAt])]);
    const stripeLinked = new Set(linked.filter((l) => l.tx.externalId?.startsWith("stripe:")).map((l) => ownerOf(l.tx.matchedInvoiceId!)));
    const paymentsOf = new Map<string, AuditPayment[]>();
    const push = (invoiceId: string, p: AuditPayment) => paymentsOf.set(invoiceId, [...(paymentsOf.get(invoiceId) ?? []), p]);
    for (const { tx, importSource, filename } of linked) {
      push(ownerOf(tx.matchedInvoiceId!), {
        id: tx.id,
        kind: "bank",
        source: auditSourceKey(importSource, filename, tx.externalId, connections),
        date: dayOf(tx.transactionDate),
        amount: Number(tx.amount),
        currency: tx.currency,
        fee: num(tx.fee),
        homeRate: await homeRateOf(tx),
      });
    }
    const cardTransactions: AuditTransaction[] = [];
    for (const card of cards) {
      const owner = ownerOf(card.invoiceId);
      // A synced Stripe account already brought the same payment as a bank row.
      if (stripeLinked.has(owner) || card.sealState === "dropped") continue;
      const sealedEnvelope = card.amount == null ? sealedPayments.find((s) => s.id === card.sealedPaymentId)?.encAmount ?? null : null;
      if (card.amount == null && !sealedEnvelope) continue;
      const paidAt = card.paidAt ?? card.createdAt;
      const payment: AuditPayment = {
        id: card.id,
        kind: "card",
        source: "card",
        date: dayOf(paidAt),
        amount: num(card.amount),
        currency: card.currency,
        fee: num(card.fee),
        homeRate: await rate(card.currency, paidAt),
        encAmount: sealedEnvelope,
      };
      push(owner, payment);
      if (paidAt >= from && paidAt < to) {
        const invoice = rows.find((r) => r.invoice.id === owner)?.invoice;
        cardTransactions.push({
          ...payment,
          amount: payment.amount ?? 0,
          amountUnknown: payment.amount == null,
          externalId: null,
          status: "matched",
          matchedInvoiceId: owner,
          matchedInvoiceStatus: invoice?.status ?? null,
          matchedInvoiceNumber: invoice?.invoiceNumber ?? null,
          matchedExpenseId: null,
          transferPairId: null,
          counterpartyName: null,
          counterpartyAccount: null,
          message: null,
          variableSymbol: null,
        });
      }
    }
    // Card and bank payments of a sealed document have their own envelope; what is left was entered by hand.
    const cardSealed = new Set(cards.map((c) => c.sealedPaymentId).filter(Boolean));
    const manualSealed = new Set(sealedPayments.filter((s) => !s.bankTransactionId && !cardSealed.has(s.id)).map((s) => ownerOf(s.invoiceId)));

    const invoices: AuditInvoice[] = [];
    for (const { invoice, contact } of rows) {
      const sealed = amountsSealed(invoice);
      const payments = (paymentsOf.get(invoice.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
      const day = invoice.paidAt ?? (payments.length ? new Date(payments.at(-1)!.date) : invoice.issueDate ?? new Date());
      invoices.push({
        id: invoice.id,
        number: invoice.invoiceNumber ?? "",
        customer: contact ? (applyBuyerSnapshot(contact, invoice.buyerSnapshot).legalName ?? "") : "",
        currency: invoice.currency,
        total: sealed ? null : computeInvoiceTotal(items.filter((i) => i.invoiceId === invoice.id), { reverseCharge: invoice.reverseCharge }),
        // The rate of the day the money came, so a payment in CZK is compared with the invoice at the same rate.
        rate: invoice.currency === home ? 1 : ((await rate(invoice.currency, day)) ?? num(invoice.exchangeRate)),
        issueDate: invoice.issueDate ? dayOf(invoice.issueDate) : null,
        dueDate: invoice.dueDate ? dayOf(invoice.dueDate) : null,
        paidAt: invoice.paidAt ? dayOf(invoice.paidAt) : null,
        paymentMethod: invoice.paymentMethod,
        // amount_paid is set to the total by "mark as paid" too, so it says nothing about where the money is.
        markedPaid: invoice.status === "paid" || Number(invoice.amountPaid) > 0 || invoice.sealedPaymentState === "partly_paid" || manualSealed.has(invoice.id),
        paidInFull: invoice.status === "paid",
        recordedFee: sealed ? null : Number(invoice.paymentFees) || 0,
        encAmounts: sealed ? invoice.encAmounts : null,
        payments,
      });
    }

    const matched = alias(schema.invoices, "matched_invoice");
    const yearRows = await db
      .select({
        tx: schema.bankTransactions,
        importSource: schema.bankStatementImports.source,
        filename: schema.bankStatementImports.filename,
        matchedStatus: matched.status,
        matchedNumber: matched.invoiceNumber,
      })
      .from(schema.bankTransactions)
      .leftJoin(schema.bankStatementImports, eq(schema.bankStatementImports.id, schema.bankTransactions.importId))
      .leftJoin(matched, eq(matched.id, schema.bankTransactions.matchedInvoiceId))
      .where(and(gte(schema.bankTransactions.transactionDate, from), lt(schema.bankTransactions.transactionDate, to), gt(schema.bankTransactions.amount, "0")))
      .orderBy(schema.bankTransactions.transactionDate);
    await prefetch(yearRows.map(({ tx }): [string, Date] => [tx.currency, tx.transactionDate]));
    const transactions: AuditTransaction[] = [];
    for (const { tx, importSource, filename, matchedStatus, matchedNumber } of yearRows) {
      transactions.push({
        id: tx.id,
        kind: "bank",
        source: auditSourceKey(importSource, filename, tx.externalId, connections),
        date: dayOf(tx.transactionDate),
        amount: Number(tx.amount),
        currency: tx.currency,
        fee: num(tx.fee),
        homeRate: await homeRateOf(tx),
        externalId: tx.externalId,
        status: tx.status,
        matchedInvoiceId: tx.matchedInvoiceId,
        matchedInvoiceStatus: matchedStatus ?? null,
        matchedInvoiceNumber: matchedNumber ?? null,
        matchedExpenseId: tx.matchedExpenseId,
        transferPairId: tx.transferPairId,
        counterpartyName: tx.counterpartyName,
        counterpartyAccount: tx.counterpartyAccount,
        message: tx.message,
        variableSymbol: tx.variableSymbol,
      });
    }
    transactions.push(...cardTransactions);

    const keys = new Set([...transactions.map((t) => t.source), ...invoices.flatMap((i) => i.payments.map((p) => p.source))]);
    const sources: AuditSource[] = [...keys].map((key) => {
      const c = key.startsWith("c:") ? connections.find((x) => `c:${x.id}` === key) : undefined;
      return { key, label: c ? connectionLabel(c) : null, provider: c?.provider ?? key };
    });

    return { year, from: dayOf(from), to: dayOf(to), home, sources, invoices, transactions };
  }
}
