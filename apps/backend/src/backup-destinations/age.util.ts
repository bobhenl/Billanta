/**
 * age (https://age-encryption.org) encryption of backup files, so a copy on
 * the company's own SFTP or Drive is unreadable without their key. Files open
 * with the standard CLI: `age -d -i key.txt zaloha.db.age > zaloha.db`, or
 * `age -d zaloha.db.age` for a passphrase.
 *
 * `age-encryption` is ESM-only; the CommonJS build turns `import()` into
 * `require()`, which loads ES modules on Node 20.19+ / 22.12+.
 */

export interface AgeOptions {
  /** An `age1…` public key. */
  recipient?: string | null;
  passphrase?: string | null;
}

export const isAgeRecipient = (value: string) => /^age1[02-9ac-hj-np-z]{58}$/.test(value.trim());

/** Encrypts `data` for the recipient or passphrase; returns it unchanged when neither is set. */
export async function ageEncrypt(data: Uint8Array, opts: AgeOptions): Promise<{ data: Uint8Array; encrypted: boolean }> {
  if (!opts.recipient && !opts.passphrase) return { data, encrypted: false };
  const age = await import("age-encryption");
  const e = new age.Encrypter();
  if (opts.recipient) e.addRecipient(opts.recipient.trim());
  else e.setPassphrase(opts.passphrase!);
  return { data: await e.encrypt(data), encrypted: true };
}
