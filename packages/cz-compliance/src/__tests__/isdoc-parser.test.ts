import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { checkIsdoc, inferIsdocScenario } from '../isdoc-check.js';
import { generateIsdocXml, type IsdocInvoiceInput } from '../isdoc-generator.js';
import { decodeXmlBytes, extractIsdocFromZip, IsdocParseError, parseIsdoc, parseXml, readIsdocFile } from '../isdoc-parser.js';

/** A consistent domestic CZ invoice: 2 × 1000 + 1 × 500 at 21 % → 2500 + 525 = 3025. */
function input(over: Partial<IsdocInvoiceInput> = {}): IsdocInvoiceInput {
  return {
    invoiceNumber: '2026001',
    variableSymbol: '2026001',
    issueDate: '2026-03-15',
    dueDate: '2026-03-29',
    taxableSupplyDate: '2026-03-15',
    currency: 'CZK',
    supplier: {
      legalName: 'Dodavatel s.r.o.',
      ico: '27082440',
      dic: 'CZ27082440',
      isVatPayer: true,
      address: { street: 'Vinohradská', houseNumber: '1234/56', city: 'Praha', postalCode: '120 00', countryCode: 'CZ' }
    },
    customer: {
      legalName: 'Odběratel a.s.',
      ico: '00006947',
      dic: 'CZ00006947',
      address: { street: 'Letenská', houseNumber: '15', city: 'Praha', postalCode: '118 10', countryCode: 'CZ' }
    },
    lineItems: [
      { description: 'Konzultace', quantity: 2, unitPriceWithoutVat: 1000, vatRate: 'base', vatRatePercent: 21 },
      { description: 'Školení', quantity: 1, unitPriceWithoutVat: 500, vatRate: 'base', vatRatePercent: 21 }
    ],
    totals: {
      totalWithoutVat: 2500,
      totalVat: 525,
      totalWithVat: 3025,
      vatRecapitulation: [{ vatRate: 'base', vatRatePercent: 21, totalWithoutVat: 2500, vatAmount: 525, totalWithVat: 3025 }]
    },
    bankAccount: { accountNumber: '19-2000145399/0800', iban: 'CZ6508000000192000145399', bic: 'GIBACZPX', bankName: 'Česká spořitelna' },
    note: 'Zapsáno v obchodním rejstříku u Městského soudu v Praze, oddíl C, vložka 1',
    ...over
  };
}

/** Builds a single-entry ZIP (local header + central directory + EOCD). */
function zip(name: string, content: Uint8Array, deflate = true): Uint8Array {
  const data = deflate ? new Uint8Array(deflateRawSync(content)) : content;
  const nameBytes = new TextEncoder().encode(name);
  const method = deflate ? 8 : 0;
  const local = new Uint8Array(30 + nameBytes.length);
  const lv = new DataView(local.buffer);
  lv.setUint32(0, 0x04034b50, true);
  lv.setUint16(8, method, true);
  lv.setUint32(18, data.length, true);
  lv.setUint32(22, content.length, true);
  lv.setUint16(26, nameBytes.length, true);
  local.set(nameBytes, 30);
  const central = new Uint8Array(46 + nameBytes.length);
  const cv = new DataView(central.buffer);
  cv.setUint32(0, 0x02014b50, true);
  cv.setUint16(10, method, true);
  cv.setUint32(20, data.length, true);
  cv.setUint32(24, content.length, true);
  cv.setUint16(28, nameBytes.length, true);
  cv.setUint32(42, 0, true);
  central.set(nameBytes, 46);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, 1, true);
  ev.setUint16(10, 1, true);
  ev.setUint32(12, central.length, true);
  ev.setUint32(16, local.length + data.length, true);
  const out = new Uint8Array(local.length + data.length + central.length + eocd.length);
  out.set(local, 0);
  out.set(data, local.length);
  out.set(central, local.length + data.length);
  out.set(eocd, local.length + data.length + central.length);
  return out;
}

describe('parseXml', () => {
  it('reads elements, attributes, entities and CDATA and drops namespace prefixes', () => {
    const root = parseXml(
      '<?xml version="1.0"?><!-- c --><!DOCTYPE x [<!ENTITY a "b">]><i:Invoice xmlns:i="ns" version="6.0.2"><i:Note>A &amp; B &#381;</i:Note><x a=\'1>2\'/><y><![CDATA[<raw>]]></y></i:Invoice>'
    );
    const inv = root.children[0]!;
    expect(inv.name).toBe('Invoice');
    expect(inv.attrs.version).toBe('6.0.2');
    expect(inv.children.map((c) => c.name)).toEqual(['Note', 'x', 'y']);
    expect(inv.children[0]!.text).toBe('A & B Ž');
    expect(inv.children[1]!.attrs.a).toBe('1>2');
    expect(inv.children[2]!.text).toBe('<raw>');
  });

  it('rejects broken XML', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(IsdocParseError);
    expect(() => parseXml('<a>')).toThrow(IsdocParseError);
  });
});

