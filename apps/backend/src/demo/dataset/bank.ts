import { daysAgo } from "./dates";
import type { DemoInvoice } from "./invoices";
import { SUPPLIERS, type DemoKind } from "./kinds";

/** What the seeder knows about an invoice after InvoicesService issued it. */
export interface SeededInvoice {
  spec: DemoInvoice;
  id: string;
  variableSymbol: string | null;
  total: number;
  counterpartyName: string;
}

export interface DemoBankTransaction {
  transactionDate: Date;
  amount: number;
  currency: string;
  variableSymbol: string | null;
  counterpartyName: string | null;
  matchedInvoiceId: string | null;
  status: "matched" | "unmatched" | "ignored";
  message: string | null;
}

/**
 * A statement built from what was actually issued, so the variable symbols
 * and amounts line up with the invoices the visitor sees. Besides the
 * matched payments it holds the cases the matching screen exists for: a
 * payment for the wrong amount, one with no variable symbol, and a line
 * someone chose to ignore. Counterparty accounts are left empty on purpose:
 * any valid-looking number could belong to a real person.
 */
export function buildBankTransactions(kind: DemoKind, now: Date, seeded: SeededInvoice[]): DemoBankTransaction[] {
  const sup = SUPPLIERS[kind];
  const sk = sup.language === "sk";
  const accountCurrencies = new Set(sup.bank.map((b) => b.currency));
  const out: DemoBankTransaction[] = [];

  for (const s of seeded) {
    const { spec } = s;
    if (spec.documentType === "quote" || !spec.paidAt) continue;
    // A GBP or USD payment would land on an account the company doesn't have.
    if (!accountCurrencies.has(spec.currency)) continue;
    const amount = spec.state === "partial" ? (spec.partialAmount ?? 0) : s.total;
    out.push({
      transactionDate: spec.paidAt,
      amount: round2(amount),
      currency: spec.currency,
      variableSymbol: s.variableSymbol,
      counterpartyName: s.counterpartyName,
      matchedInvoiceId: s.id,
      status: "matched",
      message: spec.documentType === "credit_note" ? (sk ? "Vrátenie preplatku" : "Vrácení přeplatku") : null,
    });
  }

  // Someone paid the 20-days-overdue invoice short: the matcher won't pair
  // it by itself, the visitor decides.
  const overdue = seeded.find(
    (s) => s.spec.state === "issued" && s.spec.dueDate.getTime() < now.getTime() - 10 * 86_400_000 && s.spec.dueDate.getTime() > now.getTime() - 30 * 86_400_000,
  );
  if (overdue && accountCurrencies.has(overdue.spec.currency)) {
    out.push({
      transactionDate: daysAgo(now, 2),
      amount: round2(overdue.total * 0.9),
      currency: overdue.spec.currency,
      variableSymbol: overdue.variableSymbol,
      counterpartyName: overdue.counterpartyName,
      matchedInvoiceId: null,
      status: "unmatched",
      message: sk ? "Úhrada faktúry po odpočítaní zľavy" : "Úhrada faktury po odečtení slevy",
    });
  }

  const unknownPayer = sk ? "Ján Baláž" : "Petr Novotný";
  out.push(
    {
      transactionDate: daysAgo(now, 1),
      amount: sup.home === "EUR" ? 120 : 2_500,
      currency: sup.home,
      variableSymbol: null,
      counterpartyName: unknownPayer,
      matchedInvoiceId: null,
      status: "unmatched",
      message: sk ? "Záloha" : "Záloha na zakázku",
    },
    {
      transactionDate: daysAgo(now, 30),
      amount: sup.home === "EUR" ? -9.9 : -199,
      currency: sup.home,
      variableSymbol: null,
      counterpartyName: null,
      matchedInvoiceId: null,
      status: "ignored",
      message: sk ? "Poplatok za vedenie účtu" : "Poplatek za vedení účtu",
    },
  );

  return out.sort((a, b) => a.transactionDate.getTime() - b.transactionDate.getTime());
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
