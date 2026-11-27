import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { describeCertificate, Pkcs12Error, pkcs12Kdf, readPkcs12 } from '../eet/pkcs12.js';
import { rc2CbcDecrypt, rc2DecryptBlock } from '../eet/rc2.js';

// Official playground material from https://eet.gov.cz/cs/pro-vyvojare
// (CAEET_Playground_2026_v1.zip). These certificates and their password are
// published for every tester, so they are fine to keep in the repo.
const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'eet');
const fixture = (name: string) => readFileSync(join(dir, name));
const password = () => fixture('playground-password.txt').toString('utf8').trim();
const hex = (s: string) => Buffer.from(s.replace(/\s/g, ''), 'hex');

describe('RC2 (RFC 2268 section 5 test vectors)', () => {
  // RFC 2268 lists them as encryptions; decrypting the ciphertext must give the plaintext back.
  const vectors: [key: string, bits: number, plain: string, cipher: string][] = [
    ['0000000000000000', 63, '0000000000000000', 'ebb773f993278eff'],
    ['ffffffffffffffff', 64, 'ffffffffffffffff', '278b27e42e2f0d49'],
    ['3000000000000000', 64, '1000000000000001', '30649edf9be7d2c2'],
    ['88', 64, '0000000000000000', '61a8a244adacccf0'],
    ['88bca90e90875a', 64, '0000000000000000', '6ccf4308974c267f'],
    ['88bca90e90875a7f0f79c384627bafb2', 64, '0000000000000000', '1a807d272bbe5db1'],
    ['88bca90e90875a7f0f79c384627bafb2', 128, '0000000000000000', '2269552ab0f85ca6'],
  ];
  it.each(vectors)('key %s, %i effective bits', (key, bits, plain, cipher) => {
    expect(Buffer.from(rc2DecryptBlock(hex(key), bits, hex(cipher))).toString('hex')).toBe(plain);
  });

  it('rejects bad padding', () => {
    expect(() => rc2CbcDecrypt(hex('0011223344'), new Uint8Array(8), new Uint8Array(8))).toThrow('bad padding');
  });
});

describe('PKCS#12 key derivation (RFC 7292 appendix B)', () => {
  it('derives separate key and IV material of the requested length', () => {
    // The real check is the MAC of the playground files below, which only verifies with a correct KDF.
    const salt = hex('0102030405060708');
    const a = pkcs12Kdf('pw', salt, 2048, 1, 24);
    const b = pkcs12Kdf('pw', salt, 2048, 2, 8);
    expect(a.length).toBe(24);
    expect(b.length).toBe(8);
    expect(Buffer.from(a.subarray(0, 8)).equals(Buffer.from(b))).toBe(false);
  });
});

describe('readPkcs12 with the official playground certificates', () => {
  it.each(['CZ00000019', 'CZ683555118', 'CZ8551015704'])('opens %s', (eic) => {
    const p12 = readPkcs12(fixture(`CA_EET-Playground-${eic}.p12`), password());
    const info = describeCertificate(p12.certificate);
    expect(info.commonName).toBe(eic);
    expect(p12.certificate.checkPrivateKey(p12.privateKey)).toBe(true);
    expect(p12.privateKey.asymmetricKeyDetails?.modulusLength).toBe(2048);
    expect(p12.chain.length).toBeGreaterThanOrEqual(0);
  });

  it('rejects a wrong password with a stable code', () => {
    try {
      readPkcs12(fixture('CA_EET-Playground-CZ00000019.p12'), 'wrong');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Pkcs12Error);
      expect((err as Pkcs12Error).code).toBe('wrong_password');
    }
  });

  it('rejects garbage as invalid_p12', () => {
    expect(() => readPkcs12(Buffer.from('not a certificate'), 'x')).toThrow(/invalid_p12/);
  });
});
