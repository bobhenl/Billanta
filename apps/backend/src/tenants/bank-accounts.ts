import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, asc, eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";

type TenantDb = PostgresJsDatabase<typeof schema>;
type TenantRow = typeof schema.tenants.$inferSelect;
export type BankAccountRow = typeof schema.tenantBankAccounts.$inferSelect;

/**
 * Picks the account an invoice is paid to: the one chosen on the invoice,
 * else an extra account in the invoice currency, else null (= the primary
 * account on the tenant row). Mirrors get_public_invoice_supplier_info().
 */
export function pickBankAccount(
  accounts: BankAccountRow[],
  invoice: { bankAccountId: string | null; currency: string },
): BankAccountRow | null {
  if (invoice.bankAccountId) {
    const chosen = accounts.find((a) => a.id === invoice.bankAccountId);
    if (chosen) return chosen;
  }
  return accounts.find((a) => a.currency === invoice.currency) ?? null;
}

/** The tenant row with its bank fields replaced by the resolved account, for the PDF / ISDOC. */
export function withBankAccount(tenant: TenantRow, account: BankAccountRow | null): TenantRow {
  if (!account) return tenant;
  return {
    ...tenant,
    bankAccountNumber: account.accountNumber,
    bankAccountBankCode: account.bankCode,
    bankAccountIban: account.iban,
    bankAccountSwift: account.swift,
  };
}

export async function listBankAccounts(db: TenantDb, tenantId: string): Promise<BankAccountRow[]> {
  return db
    .select()
    .from(schema.tenantBankAccounts)
    .where(eq(schema.tenantBankAccounts.tenantId, tenantId))
    .orderBy(asc(schema.tenantBankAccounts.sortOrder), asc(schema.tenantBankAccounts.createdAt));
}

export async function resolveTenantForInvoice(
  db: TenantDb,
  tenant: TenantRow,
  invoice: { bankAccountId: string | null; currency: string },
): Promise<TenantRow> {
  return withBankAccount(tenant, pickBankAccount(await listBankAccounts(db, tenant.id), invoice));
}

export async function findBankAccount(db: TenantDb, tenantId: string, id: string) {
  const [row] = await db
    .select()
    .from(schema.tenantBankAccounts)
    .where(and(eq(schema.tenantBankAccounts.tenantId, tenantId), eq(schema.tenantBankAccounts.id, id)))
    .limit(1);
  return row ?? null;
}
