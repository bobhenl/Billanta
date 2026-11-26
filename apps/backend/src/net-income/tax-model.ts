import { z } from "zod";

/**
 * The company's own "what is left after taxes" model, stored as
 * `tenants.tax_model` (null = DEFAULT_TAX_MODEL). Rates are percentages, money
 * is whole CZK. Shares are weights, not percentages: they are divided by their
 * sum, so 1 : 2 works as well as 33 : 67, and a removed partner simply drops
 * out of an older split.
 */

const PARTNER_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const DAY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

const percent = (max: number) => z.number().finite().min(0).max(max);
const money = (min: number, max: number) => z.number().finite().min(min).max(max);

/** {partnerId: weight}; at least one positive weight. */
export const sharesSchema = z
  .record(z.string().regex(PARTNER_ID), money(0, 1_000_000))
  .refine((s) => Object.keys(s).length <= 20, "too_many_shares")
  .refine((s) => Object.values(s).some((v) => v > 0), "shares_must_be_positive");

export type Shares = z.infer<typeof sharesSchema>;

const partnerSchema = z.object({
  id: z.string().regex(PARTNER_ID),
  name: z.string().trim().max(60),
  share: money(0, 1_000_000),
  /** Yearly slevy na dani (taxpayer, spouse, children…), Kč. */
  tax_credits: money(0, 10_000_000),
  /** The team member this partner is, if they have an account in the company. */
  user_id: z.string().uuid().nullish(),
  /** Invoices that member creates are theirs, unless an invoice has its own split. */
  claim_own: z.boolean().optional(),
});

/**
 * A one-off expense counts in the period holding its `date`. A recurring one
 * counts in every month of [from, to] (by month, both ends inclusive; null =
 * open). The dates came later, so a stored model without them parses as
 * before: recurring and open on both ends.
 */
const sharedExpenseSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    amount: money(0, 1_000_000_000),
    per: z.enum(["once", "month", "year"]),
    date: z.string().regex(DAY).nullable().default(null),
    from: z.string().regex(DAY).nullable().default(null),
    to: z.string().regex(DAY).nullable().default(null),
    /** null = the partners' default shares. */
    shares: sharesSchema.nullable(),
  })
  .superRefine((e, ctx) => {
    if (e.per === "once" && !e.date) ctx.addIssue({ code: "custom", message: "expense_date_required" });
    if (e.from && e.to && e.from.slice(0, 7) > e.to.slice(0, 7)) ctx.addIssue({ code: "custom", message: "expense_range_invalid" });
  });

/** Income that is not an invoice (fees, FX gains…), taxed the same way. */
const extraIncomeSchema = z.object({
  date: z.string().regex(DAY),
  label: z.string().trim().min(1).max(80),
  amount: money(-1_000_000_000, 1_000_000_000),
  shares: sharesSchema.nullable(),
});

const rateFields = {
  flat_expense_percent: percent(80),
  /** Yearly cap of the flat-rate expenses per person (Kč); null = none. */
  flat_expense_cap: money(0, 100_000_000).nullable(),
  income_tax_percent: percent(100),
  social_rate_percent: percent(100),
  social_base_percent: percent(100),
  health_rate_percent: percent(100),
  health_base_percent: percent(100),
};

export const RATE_KEYS = Object.keys(rateFields) as (keyof typeof rateFields)[];

const yearPartnerSchema = z.object({ tax_credits: money(0, 10_000_000) });

/**
 * Rates and credits change from year to year; partners and their default
 * shares do not. `tax_scope`: "per_partner" taxes each partner as their own
 * OSVČ on their share (what the model always did); "one_person" is one sole
 * trader whose income is shared out: paušál, cap, credits, tax and insurance
 * once on the total, then each line divided by the income shares.
 */
const yearSettingsSchema = z.object({
  ...rateFields,
  tax_scope: z.enum(["per_partner", "one_person"]).default("per_partner"),
  /** The one taxpayer's yearly credits ("one_person" only). */
  tax_credits: money(0, 10_000_000).default(0),
  partners: z.record(z.string().regex(PARTNER_ID), yearPartnerSchema).refine((p) => Object.keys(p).length <= 20, "too_many_partners"),
});

