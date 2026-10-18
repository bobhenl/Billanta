import { normalizeIban } from './bank-account-validator.js';

/**
 * Parsers for the bank statement files Czech and Slovak banks let you
 * download: camt.053 (ISO 20022 XML, every bank since the SEPA migration)
 * and GPC / ABO (the fixed-width format older accounting software reads,
 * still offered by Fio, KB, ČSOB, Raiffeisen and others). Both return the
 * same entry shape, so the caller does not care which file it got.
 *
 * Pure functions: the caller decodes the bytes (GPC is Windows-1250) and
 * decides what to keep. Nothing here touches the database.
 */

export type BankStatementFormat = 'camt053' | 'gpc';

export interface BankStatementEntry {
  /** Booking day, `YYYY-MM-DD`. */
  bookingDate: string;
  /** Always positive, two decimals ("1500.00"); see `direction`. */
  amount: string;
  direction: 'credit' | 'debit';
  /** ISO 4217 alpha code. */
  currency: string;
  /** Digits only, leading zeros dropped (see `normalizeVariableSymbol`). */
  variableSymbol: string | null;
  constantSymbol: string | null;
  specificSymbol: string | null;
  /** `[prefix-]number/bankCode` for CZ/SK accounts, otherwise the IBAN or the bank's own id. */
  counterpartyAccount: string | null;
  counterpartyName: string | null;
  message: string | null;
  /** The bank's own id of the movement, when the file has one that is unique within it. */
  bankReference: string | null;
}

export interface ParsedBankStatement {
  format: BankStatementFormat;
  /** The statement's own account, when the file names it. */
  accountNumber: string | null;
  entries: BankStatementEntry[];
}

export class BankStatementParseError extends Error {
  constructor(
    message: string,
    readonly errors: string[] = [],
  ) {
    super(message);
    this.name = 'BankStatementParseError';
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * VS is a number of up to 10 digits; leading zeros carry no meaning (GPC
 * pads it to 10, people type it without). "0000012345" and "12345" are the
 * same symbol. Returns null for an empty or all-zero value and for anything
 * that is not 1–10 digits once spaces are removed.
 */
export function normalizeVariableSymbol(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const compact = raw.replace(/\s+/g, '');
  if (!/^\d{1,10}$/.test(compact)) return null;
  const stripped = compact.replace(/^0+/, '');
  return stripped === '' ? null : stripped;
}

/**
 * One spelling per account, so the same payer's account written as an IBAN
 * in camt.053, as "19-2000145399/0800" by Fio and as "000019 2000145399" +
 * bank code in GPC compares equal. CZ/SK IBANs become the domestic form;
 * other IBANs are upper-cased without spaces; anything else is returned
 * trimmed.
 */
export function canonicalBankAccount(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;

  const iban = normalizeIban(trimmed);
  const czsk = /^(?:CZ|SK)\d{2}(\d{4})(\d{6})(\d{10})$/.exec(iban);
  if (czsk) return domesticAccount(czsk[2]!, czsk[3]!, czsk[1]!);
  if (/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return iban;

  const domestic = /^(?:(\d{1,6})-)?(\d{1,10})(?:\s*\/\s*(\d{4}))?$/.exec(trimmed.replace(/\s+(?=[-/])|(?<=[-/])\s+/g, ''));
  if (domestic) return domesticAccount(domestic[1] ?? '', domestic[2]!, domestic[3] ?? null);
  return trimmed;
}

function domesticAccount(prefix: string, number: string, bankCode: string | null): string | null {
  const p = prefix.replace(/^0+/, '');
  const n = number.replace(/^0+/, '');
  if (n === '') return null;
  return `${p ? `${p}-` : ''}${n}${bankCode ? `/${bankCode}` : ''}`;
}

function nullIfBlank(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
}

/** "1 234.5" → "1234.50"; null when it is not a plain non-negative decimal. */
function decimalAmount(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!/^\d+(\.\d{1,5})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  // String arithmetic: rounding a 5-decimal amount to cents without a float.
  const cents = BigInt(`${whole}${fraction.padEnd(2, '0').slice(0, 2)}`) + (Number(fraction[2] ?? '0') >= 5 ? 1n : 0n);
  const text = cents.toString().padStart(3, '0');
  return `${text.slice(0, -2)}.${text.slice(-2)}`;
}

// ---------------------------------------------------------------------------
// A small XML reader
// ---------------------------------------------------------------------------

interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x')) return String.fromCodePoint(parseInt(body.slice(2), 16));
    if (body.startsWith('#')) return String.fromCodePoint(parseInt(body.slice(1), 10));
    return ENTITIES[body] ?? whole;
  });
}

