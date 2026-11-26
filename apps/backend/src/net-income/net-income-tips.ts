import { czTaxYear } from "@faktur/cz-compliance";
import type { NetIncomeResult } from "./net-income";
import { settingsFor, type TaxModel } from "./tax-model";

/** `partnerId: null` = the one taxpayer of a "one_person" year. */
export type NetIncomeTip =
  /** The year runs on another year's settings (or the old top-level ones). */
  | { code: "year_settings_missing"; year: number; from: number | null }
  | { code: "partner_no_credits"; partnerId: string | null }
  | { code: "flat_cap_reached"; partnerId: string | null }
  /** The estimate taxes everything at the basic rate; this base is past the 23 % band (prorated). */
  | { code: "high_tax_band"; partnerId: string | null; limit: number }
  /** Taxed per partner, but only one of them has income: maybe it is one taxpayer. */
  | { code: "single_earner"; partnerId: string };

/**
 * Hints that apply to this model and period, each pointing at something the
 * user can change. Nothing generic: no tip when nothing is off.
 */
export function netIncomeTips(model: TaxModel, year: number, result: NetIncomeResult): NetIncomeTip[] {
  const tips: NetIncomeTip[] = [];
  const settings = settingsFor(model, year);
  if (!model.years[String(year)]) tips.push({ code: "year_settings_missing", year, from: settings.source });

  const params = czTaxYear(year);
  const bandLimit = params ? params.taxHighMultiple * params.averageWage : null;
  const pastBand = (base: number) => bandLimit != null && base > (bandLimit * result.months) / 12;

  if (settings.tax_scope === "one_person") {
    if (settings.tax_credits === 0) tips.push({ code: "partner_no_credits", partnerId: null });
    if (result.partners.some((p) => p.capped)) tips.push({ code: "flat_cap_reached", partnerId: null });
    if (pastBand(result.totals.base)) tips.push({ code: "high_tax_band", partnerId: null, limit: bandLimit! });
    return tips;
  }

  for (const p of result.partners) {
    if (settings.partners.get(p.id)?.tax_credits === 0) tips.push({ code: "partner_no_credits", partnerId: p.id });
    if (p.capped) tips.push({ code: "flat_cap_reached", partnerId: p.id });
    if (pastBand(p.base)) tips.push({ code: "high_tax_band", partnerId: p.id, limit: bandLimit! });
  }
  const earning = result.partners.filter((p) => p.income > 0);
  if (result.partners.length > 1 && earning.length === 1) tips.push({ code: "single_earner", partnerId: earning[0]!.id });
  return tips;
}
