import { describe, expect, it } from 'vitest';
import {
  ENCRYPTED_FILE_OVERHEAD,
  generateDataKey,
  isEncryptedFile,
  isSealed,
  openFile,
  openFileMeta,
  sealFile,
  VaultSecretError
} from '../index.js';

const pdf = new TextEncoder().encode('%PDF-1.7 účtenka 1 234,50 Kč');

describe('encrypted files', () => {
  it('round-trips the body, the name and the type', async () => {
    const key = await generateDataKey();
    const { body, encMeta } = await sealFile(key, pdf, { name: 'Účtenka říjen.pdf', mime: 'application/pdf' });
    expect(isSealed(encMeta)).toBe(true);
    expect(isEncryptedFile(body)).toBe(true);
    expect(body.length).toBe(pdf.length + ENCRYPTED_FILE_OVERHEAD);
    const opened = await openFile(key, body, encMeta);
    expect(new TextDecoder().decode(opened.bytes)).toBe('%PDF-1.7 účtenka 1 234,50 Kč');
    expect(opened.name).toBe('Účtenka říjen.pdf');
    expect(opened.mime).toBe('application/pdf');
    expect(await openFileMeta(key, encMeta)).toEqual({ name: 'Účtenka říjen.pdf', mime: 'application/pdf' });
  });

  it('keeps neither the name nor the content readable', async () => {
    const key = await generateDataKey();
    const { body, encMeta } = await sealFile(key, pdf, { name: 'tajne.pdf', mime: 'application/pdf' });
    const asText = new TextDecoder('latin1').decode(body);
    expect(asText).not.toContain('PDF');
    expect(encMeta).not.toContain('tajne');
  });

  it('uses a new file key every time', async () => {
    const key = await generateDataKey();
    const a = await sealFile(key, pdf, { name: 'a.pdf', mime: 'application/pdf' });
    const b = await sealFile(key, pdf, { name: 'a.pdf', mime: 'application/pdf' });
    expect(a.encMeta).not.toBe(b.encMeta);
    // Swapping envelopes between two files must not open either.
    await expect(openFile(key, a.body, b.encMeta)).rejects.toBeInstanceOf(VaultSecretError);
  });

  it('refuses another company key and a damaged body', async () => {
    const key = await generateDataKey();
    const { body, encMeta } = await sealFile(key, pdf, { name: 'a.pdf', mime: 'application/pdf' });
    await expect(openFile(await generateDataKey(), body, encMeta)).rejects.toBeInstanceOf(VaultSecretError);
    const broken = body.slice();
    broken[broken.length - 1] ^= 1;
    await expect(openFile(key, broken, encMeta)).rejects.toBeInstanceOf(VaultSecretError);
  });

  it('recognises only our own encrypted bodies', () => {
    expect(isEncryptedFile(pdf)).toBe(false);
    expect(isEncryptedFile(new TextEncoder().encode('BLNTENC1'))).toBe(false);
    expect(isEncryptedFile(null)).toBe(false);
  });
});
