import { createDecipheriv, createHash, createHmac, createPrivateKey, pbkdf2Sync, timingSafeEqual, X509Certificate, type KeyObject } from 'node:crypto';
import { child, children, DerError, integer, octets, oid, parseDer, TAG, type DerNode } from './der.js';
import { rc2CbcDecrypt } from './rc2.js';

/**
 * PKCS#12 (RFC 7292) reader for the EET "pokladní certifikát".
 *
 * The certificates DIS+ issues (and the published playground ones) are
 * legacy PKCS#12: SHA-1 MAC, the certificate bag under
 * pbeWithSHAAnd40BitRC2-CBC and the key under pbeWithSHAAnd3-KeyTripleDES-CBC.
 * Node cannot open those directly (no PKCS#12 API, RC2 is not in OpenSSL 3's
 * default provider), hence this reader. PBES2 (PBKDF2 + AES), which newer
 * tools write, is supported too.
 */

export type Pkcs12ErrorCode = 'invalid_p12' | 'wrong_password' | 'unsupported_algorithm' | 'no_key' | 'no_certificate';

export class Pkcs12Error extends Error {
  constructor(readonly code: Pkcs12ErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'Pkcs12Error';
  }
}

export interface Pkcs12Contents {
  privateKey: KeyObject;
  /** The certificate that belongs to the key (matched by localKeyID or by public key). */
  certificate: X509Certificate;
  /** DER of `certificate`, for the WS-Security BinarySecurityToken. */
  certificateDer: Uint8Array;
  /** Other certificates in the file (issuing CAs). */
  chain: X509Certificate[];
}

const OID = {
  data: '1.2.840.113549.1.7.1',
  encryptedData: '1.2.840.113549.1.7.6',
  keyBag: '1.2.840.113549.1.12.10.1.1',
  shroudedKeyBag: '1.2.840.113549.1.12.10.1.2',
  certBag: '1.2.840.113549.1.12.10.1.3',
  x509Certificate: '1.2.840.113549.1.9.22.1',
  localKeyId: '1.2.840.113549.1.9.21',
  pbeSha1Rc2_128: '1.2.840.113549.1.12.1.5',
  pbeSha1Rc2_40: '1.2.840.113549.1.12.1.6',
  pbeSha1Des3: '1.2.840.113549.1.12.1.3',
  pbeSha1Des2: '1.2.840.113549.1.12.1.4',
  pbes2: '1.2.840.113549.1.5.13',
  pbkdf2: '1.2.840.113549.1.5.12',
  hmacSha1: '1.2.840.113549.2.7',
  hmacSha224: '1.2.840.113549.2.8',
  hmacSha256: '1.2.840.113549.2.9',
  hmacSha384: '1.2.840.113549.2.10',
  hmacSha512: '1.2.840.113549.2.11',
  aes128cbc: '2.16.840.1.101.3.4.1.2',
  aes192cbc: '2.16.840.1.101.3.4.1.22',
  aes256cbc: '2.16.840.1.101.3.4.1.42',
  des3cbc: '1.2.840.113549.3.7',
  sha1: '1.3.14.3.2.26',
  sha256: '2.16.840.1.101.3.4.2.1',
  sha384: '2.16.840.1.101.3.4.2.2',
  sha512: '2.16.840.1.101.3.4.2.3',
} as const;

const DIGESTS: Record<string, { name: string; u: number; v: number }> = {
  [OID.sha1]: { name: 'sha1', u: 20, v: 64 },
  [OID.sha256]: { name: 'sha256', u: 32, v: 64 },
  [OID.sha384]: { name: 'sha384', u: 48, v: 128 },
  [OID.sha512]: { name: 'sha512', u: 64, v: 128 },
};

const HMACS: Record<string, string> = {
  [OID.hmacSha1]: 'sha1',
  [OID.hmacSha224]: 'sha224',
  [OID.hmacSha256]: 'sha256',
  [OID.hmacSha384]: 'sha384',
  [OID.hmacSha512]: 'sha512',
};

