import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq, gte, inArray, isNotNull, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { loadPlanSummary } from "../billing/plan.guard";
import { PLAN_PARTNERS, planFor } from "../billing/plans";
import { getHomeRate } from "../exports/home-rates";
import { ReportRates } from "../exports/uniform-rate";
import { computeVatBreakdown, round2 } from "../invoices/invoice-total.util";
import { applyBuyerSnapshot } from "../invoices/party-snapshot";
import { amountsSealed } from "../vault/sealed-amounts";
import { tenantHomeCurrencyOf } from "../tenants/home-currency";
import { computeNetIncome, type IncomeItem } from "./net-income";
import { netIncomeTips } from "./net-income-tips";
import { creatorShares, settingsFor, type Shares, sharesSchema, type TaxModel, taxModelOf } from "./tax-model";

type Db = PostgresJsDatabase<typeof schema>;

export interface NetIncomePeriod {
  year: number;
  /** 1–12, or null. */
  month: number | null;
  /** 1–4, or null. Neither = the whole year. */
  quarter: number | null;
}

/** Local calendar day, matching how the period bounds are built (server time, like the annual summary). */
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

@Injectable()
export class NetIncomeService {
  async model(db: Db, tenantId: string): Promise<TaxModel> {
    const [t] = await db.select({ taxModel: schema.tenants.taxModel }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    return taxModelOf(t?.taxModel);
  }

  async saveModel(db: Db, tenantId: string, model: TaxModel): Promise<TaxModel> {
    // Adding partners past the plan is refused; a company already over it after a downgrade can still edit or remove them.
    const summary = await loadPlanSummary(db, tenantId);
    if (summary?.enforced && model.partners.length > PLAN_PARTNERS[summary.plan]) {
      const before = await this.model(db, tenantId);
      if (model.partners.length > before.partners.length) {
        throw new ForbiddenException({
          error: "plan_required",
          message: "partner_limit",
          feature: "partners",
          limit: PLAN_PARTNERS[summary.plan],
          plan: planFor(PLAN_PARTNERS, model.partners.length),
        });
      }
    }
    // A partner can only be linked to someone in this company (RLS keeps the lookup to it).
    const linked = model.partners.map((p) => p.user_id).filter((u): u is string => !!u);
    if (linked.length) {
      const members = await db
        .select({ userId: schema.tenantMemberships.userId })
        .from(schema.tenantMemberships)
        .where(inArray(schema.tenantMemberships.userId, linked));
      if (members.length !== new Set(linked).size) throw new BadRequestException("partner_user_not_member");
    }
    await db.update(schema.tenants).set({ taxModel: model, updatedAt: new Date() }).where(eq(schema.tenants.id, tenantId));
    return model;
  }

  /** Per-invoice split; null goes back to the default shares. Only paid invoices and credit notes count in the report. */
  async setInvoiceShares(db: Db, id: string, shares: Shares | null) {
    const [row] = await db
      .update(schema.invoices)
      .set({ partnerShares: shares })
      .where(eq(schema.invoices.id, id))
      .returning({ id: schema.invoices.id, partnerShares: schema.invoices.partnerShares });
    if (!row) throw new NotFoundException("invoice_not_found");
    return row;
  }

  async report(db: Db, tenantId: string, period: NetIncomePeriod) {
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    // The model is Czech (paušál, ČSSZ, ZP) and the received amounts are in CZK.
    if (tenantHomeCurrencyOf(tenant) !== "CZK") throw new BadRequestException("country_not_supported");
    const model = taxModelOf(tenant?.taxModel);
    const vatPayer = tenant?.dicVatPayer ?? false;
    const firstMonth = period.month ? period.month - 1 : period.quarter ? (period.quarter - 1) * 3 : 0;
    const months = period.month ? 1 : period.quarter ? 3 : 12;
    const from = new Date(period.year, firstMonth, 1);
    const to = new Date(period.year, firstMonth + months, 1);

    const rates = ReportRates.fromPrefs(tenant?.invoiceFormPrefs, new Date(), "CZK");
    const rows = await db
      .select({ invoice: schema.invoices, contact: schema.contacts })
      .from(schema.invoices)
      .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
      .where(
        and(
          isNotNull(schema.invoices.invoiceNumber),
          inArray(schema.invoices.documentType, ["invoice", "credit_note"]),
          eq(schema.invoices.status, "paid"),
          gte(schema.invoices.paidAt, from),
          lt(schema.invoices.paidAt, to),
        ),
      )
      .orderBy(schema.invoices.paidAt);
    const ids = rows.map((r) => r.invoice.id);
    const items = ids.length ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids)) : [];

