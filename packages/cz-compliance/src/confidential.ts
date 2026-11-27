/*
 * "Důvěrný režim": client-side encryption of the most sensitive free text
 * (item descriptions, notes). The company has one random data key (AES-GCM
 * 256). The server stores only that key wrapped by a member's vault
 * password, a passkey (WebAuthn PRF) or the recovery code, and the text as
 * `enc:v1:<base64 iv>:<base64 ciphertext>`. Plain and sealed rows coexist,
 * so `isSealed` is what every reader checks. Design:
 * docs/research/client-side-encryption.md.
 *
 * Printed texts of a document are sealed with a key of that document
 * instead, so the document's client can be given that one key in the link
 * (`#k=…`) without getting the company's. Such an envelope carries the
 * document key wrapped by the company key as two more segments:
 * `enc:v1:<iv>:<ciphertext>:<wrap iv>:<wrapped key>`. Every text of the
 * document carries the same wrap, so a copy the server makes of the texts
 * (credit note, template, recurring) keeps opening with the same key.
 *
 * Only WebCrypto, so the same code runs in the browser and in Node (tests,
 * and the backend that only ever calls `isSealed`).
 */

const PREFIX = 'enc:v1:';
/** 12-byte IV = 16 base64 chars without padding. */
const SEALED_RE = /^enc:v1:[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]+={0,2}(?::[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{64})?$/;
/** A 32-byte key AES-GCM-encrypted is 48 bytes, 64 base64 chars. */
const WRAP_RE = /^[A-Za-z0-9+/]{16}:[A-Za-z0-9+/]{64}$/;
const DOCUMENT_KEY_AAD = 'billanta-document-key-v1';
const KEY_CHECK_TEXT = 'billanta-vault-v1';
/** OWASP 2023 figure for PBKDF2-HMAC-SHA256. */
export const VAULT_PBKDF2_ITERATIONS = 600_000;
/** Crockford base32: no I, L, O, U, so a printed code reads back unambiguously. */
const RECOVERY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_LENGTH = 30; // 150 bits

type Subtle = typeof globalThis.crypto.subtle;
/** A WebCrypto `CryptoKey` (named via the API, so no DOM lib is needed here). */
export type VaultKey = Awaited<ReturnType<Subtle['importKey']>>;

export type VaultWrapKind = 'password' | 'recovery' | 'passkey';

/** One wrapped copy of the data key, as stored on the server. All binary fields base64. */
export interface VaultWrap {
  kind: VaultWrapKind;
  kdf: 'pbkdf2-sha256' | 'hkdf-sha256';
  /** PBKDF2 only. */
  iterations: number | null;
  salt: string;
  iv: string;
  wrappedKey: string;
}

/** Wrong password, recovery code or passkey (or a corrupted wrap): AES-GCM refused to open it. */
export class VaultSecretError extends Error {
  constructor(message = 'vault_wrong_secret') {
    super(message);
    this.name = 'VaultSecretError';
  }
}

const subtle = (): Subtle => globalThis.crypto.subtle;
const random = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const utf8 = new TextEncoder();

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Whether a stored value is ciphertext. Servers use this to refuse rendering it. */
export function isSealed(value: unknown): value is `enc:v1:${string}` {
  return typeof value === 'string' && value.startsWith(PREFIX) && SEALED_RE.test(value);
}

/**
 * Longest envelope a plain text of `plainMax` UTF-16 units can become: at
 * most 3 UTF-8 bytes per unit, the 16-byte GCM tag, base64, prefix and IV,
 * plus the wrapped document key.
 */
export function sealedMaxLength(plainMax: number): number {
  return PREFIX.length + 16 + 1 + Math.ceil((plainMax * 3 + 16) / 3) * 4 + 1 + 16 + 1 + 64;
}

const ALGO = { name: 'AES-GCM', length: 256 } as const;
const USAGES: ('encrypt' | 'decrypt')[] = ['encrypt', 'decrypt'];

/** A fresh company data key. Extractable, because it still has to be wrapped; use `sessionKey` after. */
export async function generateDataKey(): Promise<VaultKey> {
  return (await subtle().generateKey(ALGO, true, USAGES)) as VaultKey;
}

/** A non-extractable copy for the session: scripts can use it but never read it out. */
export async function sessionKey(key: VaultKey): Promise<VaultKey> {
  if (!key.extractable) return key;
  const raw = await subtle().exportKey('raw', key);
  return (await subtle().importKey('raw', raw, ALGO, false, USAGES)) as VaultKey;
}

export async function seal(key: VaultKey, plaintext: string): Promise<string> {
  const iv = random(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, utf8.encode(plaintext)));
  return `${PREFIX}${toBase64(iv)}:${toBase64(ct)}`;
}

async function decryptParts(key: VaultKey, iv: string, ct: string): Promise<string> {
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(ct));
    return new TextDecoder().decode(plain);
  } catch {
    throw new VaultSecretError('vault_undecryptable');
  }
}

/**
 * Plain text passes through unchanged; a sealed value is decrypted with the
 * company key (directly, or through the document key it carries) or throws
 * VaultSecretError.
 */
