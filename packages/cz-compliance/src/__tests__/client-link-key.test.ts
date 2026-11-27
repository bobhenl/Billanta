import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_KEYS_STORAGE,
  clientCipher,
  clientLinkWithKey,
  documentKeyWrap,
  generateDataKey,
  generateDocumentKey,
  isSealed,
  open,
  openClientTexts,
  openWithDocumentKey,
  readKeyFragment,
  recallClientKey,
  rememberClientKey,
  seal,
  sealedMaxLength,
  sealWithDocumentKey,
  toBase64,
  toBase64Url,
  unwrapDocumentKey,
  VaultSecretError,
  type KeyStorage
} from '../index.js';

function memoryStorage(): KeyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

function fakeLocation(hash: string) {
  const loc = { pathname: '/cs/i/ABC-x7k2', search: '?preview=1', hash };
  const calls: (string | undefined)[] = [];
  const history = {
    replaceState: (_d: unknown, _u: string, url?: string) => {
      calls.push(url);
      loc.hash = '';
    }
  };
  return { loc, history, calls };
}

describe('document keys', () => {
  it('seals a text the company key opens and the document key alone opens too', async () => {
    const company = await generateDataKey();
    const doc = await generateDocumentKey(company);
    const sealed = await sealWithDocumentKey(doc, 'Audit – říjen');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed.startsWith('enc:v1:')).toBe(true);
    expect(documentKeyWrap(sealed)).toBe(doc.wrap);
    expect(await open(company, sealed)).toBe('Audit – říjen');
    const { cipher, keyId } = clientCipher(sealed);
    expect(cipher).not.toContain(doc.wrap.split(':')[1]);
    expect(keyId).toBe(doc.wrap.split(':')[0]);
    expect(await openWithDocumentKey(doc.key, cipher)).toBe('Audit – říjen');
  });

  it('does not let a document key open a text sealed with the company key or another document', async () => {
    const company = await generateDataKey();
    const a = await generateDocumentKey(company);
    const b = await generateDocumentKey(company);
    const legacy = await seal(company, 'interní');
    expect(documentKeyWrap(legacy)).toBeNull();
    expect(clientCipher(legacy).keyId).toBeNull();
    await expect(openWithDocumentKey(a.key, legacy)).rejects.toBeInstanceOf(VaultSecretError);
    await expect(openWithDocumentKey(a.key, await sealWithDocumentKey(b, 'x'))).rejects.toBeInstanceOf(VaultSecretError);
  });

  it('unwraps the same raw key from the wrap, and refuses another company key', async () => {
    const company = await generateDataKey();
    const doc = await generateDocumentKey(company);
    const again = await unwrapDocumentKey(company, doc.wrap);
    expect(toBase64(again.raw)).toBe(toBase64(doc.raw));
    await expect(unwrapDocumentKey(await generateDataKey(), doc.wrap)).rejects.toBeInstanceOf(VaultSecretError);
    await expect(open(await generateDataKey(), await sealWithDocumentKey(doc, 'x'))).rejects.toBeInstanceOf(VaultSecretError);
  });

  it('sealedMaxLength still covers the worst case with the wrapped key', async () => {
    const company = await generateDataKey();
    const doc = await generateDocumentKey(company);
    expect((await sealWithDocumentKey(doc, '€'.repeat(500))).length).toBeLessThanOrEqual(sealedMaxLength(500));
  });
});

describe('client link', () => {
  it('puts the key after # only, replacing an old fragment', () => {
    const raw = new Uint8Array(32).fill(250);
    const url = clientLinkWithKey('https://app.example/i/ABC-x7k2#old', raw);
    const [before, after] = url.split('#');
    expect(before).toBe('https://app.example/i/ABC-x7k2');
    expect(after).toBe(`k=${toBase64Url(raw)}`);
    expect(before).not.toContain(toBase64Url(raw));
    expect(readKeyFragment(`#${after}`)).toEqual(raw);
  });

  it('ignores a malformed or short fragment', () => {
    expect(readKeyFragment('')).toBeNull();
    expect(readKeyFragment('#k=abc')).toBeNull();
    expect(readKeyFragment('#x=1')).toBeNull();
  });
});

describe('client page loader', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function sealedDoc() {
    const company = await generateDataKey();
    const doc = await generateDocumentKey(company);
    const items = [clientCipher(await sealWithDocumentKey(doc, 'Položka A')), clientCipher(await sealWithDocumentKey(doc, 'Položka B'))];
    return { company, doc, items };
  }

  it('opens the texts with the link key, strips it from history, keeps it and never makes a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const { doc, items } = await sealedDoc();
    const { loc, history, calls } = fakeLocation(`#k=${toBase64Url(doc.raw)}`);
    const storage = memoryStorage();
    const result = await openClientTexts({ location: loc, history, storage, items });
    expect(result).toEqual({ texts: ['Položka A', 'Položka B'], source: 'link' });
    expect(calls).toEqual(['/cs/i/ABC-x7k2?preview=1']);
    expect(calls.join()).not.toContain(toBase64Url(doc.raw));
    expect(loc.hash).toBe('');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(recallClientKey(storage, items[0]!.keyId!)).toEqual(doc.raw);
  });

  it('opens a later link without the key from what this browser kept', async () => {
    const { doc, items } = await sealedDoc();
    const storage = memoryStorage();
    rememberClientKey(storage, items[0]!.keyId!, doc.raw);
    const { loc, history, calls } = fakeLocation('');
    const result = await openClientTexts({ location: loc, history, storage, items });
    expect(result).toEqual({ texts: ['Položka A', 'Položka B'], source: 'stored' });
    expect(calls).toEqual([]);
  });

  it('leaves the texts closed without a key, and with a wrong key keeps nothing', async () => {
    const { items } = await sealedDoc();
    const other = await sealedDoc();
    const storage = memoryStorage();
    expect(await openClientTexts({ location: fakeLocation('').loc, history: null, storage, items })).toEqual({ texts: [null, null], source: null });
    const { loc, history, calls } = fakeLocation(`#k=${toBase64Url(other.doc.raw)}`);
    expect(await openClientTexts({ location: loc, history, storage, items })).toEqual({ texts: [null, null], source: null });
    // Even a key that does not fit leaves the address bar.
    expect(calls).toHaveLength(1);
    expect(storage.data.has(CLIENT_KEYS_STORAGE)).toBe(false);
  });

  it('keeps nothing for the supplier preview', async () => {
    const { doc, items } = await sealedDoc();
    const storage = memoryStorage();
    const { loc, history } = fakeLocation(`#k=${toBase64Url(doc.raw)}`);
    const result = await openClientTexts({ location: loc, history, storage, items, remember: false });
    expect(result.texts).toEqual(['Položka A', 'Položka B']);
    expect(storage.data.size).toBe(0);
  });
});
