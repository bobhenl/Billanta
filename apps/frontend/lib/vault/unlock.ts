import { VaultSecretError, matchesKeyCheck, unwrapWithPassword, unwrapWithRecoveryCode, type VaultKey } from '@faktur/cz-compliance';
import type { EnabledVault } from './types';

/**
 * Opens the company key with the member's vault password or the company's
 * recovery code. The key check makes sure the result is this company's key,
 * so a swapped wrap from the server can't plant a key of someone else's.
 */
export async function unlockVault(vault: EnabledVault, method: 'password' | 'recovery', secret: string, extractable = false): Promise<VaultKey> {
  const wrap = vault.wraps.find((w) => w.kind === method);
  if (!wrap) throw new VaultSecretError('vault_no_wrap');
  const key = method === 'password' ? await unwrapWithPassword(wrap, secret, extractable) : await unwrapWithRecoveryCode(wrap, secret, extractable);
  if (!(await matchesKeyCheck(key, vault.keyCheck))) throw new VaultSecretError('vault_wrong_secret');
  return key;
}

/** A translation key for a failed unlock. */
export function unlockErrorKey(error: unknown): string {
  if (error instanceof VaultSecretError) {
    if (error.message === 'vault_recovery_malformed') return 'errors.recoveryMalformed';
    if (error.message === 'vault_no_wrap') return 'errors.noPassword';
    return 'errors.wrongSecret';
  }
  return 'errors.unlockFailed';
}