const CIPHERS: Record<string, { name: string; keyLen: number }> = {
  [OID.aes128cbc]: { name: 'aes-128-cbc', keyLen: 16 },
  [OID.aes192cbc]: { name: 'aes-192-cbc', keyLen: 24 },
  [OID.aes256cbc]: { name: 'aes-256-cbc', keyLen: 32 },
  [OID.des3cbc]: { name: 'des-ede3-cbc', keyLen: 24 },
};

/** RFC 7292 B.1: the password as a NUL-terminated big-endian BMPString. */
function bmpPassword(password: string): Uint8Array {
  const out = new Uint8Array((password.length + 1) * 2);
  for (let i = 0; i < password.length; i++) {
    const c = password.charCodeAt(i);
    out[2 * i] = c >> 8;
    out[2 * i + 1] = c & 0xff;
  }
  return out;
}

/** RFC 7292 B.2 key derivation. `id` is 1 for keys, 2 for IVs, 3 for MAC keys. */
export function pkcs12Kdf(
  password: string,
  salt: Uint8Array,
  iterations: number,
  id: 1 | 2 | 3,
  n: number,
  digestOid: string = OID.sha1,
): Uint8Array {
  const digest = DIGESTS[digestOid];
  if (!digest) throw new Pkcs12Error('unsupported_algorithm', `digest ${digestOid}`);
  const { name, u, v } = digest;
  const pw = password.length ? bmpPassword(password) : new Uint8Array(0);
  const D = new Uint8Array(v).fill(id);
  const fill = (src: Uint8Array) => {
    const len = src.length ? v * Math.ceil(src.length / v) : 0;
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = src[i % src.length]!;
    return out;
  };
  const S = fill(salt);
  const P = fill(pw);
  const I = new Uint8Array(S.length + P.length);
  I.set(S);
  I.set(P, S.length);
  const out = new Uint8Array(n);
  for (let off = 0; off < n; off += u) {
    let A: Uint8Array = createHash(name).update(D).update(I).digest();
    for (let r = 1; r < iterations; r++) A = createHash(name).update(A).digest();
    out.set(A.subarray(0, Math.min(u, n - off)), off);
    if (off + u >= n) break;
    const B = fill(A).subarray(0, v);
    for (let j = 0; j < I.length; j += v) {
      // I_j = (I_j + B + 1) mod 2^(8v), big-endian.
      let carry = 1;
      for (let k = v - 1; k >= 0; k--) {
        const sum = I[j + k]! + B[k]! + carry;
        I[j + k] = sum & 0xff;
        carry = sum >> 8;
      }
    }
  }
  return out;
}

function algorithm(node: DerNode): { oid: string; params: DerNode | undefined } {
  const parts = children(node);
  return { oid: oid(parts[0]!), params: parts[1] };
}

function decrypt(alg: DerNode, data: Uint8Array, password: string): Uint8Array {
  const { oid: algOid, params } = algorithm(alg);
  try {
    if (algOid === OID.pbes2) return decryptPbes2(params!, data, password);
    const legacy: Record<string, { keyLen: number; cipher: string }> = {
      [OID.pbeSha1Des3]: { keyLen: 24, cipher: 'des-ede3-cbc' },
      [OID.pbeSha1Des2]: { keyLen: 16, cipher: 'des-ede-cbc' },
      [OID.pbeSha1Rc2_40]: { keyLen: 5, cipher: 'rc2' },
      [OID.pbeSha1Rc2_128]: { keyLen: 16, cipher: 'rc2' },
    };
    const spec = legacy[algOid];
    if (!spec || !params) throw new Pkcs12Error('unsupported_algorithm', algOid);
    const p = children(params);
    const salt = octets(p[0]!);
    const iterations = integer(p[1]!);
    const key = pkcs12Kdf(password, salt, iterations, 1, spec.keyLen);
    const iv = pkcs12Kdf(password, salt, iterations, 2, 8);
    if (spec.cipher === 'rc2') return rc2CbcDecrypt(key, iv, data);
    const d = createDecipheriv(spec.cipher, key, iv);
    return Buffer.concat([d.update(data), d.final()]);
  } catch (err) {
    if (err instanceof Pkcs12Error && err.code === 'unsupported_algorithm') throw err;
    // The MAC already proved the password; a padding error here means a broken file.
    throw new Pkcs12Error('invalid_p12', 'decryption failed');
  }
}