describe('parseIsdoc', () => {
  it('reads back what generateIsdocXml writes', () => {
    const doc = parseIsdoc(generateIsdocXml(input()));
    expect(doc).toMatchObject({
      version: '6.0.2',
      documentType: '1',
      kind: 'invoice',
      number: '2026001',
      issueDate: '2026-03-15',
      taxPointDate: '2026-03-15',
      dueDate: '2026-03-29',
      vatApplicable: true,
      localCurrency: 'CZK',
      taxTotal: 525,
      totals: { taxExclusive: 2500, taxInclusive: 3025, payable: 3025 }
    });
    expect(doc.supplier).toMatchObject({ name: 'Dodavatel s.r.o.', ico: '27082440', dic: 'CZ27082440', city: 'Praha', countryCode: 'CZ' });
    expect(doc.customer).toMatchObject({ name: 'Odběratel a.s.', ico: '00006947' });
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0]).toMatchObject({ description: 'Konzultace', quantity: 2, unitPrice: 1000, net: 2000, vatPercent: 21, reverseCharge: false });
    expect(doc.taxSubTotals).toEqual([{ percent: 21, taxable: 2500, tax: 525, inclusive: 3025 }]);
    expect(doc.payments[0]).toMatchObject({ code: '42', iban: 'CZ6508000000192000145399', variableSymbol: '2026001', bankCode: '0800' });
    expect(doc.notes[0]).toContain('obchodním rejstříku');
  });

  it('reads prefixed elements, credit notes and the reverse-charge flag', () => {
    const doc = parseIsdoc(`<?xml version="1.0" encoding="utf-8"?>
      <isdoc:Invoice xmlns:isdoc="http://isdoc.cz/namespace/2013" version="6.0.2">
        <isdoc:DocumentType>2</isdoc:DocumentType><isdoc:ID>D-1</isdoc:ID>
        <isdoc:AccountingSupplierParty><isdoc:Party><isdoc:PartyIdentification><isdoc:ID>N/A</isdoc:ID></isdoc:PartyIdentification>
          <isdoc:PartyName><isdoc:Name>X</isdoc:Name></isdoc:PartyName></isdoc:Party></isdoc:AccountingSupplierParty>
        <isdoc:OriginalDocumentReferences><isdoc:OriginalDocumentReference><isdoc:ID>F-9</isdoc:ID></isdoc:OriginalDocumentReference></isdoc:OriginalDocumentReferences>
        <isdoc:InvoiceLines><isdoc:InvoiceLine><isdoc:ClassifiedTaxCategory><isdoc:Percent>21</isdoc:Percent><isdoc:LocalReverseChargeFlag>true</isdoc:LocalReverseChargeFlag></isdoc:ClassifiedTaxCategory></isdoc:InvoiceLine></isdoc:InvoiceLines>
      </isdoc:Invoice>`);
    expect(doc.kind).toBe('credit_note');
    expect(doc.originalDocuments).toEqual(['F-9']);
    // "N/A" in PartyIdentification is no IČO.
    expect(doc.supplier.ico).toBeUndefined();
    expect(doc.lines[0]!.reverseCharge).toBe(true);
  });

  it('refuses XML that is not an ISDOC invoice', () => {
    expect(() => parseIsdoc('<Order><ID>1</ID></Order>')).toThrow(expect.objectContaining({ code: 'not_isdoc' }));
    expect(() => parseIsdoc('not xml <')).toThrow(IsdocParseError);
  });
});

describe('files', () => {
  it('decodes windows-1250 as declared in the XML prolog', () => {
    // "Ž" is 0x8E in windows-1250.
    const bytes = new Uint8Array([...new TextEncoder().encode('<?xml version="1.0" encoding="windows-1250"?><a>'), 0x8e, ...new TextEncoder().encode('</a>')]);
    expect(decodeXmlBytes(bytes)).toContain('<a>Ž</a>');
  });

  it('reads the .isdoc out of a deflated or stored ISDOCX', async () => {
    const xml = new TextEncoder().encode(generateIsdocXml(input()));
    expect(await extractIsdocFromZip(zip('faktura.isdoc', xml))).toEqual(xml);
    expect(await extractIsdocFromZip(zip('faktura.isdoc', xml, false))).toEqual(xml);
    expect(await extractIsdocFromZip(zip('manifest.xml', xml))).toBeNull();
    const doc = await readIsdocFile(zip('faktura.isdoc', xml));
    expect(doc.number).toBe('2026001');
    // A plain .isdoc goes straight to the parser.
    expect((await readIsdocFile(xml)).number).toBe('2026001');
  });
});

