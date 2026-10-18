import { describe, expect, it } from 'vitest';
import { czechAccountToIban } from '../bank-account-validator.js';
import {
  BankStatementParseError,
  bankTransactionFingerprint,
  canonicalBankAccount,
  detectBankStatementFormat,
  normalizeVariableSymbol,
  parseCamt053,
  parseGpc,
} from '../bank-statements.js';

// All fixtures below are made up by hand: invented accounts, names and amounts.

describe('normalizeVariableSymbol', () => {
  it('drops leading zeros and spaces', () => {
    expect(normalizeVariableSymbol('0002026001')).toBe('2026001');
    expect(normalizeVariableSymbol(' 2026 001 ')).toBe('2026001');
  });

  it('treats empty, all-zero and non-numeric values as no symbol', () => {
    expect(normalizeVariableSymbol('')).toBeNull();
    expect(normalizeVariableSymbol('0000000000')).toBeNull();
    expect(normalizeVariableSymbol('FA-2026-1')).toBeNull();
    expect(normalizeVariableSymbol('12345678901')).toBeNull();
    expect(normalizeVariableSymbol(null)).toBeNull();
  });
});

describe('canonicalBankAccount', () => {
  it('spells a CZ account the same from an IBAN, a domestic number and a padded one', () => {
    expect(canonicalBankAccount('CZ65 0800 0000 1920 0014 5399')).toBe('19-2000145399/0800');
    expect(canonicalBankAccount('19-2000145399/0800')).toBe('19-2000145399/0800');
    expect(canonicalBankAccount('000019-2000145399 / 0800')).toBe('19-2000145399/0800');
  });

  it('converts SK IBANs too and keeps other IBANs as they are', () => {
    expect(canonicalBankAccount('SK31 1200 0000 1987 4263 7541')).toBe('19-8742637541/1200');
    expect(canonicalBankAccount('de89 3704 0044 0532 0130 00')).toBe('DE89370400440532013000');
  });

  it('returns null for blank input', () => {
    expect(canonicalBankAccount('  ')).toBeNull();
    expect(canonicalBankAccount(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// camt.053
// ---------------------------------------------------------------------------

const camt02 = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.02">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>TEST-1</MsgId><CreDtTm>2026-10-01T06:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>STMT-1</Id>
      <Acct><Id><IBAN>CZ6508000000192000145399</IBAN></Id><Ccy>CZK</Ccy></Acct>
      <Ntry>
        <NtryRef>1</NtryRef>
        <Amt Ccy="CZK">12100.50</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-09-30</Dt></BookgDt>
        <ValDt><Dt>2026-09-30</Dt></ValDt>
        <AcctSvcrRef>REF-0001</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <Refs><EndToEndId>VS2026001/SS77/KS0308</EndToEndId></Refs>
          <RltdPties>
            <Dbtr><Nm>Firma &amp; syn s.r.o.</Nm></Dbtr>
            <DbtrAcct><Id><IBAN>CZ5503000000000123456789</IBAN></Id></DbtrAcct>
          </RltdPties>
          <RmtInf><Ustrd>Faktura 2026001</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CZK">500.00</Amt>
        <CdtDbtInd>DBIT</CdtDbtInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-09-30</Dt></BookgDt>
        <AcctSvcrRef>REF-0002</AcctSvcrRef>
        <NtryDtls><TxDtls>
          <RltdPties><Cdtr><Nm>Dodavatel a.s.</Nm></Cdtr>
          <CdtrAcct><Id><Othr><Id>2000123456</Id></Othr></Id></CdtrAcct></RltdPties>
          <RltdAgts><CdtrAgt><FinInstnId><ClrSysMmbId><MmbId>2010</MmbId></ClrSysMmbId></FinInstnId></CdtrAgt></RltdAgts>
        </TxDtls></NtryDtls>
      </Ntry>
      <Ntry>
        <Amt Ccy="CZK">99.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <Sts>PDNG</Sts>
        <BookgDt><Dt>2026-10-01</Dt></BookgDt>
      </Ntry>
      <Ntry>
        <Amt Ccy="CZK">200.00</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd>
        <RvslInd>true</RvslInd>
        <Sts>BOOK</Sts>
        <BookgDt><Dt>2026-10-01</Dt></BookgDt>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;

describe('parseCamt053', () => {
  it('reads booked entries with symbols, counterparty and message', () => {
    const result = parseCamt053(camt02);
    expect(result.format).toBe('camt053');
    expect(result.accountNumber).toBe('CZ6508000000192000145399');
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0]).toEqual({
      bookingDate: '2026-09-30',
      amount: '12100.50',
      direction: 'credit',
      currency: 'CZK',
      variableSymbol: '2026001',
      constantSymbol: '0308',
      specificSymbol: '77',
      counterpartyAccount: '123456789/0300',
      counterpartyName: 'Firma & syn s.r.o.',
      message: 'Faktura 2026001',
      bankReference: 'REF-0001',
    });
  });

  it('takes the creditor account and the clearing bank code for a debit', () => {
    const [, debit] = parseCamt053(camt02).entries;
    expect(debit).toMatchObject({
      direction: 'debit',
      amount: '500.00',
      counterpartyAccount: '2000123456/2010',
      counterpartyName: 'Dodavatel a.s.',
      variableSymbol: null,
    });
  });

  it('skips pending entries and reversals', () => {
    const amounts = parseCamt053(camt02).entries.map((e) => e.amount);
    expect(amounts).not.toContain('99.00');
    expect(amounts).not.toContain('200.00');
  });

  it('reads camt.053.001.08 with prefixed tags, Sts/Cd, Pty/Nm, DtTm and a structured VS', () => {
    const xml = `<?xml version="1.0"?>
<ns:Document xmlns:ns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
 <ns:BkToCstmrStmt><ns:Stmt>
  <ns:Acct><ns:Id><ns:IBAN>SK3112000000198742637541</ns:IBAN></ns:Id></ns:Acct>
  <ns:Ntry>
   <ns:Amt Ccy='EUR'>80.5</ns:Amt><ns:CdtDbtInd>CRDT</ns:CdtDbtInd>
   <ns:Sts><ns:Cd>BOOK</ns:Cd></ns:Sts>
   <ns:BookgDt><ns:DtTm>2026-02-28T23:10:00+01:00</ns:DtTm></ns:BookgDt>
   <ns:NtryDtls><ns:TxDtls>
    <ns:RltdPties><ns:Dbtr><ns:Pty><ns:Nm>Ján Malý</ns:Nm></ns:Pty></ns:Dbtr></ns:RltdPties>
    <ns:RmtInf><ns:Strd><ns:CdtrRefInf><ns:Ref>0000004711</ns:Ref></ns:CdtrRefInf></ns:Strd></ns:RmtInf>
   </ns:TxDtls></ns:NtryDtls>
  </ns:Ntry>
 </ns:Stmt></ns:BkToCstmrStmt>
</ns:Document>`;
    const [entry] = parseCamt053(xml).entries;
    expect(entry).toMatchObject({
      bookingDate: '2026-02-28',
      amount: '80.50',
      currency: 'EUR',
      variableSymbol: '4711',
      counterpartyName: 'Ján Malý',
      bankReference: null,
    });
  });

  it('splits a batch booking into its transactions and numbers the shared reference', () => {
    const xml = `<Document><BkToCstmrStmt><Stmt><Acct><Id><IBAN>CZ6508000000192000145399</IBAN></Id><Ccy>CZK</Ccy></Acct>
      <Ntry><Amt Ccy="CZK">300.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-02</Dt></BookgDt>
        <AcctSvcrRef>BATCH-9</AcctSvcrRef>
        <NtryDtls>
          <TxDtls><Amt Ccy="CZK">100.00</Amt><RmtInf><Ustrd>VS: 11</Ustrd></RmtInf></TxDtls>
          <TxDtls><AmtDtls><TxAmt><Amt Ccy="CZK">200.00</Amt></TxAmt></AmtDtls><RmtInf><Ustrd>VS 22</Ustrd></RmtInf></TxDtls>
        </NtryDtls>
      </Ntry></Stmt></BkToCstmrStmt></Document>`;
    const entries = parseCamt053(xml).entries;
    expect(entries.map((e) => [e.amount, e.variableSymbol, e.bankReference])).toEqual([
      ['100.00', '11', 'BATCH-9/1'],
      ['200.00', '22', 'BATCH-9/2'],
    ]);
  });

  it('drops a bank reference that two entries share', () => {
    const entry = (amount: string) =>
      `<Ntry><Amt Ccy="CZK">${amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-02</Dt></BookgDt><AcctSvcrRef>SAME</AcctSvcrRef></Ntry>`;
    const xml = `<Document><BkToCstmrStmt><Stmt><Acct><Ccy>CZK</Ccy></Acct>${entry('1.00')}${entry('2.00')}</Stmt></BkToCstmrStmt></Document>`;
    expect(parseCamt053(xml).entries.map((e) => e.bankReference)).toEqual([null, null]);
  });

  it('lists every invalid entry', () => {
    const xml = `<Document><BkToCstmrStmt><Stmt><Acct><Ccy>CZK</Ccy></Acct>
      <Ntry><Amt Ccy="CZK">abc</Amt><CdtDbtInd>CRDT</CdtDbtInd><BookgDt><Dt>2026-03-02</Dt></BookgDt></Ntry>
      <Ntry><Amt Ccy="CZK">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd></Ntry>
    </Stmt></BkToCstmrStmt></Document>`;
    try {
      parseCamt053(xml);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BankStatementParseError);
      expect((err as BankStatementParseError).errors).toEqual([
        'Statement 1, entry 1: invalid amount or currency',
        'Statement 1, entry 2: missing booking date',
      ]);
    }
  });

  it('rejects other XML and broken XML', () => {
    expect(() => parseCamt053('<Document><CstmrCdtTrfInitn/></Document>')).toThrow(BankStatementParseError);
    expect(() => parseCamt053('<Document><BkToCstmrStmt><Stmt></BkToCstmrStmt></Document>')).toThrow(BankStatementParseError);
  });

  it('never expands a DOCTYPE entity', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><Document><BkToCstmrStmt><Stmt><Acct><Ccy>CZK</Ccy></Acct>
      <Ntry><Amt Ccy="CZK">1.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts>BOOK</Sts><BookgDt><Dt>2026-03-02</Dt></BookgDt><AddtlNtryInf>&x;</AddtlNtryInf></Ntry>
    </Stmt></BkToCstmrStmt></Document>`;
    expect(parseCamt053(xml).entries[0]!.message).toBe('&x;');
  });
});

// ---------------------------------------------------------------------------
// GPC
// ---------------------------------------------------------------------------

/** Assembles a 075 line field by field (widths from the GPC specification). */
function gpc075(fields: {
  account?: string;
  counter?: string;
  doc?: string;
  hellers: number;
  code: string;
  vs?: string;
  bank?: string;
  ks?: string;
  ss?: string;
  valuta?: string;
  name?: string;
  currency?: string;
  booked?: string;
}): string {
  const line =
    '075' +
    (fields.account ?? '0000002400012345') +
    (fields.counter ?? '0000000000000000') +
    (fields.doc ?? '0000000000000').padStart(13, '0') +
    String(fields.hellers).padStart(12, '0') +
    fields.code +
    (fields.vs ?? '').padStart(10, '0') +
    '00' +
    (fields.bank ?? '0000') +
    (fields.ks ?? '0000') +
    (fields.ss ?? '').padStart(10, '0') +
    (fields.valuta ?? '010326') +
    (fields.name ?? '').padEnd(20, ' ') +
    '0' +
    (fields.currency ?? '0203') +
    (fields.booked ?? '010326');
  expect(line).toHaveLength(128);
  return line;
}

const gpcHeader = '074' + '0000002400012345' + 'TEST UCET'.padEnd(20, ' ') + '280226' + '0'.repeat(14) + '+';

describe('parseGpc', () => {
  it('reads a hand-typed 075 line at the documented positions', () => {
    // 075 | account | counter-account | doc no. | amount | code | VS | 00+bank+KS | SS | valuta | name | 0 | currency | booked
    const line =
      '075' + '0000002400012345' + '0000190000123457' + '0000026962199' + '000000121005' + '2' + '0002026001' +
      '0008000308' + '0000000077' + '300926' + 'Firma s.r.o.        ' + '0' + '0203' + '300926';
    expect(line).toHaveLength(128);
    const result = parseGpc(`${gpcHeader}\r\n${line}\r\n`);
    expect(result.format).toBe('gpc');
    expect(result.accountNumber).toBe('2400012345');
    expect(result.entries).toEqual([
      {
        bookingDate: '2026-09-30',
        amount: '1210.05',
        direction: 'credit',
        currency: 'CZK',
        variableSymbol: '2026001',
        constantSymbol: '308',
        specificSymbol: '77',
        counterpartyAccount: '19-123457/0800',
        counterpartyName: 'Firma s.r.o.',
        message: null,
        bankReference: '26962199',
      },
    ]);
  });

  it('marks debits, reads EUR and attaches 078/079 message lines to the movement before them', () => {
    const content = [
      gpcHeader,
      gpc075({ hellers: 50, code: '1', currency: '0978', name: 'Nájem' }),
      '078' + 'Platba za brezen'.padEnd(35, ' ') + 'byt 3'.padEnd(35, ' '),
      '079' + 'dekujeme'.padEnd(35, ' '),
    ].join('\n');
    const [entry] = parseGpc(content).entries;
    expect(entry).toMatchObject({ direction: 'debit', amount: '0.50', currency: 'EUR', counterpartyName: 'Nájem' });
    expect(entry!.message).toBe('Platba za brezen byt 3 dekujeme');
  });

  it('skips reversals (codes 4 and 5)', () => {
    const content = [
      gpcHeader,
      gpc075({ hellers: 100, code: '5', doc: '1' }),
      gpc075({ hellers: 200, code: '4', doc: '2' }),
      gpc075({ hellers: 300, code: '2', doc: '3', booked: '280226' }),
    ].join('\n');
    const entries = parseGpc(content).entries;
    expect(entries.map((e) => [e.amount, e.bookingDate])).toEqual([['3.00', '2026-02-28']]);
  });

  it('falls back to the value date when the booking date is zero', () => {
    const entries = parseGpc([gpcHeader, gpc075({ hellers: 300, code: '2', booked: '000000', valuta: '280226' })].join('\n')).entries;
    expect(entries.map((e) => [e.amount, e.bookingDate])).toEqual([['3.00', '2026-02-28']]);
  });

  it('rejects 29 February outside a leap year and accepts it in one', () => {
    expect(() => parseGpc([gpcHeader, gpc075({ hellers: 1, code: '2', booked: '290226', valuta: '000000' })].join('\n'))).toThrow(
      BankStatementParseError,
    );
    expect(parseGpc([gpcHeader, gpc075({ hellers: 1, code: '2', booked: '290228' })].join('\n')).entries[0]!.bookingDate).toBe(
      '2028-02-29',
    );
  });

  it('drops document numbers that repeat inside the file', () => {
    const content = [gpcHeader, gpc075({ hellers: 1, code: '2', doc: '7' }), gpc075({ hellers: 2, code: '2', doc: '7' })].join('\n');
    expect(parseGpc(content).entries.map((e) => e.bankReference)).toEqual([null, null]);
  });

  it('lists every invalid line with its number', () => {
    const content = [
      gpcHeader,
      gpc075({ hellers: 1, code: '9' }),
      gpc075({ hellers: 1, code: '2', currency: '0999' }),
      '075' + '0000002400012345' + '0'.repeat(29) + 'ABCDEFGHIJKL' + '2',
    ].join('\n');
    try {
      parseGpc(content);
      expect.unreachable();
    } catch (err) {
      expect((err as BankStatementParseError).errors).toEqual([
        'Line 2: unknown posting code "9"',
        'Line 3: unknown currency code "0999"',
        'Line 4: invalid amount "ABCDEFGHIJKL"',
      ]);
    }
  });

  it('rejects a file that is not GPC at all', () => {
    expect(() => parseGpc('date;amount\n2026-01-01;5')).toThrow(BankStatementParseError);
  });
});

describe('detectBankStatementFormat', () => {
  it('trusts a clear extension and sniffs the rest', () => {
    expect(detectBankStatementFormat('vypis.GPC', '')).toBe('gpc');
    expect(detectBankStatementFormat('vypis.abo', '')).toBe('gpc');
    expect(detectBankStatementFormat('vypis.csv', '074...')).toBe('csv');
    expect(detectBankStatementFormat('vypis.xml', camt02)).toBe('camt053');
    expect(detectBankStatementFormat('vypis', `﻿${camt02}`)).toBe('camt053');
    expect(detectBankStatementFormat('vypis.txt', gpcHeader)).toBe('gpc');
  });

  it('refuses XML that is not a camt.053 statement, and unknown text', () => {
    expect(detectBankStatementFormat('invoice.xml', '<Invoice/>')).toBeNull();
    expect(detectBankStatementFormat('notes.txt', 'hello')).toBeNull();
  });
});

describe('bankTransactionFingerprint', () => {
  it('is the same for one payment as Fio API, camt.053 and GPC describe it', () => {
    const fromApi = bankTransactionFingerprint({
      date: new Date(Date.UTC(2026, 8, 30)),
      amount: '1210.05',
      currency: 'CZK',
      variableSymbol: '2026001',
      counterpartyAccount: '19-123457/0800',
    });
    const fromCamt = bankTransactionFingerprint({
      date: '2026-09-30',
      amount: 1210.05,
      currency: 'czk',
      variableSymbol: '0002026001',
      counterpartyAccount: czechAccountToIban('19-123457/0800'),
    });
    expect(fromCamt).toBe(fromApi);
    expect(fromApi).toBe('2026-09-30|121005|CZK|2026001|19-123457/0800');
  });

  it('differs when the amount, day or VS differs', () => {
    const base = { date: '2026-09-30', amount: '100.00', currency: 'CZK', variableSymbol: '1', counterpartyAccount: null };
    const key = bankTransactionFingerprint(base);
    expect(bankTransactionFingerprint({ ...base, amount: '100.01' })).not.toBe(key);
    expect(bankTransactionFingerprint({ ...base, date: '2026-10-01' })).not.toBe(key);
    expect(bankTransactionFingerprint({ ...base, variableSymbol: '2' })).not.toBe(key);
  });
});
