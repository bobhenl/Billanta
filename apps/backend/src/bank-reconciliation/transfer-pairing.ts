/**
 * Pairs PayPal withdrawals with the bank credits they became. The money was
 * counted once already, as the PayPal payments it is made of, so the bank
 * credit is the company's own transfer and must not count as income again.
 *
 * PayPal sends the withdrawn amount to the bank unchanged (it converts
 * before the withdrawal, not during it), so the amount and currency have to
 * be equal. The bank books it a working day or a few later; a week covers
 * weekends and holidays.
 */

export interface TransferLeg {
  id: string;
  transactionDate: Date;
  amount: string;
  currency: string;
}

export interface BankCreditLeg extends TransferLeg {
  counterpartyName: string | null;
  counterpartyAccount: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long a withdrawal may take to reach the bank. */
export const TRANSFER_MAX_DAYS = 7;

/** A bank credit sent by PayPal ("PAYPAL PTE LTD", "PayPal Europe S.a r.l."). */
export function isPaypalCredit(row: Pick<BankCreditLeg, "counterpartyName" | "counterpartyAccount" | "amount">): boolean {
  return Number(row.amount) > 0 && /pay\s*pal/i.test(`${row.counterpartyName ?? ""} ${row.counterpartyAccount ?? ""}`);
}

const cents = (amount: string) => Math.round(Math.abs(Number(amount)) * 100);

/**
 * Oldest withdrawal first, each takes the nearest unused credit of the same
 * amount and currency booked between a day before (time zones) and
 * `TRANSFER_MAX_DAYS` after it.
 */
export function pairTransfers(withdrawals: TransferLeg[], credits: BankCreditLeg[]): { withdrawalId: string; creditId: string }[] {
  const pairs: { withdrawalId: string; creditId: string }[] = [];
  const used = new Set<string>();
  const ordered = [...withdrawals].sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
  for (const w of ordered) {
    const at = w.transactionDate.getTime();
    let best: BankCreditLeg | null = null;
    for (const c of credits) {
      if (used.has(c.id) || !isPaypalCredit(c)) continue;
      if (c.currency !== w.currency || cents(c.amount) !== cents(w.amount)) continue;
      const lag = c.transactionDate.getTime() - at;
      if (lag < -DAY_MS || lag > TRANSFER_MAX_DAYS * DAY_MS) continue;
      if (!best || Math.abs(lag) < Math.abs(best.transactionDate.getTime() - at)) best = c;
    }
    if (best) {
      used.add(best.id);
      pairs.push({ withdrawalId: w.id, creditId: best.id });
    }
  }
  return pairs;
}
