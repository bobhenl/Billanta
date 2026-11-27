import { createHash, randomBytes, randomUUID, sign, type KeyObject } from 'node:crypto';
import {
  EET_MAX_MESSAGE_BYTES,
  EET_NAMESPACE,
  EetFieldError,
  formatEetDateTime,
  validateEetSaleData,
  type EetSaleData,
} from '../eet-fields.js';

/**
 * Builds and signs the OdeslaniTrzby SOAP request (interface v4.1, section
 * 2.1 "Zabezpečení"): WS-Security 1.1 with exactly one signed element, the
 * soap:Body, referenced by wsu:Id; exclusive C14N; SHA-256 digest; RSA-SHA256
 * signature; the certificate as an X509v3 BinarySecurityToken.
 *
 * The XML is written as strings in a fixed layout that mirrors the official
 * sample request (CZ00000019.eet.v4.req.xml). Because we control every byte,
 * the exclusive canonical form of the Body and SignedInfo can be written out
 * directly instead of being computed by a generic C14N implementation; the
 * tests check both against the digest and signature in the official sample.
 */

const NS = {
  soapenv: 'http://schemas.xmlsoap.org/soap/envelope/',
  wsse: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd',
  wsu: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd',
  ds: 'http://www.w3.org/2000/09/xmldsig#',
  ec: 'http://www.w3.org/2001/10/xml-exc-c14n#',
} as const;

const ALG = {
  c14n: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  rsaSha256: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
  sha256: 'http://www.w3.org/2001/04/xmlenc#sha256',
} as const;

const WSS = {
  base64: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary',
  x509v3: 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-x509-token-profile-1.0#X509v3',
} as const;

/** The <Hlavicka> of a request (section 3.3.3.1–3.3.3.4). */
export interface EetHeader {
  /** New for every attempt, also for a resend (section 3.3.3.1). */
  uuidZpravy: string;
  datOdesl: string;
  /** false when the same sale is sent again after a failed attempt (§ 20). */
  prvniZaslani: boolean;
  /** Verification mode: the server checks the message and answers with error 0 instead of a POK. */
  overeni?: boolean;
}

export interface EetMessage {
  header: EetHeader;
  data: EetSaleData;
}

export interface EetSigner {
  privateKey: KeyObject;
  /** DER of the pokladní certifikát. */
  certificateDer: Uint8Array;
}

/** wsu:Id values. Random by default; the tests pin them to the official sample's. */
export interface EetSignatureIds {
  token: string;
  body: string;
  signature: string;
  keyInfo: string;
  tokenReference: string;
}

export interface SignedEetRequest {
  xml: string;
  /** Base64 SHA-256 of the canonical Body. */
  digestValue: string;
  signatureValue: string;
}

/** Header for a new attempt. `first` is false for every resend of the same sale. */
export function createEetHeader(opts: { first: boolean; overeni?: boolean; now?: Date }): EetHeader {
  const header: EetHeader = {
    uuidZpravy: randomUUID(),
    datOdesl: formatEetDateTime(opts.now ?? new Date()),
    prvniZaslani: opts.first,
  };
  if (opts.overeni !== undefined) header.overeni = opts.overeni;
  return header;
}

function randomIds(): EetSignatureIds {
  const base = randomBytes(12).toString('hex').toUpperCase();
  return {
    token: `X509-${base}1`,
    body: `id-${base}2`,
    signature: `SIG-${base}3`,
    keyInfo: `KI-${base}4`,
    tokenReference: `STR-${base}5`,
  };
}

/** C14N attribute value escaping (Canonical XML 1.0, section 2.3). */
function attr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#x9;')
    .replace(/\n/g, '&#xA;')
    .replace(/\r/g, '&#xD;');
}

/** Unqualified attributes, sorted by name as C14N orders them. Undefined ones are left out (section 3.3, "never empty"). */
function attrs(values: Record<string, string | boolean | undefined>): string {
  return Object.keys(values)
    .filter((k) => values[k] !== undefined)
    .sort()
    .map((k) => ` ${k}="${attr(String(values[k]))}"`)
    .join('');
}

function trzbaElements(msg: EetMessage, canonical: boolean): string {
  const { header: h, data: d } = msg;
  const hlavicka = attrs({
    uuid_zpravy: h.uuidZpravy,
    dat_odesl: h.datOdesl,
    prvni_zaslani: h.prvniZaslani,
    overeni: h.overeni,
  });
  const data = attrs({
    eic_popl: d.eicPopl,
    eic_poverujiciho: d.eicPoverujiciho,
    povereni_vice_popl: d.povereniVicePopl,
    id_jednotky: d.idJednotky,
    id_pokl: d.idPokl,
    porad_cis: d.poradCis,
    dat_trzby: d.datTrzby,
    celk_trzba: d.celkTrzba,
    urceno_cerp_zuct: d.urcenoCerpZuct,
    cerp_zuct: d.cerpZuct,
  });
  // C14N always writes start and end tags; the envelope uses the short form like the sample.
  const empty = (name: string, a: string) => (canonical ? `<v4:${name}${a}></v4:${name}>` : `<v4:${name}${a}/>`);
  return `<v4:Trzba>${empty('Hlavicka', hlavicka)}${empty('Data', data)}</v4:Trzba>`;
}