describe('inferIsdocScenario', () => {
  it('guesses a CZ payer invoicing a domestic business', () => {
    expect(inferIsdocScenario(parseIsdoc(generateIsdocXml(input())))).toEqual({
      country: 'CZ',
      vatStatus: 'payer',
      document: 'invoice',
      customer: 'business',
      reverseCharge: false
    });
  });

  it('a non-payer to a consumer, a Slovak supplier, an EU service', () => {
    const nonPayer = input({
      supplier: { ...input().supplier, dic: undefined, isVatPayer: false },
      customer: { legalName: 'Jan Novák', address: { street: 'Dlouhá', city: 'Brno', postalCode: '60200', countryCode: 'CZ' } },
      lineItems: [{ description: 'Oprava', quantity: 1, unitPriceWithoutVat: 1000, vatRate: 'zero', vatRatePercent: 0 }],
      totals: { totalWithoutVat: 1000, totalVat: 0, totalWithVat: 1000, vatRecapitulation: [{ vatRate: 'zero', vatRatePercent: 0, totalWithoutVat: 1000, vatAmount: 0, totalWithVat: 1000 }] }
    });
    expect(inferIsdocScenario(parseIsdoc(generateIsdocXml(nonPayer)))).toMatchObject({ vatStatus: 'non_payer', customer: 'consumer', reverseCharge: false });

    const sk = input({ supplier: { ...input().supplier, dic: 'SK2020317068', address: { ...input().supplier.address, countryCode: 'SK' } } });
    expect(inferIsdocScenario(parseIsdoc(generateIsdocXml(sk)))).toMatchObject({ country: 'SK', customer: 'eu_business' });

    const euService = input({
      customer: { legalName: 'Kunde GmbH', dic: 'DE123456789', address: { street: 'Hauptstr.', houseNumber: '1', city: 'Berlin', postalCode: '10115', countryCode: 'DE' } },
      lineItems: [{ description: 'Vývoj', quantity: 1, unitPriceWithoutVat: 1000, vatRate: 'zero', vatRatePercent: 0 }],
      totals: { totalWithoutVat: 1000, totalVat: 0, totalWithVat: 1000, vatRecapitulation: [{ vatRate: 'zero', vatRatePercent: 0, totalWithoutVat: 1000, vatAmount: 0, totalWithVat: 1000 }] },
      note: 'Daň odvede zákazník'
    });
    expect(inferIsdocScenario(parseIsdoc(generateIsdocXml(euService)))).toMatchObject({ customer: 'eu_business', reverseCharge: true });
  });
});