export async function open(key: VaultKey, value: string): Promise<string> {
  if (!isSealed(value)) return value;
  const [iv, ct, wrapIv, wrapped] = value.slice(PREFIX.length).split(':') as [string, string, string?, string?];
  if (!wrapIv || !wrapped) return decryptParts(key, iv, ct);
  const doc = await unwrapDocumentKey(key, `${wrapIv}:${wrapped}`);
  return decryptParts(doc.key, iv, ct);
}

/**
 * A document's own key. `raw` goes into the client link fragment and
 * nowhere else; `wrap` (the key encrypted with the company key) is what the
 * server stores inside each envelope.
 */
export interface DocumentKey {
  key: VaultKey;
  raw: Uint8Array;
  /** `<wrap iv>:<wrapped key>`, the same in every envelope of the document. */
  wrap: string;
}

/** A fresh key for one document, wrapped with the (unlocked) company key. */
export async function generateDocumentKey(companyKey: VaultKey): Promise<DocumentKey> {
  const raw = random(32);
  const iv = random(12);
  const wrapped = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: utf8.encode(DOCUMENT_KEY_AAD) }, companyKey, raw));
  return { key: await importDocumentKey(raw), raw, wrap: `${toBase64(iv)}:${toBase64(wrapped)}` };
}

// Opening every text of a list would otherwise unwrap the same key again and again.
const unwrapped = new WeakMap<VaultKey, Map<string, Promise<DocumentKey>>>();

export function unwrapDocumentKey(companyKey: VaultKey, wrap: string): Promise<DocumentKey> {
  let cache = unwrapped.get(companyKey);
  if (!cache) unwrapped.set(companyKey, (cache = new Map()));
  const hit = cache.get(wrap);
  if (hit) return hit;
  const pending = (async () => {
    if (!WRAP_RE.test(wrap)) throw new VaultSecretError('vault_undecryptable');
    const [iv, wrapped] = wrap.split(':') as [string, string];
    let raw: Uint8Array;
    try {
      raw = new Uint8Array(
        await subtle().decrypt({ name: 'AES-GCM', iv: fromBase64(iv), additionalData: utf8.encode(DOCUMENT_KEY_AAD) }, companyKey, fromBase64(wrapped))
      );
    } catch {
      throw new VaultSecretError('vault_undecryptable');
    }
    return { key: await importDocumentKey(raw), raw, wrap };
  })();
  // A failure is not kept: it says nothing about the next try.
  pending.catch(() => cache.delete(wrap));
  cache.set(wrap, pending);
  return pending;
}

/** Non-extractable, so a script can decrypt with it but not read it back. */
export async function importDocumentKey(raw: Uint8Array): Promise<VaultKey> {
  if (raw.length !== 32) throw new VaultSecretError('vault_document_key');
  return (await subtle().importKey('raw', raw, ALGO, false, USAGES)) as VaultKey;
}

export async function sealWithDocumentKey(doc: DocumentKey, plaintext: string): Promise<string> {
  const iv = random(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, doc.key, utf8.encode(plaintext)));
  return `${PREFIX}${toBase64(iv)}:${toBase64(ct)}:${doc.wrap}`;
}

/** The wrapped document key an envelope carries, or null (plain text, or sealed with the company key). */
export function documentKeyWrap(value: unknown): string | null {
  if (!isSealed(value)) return null;
  const parts = value.slice(PREFIX.length).split(':');
  return parts.length === 4 ? `${parts[2]}:${parts[3]}` : null;
}

/**
 * What the client's page gets for a sealed text: the ciphertext without the
 * wrapped key (useless to the client), and a non-secret id of the document
 * key (the wrap's random IV), so the browser can find a key it kept earlier.
 */
export function clientCipher(value: string): { cipher: string; keyId: string | null } {
  const [iv, ct, wrapIv] = value.slice(PREFIX.length).split(':') as [string, string, string?];
  return { cipher: `${PREFIX}${iv}:${ct}`, keyId: wrapIv ?? null };
}

/** On the client's page: decrypts a text sealed with this document key (`clientCipher` output or a full envelope). */
export async function openWithDocumentKey(key: VaultKey, value: string): Promise<string> {
  if (!isSealed(value)) return value;
  const [iv, ct] = value.slice(PREFIX.length).split(':') as [string, string];
  return decryptParts(key, iv, ct);
}

/** Stored next to the wraps, so an unwrapped key can be checked against the company's. */
export function keyCheck(key: VaultKey): Promise<string> {
  return seal(key, KEY_CHECK_TEXT);
}

export async function matchesKeyCheck(key: VaultKey, check: string): Promise<boolean> {
  try {
    return (await open(key, check)) === KEY_CHECK_TEXT;
  } catch {
    return false;
  }
}

async function passwordKek(password: string, salt: Uint8Array, iterations: number) {
  const base = await subtle().importKey('raw', utf8.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, ALGO, false, ['wrapKey', 'unwrapKey']);
}

