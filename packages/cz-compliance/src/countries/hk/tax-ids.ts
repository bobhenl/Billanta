/**
 * Business Registration number. Its first 8 digits identify the business
 * (and since 2023 serve as the Unique Business Identifier, shared with the
 * Companies Registry); a 3-digit branch code follows. The full certificate
 * number adds the expiry month, year and a check character
 * (12345678-000-07-26-A). The IRD publishes no check-digit algorithm, so
 * this checks the shape only.
 */
export function normalizeHkBrNumber(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase();
}

export function isValidHkBrNumber(value: string): boolean {
  return /^\d{8}(\d{3}(\d{4}[0-9A-Z])?)?$/.test(normalizeHkBrNumber(value));
}

/**
 * Local account: 3-digit bank code, 3-digit branch code, account number of
 * 6–9 digits depending on the bank.
 */
export function isValidHkBankAccount(value: string): boolean {
  return /^\d{12,15}$/.test(value.replace(/[\s-]/g, ''));
}
