import { describe, expect, it } from 'vitest';
import {
  generateDataKey,
  generateRecoveryCode,
  isSealed,
  keyCheck,
  matchesKeyCheck,
  open,
  recoveryCodeSecret,
  seal,
  sealedMaxLength,
  sessionKey,
  unwrapWithPassword,
  unwrapWithRecoveryCode,
  unwrapWithSecret,
  VaultSecretError,
  wrapWithPassword,
  wrapWithRecoveryCode,
  wrapWithSecret
} from './confidential.js';

// Low iterations keep the suite fast; the default (600 000) is the same code path.
const FAST = 1_000;

describe('sealed envelope', () => {
  it('round-trips text, including Czech and emoji', async () => {
    const key = await generateDataKey();
    const text = 'Údržba serveru – říjen 🛠\nřádek 2';
    const sealed = await seal(key, text);
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(sealed).not.toContain('Údržba');
    expect(isSealed(sealed)).toBe(true);
    expect(await open(key, sealed)).toBe(text);
  });

  it('uses a fresh IV, so the same text seals differently', async () => {
    const key = await generateDataKey();
    expect(await seal(key, 'x')).not.toBe(await seal(key, 'x'));
  });

  it('passes plain text through, so old rows keep working', async () => {
    const key = await generateDataKey();
    expect(await open(key, 'Konzultace')).toBe('Konzultace');
    expect(isSealed('Konzultace')).toBe(false);
    expect(isSealed('enc:v1:notbase64')).toBe(false);
    expect(isSealed(null)).toBe(false);
  });

  it('refuses another company key and a tampered ciphertext', async () => {
    const key = await generateDataKey();
    const other = await generateDataKey();
    const sealed = await seal(key, 'tajné');
    await expect(open(other, sealed)).rejects.toBeInstanceOf(VaultSecretError);
    // Change a character well inside the ciphertext: the one before the `==`
    // padding is mostly padding bits, so changing it may decode to the same bytes.
    const at = sealed.length - 8;
    const swap = sealed[at] === 'A' ? 'B' : 'A';
    const tampered = sealed.slice(0, at) + swap + sealed.slice(at + 1);
    await expect(open(key, tampered)).rejects.toBeInstanceOf(VaultSecretError);
  });

  it('sealedMaxLength covers the worst case of 3-byte characters', async () => {
    const key = await generateDataKey();
    const sealed = await seal(key, '€'.repeat(500));
    expect(sealed.length).toBeLessThanOrEqual(sealedMaxLength(500));
  });
});

describe('key wraps', () => {
  it('unwraps with the right password and refuses a wrong one', async () => {
    const key = await generateDataKey();
    const wrap = await wrapWithPassword(key, 'správné heslo', FAST);
    expect(wrap).toMatchObject({ kind: 'password', kdf: 'pbkdf2-sha256', iterations: FAST });
    const back = await unwrapWithPassword(wrap, 'správné heslo');
    expect(back.extractable).toBe(false);
    expect(await open(back, await seal(key, 'a'))).toBe('a');
    await expect(unwrapWithPassword(wrap, 'spravne heslo')).rejects.toBeInstanceOf(VaultSecretError);
  });

  it('defaults to 600 000 PBKDF2 iterations', async () => {
    const wrap = await wrapWithPassword(await generateDataKey(), 'x');
    expect(wrap.iterations).toBe(600_000);
  });

  it('a recovery code opens the same key; a wrong code does not', async () => {
    const key = await generateDataKey();
    const code = generateRecoveryCode();
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){5}[0-9A-HJKMNP-TV-Z]{5}$/);
    const wrap = await wrapWithRecoveryCode(key, code);
    const sealed = await seal(key, 'popis');
    // Typed in lower case, without dashes: still the same code.
    const back = await unwrapWithRecoveryCode(wrap, code.toLowerCase().replace(/-/g, ' '));
    expect(await open(back, sealed)).toBe('popis');
    const wrong = generateRecoveryCode();
    await expect(unwrapWithRecoveryCode(wrap, wrong)).rejects.toBeInstanceOf(VaultSecretError);
  });

  it('rejects a malformed recovery code before trying it', () => {
    expect(() => recoveryCodeSecret('ABC')).toThrow('vault_recovery_malformed');
    expect(() => recoveryCodeSecret('U'.repeat(30))).toThrow('vault_recovery_malformed');
    // Look-alikes read as digits.
    expect(recoveryCodeSecret('O'.repeat(30))).toEqual(recoveryCodeSecret('0'.repeat(30)));
  });

  it('a passkey secret wraps with the PRF salt it was given', async () => {
    const key = await generateDataKey();
    const prf = crypto.getRandomValues(new Uint8Array(32));
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const wrap = await wrapWithSecret(key, prf, 'passkey', salt);
    expect(wrap.kind).toBe('passkey');
    const back = await unwrapWithSecret(wrap, prf);
    expect(await matchesKeyCheck(back, await keyCheck(key))).toBe(true);
    await expect(unwrapWithSecret(wrap, crypto.getRandomValues(new Uint8Array(32)))).rejects.toBeInstanceOf(VaultSecretError);
  });

  it('never mixes wrap kinds', async () => {
    const key = await generateDataKey();
    const pw = await wrapWithPassword(key, 'x', FAST);
    await expect(unwrapWithSecret(pw, new Uint8Array(32))).rejects.toThrow('vault_wrap_kind');
    const rc = await wrapWithRecoveryCode(key, generateRecoveryCode());
    await expect(unwrapWithPassword(rc, 'x')).rejects.toThrow('vault_wrap_kind');
  });

  it('the key check tells the company key from another', async () => {
    const key = await generateDataKey();
    const check = await keyCheck(key);
    expect(await matchesKeyCheck(key, check)).toBe(true);
    expect(await matchesKeyCheck(await generateDataKey(), check)).toBe(false);
  });

  it('a session key works but cannot be exported or re-wrapped', async () => {
    const key = await generateDataKey();
    const session = await sessionKey(key);
    expect(session.extractable).toBe(false);
    expect(await open(session, await seal(key, 'a'))).toBe('a');
    await expect(wrapWithPassword(session, 'x', FAST)).rejects.toThrow();
  });
});
