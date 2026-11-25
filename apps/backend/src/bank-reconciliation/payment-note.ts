/**
 * The line a matched PayPal payment leaves in the invoice's internal note:
 * what the customer paid, what PayPal kept, and what arrived after its
 * conversion, so the company can count with the real proceeds. Internal
 * notes are team-only, never on the PDF or the portal.
 */
export interface PaymentNoteInput {
  amount: number;
  currency: string;
  fee?: number | null;
  netAmount?: number | null;
  netCurrency?: string | null;
}

const unit = (currency: string) => (currency === "CZK" ? "Kč" : currency);
// Plain spaces, so the note reads the same in any text field or export.
const fmt = (n: number, currency: string) =>
  `${new Intl.NumberFormat("cs-CZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n).replace(/\s/g, " ")} ${unit(currency)}`;

/**
 * "PayPal: zaplaceno 25,00 USD, poplatek 1,20 USD, připsáno 545,12 Kč (kurz 22,9042 Kč/USD)".
 * Stripe payments get the same line under their own name.
 */
export function paypalPaymentNote(input: PaymentNoteInput, provider: "PayPal" | "Stripe" = "PayPal"): string {
  const currency = input.currency.toUpperCase();
  const parts = [`zaplaceno ${fmt(input.amount, currency)}`];
  const fee = input.fee && input.fee > 0 ? input.fee : 0;
  if (fee) parts.push(`poplatek ${fmt(fee, currency)}`);
  const net = input.netAmount && input.netAmount > 0 && input.netCurrency ? input.netAmount : null;
  if (net !== null && input.netCurrency!.toUpperCase() !== currency) {
    const netCurrency = input.netCurrency!.toUpperCase();
    const after = input.amount - fee;
    // The rate PayPal applied to what was left after its fee.
    const rate =
      after > 0
        ? ` (kurz ${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 4 }).format(net / after)} ${unit(netCurrency)}/${unit(currency)})`
        : "";
    parts.push(`připsáno ${fmt(net, netCurrency)}${rate}`);
  } else if (fee) {
    parts.push(`připsáno ${fmt(input.amount - fee, currency)}`);
  }
  return `${provider}: ${parts.join(", ")}`;
}

/** The note with the line added below what is already there, once. */
export function appendNoteLine(existing: string | null | undefined, line: string): string {
  const current = existing?.trim() ?? "";
  if (current.split("\n").some((l) => l.trim() === line)) return current;
  return current ? `${current}\n${line}` : line;
}