function decryptPbes2(params: DerNode, data: Uint8Array, password: string): Uint8Array {
  const [kdf, enc] = children(params);
  const kdfAlg = algorithm(kdf!);
  if (kdfAlg.oid !== OID.pbkdf2 || !kdfAlg.params) throw new Pkcs12Error('unsupported_algorithm', kdfAlg.oid);
  const kp = children(kdfAlg.params);
  const salt = octets(kp[0]!);
  const iterations = integer(kp[1]!);
  let prf = 'sha1';
  for (const extra of kp.slice(2)) {
    if (extra.tag === TAG.SEQUENCE) {
      const h = HMACS[algorithm(extra).oid];
      if (!h) throw new Pkcs12Error('unsupported_algorithm', algorithm(extra).oid);
      prf = h;
    }
  }
  const encAlg = algorithm(enc!);
  const cipher = CIPHERS[encAlg.oid];
  if (!cipher || !encAlg.params) throw new Pkcs12Error('unsupported_algorithm', encAlg.oid);
  // PBES2 takes the password as raw UTF-8 octets, not as a BMPString.
  const key = pbkdf2Sync(Buffer.from(password, 'utf8'), salt, iterations, cipher.keyLen, prf);
  const d = createDecipheriv(cipher.name, key, octets(encAlg.params));
  return Buffer.concat([d.update(data), d.final()]);
}

function verifyMac(pfx: DerNode[], authSafe: Uint8Array, password: string): void {
  const macData = pfx[2];
  if (!macData) return; // MAC is optional in the format; DIS+ files always have one.
  const [digestInfo, saltNode, iterNode] = children(macData);
  const [algNode, expected] = children(digestInfo!);
  const digestOid = algorithm(algNode!).oid;
  const digest = DIGESTS[digestOid];
  if (!digest) throw new Pkcs12Error('unsupported_algorithm', digestOid);
  const iterations = iterNode ? integer(iterNode) : 1;
  const key = pkcs12Kdf(password, octets(saltNode!), iterations, 3, digest.u, digestOid);
  const mac = createHmac(digest.name, key).update(authSafe).digest();
  const want = octets(expected!);
  if (mac.length !== want.length || !timingSafeEqual(mac, want)) throw new Pkcs12Error('wrong_password');
}

interface Bag {
  type: string;
  value: DerNode;
  localKeyId: string | null;
}

function parseBags(safeContents: Uint8Array): Bag[] {
  return children(parseDer(safeContents)).map((bag) => {
    const parts = children(bag);
    let localKeyId: string | null = null;
    const attrs = parts[2];
    if (attrs && attrs.tag === TAG.SET) {
      for (const attr of children(attrs)) {
        const [idNode, values] = children(attr);
        if (oid(idNode!) === OID.localKeyId) {
          const v = children(values!)[0];
          if (v) localKeyId = Buffer.from(octets(v)).toString('hex');
        }
      }
    }
    return { type: oid(parts[0]!), value: child(bag, 1, TAG.CTX0, 'bag value'), localKeyId };
  });
}

