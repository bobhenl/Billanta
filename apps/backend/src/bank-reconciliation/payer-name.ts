/**
 * A foreign payment that Česká spořitelna clears for the receiving bank shows
 * the clearing account (2001141349/0800) as the counterparty, under a name
 * like "Česká spořitelna vyp" or "ZPS PZSUN 1236 (CZK)". The real payer only
 * survives in the message, after "/URI/":
 *   /ROC/281475579858280///URI/Tebex Li mited
 * Taking the name from there keeps "Česká spořitelna" out of new contacts.
 */
const URI_NAME = /\/URI\/(.+?)(?:\/[A-Z]{2,4}\/|$)/;

export function payerName(counterpartyName: string | null, message: string | null): string | null {
  const fromMessage = message ? URI_NAME.exec(message)?.[1]?.trim() : undefined;
  return fromMessage || counterpartyName;
}
