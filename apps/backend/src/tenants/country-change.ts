import { BadRequestException, ConflictException } from "@nestjs/common";
import { homeCurrencyForCountry, isActiveCountry } from "@faktur/cz-compliance";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../../drizzle/schema";

/**
 * The tax country picked at onboarding. Only an active country can be
 * chosen, and once an invoice has been issued under one country's rules
 * the choice is final: numbering, VAT and exports already depend on it.
 * Returns the columns to write, or nothing when the country stays.
 */
export function countryChange(current: string | null | undefined, requested: string | undefined, locked: boolean): { country: string; homeCurrency: string } | null {
  if (requested === undefined) return null;
  const country = requested.trim().toUpperCase();
  if ((current ?? "").trim().toUpperCase() === country) return null;
  if (!isActiveCountry(country)) throw new BadRequestException("country_not_supported");
  if (locked) throw new ConflictException("country_locked");
  return { country, homeCurrency: homeCurrencyForCountry(country) };
}

/** Locked once any invoice left draft / review; RLS keeps the check to this company. */
export async function isCountryLocked(db: PostgresJsDatabase<typeof schema>): Promise<boolean> {
  const [row] = await db.execute<{ locked: boolean }>(
    sql`SELECT EXISTS (SELECT 1 FROM invoices WHERE status NOT IN ('draft', 'pending_review')) AS locked`,
  );
  return Boolean(row?.locked);
}