/** Opens a PKCS#12 file. Throws `Pkcs12Error` with a stable code. */
export function readPkcs12(p12: Uint8Array, password: string): Pkcs12Contents {
  let pfx: DerNode[];
  let authSafe: Uint8Array;
  try {
    pfx = children(parseDer(p12));
    if (integer(pfx[0]!) !== 3) throw new Pkcs12Error('invalid_p12', 'version');
    const ci = children(pfx[1]!);
    if (oid(ci[0]!) !== OID.data) throw new Pkcs12Error('invalid_p12', 'signed PFX is not supported');
    authSafe = octets(children(ci[1]!)[0]!);
  } catch (err) {
    if (err instanceof Pkcs12Error) throw err;
    throw new Pkcs12Error('invalid_p12', err instanceof DerError ? err.message : undefined);
  }
  verifyMac(pfx, authSafe, password);

  const bags: Bag[] = [];
  try {
    for (const ci of children(parseDer(authSafe))) {
      const [typeNode, content] = children(ci);
      const type = oid(typeNode!);
      if (type === OID.data) {
        bags.push(...parseBags(octets(children(content!)[0]!)));
      } else if (type === OID.encryptedData) {
        const encData = children(children(content!)[0]!);
        const [, algNode, encrypted] = children(encData[1]!);
        bags.push(...parseBags(decrypt(algNode!, octets(encrypted!), password)));
      } else {
        throw new Pkcs12Error('unsupported_algorithm', `content type ${type}`);
      }
    }
  } catch (err) {
    if (err instanceof Pkcs12Error) throw err;
    throw new Pkcs12Error('invalid_p12', err instanceof DerError ? err.message : undefined);
  }

  const keys: { key: KeyObject; localKeyId: string | null }[] = [];
  const certs: { cert: X509Certificate; der: Uint8Array; localKeyId: string | null }[] = [];
  for (const bag of bags) {
    const inner = children(bag.value)[0]!;
    if (bag.type === OID.shroudedKeyBag) {
      const [algNode, encrypted] = children(inner);
      const pkcs8 = decrypt(algNode!, octets(encrypted!), password);
      keys.push({ key: createPrivateKey({ key: Buffer.from(pkcs8), format: 'der', type: 'pkcs8' }), localKeyId: bag.localKeyId });
    } else if (bag.type === OID.keyBag) {
      keys.push({ key: createPrivateKey({ key: Buffer.from(inner.raw), format: 'der', type: 'pkcs8' }), localKeyId: bag.localKeyId });
    } else if (bag.type === OID.certBag) {
      const [certType, certValue] = children(inner);
      if (oid(certType!) !== OID.x509Certificate) continue;
      const der = octets(children(certValue!)[0]!);
      certs.push({ cert: new X509Certificate(Buffer.from(der)), der, localKeyId: bag.localKeyId });
    }
  }
  const key = keys[0];
  if (!key) throw new Pkcs12Error('no_key');
  const leaf =
    certs.find((c) => key.localKeyId !== null && c.localKeyId === key.localKeyId) ??
    certs.find((c) => c.cert.checkPrivateKey(key.key));
  if (!leaf) throw new Pkcs12Error('no_certificate');
  return {
    privateKey: key.key,
    certificate: leaf.cert,
    certificateDer: leaf.der,
    chain: certs.filter((c) => c !== leaf).map((c) => c.cert),
  };
}

/** What the settings page shows about an uploaded certificate (never the key). */
export interface EetCertificateInfo {
  /** Subject CN; for a pokladní certifikát this is the EIČ, e.g. "CZ00000019". */
  commonName: string | null;
  serialNumber: string;
  validFrom: Date;
  validTo: Date;
  issuer: string;
  fingerprint256: string;
}

export function describeCertificate(cert: X509Certificate): EetCertificateInfo {
  const cn = /(?:^|\n)CN=([^\n]+)/.exec(cert.subject)?.[1] ?? null;
  return {
    commonName: cn,
    serialNumber: cert.serialNumber,
    validFrom: new Date(cert.validFrom),
    validTo: new Date(cert.validTo),
    issuer: cert.issuer.replace(/\n/g, ', '),
    fingerprint256: cert.fingerprint256,
  };
}
