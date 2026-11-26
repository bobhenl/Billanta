'use client';

import { fromBase64, toBase64, unwrapWithSecret, wrapWithSecret, type VaultKey } from '@faktur/cz-compliance';
import type { VaultWrapView } from './types';

/**
 * Passkey unlock through the WebAuthn PRF extension: the authenticator
 * turns a salt into 32 secret bytes that never leave the browser, and those
 * bytes wrap the company key (HKDF, `wrapWithSecret`). The server keeps the
 * salt and the credential id, never the PRF output.
 */

const b64url = (bytes: Uint8Array) => toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text: string) => fromBase64(text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '='));

type PrfResults = { prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } } };

/** Only browsers that say they support PRF get the option; others would fail after the user's tap. */
export async function passkeyPrfSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential || !window.isSecureContext) return false;
  const pkc = PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> };
  if (!pkc.getClientCapabilities) return false;
  try {
    return (await pkc.getClientCapabilities())['extension:prf'] === true;
  } catch {
    return false;
  }
}

async function prfOutput(credentialId: Uint8Array, salt: Uint8Array): Promise<Uint8Array | null> {
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: credentialId as BufferSource }],
      userVerification: 'required',
      extensions: { prf: { eval: { first: salt as BufferSource } } } as AuthenticationExtensionsClientInputs
    }
  })) as PublicKeyCredential | null;
  const first = (assertion?.getClientExtensionResults() as PrfResults | undefined)?.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

/**
 * Registers a new passkey for the vault and wraps `key` with its PRF output.
 * Returns null when the authenticator has no PRF (the passkey is then useless here).
 */
export async function createPasskeyWrap(key: VaultKey, user: { id: string; name: string }, rpName: string) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: rpName },
      user: { id: new TextEncoder().encode(user.id), name: user.name, displayName: user.name },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 }
      ],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
      extensions: { prf: { eval: { first: salt as BufferSource } } } as AuthenticationExtensionsClientInputs
    }
  })) as PublicKeyCredential | null;
  if (!credential) return null;
  const results = credential.getClientExtensionResults() as PrfResults;
  if (!results.prf?.enabled && !results.prf?.results?.first) return null;
  const rawId = new Uint8Array(credential.rawId);
  // Some authenticators only evaluate PRF on sign-in, not on registration.
  const secret = results.prf.results?.first ? new Uint8Array(results.prf.results.first) : await prfOutput(rawId, salt);
  if (!secret) return null;
  const wrap = await wrapWithSecret(key, secret, 'passkey', salt);
  return { ...wrap, credentialId: b64url(rawId) };
}

/** Unlocks with one of the member's passkeys; the browser lets them pick. */
export async function unlockWithPasskey(wraps: VaultWrapView[], extractable = false): Promise<VaultKey | null> {
  const passkeys = wraps.filter((w) => w.kind === 'passkey' && w.credentialId);
  if (!passkeys.length) return null;
  const evalByCredential = Object.fromEntries(passkeys.map((w) => [w.credentialId!, { first: fromBase64(w.salt) as BufferSource }]));
  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: passkeys.map((w) => ({ type: 'public-key' as const, id: fromB64url(w.credentialId!) as BufferSource })),
      userVerification: 'required',
      extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs
    }
  })) as PublicKeyCredential | null;
  if (!assertion) return null;
  const used = b64url(new Uint8Array(assertion.rawId));
  const wrap = passkeys.find((w) => w.credentialId === used);
  const first = (assertion.getClientExtensionResults() as PrfResults).prf?.results?.first;
  if (!wrap || !first) return null;
  return unwrapWithSecret(wrap, new Uint8Array(first), extractable);
}
