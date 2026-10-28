import { homeCurrencyOf, type HomeCurrency } from "@faktur/cz-compliance";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";

type TaxCountryFields = { country?: string | null; homeCurrency?: string | null };

/**
 * The tax country of a tenant row (`tenants.country`, 0087): VAT rules,
 * deadlines and exports follow it. Never the postal address, which the
 * company may change freely, and never the UI language. CZ for a row that
 * somehow lacks it, which was the rule before the column existed.
 */
export function tenantCountry(tenant: TaxCountryFields | null | undefined): "CZ" | "SK" {
  // Only CZ and SK can be chosen yet (ACTIVE_COUNTRIES); anything else would
  // fall back to the Czech rules, exactly as an unknown address did before.
  return tenant?.country?.trim().toUpperCase() === "SK" ? "SK" : "CZ";
}

/**
 * The currency the company keeps its books in: CZK, or EUR for a company
 * registered in Slovakia. Stored as `tenants.home_currency` next to the
 * country; while only CZ and SK exist it always equals `homeCurrencyOf`.
 */
export function tenantHomeCurrencyOf(tenant: TaxCountryFields | null | undefined): HomeCurrency {
  return homeCurrencyOf(tenantCountry(tenant));
}

export async function tenantHomeCurrency(db: PostgresJsDatabase<typeof schema>, tenantId: string): Promise<HomeCurrency> {
  const [tenant] = await db.select({ country: schema.tenants.country }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return tenantHomeCurrencyOf(tenant);
}