describe('checkIsdoc', () => {
  it('a complete invoice passes with no findings', () => {
    const r = checkIsdoc(parseIsdoc(generateIsdocXml(input())));
    expect(r.findings).toEqual([]);
    const missing = r.items.filter((i) => i.status === 'missing' || i.status === 'invalid');
    expect(missing).toEqual([]);
    expect(r.items.find((i) => i.id === 'supplierRegistry')?.status).toBe('ok');
  });

  it('flags bad identifiers, a bad account and broken VAT arithmetic', () => {
    const xml = generateIsdocXml(input())
      .replace(/<ID>27082440<\/ID>/, '<ID>27082441</ID>')
      .replace('<CompanyID>CZ00006947</CompanyID>', '<CompanyID>CZ00006948</CompanyID>')
      .replace('<IBAN>CZ6508000000192000145399</IBAN>', '<IBAN>CZ6508000000192000145398</IBAN>')
      .replace('<ID>19-2000145399</ID>', '<ID>19-2000145398</ID>')
      .replace(/<TaxTotal>([\s\S]*?)<TaxAmount>525.00<\/TaxAmount>/, '<TaxTotal>$1<TaxAmount>520.00</TaxAmount>')
      .replace('<PayableAmount>3025.00</PayableAmount>', '<PayableAmount>3000.00</PayableAmount>');
    const r = checkIsdoc(parseIsdoc(xml));
    const codes = r.findings.map((f) => f.code);
    expect(codes).toEqual(
      expect.arrayContaining(['supplierIcoInvalid', 'customerDicInvalid', 'ibanInvalid', 'bankAccountInvalid', 'subtotalVatMismatch', 'payableMismatch'])
    );
    expect(r.findings.find((f) => f.code === 'subtotalVatMismatch')).toMatchObject({ expected: 525, actual: 520 });
    expect(r.items.find((i) => i.id === 'supplierIco')?.status).toBe('invalid');
    expect(r.items.find((i) => i.id === 'customerDic')?.status).toBe('invalid');
    expect(r.items.find((i) => i.id === 'paymentDetails')?.status).toBe('invalid');
  });

  it('marks required items as missing and absent conditional ones as unknown', () => {
    const xml = generateIsdocXml(input({ note: undefined }))
      .replace(/<PartyName><Name>Odběratel a.s.<\/Name><\/PartyName>/, '')
      .replace(/<PaymentMeans>[\s\S]*<\/PaymentMeans>/, '');
    const r = checkIsdoc(parseIsdoc(xml));
    const status = (id: string) => r.items.find((i) => i.id === id)?.status;
    expect(status('customerName')).toBe('missing');
    expect(status('supplierRegistry')).toBe('unknown');
    // Payment details are good practice: absent → unknown, not missing.
    expect(status('paymentDetails')).toBe('unknown');
  });

  it('flags VAT on a non-payer, a due date before the issue date and a simplified document over the limit', () => {
    const doc = parseIsdoc(generateIsdocXml(input({ dueDate: '2026-03-01' })));
    const asNonPayer = checkIsdoc(doc, { country: 'CZ', vatStatus: 'non_payer', document: 'invoice', customer: 'business', reverseCharge: false });
    expect(asNonPayer.findings.map((f) => f.code)).toEqual(expect.arrayContaining(['vatOnNonPayer', 'dueBeforeIssue']));

    const big = parseIsdoc(
      generateIsdocXml(
        input({
          lineItems: [{ description: 'Zboží', quantity: 1, unitPriceWithoutVat: 10000, vatRate: 'base', vatRatePercent: 21 }],
          totals: { totalWithoutVat: 10000, totalVat: 2100, totalWithVat: 12100, vatRecapitulation: [{ vatRate: 'base', vatRatePercent: 21, totalWithoutVat: 10000, vatAmount: 2100, totalWithVat: 12100 }] }
        })
      ).replace('<DocumentType>1</DocumentType>', '<DocumentType>7</DocumentType>')
    );
    expect(big.kind).toBe('simplified');
    expect(checkIsdoc(big).findings).toContainEqual(expect.objectContaining({ code: 'simplifiedOverLimit', expected: 10000, actual: 12100 }));
  });

  it('caps a Slovak simplified invoice at 100 € incl. VAT (§74/3 a) ZoDPH)', () => {
    const sk = { country: 'SK', vatStatus: 'payer', document: 'simplified', customer: 'business', reverseCharge: false } as const;
    const doc = (net: number) => {
      const vat = Math.round(net * 23) / 100;
      const parsed = parseIsdoc(
        generateIsdocXml(
          input({
            lineItems: [{ description: 'Tovar', quantity: 1, unitPriceWithoutVat: net, vatRate: 'base', vatRatePercent: 23 }],
            totals: { totalWithoutVat: net, totalVat: vat, totalWithVat: net + vat, vatRecapitulation: [{ vatRate: 'base', vatRatePercent: 23, totalWithoutVat: net, vatAmount: vat, totalWithVat: net + vat }] }
          })
        )
      );
      parsed.localCurrency = 'EUR';
      return parsed;
    };
    const codes = (net: number) => checkIsdoc(doc(net), sk).findings.map((f) => f.code);
    expect(codes(80)).not.toContain('simplifiedOverLimit'); // 98.40 €
    expect(checkIsdoc(doc(100), sk).findings).toContainEqual(expect.objectContaining({ code: 'simplifiedOverLimit', expected: 100, actual: 123 }));
  });

  it('a reverse-charge invoice needs the note; the line flag counts', () => {
    const doc = parseIsdoc(generateIsdocXml(input({ note: undefined })));
    const scenario = { country: 'CZ', vatStatus: 'payer', document: 'invoice', customer: 'business', reverseCharge: true } as const;
    expect(checkIsdoc(doc, scenario).items.find((i) => i.id === 'reverseChargeNote')?.status).toBe('missing');
    doc.lines[0]!.reverseCharge = true;
    expect(checkIsdoc(doc, scenario).items.find((i) => i.id === 'reverseChargeNote')?.status).toBe('ok');
  });
});
