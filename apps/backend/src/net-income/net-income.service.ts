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
import { netIncomeAmountOf, netIncomeReportOf, netIncomeSpanOf, type NetIncomeActivity, type NetIncomeInputs, type NetIncomeInvoice, type SealedNetIncomeDoc } from "@faktur/cz-compliance";
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

  /** The report over the plain documents; sealed ones are only counted (the browser adds them from `inputs`). */
  async report(db: Db, tenantId: string, period: NetIncomePeriod) {
    const { inputs, sealedIds } = await this.collect(db, tenantId, period);
    return {
      ...netIncomeReportOf(inputs),
      /** Paid documents of the period with sealed amounts, left out of `result`. */
      sealed: { count: sealedIds.length, ids: sealedIds },
    };
  }

  /**
   * Confidential mode: the same inputs the report is built from, the sealed
   * documents with their totals envelope and rate instead of an amount. The
   * browser opens them and builds the report with netIncomeReportOf; nothing
   * opened comes back.
   */
  async inputs(db: Db, tenantId: string, period: NetIncomePeriod): Promise<NetIncomeInputs> {
    return (await this.collect(db, tenantId, period)).inputs;
  }

  private async collect(db: Db, tenantId: string, period: NetIncomePeriod): Promise<{ inputs: NetIncomeInputs; sealedIds: string[] }> {
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    // The model is Czech (paušál, ČSSZ, ZP) and the received amounts are in CZK.
    if (tenantHomeCurrencyOf(tenant) !== "CZK") throw new BadRequestException("country_not_supported");
    const model = taxModelOf(tenant?.taxModel);
    const vatPayer = tenant?.dicVatPayer ?? false;
    const span = netIncomeSpanOf(period);
    const from = new Date(period.year, span.month - 1, 1);
    const to = new Date(period.year, span.month - 1 + span.months, 1);

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
    // A sealed document's items hold only the placeholder: no need to load them.
    const ids = rows.filter((r) => !amountsSealed(r.invoice)).map((r) => r.invoice.id);
    const items = ids.length ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, ids)) : [];
    const rateOf = async (currency: string, exchangeRate: unknown, paidAt: Date) =>
      (await rates.rate(currency, Number(exchangeRate) || null, paidAt, period.year)) ?? (await getHomeRate("CZK", currency, paidAt));

    // Each day's CNB list is its own request; a year of foreign invoices fetched one by one took
    // seconds on a cold cache. Ask for them all at once; the loop below then reads the cache.
    await Promise.all(
      rows
        .filter(({ invoice }) => invoice.currency !== "CZK")
        .map(({ invoice }) => rateOf(invoice.currency, invoice.exchangeRate, invoice.paidAt!).catch(() => null)),
    );

    let missingRates = 0;
    const invoices: NetIncomeInvoice[] = [];
    // Sealed amounts would count as 0 income; they go to the browser with their envelope instead.
    const sealedDocs: SealedNetIncomeDoc[] = [];
    for (const { invoice, contact } of rows) {
      const paidAt = invoice.paidAt!;
      const listed = {
        id: invoice.id,
        number: invoice.invoiceNumber ?? "",
        customer: contact ? (applyBuyerSnapshot(contact, invoice.buyerSnapshot).legalName ?? "") : "",
        paidAt: dayOf(paidAt),
        month: paidAt.getMonth() + 1,
        currency: invoice.currency,
        partnerShares: sharesOrNull(invoice.partnerShares),
        claimedShares: creatorShares(model, invoice.createdByUserId),
      };
      if (amountsSealed(invoice)) {
        // What arrived in CZK is sealed too (paymentsOnSeal), so a foreign one is converted like the year summary does.
        const rate = invoice.currency === "CZK" ? 1 : await rateOf(invoice.currency, invoice.exchangeRate, paidAt);
        sealedDocs.push({ ...listed, documentType: invoice.documentType as "invoice" | "credit_note", encAmounts: invoice.encAmounts!, rate });
        continue;
      }
      const totals = computeVatBreakdown(
        items.filter((i) => i.invoiceId === invoice.id),
        { reverseCharge: invoice.reverseCharge },
      );
      const sign = invoice.documentType === "credit_note" ? -1 : 1;
      const amount = netIncomeAmountOf(totals, invoice.documentType, vatPayer);
      let income: number;
      let fees = 0;
      let source: NetIncomeInvoice["source"];
      const received = Number(invoice.receivedCzk);
      if (invoice.currency === "CZK") {
        income = amount;
        source = "czk";
      } else if (invoice.receivedCzk != null && received > 0) {
        // The tax is on the invoiced amount at the rate (as in the tax return); what PayPal's fee and
        // its worse rate took off the way comes off the net only. A VAT payer keeps the base part.
        const baseShare = vatPayer && totals.totalWithVat ? totals.totalWithoutVat / totals.totalWithVat : 1;
        const arrived = received * baseShare * sign;
        const rate = await rateOf(invoice.currency, invoice.exchangeRate, paidAt).catch(() => null);
        income = rate == null ? arrived : amount * rate;
        fees = income - arrived;
        source = "received";
      } else {
        const rate = await rateOf(invoice.currency, invoice.exchangeRate, paidAt);
        if (rate == null) {
          missingRates++;
          continue;
        }
        income = amount * rate;
        source = "converted";
      }
      invoices.push({ ...listed, amount: round2(amount), income: round2(income), fees: round2(fees), source });
    }

    const inputs: NetIncomeInputs = {
      period: { ...period, months: span.months, from: dayOf(from), to: dayOf(to) },
      vatPayer,
      model,
      invoices,
      missingRates,
      sealedDocs,
      // Company settings decide vedlejší činnost (the report's own old switch only while they say nothing).
      activity: activityOf(tenant),
    };
    // A month or quarter takes its part of the year's actual payments by income, so it needs the whole year's.
    // Loaded only then: most years have no actual amounts and the period alone is enough.
    if (span.months < 12 && settingsFor(model, period.year).actual) {
      const { inputs: year } = await this.collect(db, tenantId, { year: period.year, month: null, quarter: null });
      inputs.yearIncome = {
        invoices: round2(year.invoices.reduce((s, i) => s + i.income, 0)),
        sealedDocs: year.sealedDocs.map((d) => ({ documentType: d.documentType, encAmounts: d.encAmounts, rate: d.rate })),
      };
    }
    return { inputs, sealedIds: sealedDocs.map((d) => d.id) };
  }
}

/** Hlavní / vedlejší činnost from Settings → Company; the days only matter for a secondary one. */
export function activityOf(
  tenant: Pick<typeof schema.tenants.$inferSelect, "activityKind" | "secondaryActivityFrom" | "secondaryActivityTo"> | undefined,
): NetIncomeActivity {
  const kind = tenant?.activityKind ?? null;
  return kind === "secondary"
    ? { kind, from: tenant?.secondaryActivityFrom ?? null, to: tenant?.secondaryActivityTo ?? null }
    : { kind, from: null, to: null };
}

function sharesOrNull(v: unknown): Shares | null {
  const parsed = sharesSchema.safeParse(v);
  return parsed.success ? parsed.data : null;
}
