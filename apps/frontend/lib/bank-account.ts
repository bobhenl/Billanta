/** Client-safe: no server imports (lib/tenant.ts pulls in auth). */

/** Extra bank account (Settings → Company), besides the primary one on the tenant. */
export interface BankAccount {
  id: string;
  label: string;
  accountNumber: string | null;
  bankCode: string | null;
  iban: string | null;
  swift: string | null;
  currency: string | null;
  sortOrder: number;
}

/** One-line description of an account for selects and lists. */
export function bankAccountLine(a: Pick<BankAccount, 'accountNumber' | 'bankCode' | 'iban'>): string {
  if (a.accountNumber) return `${a.accountNumber}/${a.bankCode ?? ''}`;
  return a.iban ?? '';
}
