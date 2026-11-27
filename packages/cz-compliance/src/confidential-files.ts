import { fromBase64, isSealed, open, seal, toBase64, VaultSecretError, type VaultKey } from './confidential.js';

/*
 * "Důvěrný režim", category "attachments": files attached to documents and
 * expenses, encrypted in the browser before upload.
 *
 * Each file gets its own random AES-GCM key. The file body is stored as
 * `MAGIC | 12-byte IV | ciphertext`; the file key, the original name and the
 * MIME type travel together in one `enc:v1:` envelope sealed with the company
 * data key (`encMeta`). So the server holds only the ciphertext, its size and
 * that envelope, and replacing the company key would only mean re-sealing the
 * small envelopes, never re-encrypting the files.
 *
 * The magic prefix lets the server recognise ciphertext without any key and
 * refuse to treat it as a plain file (preview, AI, e-mail, portal).
 */

/** "BLNTENC1": the first bytes of every encrypted file body. */
export const ENCRYPTED_FILE_MAGIC = new Uint8Array([0x42, 0x4c, 0x4e, 0x54, 0x45, 0x4e, 0x43, 0x31]);
/** Magic, IV and the GCM tag: what encryption adds to a file's size. */
export const ENCRYPTED_FILE_OVERHEAD = ENCRYPTED_FILE_MAGIC.length + 12 + 16;

const subtle = () => globalThis.crypto.subtle;

export interface FileMeta {
  name: string;
  mime: string;
}

interface MetaEnvelope {
  v: 1;
  /** The file key, raw, base64. */
  k: string;
  n: string;
  m: string;
}

/** Whether a file body is one of ours, encrypted. Works on Buffer too (a Uint8Array). */
export function isEncryptedFile(bytes: Uint8Array | null | undefined): boolean {
  if (!bytes || bytes.length < ENCRYPTED_FILE_OVERHEAD) return false;
  for (let i = 0; i < ENCRYPTED_FILE_MAGIC.length; i++) if (bytes[i] !== ENCRYPTED_FILE_MAGIC[i]) return false;
  return true;
}

const fileKey = (raw: Uint8Array, usage: 'encrypt' | 'decrypt') => subtle().importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, [usage]);

/** Encrypts one file: the body for upload and the sealed envelope with its key, name and type. */
export async function sealFile(key: VaultKey, bytes: Uint8Array, meta: FileMeta): Promise<{ body: Uint8Array; encMeta: string }> {
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, await fileKey(raw, 'encrypt'), bytes as BufferSource));
  const body = new Uint8Array(ENCRYPTED_FILE_MAGIC.length + iv.length + ct.length);
  body.set(ENCRYPTED_FILE_MAGIC, 0);
  body.set(iv, ENCRYPTED_FILE_MAGIC.length);
  body.set(ct, ENCRYPTED_FILE_MAGIC.length + iv.length);
  const envelope: MetaEnvelope = { v: 1, k: toBase64(raw), n: meta.name, m: meta.mime };
  return { body, encMeta: await seal(key, JSON.stringify(envelope)) };
}

async function readMeta(key: VaultKey, encMeta: string): Promise<MetaEnvelope> {
  if (!isSealed(encMeta)) throw new VaultSecretError('vault_undecryptable');
  let parsed: Partial<MetaEnvelope>;
  try {
    parsed = JSON.parse(await open(key, encMeta)) as Partial<MetaEnvelope>;
  } catch (error) {
    if (error instanceof VaultSecretError) throw error;
    throw new VaultSecretError('vault_undecryptable');
  }
  if (parsed.v !== 1 || typeof parsed.k !== 'string' || typeof parsed.n !== 'string' || typeof parsed.m !== 'string') {
    throw new VaultSecretError('vault_undecryptable');
  }
  return parsed as MetaEnvelope;
}

/** Only the name and type, for a file list (no download needed). */
export async function openFileMeta(key: VaultKey, encMeta: string): Promise<FileMeta> {
  const meta = await readMeta(key, encMeta);
  return { name: meta.n, mime: meta.m };
}

/** Decrypts a downloaded body with its envelope. Throws VaultSecretError on a wrong key or a damaged file. */
export async function openFile(key: VaultKey, body: Uint8Array, encMeta: string): Promise<FileMeta & { bytes: Uint8Array }> {
  if (!isEncryptedFile(body)) throw new VaultSecretError('vault_undecryptable');
  const meta = await readMeta(key, encMeta);
  const start = ENCRYPTED_FILE_MAGIC.length;
  try {
    const plain = await subtle().decrypt(
      { name: 'AES-GCM', iv: body.subarray(start, start + 12) as BufferSource },
      await fileKey(fromBase64(meta.k), 'decrypt'),
      body.subarray(start + 12) as BufferSource
    );
    return { name: meta.n, mime: meta.m, bytes: new Uint8Array(plain) };
  } catch {
    throw new VaultSecretError('vault_undecryptable');
  }
}