/** Drops the namespace prefix: camt files use both `<Ntry>` and `<ns2:Ntry>`. */
function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon >= 0 ? name.slice(colon + 1) : name;
}

/**
 * Enough XML for bank statements: elements, attributes, text, CDATA,
 * comments and the prolog. No DTDs or external entities are ever resolved,
 * so a hostile upload cannot make it read files or expand entities.
 */
function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  const tag = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[\s\S]*?>|<\/\s*([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = tag.exec(xml)) !== null) {
    const current = stack[stack.length - 1]!;
    const [, cdata, closing, opening, attrText, selfClosing, text] = match;
    if (cdata !== undefined) {
      current.text += cdata;
    } else if (closing !== undefined) {
      if (stack.length === 1 || localName(closing) !== current.name) {
        throw new BankStatementParseError(`Malformed XML near </${closing}>`);
      }
      stack.pop();
    } else if (opening !== undefined) {
      const attrs: Record<string, string> = {};
      for (const attr of (attrText ?? '').matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
        attrs[localName(attr[1]!)] = decodeEntities(attr[2] ?? attr[3] ?? '');
      }
      const node: XmlNode = { name: localName(opening), attrs, children: [], text: '' };
      current.children.push(node);
      if (!selfClosing) stack.push(node);
    } else if (text !== undefined) {
      current.text += decodeEntities(text);
    }
  }
  if (stack.length !== 1) throw new BankStatementParseError('XML ends before all elements are closed');
  return root;
}

function child(node: XmlNode | undefined, ...path: string[]): XmlNode | undefined {
  let current = node;
  for (const name of path) {
    current = current?.children.find((c) => c.name === name);
    if (!current) return undefined;
  }
  return current;
}

