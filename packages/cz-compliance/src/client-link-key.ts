/*
 * The document key in the client's invoice link: `/i/<link>#k=<base64url>`.
 * Browsers never send the part after `#` to a server, so neither the web
 * server, the backend nor a proxy log sees it. The client's page reads it,
 * removes it from the address bar and history, and keeps it in that
 * browser's localStorage, so a later link without it (a reminder the server
 * sent) still opens there. Nothing in here makes a request.
 */
import { importDocumentKey, isSealed, openWithDocumentKey } from './vault/confidential.js';

const FRAGMENT_RE = /(?:^#|&)k=([A-Za-z0-9_-]{43})(?:&|$)/;
export const CLIENT_KEYS_STORAGE = 'billanta-client-keys';
/** Old entries go first once a browser has opened this many sealed documents. */
const MAX_STORED_KEYS = 200;

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const s = atob(text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** The client link with the key after `#`; any fragment the link had is replaced. */
export function clientLinkWithKey(url: string, raw: Uint8Array): string {
  if (raw.length !== 32) throw new Error('document key must be 32 bytes');
  return `${url.split('#')[0]}#k=${toBase64Url(raw)}`;
}

/** The 32-byte key in a `location.hash`, or null. */
export function readKeyFragment(hash: string): Uint8Array | null {
  const m = FRAGMENT_RE.exec(hash);
  const raw = m ? fromBase64Url(m[1]!) : null;
  return raw && raw.length === 32 ? raw : null;
}

export interface KeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type StoredKeys = Record<string, { k: string; at: number }>;

function readStored(storage: KeyStorage | null): StoredKeys {
  try {
    const parsed = JSON.parse(storage?.getItem(CLIENT_KEYS_STORAGE) ?? '{}') as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as StoredKeys) : {};
  } catch {
    return {};
  }
}

function writeStored(storage: KeyStorage | null, keys: StoredKeys) {
  try {
    if (!Object.keys(keys).length) storage?.removeItem(CLIENT_KEYS_STORAGE);
    else storage?.setItem(CLIENT_KEYS_STORAGE, JSON.stringify(keys));
  } catch {
    // Storage full or blocked (private window): the key then lasts for this visit only.
  }
}

/** Keyed by the document key's id, so a renamed link or a credit note with the same key still finds it. */
export function rememberClientKey(storage: KeyStorage | null, keyId: string, raw: Uint8Array, now = Date.now()): void {
  const keys = readStored(storage);
  keys[keyId] = { k: toBase64Url(raw), at: now };
  const ids = Object.keys(keys).sort((a, b) => keys[b]!.at - keys[a]!.at);
  for (const old of ids.slice(MAX_STORED_KEYS)) delete keys[old];
  writeStored(storage, keys);
}

export function recallClientKey(storage: KeyStorage | null, keyId: string): Uint8Array | null {
  const hit = readStored(storage)[keyId];
  const raw = hit ? fromBase64Url(hit.k) : null;
  return raw && raw.length === 32 ? raw : null;
}

export function forgetClientKeys(storage: KeyStorage | null, keyIds: string[]): void {
  const keys = readStored(storage);
  for (const id of keyIds) delete keys[id];
  writeStored(storage, keys);
}

export interface ClientCipherText {
  cipher: string;
  /** Null: sealed with the company key (before document keys), the client can never open it. */
  keyId: string | null;
}

export interface ClientTextsResult {
  /** Same order as the input; null where the text stays closed. */
  texts: (string | null)[];
  /** Where the opened texts' key came from. */
  source: 'link' | 'stored' | null;
}

/**
 * The client page's loader: takes the key out of the address bar (and out of
 * history), falls back to one this browser kept, and opens what it can.
 * `remember: false` for the supplier's own preview, which must not leave a
 * key in their browser's storage.
 */
export async function openClientTexts(input: {
  location: { hash: string; pathname: string; search: string };
  history: { replaceState(data: unknown, unused: string, url?: string): void } | null;
  storage: KeyStorage | null;
  items: ClientCipherText[];
  remember?: boolean;
}): Promise<ClientTextsResult> {
  const fromLink = readKeyFragment(input.location.hash);
  // Out of the address bar before anything else runs, whether or not the key fits.
  if (input.location.hash && input.history) input.history.replaceState(null, '', input.location.pathname + input.location.search);

  const ids = [...new Set(input.items.map((i) => i.keyId).filter((id): id is string => Boolean(id)))];
  const keys = new Map<string, { key: Awaited<ReturnType<typeof importDocumentKey>>; source: 'link' | 'stored' }>();
  const linkKey = fromLink ? await importDocumentKey(fromLink) : null;
  for (const id of ids) {
    const stored = recallClientKey(input.storage, id);
    if (stored) keys.set(id, { key: await importDocumentKey(stored), source: 'stored' });
  }

  let source: ClientTextsResult['source'] = null;
  const opened = new Set<string>();
  const texts = await Promise.all(
    input.items.map(async (item) => {
      if (!item.keyId || !isSealed(item.cipher)) return null;
      // The link's key wins: it is the newest one the supplier handed out.
      for (const candidate of [linkKey ? { key: linkKey, source: 'link' as const } : null, keys.get(item.keyId) ?? null]) {
        if (!candidate) continue;
        try {
          const text = await openWithDocumentKey(candidate.key, item.cipher);
          if (candidate.source === 'link') opened.add(item.keyId);
          source = source === 'link' ? 'link' : candidate.source;
          return text;
        } catch {
          // Not this key; try the next.
        }
      }
      return null;
    })
  );
  if (fromLink && input.remember !== false) for (const id of opened) rememberClientKey(input.storage, id, fromLink);
  return { texts, source };
}
