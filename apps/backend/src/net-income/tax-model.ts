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
});

const sharedExpenseSchema = z.object({
  label: z.string().trim().min(1).max(80),
  amount: money(0, 1_000_000_000),
  per: z.enum(["month", "year"]),
  /** null = the partners' default shares. */
  shares: sharesSchema.nullable(),
});

/** Income that is not an invoice (fees, FX gains…), taxed the same way. */
const extraIncomeSchema = z.object({
  date: z.string().regex(DAY),
  label: z.string().trim().min(1).max(80),
  amount: money(-1_000_000_000, 1_000_000_000),
  shares: sharesSchema.nullable(),
});

export const taxModelSchema = z
  .object({
    flat_expense_percent: percent(80),
    /** Yearly cap of the flat-rate expenses per person (Kč); null = none. */
    flat_expense_cap: money(0, 100_000_000).nullable(),
    income_tax_percent: percent(100),
    social_rate_percent: percent(100),
    social_base_percent: percent(100),
    health_rate_percent: percent(100),
    health_base_percent: percent(100),
    partners: z.array(partnerSchema).min(1).max(10),
    shared_expenses: z.array(sharedExpenseSchema).max(50),
    extra_income: z.array(extraIncomeSchema).max(500),
  })
  .superRefine((m, ctx) => {
    const ids = m.partners.map((p) => p.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "duplicate_partner" });
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
};

/** The stored model, or the defaults when there is none or it no longer parses. */
export function taxModelOf(stored: unknown): TaxModel {
  const parsed = taxModelSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_TAX_MODEL;
}