/**
 * Exclusive C14N of the Body with InclusiveNamespaces "v4": soapenv (used),
 * v4 (inclusive prefix, in scope from the Envelope) and wsu (used by wsu:Id),
 * in prefix order, then the attribute.
 */
export function canonicalBody(msg: EetMessage, bodyId: string): string {
  return (
    `<soapenv:Body xmlns:soapenv="${NS.soapenv}" xmlns:v4="${EET_NAMESPACE}" xmlns:wsu="${NS.wsu}" wsu:Id="${attr(bodyId)}">` +
    trzbaElements(msg, true) +
    `</soapenv:Body>`
  );
}

function signedInfo(bodyId: string, digestValue: string, canonical: boolean): string {
  const nsDecl = canonical ? ` xmlns:ds="${NS.ds}" xmlns:soapenv="${NS.soapenv}" xmlns:v4="${EET_NAMESPACE}"` : '';
  const empty = (name: string, a: string) => (canonical ? `<${name}${a}></${name}>` : `<${name}${a}/>`);
  const inclusive = (prefixes: string) =>
    canonical
      ? empty('ec:InclusiveNamespaces', ` xmlns:ec="${NS.ec}" PrefixList="${prefixes}"`)
      : empty('ec:InclusiveNamespaces', ` PrefixList="${prefixes}" xmlns:ec="${NS.ec}"`);
  return (
    `<ds:SignedInfo${nsDecl}>` +
    `<ds:CanonicalizationMethod Algorithm="${ALG.c14n}">${inclusive('soapenv v4')}</ds:CanonicalizationMethod>` +
    empty('ds:SignatureMethod', ` Algorithm="${ALG.rsaSha256}"`) +
    `<ds:Reference URI="#${attr(bodyId)}">` +
    `<ds:Transforms><ds:Transform Algorithm="${ALG.c14n}">${inclusive('v4')}</ds:Transform></ds:Transforms>` +
    empty('ds:DigestMethod', ` Algorithm="${ALG.sha256}"`) +
    `<ds:DigestValue>${digestValue}</ds:DigestValue>` +
    `</ds:Reference>` +
    `</ds:SignedInfo>`
  );
}

/**
 * Exclusive C14N of SignedInfo with InclusiveNamespaces "soapenv v4": ds is
 * used, soapenv and v4 are inclusive prefixes in scope from the Envelope.
 */
export function canonicalSignedInfo(bodyId: string, digestValue: string): string {
  return signedInfo(bodyId, digestValue, true);
}

/** Signs a message and returns the complete SOAP envelope. Throws `EetFieldError` for invalid data. */
export function buildSignedEetRequest(
  msg: EetMessage,
  signer: EetSigner,
  ids: EetSignatureIds = randomIds(),
): SignedEetRequest {
  const errors = validateEetSaleData(msg.data);
  if (errors.length) throw new EetFieldError(errors[0]!);
  const digestValue = createHash('sha256').update(canonicalBody(msg, ids.body), 'utf8').digest('base64');
  const signatureValue = sign('sha256', Buffer.from(canonicalSignedInfo(ids.body, digestValue), 'utf8'), signer.privateKey).toString('base64');
  const token = Buffer.from(signer.certificateDer).toString('base64');
  const xml =
    `<soapenv:Envelope xmlns:soapenv="${NS.soapenv}" xmlns:v4="${EET_NAMESPACE}">` +
    `<soapenv:Header>` +
    `<wsse:Security xmlns:wsse="${NS.wsse}" xmlns:wsu="${NS.wsu}">` +
    `<wsse:BinarySecurityToken EncodingType="${WSS.base64}" ValueType="${WSS.x509v3}" wsu:Id="${ids.token}">${token}</wsse:BinarySecurityToken>` +
    `<ds:Signature Id="${ids.signature}" xmlns:ds="${NS.ds}">` +
    signedInfo(ids.body, digestValue, false) +
    `<ds:SignatureValue>${signatureValue}</ds:SignatureValue>` +
    `<ds:KeyInfo Id="${ids.keyInfo}">` +
    `<wsse:SecurityTokenReference wsu:Id="${ids.tokenReference}">` +
    `<wsse:Reference URI="#${ids.token}" ValueType="${WSS.x509v3}"/>` +
    `</wsse:SecurityTokenReference>` +
    `</ds:KeyInfo>` +
    `</ds:Signature>` +
    `</wsse:Security>` +
    `</soapenv:Header>` +
    `<soapenv:Body wsu:Id="${ids.body}" xmlns:wsu="${NS.wsu}">${trzbaElements(msg, false)}</soapenv:Body>` +
    `</soapenv:Envelope>`;
  // Section 3.1 allows only ASCII 9, 10, 13 and 32–126. Every field pattern is ASCII-only, so the
  // validation above already guarantees it. Section 2.2.3: 12 kB at most.
  if (xml.length > EET_MAX_MESSAGE_BYTES) throw new EetFieldError('message_too_large');
  return { xml, digestValue, signatureValue };
}