    let missingRates = 0;
    const invoices: {
      id: string;
      number: string;
      customer: string;
      paidAt: string;
      month: number;
      currency: string;
      amount: number;
      income: number;
      source: "czk" | "received" | "converted";
      partnerShares: Shares | null;
      /** The creator's partner when they claim their own invoices; used when partnerShares is null. */
      claimedShares: Shares | null;
    }[] = [];
    // Sealed amounts would count as 0 income; they are listed for the browser instead.
    const sealedIds: string[] = [];
    for (const { invoice, contact } of rows) {
      if (amountsSealed(invoice)) {
        sealedIds.push(invoice.id);
        continue;
      }
      const totals = computeVatBreakdown(
        items.filter((i) => i.invoiceId === invoice.id),
        { reverseCharge: invoice.reverseCharge },
      );
      const sign = invoice.documentType === "credit_note" ? -1 : 1;
      const amount = Math.abs(vatPayer ? totals.totalWithoutVat : totals.totalWithVat) * sign;
      const paidAt = invoice.paidAt!;
      let income: number;
      let source: "czk" | "received" | "converted";
      const received = Number(invoice.receivedCzk);
      if (invoice.currency === "CZK") {
        income = amount;
        source = "czk";
      } else if (invoice.receivedCzk != null && received > 0) {
        // What actually arrived (after PayPal's fee and rate); a VAT payer keeps the base part of it.
        const baseShare = vatPayer && totals.totalWithVat ? totals.totalWithoutVat / totals.totalWithVat : 1;
        income = received * baseShare * sign;
        source = "received";
      } else {
        const rate = (await rates.rate(invoice.currency, Number(invoice.exchangeRate) || null, paidAt, period.year)) ?? (await getHomeRate("CZK", invoice.currency, paidAt));
        if (rate == null) {
          missingRates++;
          continue;
        }
        income = amount * rate;
        source = "converted";
      }
      invoices.push({
        id: invoice.id,
        number: invoice.invoiceNumber ?? "",
        customer: contact ? (applyBuyerSnapshot(contact, invoice.buyerSnapshot).legalName ?? "") : "",
        paidAt: dayOf(paidAt),
        month: paidAt.getMonth() + 1,
        currency: invoice.currency,
        amount: round2(amount),
        income: round2(income),
        source,
        partnerShares: sharesOrNull(invoice.partnerShares),
        claimedShares: creatorShares(model, invoice.createdByUserId),
      });
    }

    const fromDay = dayOf(from);
    const toDay = dayOf(to);
    const extraIncome = model.extra_income
      .map((e, index) => ({ ...e, index }))
      .filter((e) => e.date >= fromDay && e.date < toDay);

    const itemsOf = (month: number | null): IncomeItem[] => [
      ...invoices.filter((i) => month == null || i.month === month).map((i) => ({ amount: i.income, shares: i.partnerShares ?? i.claimedShares })),
      ...extraIncome.filter((e) => month == null || Number(e.date.slice(5, 7)) === month).map((e) => ({ amount: e.amount, shares: e.shares })),
    ];

    // One-off and dated shared expenses are placed by the same calendar months as the extra income above.
    const result = computeNetIncome(model, itemsOf(null), { year: period.year, month: firstMonth + 1, months });
    // Each month on its own (credits and the paušál cap at 1/12), to compare them side by side.
    const byMonth =
      months > 1
        ? Array.from({ length: months }, (_, i) => {
            const month = firstMonth + i + 1;
            const r = computeNetIncome(model, itemsOf(month), { year: period.year, month, months: 1 });
            return { month, income: r.totals.income, taxes: r.totals.taxes, sharedExpenses: r.totals.sharedExpenses, net: r.totals.net };
          })
        : null;

    const settings = settingsFor(model, period.year);
    return {
      period: { ...period, months, from: fromDay, to: toDay },
      vatPayer,
      model,
      /** What the period was computed with (its year's settings). */
      settings: { ...settings, partners: Object.fromEntries(settings.partners) },
      result,
      tips: netIncomeTips(model, period.year, result),
      byMonth,
      invoices,
      extraIncome,
      missingRates,
      /** Paid documents of the period with sealed amounts, left out of `result`. */
      sealed: { count: sealedIds.length, ids: sealedIds },
    };
  }
}

function sharesOrNull(v: unknown): Shares | null {
  const parsed = sharesSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}
