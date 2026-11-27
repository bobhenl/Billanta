import { createHash, verify, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EetFieldError } from '../eet-fields.js';
import { readPkcs12 } from '../eet/pkcs12.js';
import { buildSignedEetRequest, canonicalBody, canonicalSignedInfo, createEetHeader, type EetMessage } from '../eet/soap.js';

// The official signed sample requests published with the playground
// certificates (https://eet.gov.cz/cs/pro-vyvojare). Each was signed with
// the matching playground certificate, so rebuilding it from its values must
// give back the same digest, the same signature (RSA PKCS#1 v1.5 is
// deterministic) and the same bytes.
const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'eet');
const fixture = (name: string) => readFileSync(join(dir, name));
const password = () => fixture('playground-password.txt').toString('utf8').trim();

/** Pulls the values back out of a sample request (attribute-level regexes are enough for these fixed files). */
function parseSample(xml: string) {
  const attrsOf = (tag: string) => {
    const m = new RegExp(`<${tag}([^>]*?)/?>`).exec(xml);
    if (!m) throw new Error(`no ${tag}`);
    return Object.fromEntries([...m[1]!.matchAll(/([\w:]+)="([^"]*)"/g)].map((a) => [a[1]!, a[2]!]));
  };
  const h = attrsOf('v4:Hlavicka');
  const d = attrsOf('v4:Data');
  const msg: EetMessage = {
    header: {
      uuidZpravy: h.uuid_zpravy!,
      datOdesl: h.dat_odesl!,
      prvniZaslani: h.prvni_zaslani === 'true',
      ...(h.overeni !== undefined ? { overeni: h.overeni === 'true' } : {}),
    },
    data: {
      eicPopl: d.eic_popl!,
      idJednotky: d.id_jednotky!,
      idPokl: d.id_pokl!,
      poradCis: d.porad_cis!,
      datTrzby: d.dat_trzby!,
      celkTrzba: d.celk_trzba!,
      ...(d.eic_poverujiciho !== undefined ? { eicPoverujiciho: d.eic_poverujiciho } : {}),
      ...(d.povereni_vice_popl !== undefined ? { povereniVicePopl: d.povereni_vice_popl === 'true' } : {}),
      ...(d.urceno_cerp_zuct !== undefined ? { urcenoCerpZuct: d.urceno_cerp_zuct } : {}),
      ...(d.cerp_zuct !== undefined ? { cerpZuct: d.cerp_zuct } : {}),
    },
  };
  const ids = {
    token: attrsOf('wsse:BinarySecurityToken')['wsu:Id']!,
    body: attrsOf('soapenv:Body')['wsu:Id']!,
    signature: attrsOf('ds:Signature').Id!,
    keyInfo: attrsOf('ds:KeyInfo').Id!,
    tokenReference: attrsOf('wsse:SecurityTokenReference')['wsu:Id']!,
  };
  const digest = /<ds:DigestValue>([^<]+)</.exec(xml)![1]!;
  const signature = /<ds:SignatureValue>([^<]+)</.exec(xml)![1]!;
  const token = /<wsse:BinarySecurityToken[^>]*>([^<]+)</.exec(xml)![1]!;
  return { msg, ids, digest, signature, token };
}

const SAMPLES = ['CZ00000019', 'CZ683555118', 'CZ8551015704'];

describe('EET request against the official signed samples', () => {
  it.each(SAMPLES)('%s: canonical Body digest equals the sample DigestValue', (eic) => {
    const s = parseSample(fixture(`${eic}.eet.v4.req.xml`).toString('utf8'));
    const digest = createHash('sha256').update(canonicalBody(s.msg, s.ids.body)).digest('base64');
    expect(digest).toBe(s.digest);
  });

  it.each(SAMPLES)('%s: sample SignatureValue verifies over our canonical SignedInfo', (eic) => {
    const s = parseSample(fixture(`${eic}.eet.v4.req.xml`).toString('utf8'));
    const cert = new X509Certificate(Buffer.from(s.token, 'base64'));
    const ok = verify('sha256', Buffer.from(canonicalSignedInfo(s.ids.body, s.digest)), cert.publicKey, Buffer.from(s.signature, 'base64'));
    expect(ok).toBe(true);
  });

  it.each(SAMPLES)('%s: rebuilding with the playground certificate gives the sample byte for byte', (eic) => {
    const sample = fixture(`${eic}.eet.v4.req.xml`).toString('utf8');
    const s = parseSample(sample);
    const p12 = readPkcs12(fixture(`CA_EET-Playground-${eic}.p12`), password());
    const built = buildSignedEetRequest(s.msg, p12, s.ids);
    expect(built.digestValue).toBe(s.digest);
    expect(built.signatureValue).toBe(s.signature);
    expect(built.xml).toBe(sample);
  });
});

describe('buildSignedEetRequest', () => {
  const p12 = () => readPkcs12(fixture('CA_EET-Playground-CZ00000019.p12'), password());
  const base: EetMessage = {
    header: { uuidZpravy: 'b3a09b52-7c87-4014-a496-4c7a53cf9125', datOdesl: '2027-01-09T04:25:28+01:00', prvniZaslani: true },
    data: {
      eicPopl: 'CZ00000019',
      idJednotky: '61',
      idPokl: '88-2',
      poradCis: '123',
      datTrzby: '2027-04-27T08:12:29+02:00',
      celkTrzba: '82.00',
    },
  };

  it('leaves out optional attributes that are not set (never empty)', () => {
    const { xml } = buildSignedEetRequest(base, p12());
    expect(xml).not.toContain('overeni=');
    expect(xml).not.toContain('cerp_zuct');
    expect(xml).not.toContain('eic_poverujiciho');
    expect(xml).toContain('<v4:Data celk_trzba="82.00" dat_trzby="2027-04-27T08:12:29+02:00" eic_popl="CZ00000019" id_jednotky="61" id_pokl="88-2" porad_cis="123"/>');
  });

  it('marks a resend with prvni_zaslani="false" and a new message UUID', () => {
    const h1 = createEetHeader({ first: true });
    const h2 = createEetHeader({ first: false });
    expect(h1.uuidZpravy).not.toBe(h2.uuidZpravy);
    expect(h1.uuidZpravy).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4/);
    const { xml } = buildSignedEetRequest({ ...base, header: h2 }, p12());
    expect(xml).toContain('prvni_zaslani="false"');
  });

  it('uses fresh wsu:Ids per message', () => {
    const a = buildSignedEetRequest(base, p12()).xml;
    const b = buildSignedEetRequest(base, p12()).xml;
    const id = (x: string) => /soapenv:Body wsu:Id="([^"]+)"/.exec(x)![1];
    expect(id(a)).not.toBe(id(b));
  });

  it('refuses invalid data with the field code', () => {
    const bad = { ...base, data: { ...base.data, celkTrzba: '82' } };
    expect(() => buildSignedEetRequest(bad, p12())).toThrow(EetFieldError);
    expect(() => buildSignedEetRequest(bad, p12())).toThrow('invalid_celk_trzba');
    const badPokl = { ...base, data: { ...base.data, idPokl: 'Pokladna č. 1' } };
    expect(() => buildSignedEetRequest(badPokl, p12())).toThrow('invalid_id_pokl');
  });

  it('stays under the 12 kB limit', () => {
    expect(buildSignedEetRequest(base, p12()).xml.length).toBeLessThan(12 * 1024);
  });

  it('refuses a message over 12 kB (only an oversized certificate can cause it)', () => {
    const signer = { ...p12(), certificateDer: new Uint8Array(9 * 1024) };
    expect(() => buildSignedEetRequest(base, signer)).toThrow('message_too_large');
  });
});