export type YearSettings = z.infer<typeof yearSettingsSchema>;

export const taxModelSchema = z
  .object({
    ...rateFields,
    /**
     * Per calendar year ("2024"). A period uses its own year, else the nearest
     * earlier one, else the top-level values above (all a model had before).
     */
    years: z
      .record(z.string().regex(/^(19|20|21)\d{2}$/), yearSettingsSchema)
      .refine((y) => Object.keys(y).length <= 50, "too_many_years")
      .default({}),
    partners: z.array(partnerSchema).min(1).max(10),
    shared_expenses: z.array(sharedExpenseSchema).max(50),
    extra_income: z.array(extraIncomeSchema).max(500),
  })
  .superRefine((m, ctx) => {
    const ids = m.partners.map((p) => p.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate_partner" });
    const users = m.partners.map((p) => p.user_id).filter(Boolean);
    if (new Set(users).size !== users.length) ctx.addIssue({ code: "custom", message: "duplicate_partner_user" });
    if (!m.partners.some((p) => p.share > 0)) ctx.addIssue({ code: "custom", message: "shares_must_be_positive" });
  });

export type TaxModel = z.infer<typeof taxModelSchema>;

/**
 * A single OSVČ under current Czech rules: 60 % paušál capped at 1.2 M Kč,
 * 15 % tax, social 29.2 % of 55 % of the profit (since 2024), health 13.5 % of
 * 50 %, and the basic taxpayer credit.
 */
export const DEFAULT_TAX_MODEL: TaxModel = {
  flat_expense_percent: 60,
  flat_expense_cap: 1_200_000,
  income_tax_percent: 15,
  social_rate_percent: 29.2,
  social_base_percent: 55,
  health_rate_percent: 13.5,
  health_base_percent: 50,
  partners: [{ id: "me", name: "", share: 100, tax_credits: 30_840 }],
  shared_expenses: [],
  extra_income: [],
  years: {},
};

/** The stored model, or the defaults when there is none or it no longer parses. */
export function taxModelOf(stored: unknown): TaxModel {
  const parsed = taxModelSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_TAX_MODEL;
}

export interface ResolvedYear extends Pick<TaxModel, (typeof RATE_KEYS)[number]> {
  /** The `years` entry used, or null for the top-level values. */
  source: number | null;
  tax_scope: YearSettings["tax_scope"];
  /** "one_person": the taxpayer's credits. */
  tax_credits: number;
  /** "per_partner": each partner's credits. */
  partners: Map<string, { tax_credits: number }>;
}

/** The settings in force in `year`. */
export function settingsFor(model: TaxModel, year: number): ResolvedYear {
  const source =
    Object.keys(model.years)
      .map(Number)
      .filter((y) => y <= year)
      .sort((a, b) => b - a)[0] ?? null;
  const entry = source == null ? null : model.years[String(source)]!;
  const rates = entry ?? model;
  const partners = new Map(model.partners.map((p) => [p.id, { tax_credits: entry?.partners[p.id]?.tax_credits ?? p.tax_credits }]));
  return {
    ...(Object.fromEntries(RATE_KEYS.map((k) => [k, rates[k]])) as Pick<TaxModel, (typeof RATE_KEYS)[number]>),
    source,
    tax_scope: entry?.tax_scope ?? "per_partner",
    tax_credits: entry?.tax_credits ?? 0,
    partners,
  };
}

/**
 * Whose invoice it is when it has no split of its own: the partner linked to
 * the member who created it, if that partner claims their own invoices;
 * otherwise null, i.e. the default shares.
 */
export function creatorShares(model: TaxModel, createdByUserId: string | null): Shares | null {
  if (!createdByUserId) return null;
  const partner = model.partners.find((p) => p.claim_own && p.user_id === createdByUserId);
  return partner ? { [partner.id]: 1 } : null;
}