function childrenNamed(node: XmlNode | undefined, name: string): XmlNode[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

function textAt(node: XmlNode | undefined, ...path: string[]): string | null {
  return nullIfBlank(child(node, ...path)?.text);
}

// ---------------------------------------------------------------------------
// camt.053
// ---------------------------------------------------------------------------

/** "VS1234/SS5678/KS0308" (ČBA convention in EndToEndId) or "VS: 1234" in a message. */
function symbolFrom(text: string | null, key: 'VS' | 'SS' | 'KS'): string | null {
  if (!text) return null;
  const match = new RegExp(`(?:^|[^A-Z])${key}[:\\s]*(\\d{1,10})(?!\\d)`, 'i').exec(text);
  return match ? match[1]! : null;
}

/** IBAN, or the bank's domestic id plus the counterparty bank's clearing code. */
function camtAccount(account: XmlNode | undefined, agent: XmlNode | undefined): string | null {
  const iban = textAt(account, 'Id', 'IBAN');
  if (iban) return canonicalBankAccount(iban);
  const other = textAt(account, 'Id', 'Othr', 'Id');
  if (!other) return null;
  const bankCode = textAt(agent, 'FinInstnId', 'ClrSysMmbId', 'MmbId');
  const withCode = bankCode && /^\d{4}$/.test(bankCode) && !other.includes('/') ? `${other}/${bankCode}` : other;
  return canonicalBankAccount(withCode);
}

/** camt.053.001.02 has `Dbtr/Nm`; .08 wraps it as `Dbtr/Pty/Nm`. */
function partyName(party: XmlNode | undefined): string | null {
  return textAt(party, 'Nm') ?? textAt(party, 'Pty', 'Nm');
}

function camtDate(node: XmlNode | undefined): string | null {
  const raw = textAt(node, 'Dt') ?? textAt(node, 'DtTm');
  const match = raw ? /^(\d{4}-\d{2}-\d{2})/.exec(raw) : null;
  return match ? match[1]! : null;
}

/**
 * Parses an ISO 20022 camt.053 bank-to-customer statement (versions .02
 * to .08 share the parts read here). Only booked entries (`Sts` BOOK) are
 * returned; reversals (`RvslInd`) are skipped, they undo an earlier entry
 * rather than move new money. An entry booking several transactions
 * (`NtryDtls` with more than one `TxDtls`) yields one entry per transaction.
 *
 * Czech banks follow the ČBA camt guideline for symbols: VS/SS/KS travel in
 * `Refs/EndToEndId` ("VS123/SS456/KS0308"), the VS also in
 * `RmtInf/Strd/CdtrRefInf/Ref`. Both are read, then a "VS 123" in the
 * message as a last resort.
 */
export function parseCamt053(xml: string): ParsedBankStatement {
  const content = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml;
  const document = child(parseXml(content), 'Document');
  const report = child(document, 'BkToCstmrStmt');
  if (!report) throw new BankStatementParseError('Not a camt.053 statement (no BkToCstmrStmt element)');

  let accountNumber: string | null = null;
  const entries: BankStatementEntry[] = [];
  const errors: string[] = [];

  childrenNamed(report, 'Stmt').forEach((statement, statementIndex) => {
    const accountIban = textAt(statement, 'Acct', 'Id', 'IBAN');
    accountNumber ??= accountIban ? normalizeIban(accountIban) : textAt(statement, 'Acct', 'Id', 'Othr', 'Id');
    const accountCurrency = textAt(statement, 'Acct', 'Ccy');

    childrenNamed(statement, 'Ntry').forEach((entry, entryIndex) => {
      const where = `Statement ${statementIndex + 1}, entry ${entryIndex + 1}`;
      const status = textAt(entry, 'Sts') ?? textAt(entry, 'Sts', 'Cd');
      if (status && status.toUpperCase() !== 'BOOK') return;
      if (textAt(entry, 'RvslInd')?.toLowerCase() === 'true') return;

      const indicator = textAt(entry, 'CdtDbtInd');
      if (indicator !== 'CRDT' && indicator !== 'DBIT') {
        errors.push(`${where}: missing CdtDbtInd`);
        return;
      }
      const bookingDate = camtDate(child(entry, 'BookgDt')) ?? camtDate(child(entry, 'ValDt'));
      if (!bookingDate) {
        errors.push(`${where}: missing booking date`);
        return;
      }
      const entryAmount = child(entry, 'Amt');
      const entryRef = textAt(entry, 'AcctSvcrRef') ?? textAt(entry, 'NtryRef');
      const details = childrenNamed(child(entry, 'NtryDtls'), 'TxDtls');
      const transactions = details.length > 0 ? details : [undefined];

      transactions.forEach((tx, txIndex) => {
        // A batch booking splits its total over the transactions; a single one keeps the entry amount.
        const txAmount = transactions.length > 1 ? (child(tx, 'Amt') ?? child(tx, 'AmtDtls', 'TxAmt', 'Amt')) : entryAmount;
        const amount = decimalAmount(txAmount?.text);
        const currency = (txAmount?.attrs.Ccy ?? accountCurrency ?? '').toUpperCase();
        if (!amount || !/^[A-Z]{3}$/.test(currency)) {
          errors.push(`${where}: invalid amount or currency`);
          return;
        }

        const credit = indicator === 'CRDT';
        const parties = child(tx, 'RltdPties');
        const agents = child(tx, 'RltdAgts');
        const counterparty = credit ? child(parties, 'Dbtr') : child(parties, 'Cdtr');
        const counterAccount = credit ? child(parties, 'DbtrAcct') : child(parties, 'CdtrAcct');
        const counterAgent = credit ? child(agents, 'DbtrAgt') : child(agents, 'CdtrAgt');

        const endToEnd = textAt(tx, 'Refs', 'EndToEndId');
        const creditorRef = textAt(tx, 'RmtInf', 'Strd', 'CdtrRefInf', 'Ref');
        const message = nullIfBlank(
          childrenNamed(child(tx, 'RmtInf'), 'Ustrd')
            .map((u) => u.text)
            .join(' '),
        ) ?? textAt(entry, 'AddtlNtryInf');
        const variableSymbol =
          normalizeVariableSymbol(creditorRef) ??
          normalizeVariableSymbol(symbolFrom(endToEnd, 'VS')) ??
          normalizeVariableSymbol(endToEnd) ??
          normalizeVariableSymbol(symbolFrom(message, 'VS'));

        const txRef = textAt(tx, 'Refs', 'AcctSvcrRef') ?? textAt(tx, 'Refs', 'TxId');
        entries.push({
          bookingDate,
          amount,
          direction: credit ? 'credit' : 'debit',
          currency,
          variableSymbol,
          constantSymbol: symbolFrom(endToEnd, 'KS'),
          specificSymbol: symbolFrom(endToEnd, 'SS'),
          counterpartyAccount: camtAccount(counterAccount, counterAgent),
          counterpartyName: partyName(counterparty),
          message,
          bankReference: txRef ?? (entryRef ? (transactions.length > 1 ? `${entryRef}/${txIndex + 1}` : entryRef) : null),
        });
      });
    });
  });

  if (errors.length > 0) throw new BankStatementParseError('The camt.053 file has invalid entries', errors);
  return { format: 'camt053', accountNumber, entries: dropSharedReferences(entries) };
}

// ---------------------------------------------------------------------------
// GPC / ABO
// ---------------------------------------------------------------------------

/** ISO 4217 numeric → alpha, for the currencies CZ/SK accounts are kept in. */
const NUMERIC_CURRENCIES: Record<string, string> = {
  '203': 'CZK',
  '978': 'EUR',
  '840': 'USD',
  '826': 'GBP',
  '756': 'CHF',
  '985': 'PLN',
  '348': 'HUF',
  '946': 'RON',
  '975': 'BGN',
  '208': 'DKK',
  '752': 'SEK',
  '578': 'NOK',
};

/** DDMMYY → YYYY-MM-DD (years 00–99 are 2000–2099); null for 000000 or an impossible day. */
function gpcDate(raw: string): string | null {
  if (!/^\d{6}$/.test(raw) || raw === '000000') return null;
  const day = Number(raw.slice(0, 2));
  const month = Number(raw.slice(2, 4));
  const year = 2000 + Number(raw.slice(4, 6));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${raw.slice(2, 4)}-${raw.slice(0, 2)}`;
}

/** 16 digits: prefix (6) + number (10). */
function gpcAccount(raw: string, bankCode: string | null): string | null {
  const digits = raw.trim();
  if (!/^\d{16}$/.test(digits) || /^0+$/.test(digits)) return null;
  return domesticAccount(digits.slice(0, 6), digits.slice(6), bankCode);
}

function zeroToNull(raw: string): string | null {
  const stripped = raw.trim().replace(/^0+/, '');
  return stripped === '' ? null : stripped;
}

/**
 * Parses a GPC (ABO) statement, the fixed-width text format of the Czech
 * banks' "Gemini" standard. Line types:
 *
 * - `074` statement header (account number at 4–19),
 * - `075` one movement, 128 characters,
 * - `078` / `079` optional message lines (AV1–AV4) for the preceding `075`.
 *
 * `075` columns (1-based, inclusive): 4–19 account, 20–35 counter-account,
 * 36–48 document number, 49–60 amount in hellers, 61 posting code
 * (1 debit, 2 credit, 4 / 5 reversal of a debit / credit), 62–71 VS,
 * 72–81 "00" + counter-account bank code (4) + KS (4), 82–91 SS,
 * 92–97 value date DDMMYY, 98–117 counterparty name, 119–122 currency
 * (ISO numeric with a leading zero, "0203" = CZK), 123–128 booking date.
 *
 * Reversal lines (codes 4 and 5) are skipped, like `RvslInd` in camt.053.
 * Other line types are ignored.
 */
export function parseGpc(content: string): ParsedBankStatement {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const lines = text.split(/\r\n|\r|\n/);
  let accountNumber: string | null = null;
  const entries: BankStatementEntry[] = [];
  const errors: string[] = [];
  let sawHeader = false;
  let last: BankStatementEntry | null = null;

  lines.forEach((rawLine, index) => {
    const line = rawLine.padEnd(128, ' ');
    const type = line.slice(0, 3);
    const lineNumber = index + 1;

    if (type === '074') {
      sawHeader = true;
      accountNumber ??= gpcAccount(line.slice(3, 19), null);
      last = null;
      return;
    }
    if (type === '078' || type === '079') {
      if (last) {
        const extra = nullIfBlank(`${line.slice(3, 38)} ${line.slice(38, 73)}`);
        if (extra) last.message = last.message ? `${last.message} ${extra}` : extra;
      }
      return;
    }
    if (type !== '075') {
      last = null;
      return;
    }

    const code = line.slice(60, 61);
    if (code === '4' || code === '5') {
      last = null;
      return;
    }
    if (code !== '1' && code !== '2') {
      errors.push(`Line ${lineNumber}: unknown posting code "${code}"`);
      last = null;
      return;
    }
    const hellers = line.slice(48, 60);
    if (!/^\d{12}$/.test(hellers)) {
      errors.push(`Line ${lineNumber}: invalid amount "${hellers.trim()}"`);
      last = null;
      return;
    }
    const currencyCode = line.slice(118, 122).trim().replace(/^0+/, '');
    const currency = currencyCode === '' ? 'CZK' : NUMERIC_CURRENCIES[currencyCode];
    if (!currency) {
      errors.push(`Line ${lineNumber}: unknown currency code "${line.slice(118, 122).trim()}"`);
      last = null;
      return;
    }
    const bookingDate = gpcDate(line.slice(122, 128)) ?? gpcDate(line.slice(91, 97));
    if (!bookingDate) {
      errors.push(`Line ${lineNumber}: invalid date`);
      last = null;
      return;
    }

    const bankCode = /^\d{4}$/.test(line.slice(73, 77)) && line.slice(73, 77) !== '0000' ? line.slice(73, 77) : null;
    const cents = hellers.replace(/^0+/, '').padStart(3, '0');
    const entry: BankStatementEntry = {
      bookingDate,
      amount: `${cents.slice(0, -2)}.${cents.slice(-2)}`,
      direction: code === '2' ? 'credit' : 'debit',
      currency,
      variableSymbol: normalizeVariableSymbol(line.slice(61, 71)),
      constantSymbol: zeroToNull(line.slice(77, 81)),
      specificSymbol: zeroToNull(line.slice(81, 91)),
      counterpartyAccount: gpcAccount(line.slice(19, 35), bankCode),
      counterpartyName: nullIfBlank(line.slice(97, 117)),
      message: null,
      bankReference: zeroToNull(line.slice(35, 48)),
    };
    entries.push(entry);
    last = entry;
  });

  if (!sawHeader && entries.length === 0) {
    throw new BankStatementParseError('Not a GPC statement (no 074 header line)');
  }
  if (errors.length > 0) throw new BankStatementParseError('The GPC file has invalid lines', errors);
  return { format: 'gpc', accountNumber, entries: dropSharedReferences(entries) };
}

/**
 * A bank reference is only useful as an id when no two entries in the file
 * share it; some banks fill the GPC document number with a batch number or
 * zeros. Shared ones are dropped for every entry that has them.
 */
function dropSharedReferences(entries: BankStatementEntry[]): BankStatementEntry[] {
  const counts = new Map<string, number>();
  for (const e of entries) if (e.bankReference) counts.set(e.bankReference, (counts.get(e.bankReference) ?? 0) + 1);
  return entries.map((e) => (e.bankReference && counts.get(e.bankReference)! > 1 ? { ...e, bankReference: null } : e));
}

// ---------------------------------------------------------------------------
// Format detection and de-duplication
// ---------------------------------------------------------------------------

/**
 * Picks the parser for an upload. The extension decides when it is clear
 * (`.xml` camt, `.gpc` / `.abo` GPC, `.csv` CSV); otherwise the content is
 * sniffed. Returns null when it looks like none of them.
 */
export function detectBankStatementFormat(filename: string, content: string): BankStatementFormat | 'csv' | null {
  const name = filename.toLowerCase();
  const head = content.slice(0, 2048).replace(/^﻿/, '').trimStart();
  if (name.endsWith('.gpc') || name.endsWith('.abo')) return 'gpc';
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.xml') || head.startsWith('<')) {
    return /BkToCstmrStmt|camt\.053/.test(content.slice(0, 4096)) ? 'camt053' : null;
  }
  if (/^07[45]/.test(head)) return 'gpc';
  return null;
}

export interface FingerprintInput {
  /** `YYYY-MM-DD`, or a Date taken as its UTC day. */
  date: string | Date;
  /** Numeric string or number; compared to the cent. */
  amount: string | number;
  currency: string;
  variableSymbol: string | null;
  counterpartyAccount: string | null;
}

/**
 * The key that recognises one payment arriving twice from different
 * places: an uploaded statement and the Fio API, or two overlapping
 * statements. Built from what every source carries in a comparable form:
 * booking day, amount, currency, VS and the payer's account. The message is
 * left out on purpose: GPC has none for most banks and the others cut it at
 * different lengths, so including it would make the same payment look new.
 *
 * Two genuinely separate payments can share the key (same payer, same day,
 * same amount and VS). Callers count occurrences instead of treating the
 * key as unique; see `bank-reconciliation/dedupe.ts` in the backend.
 */
export function bankTransactionFingerprint(input: FingerprintInput): string {
  const day = typeof input.date === 'string' ? input.date.slice(0, 10) : input.date.toISOString().slice(0, 10);
  const amount = Math.round(Number(input.amount) * 100);
  return [
    day,
    String(amount),
    input.currency.toUpperCase(),
    normalizeVariableSymbol(input.variableSymbol) ?? '',
    canonicalBankAccount(input.counterpartyAccount) ?? '',
  ].join('|');
}
