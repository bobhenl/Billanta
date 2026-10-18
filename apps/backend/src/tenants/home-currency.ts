import { homeCurrencyOf, type HomeCurrency } from "@faktur/cz-compliance";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";

/**
 * The currency the company keeps its books in: CZK, or EUR for a company
 * registered in Slovakia. It follows the registered country, never the UI
 * language, so a Slovak-speaking Czech company still reports in CZK.
 */
export async function tenantHomeCurrency(db: PostgresJsDatabase<typeof schema>, tenantId: string): Promise<HomeCurrency> {
  const [tenant] = await db.select({ country: schema.tenants.addressCountry }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  return homeCurrencyOf(tenant?.country);
}