async function secretKek(secret: Uint8Array, salt: Uint8Array, kind: VaultWrapKind) {
  const base = await subtle().importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: utf8.encode(`billanta-vault-${kind}`) }, base, ALGO, false, [
    'wrapKey',
    'unwrapKey'
  ]);
}

async function wrapWith(kek: Awaited<ReturnType<Subtle['deriveKey']>>, key: VaultKey) {
  const iv = random(12);
  const wrapped = new Uint8Array(await subtle().wrapKey('raw', key, kek, { name: 'AES-GCM', iv }));
  return { iv: toBase64(iv), wrappedKey: toBase64(wrapped) };
}

async function unwrapWith(kek: Awaited<ReturnType<Subtle['deriveKey']>>, wrap: VaultWrap, extractable: boolean): Promise<VaultKey> {
  try {
    return (await subtle().unwrapKey('raw', fromBase64(wrap.wrappedKey), kek, { name: 'AES-GCM', iv: fromBase64(wrap.iv) }, ALGO, extractable, USAGES)) as VaultKey;
  } catch {
    throw new VaultSecretError();
  }
}

/** Wraps an extractable data key with a vault password (PBKDF2-SHA256). */
export async function wrapWithPassword(key: VaultKey, password: string, iterations = VAULT_PBKDF2_ITERATIONS): Promise<VaultWrap> {
  const salt = random(16);
  const kek = await passwordKek(password, salt, iterations);
  return { kind: 'password', kdf: 'pbkdf2-sha256', iterations, salt: toBase64(salt), ...(await wrapWith(kek, key)) };
}

/**
 * Wraps with a high-entropy secret: the recovery code's bytes or a passkey's
 * PRF output. HKDF is enough here, a stretched KDF only helps weak secrets.
 * For a passkey `salt` is also the PRF input, so pass the one used there.
 */
export async function wrapWithSecret(key: VaultKey, secret: Uint8Array, kind: 'recovery' | 'passkey', salt: Uint8Array = random(32)): Promise<VaultWrap> {
  const kek = await secretKek(secret, salt, kind);
  return { kind, kdf: 'hkdf-sha256', iterations: null, salt: toBase64(salt), ...(await wrapWith(kek, key)) };
}

/** `extractable` only to re-wrap right away (a new password, a new passkey); sessions get a non-extractable key. */
export async function unwrapWithPassword(wrap: VaultWrap, password: string, extractable = false): Promise<VaultKey> {
  if (wrap.kdf !== 'pbkdf2-sha256' || !wrap.iterations) throw new VaultSecretError('vault_wrap_kind');
  return unwrapWith(await passwordKek(password, fromBase64(wrap.salt), wrap.iterations), wrap, extractable);
}

export async function unwrapWithSecret(wrap: VaultWrap, secret: Uint8Array, extractable = false): Promise<VaultKey> {
  if (wrap.kdf !== 'hkdf-sha256' || wrap.kind === 'password') throw new VaultSecretError('vault_wrap_kind');
  return unwrapWith(await secretKek(secret, fromBase64(wrap.salt), wrap.kind), wrap, extractable);
}

/** A new recovery code, "XXXXX-XXXXX-…" (6 groups of 5, 150 bits). Shown once, never sent to the server. */
export function generateRecoveryCode(): string {
  const bytes = random(RECOVERY_LENGTH);
  const chars = Array.from(bytes, (b) => RECOVERY_ALPHABET[b & 31]).join('');
  return chars.match(/.{5}/g)!.join('-');
}

/**
 * The typed code as key material: case, spaces and dashes don't matter, and
 * the look-alikes O/I/L read as 0/1/1. Throws on a wrong length or letter.
 */
export function recoveryCodeSecret(code: string): Uint8Array {
  const normalized = code
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (normalized.length !== RECOVERY_LENGTH || [...normalized].some((c) => !RECOVERY_ALPHABET.includes(c))) {
    throw new VaultSecretError('vault_recovery_malformed');
  }
  return utf8.encode(normalized);
}

export function unwrapWithRecoveryCode(wrap: VaultWrap, code: string, extractable = false): Promise<VaultKey> {
  return unwrapWithSecret(wrap, recoveryCodeSecret(code), extractable);
}

export function wrapWithRecoveryCode(key: VaultKey, code: string): Promise<VaultWrap> {
  return wrapWithSecret(key, recoveryCodeSecret(code), 'recovery');
}

/**
 * What a company can choose to encrypt. Each category switches off the server
 * features that need to read it (the enable screen lists them), so the choice
 * is the customer's. `available: false` ones are planned, not built.
 */
export const VAULT_CATEGORIES = [
  { id: 'texts', available: true, default: true },
  { id: 'attachments', available: false, default: false },
  { id: 'contacts', available: false, default: false },
  { id: 'amounts', available: false, default: false },
] as const;

export type VaultCategory = (typeof VAULT_CATEGORIES)[number]['id'];

export const AVAILABLE_VAULT_CATEGORIES = VAULT_CATEGORIES.filter((c) => c.available).map((c) => c.id);
