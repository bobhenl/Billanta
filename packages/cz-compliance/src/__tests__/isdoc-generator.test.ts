import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { escapeXml, generateIsdocXml, type IsdocInvoiceInput } from '../isdoc-generator.js';

const ISDOC_NAMESPACE = 'http://isdoc.cz/namespace/2013';

/**
 * A realistic multi-line invoice mixing three VAT rates (21% base, 15%
 * reduced, 0% zero-rated) so the VAT recapitulation grouping logic is
 * actually exercised across more than one bracket.
 *
 * Hand-computed expectations (all amounts in CZK):
 *
 *   Line 1: 2 x 1000.00 @ 21%  -> net 2000.00, vat  420.00 (2000 * 0.21)
 *   Line 2: 1 x  500.00 @ 21%  -> net  500.00, vat  105.00 ( 500 * 0.21)
 *   Line 3: 3 x  200.00 @ 15%  -> net  600.00, vat   90.00 ( 600 * 0.15)
 *   Line 4: 1 x  300.00 @  0%  -> net  300.00, vat    0.00
 *
 *   21% bracket: base = 2000.00 + 500.00 = 2500.00, vat = 2500.00 * 0.21 = 525.00
 *   15% bracket: base = 600.00,                     vat =  600.00 * 0.15 =  90.00
 *    0% bracket: base = 300.00,                     vat =    0.00
 *
 *   totalWithoutVat = 2500.00 + 600.00 + 300.00 = 3400.00
 *   totalVat        =  525.00 +  90.00 +   0.00 =  615.00
 *   totalWithVat    = 3400.00 + 615.00          = 4015.00
 */
function buildRealisticInvoice(overrides: Partial<IsdocInvoiceInput> = {}): IsdocInvoiceInput {
  return {
    invoiceNumber: '20240001',
    variableSymbol: '20240001',
    issueDate: '2024-03-15',
    dueDate: '2024-03-29',
    taxableSupplyDate: '2024-03-15',
    currency: 'CZK',
    supplier: {
      legalName: 'Dodavatel s.r.o.',
      ico: '12345678',
      dic: 'CZ12345678',
      isVatPayer: true,
      address: {
        street: 'Vinohradská',
        houseNumber: '1234/56',
        city: 'Praha',
        postalCode: '120 00',
        countryCode: 'CZ',
      },
      email: 'fakturace@dodavatel.cz',
    },
    customer: {
      legalName: 'Odberatel a.s.',
      ico: '87654321',
      dic: 'CZ87654321',
      address: {
        street: 'Nám. Republiky',
        houseNumber: '1',
        city: 'Brno',
        postalCode: '602 00',
        countryCode: 'CZ',
      },
    },
    lineItems: [
      { description: 'Konzultační služby', quantity: 2, unitPriceWithoutVat: 1000, vatRate: 'base', vatRatePercent: 21 },
      { description: 'Školení', quantity: 1, unitPriceWithoutVat: 500, vatRate: 'base', vatRatePercent: 21 },
      { description: 'Tiskoviny', quantity: 3, unitPriceWithoutVat: 200, vatRate: 'reduced', vatRatePercent: 15 },
      { description: 'Vývoz zboží', quantity: 1, unitPriceWithoutVat: 300, vatRate: 'zero', vatRatePercent: 0 },
    ],
    totals: {
      totalWithoutVat: 3400,
      totalVat: 615,
      totalWithVat: 4015,
      vatRecapitulation: [
        { vatRate: 'base', vatRatePercent: 21, totalWithoutVat: 2500, vatAmount: 525, totalWithVat: 3025 },
        { vatRate: 'reduced', vatRatePercent: 15, totalWithoutVat: 600, vatAmount: 90, totalWithVat: 690 },
        { vatRate: 'zero', vatRatePercent: 0, totalWithoutVat: 300, vatAmount: 0, totalWithVat: 300 },
      ],
    },
    bankAccount: {
      accountNumber: '19-2000145399/0800',
      iban: 'CZ6508000000192000145399',
      bic: 'GIBACZPX',
      bankName: 'Česká spořitelna, a.s.',
    },
    ...overrides,
  };
}

/** Extracts the text content of the first `<tag>` occurrence via a simple, deliberately dumb regex (used only to sanity-check values independent of the XML parser). */
function firstTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(xml);
  return match?.[1];
}

describe('generateIsdocXml', () => {
  it('produces well-formed XML in the ISDOC 6.0.2 namespace with the correct root element', () => {
    const xml = generateIsdocXml(buildRealisticInvoice());

    const validation = XMLValidator.validate(xml);
    expect(validation).toBe(true);

    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
    const parsed = parser.parse(xml);

    expect(parsed.Invoice).toBeDefined();
    expect(parsed.Invoice['@_xmlns']).toBe(ISDOC_NAMESPACE);
    expect(parsed.Invoice['@_version']).toBe('6.0.2');
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });

  it('maps header fields (ID, dates, currency) to the correct ISDOC elements', () => {
    const xml = generateIsdocXml(buildRealisticInvoice());
    const parser = new XMLParser();
    const parsed = parser.parse(xml).Invoice;

    expect(String(parsed.ID)).toBe('20240001');
    expect(String(parsed.IssueDate)).toBe('2024-03-15');
    expect(String(parsed.TaxPointDate)).toBe('2024-03-15');
    expect(String(parsed.LocalCurrencyCode)).toBe('CZK');
    expect(String(parsed.DocumentType)).toBe('1');
    expect(parsed.UUID).toBeTruthy();
  });

  it('truncates a full ISO datetime down to the xs:date lexical form (YYYY-MM-DD)', () => {
    const xml = generateIsdocXml(
      buildRealisticInvoice({
        issueDate: '2024-03-15T10:30:00.000Z',
        dueDate: '2024-03-29T00:00:00.000Z',
        taxableSupplyDate: '2024-03-15T10:30:00.000Z',
      }),
    );
    const parser = new XMLParser();
    const parsed = parser.parse(xml).Invoice;

    expect(String(parsed.IssueDate)).toBe('2024-03-15');
    expect(String(parsed.TaxPointDate)).toBe('2024-03-15');
    expect(String(parsed.PaymentMeans.Payment.Details.PaymentDueDate)).toBe('2024-03-29');
  });

  it('correctly groups line items by VAT rate and sums base/VAT amounts per group', () => {
    const xml = generateIsdocXml(buildRealisticInvoice());
    const parser = new XMLParser();
    const parsed = parser.parse(xml).Invoice;

    const subTotals = Array.isArray(parsed.TaxTotal.TaxSubTotal) ? parsed.TaxTotal.TaxSubTotal : [parsed.TaxTotal.TaxSubTotal];
    expect(subTotals).toHaveLength(3);

    const byRate = new Map<number, (typeof subTotals)[number]>();
    for (const subTotal of subTotals) {
      byRate.set(subTotal.TaxCategory.Percent, subTotal);
    }

    const rate21 = byRate.get(21)!;
    expect(rate21.TaxableAmount).toBeCloseTo(2500, 2);
    expect(rate21.TaxAmount).toBeCloseTo(525, 2);
    expect(rate21.TaxInclusiveAmount).toBeCloseTo(3025, 2);

    const rate15 = byRate.get(15)!;
    expect(rate15.TaxableAmount).toBeCloseTo(600, 2);
    expect(rate15.TaxAmount).toBeCloseTo(90, 2);

    const rate0 = byRate.get(0)!;
    expect(rate0.TaxableAmount).toBeCloseTo(300, 2);
    expect(rate0.TaxAmount).toBeCloseTo(0, 2);

    // Grand TaxTotal/TaxAmount is the sum across all rate brackets.
    expect(parsed.TaxTotal.TaxAmount).toBeCloseTo(615, 2);

    // LegalMonetaryTotal ties back to the same hand-computed grand totals.
    expect(parsed.LegalMonetaryTotal.TaxExclusiveAmount).toBeCloseTo(3400, 2);
    expect(parsed.LegalMonetaryTotal.TaxInclusiveAmount).toBeCloseTo(4015, 2);
    expect(parsed.LegalMonetaryTotal.PayableAmount).toBeCloseTo(4015, 2);
  });

  it('emits required-but-otherwise-unused advance-payment fields as zero on each TaxSubTotal and LegalMonetaryTotal', () => {
    const xml = generateIsdocXml(buildRealisticInvoice());
    const parser = new XMLParser();
    const parsed = parser.parse(xml).Invoice;

    const subTotals: any[] = Array.isArray(parsed.TaxTotal.TaxSubTotal) ? parsed.TaxTotal.TaxSubTotal : [parsed.TaxTotal.TaxSubTotal];
    for (const subTotal of subTotals) {
      expect(subTotal.AlreadyClaimedTaxableAmount).toBe(0);
      expect(subTotal.AlreadyClaimedTaxAmount).toBe(0);
      expect(subTotal.AlreadyClaimedTaxInclusiveAmount).toBe(0);
      expect(subTotal.DifferenceTaxableAmount).toBe(subTotal.TaxableAmount);
      expect(subTotal.DifferenceTaxAmount).toBe(subTotal.TaxAmount);
    }

    expect(parsed.LegalMonetaryTotal.AlreadyClaimedTaxExclusiveAmount).toBe(0);
    expect(parsed.LegalMonetaryTotal.AlreadyClaimedTaxInclusiveAmount).toBe(0);
    expect(parsed.LegalMonetaryTotal.PaidDepositsAmount).toBe(0);
  });

  it('escapes XML-reserved characters in free-text fields (description, party name, note)', () => {
    const xml = generateIsdocXml(
      buildRealisticInvoice({
        note: 'Ceny jsou uvedeny v Kč & jsou konečné <bez slevy>',
        lineItems: [
          {
            description: 'Licence "Pro" & <podpora> 24/7',
            quantity: 1,
            unitPriceWithoutVat: 1000,
            vatRate: 'base',
            vatRatePercent: 21,
          },
        ],
        totals: {
          totalWithoutVat: 1000,
          totalVat: 210,
          totalWithVat: 1210,
          vatRecapitulation: [{ vatRate: 'base', vatRatePercent: 21, totalWithoutVat: 1000, vatAmount: 210, totalWithVat: 1210 }],
        },
      }),
    );

    // The raw string must never contain a literal unescaped '&', '<' inside
    // text content (other than the tag markup itself and the XML/entity
    // escapes we expect) — validate this the same way a real XML parser
    // would: successful parse + round-tripped values match the originals.
    expect(XMLValidator.validate(xml)).toBe(true);
    expect(xml).toContain('Licence &quot;Pro&quot; &amp; &lt;podpora&gt; 24/7');
    expect(xml).toContain('Ceny jsou uvedeny v Kč &amp; jsou konečné &lt;bez slevy&gt;');

    const parser = new XMLParser();
    const parsed = parser.parse(xml).Invoice;
    expect(String(parsed.InvoiceLines.InvoiceLine.Item.Description)).toBe('Licence "Pro" & <podpora> 24/7');
    expect(String(parsed.Note)).toBe('Ceny jsou uvedeny v Kč & jsou konečné <bez slevy>');
  });

  it('escapeXml escapes all five XML-reserved characters', () => {
    expect(escapeXml(`& < > " '`)).toBe('&amp; &lt; &gt; &quot; &apos;');
  });

  it('throws a clear validation error for zero line items rather than emitting a malformed invoice', () => {
    expect(() => generateIsdocXml(buildRealisticInvoice({ lineItems: [] }))).toThrow(/at least one line item is required/);
  });

  it('throws when totals.vatRecapitulation is inconsistent with the line items', () => {
    const invoice = buildRealisticInvoice();
    invoice.totals = {
      ...invoice.totals,
      vatRecapitulation: invoice.totals.vatRecapitulation.map((entry) =>
        entry.vatRatePercent === 21 ? { ...entry, totalWithoutVat: 999999 } : entry,
      ),
    };

    expect(() => generateIsdocXml(invoice)).toThrow(/totals\.vatRecapitulation base for 21% VAT/);
  });

  it('throws when totals.totalWithVat does not equal totalWithoutVat + totalVat + roundingAmount', () => {
    const invoice = buildRealisticInvoice({
      totals: {
        totalWithoutVat: 3400,
        totalVat: 615,
        totalWithVat: 5000, // inconsistent on purpose
        vatRecapitulation: [
          { vatRate: 'base', vatRatePercent: 21, totalWithoutVat: 2500, vatAmount: 525, totalWithVat: 3025 },
          { vatRate: 'reduced', vatRatePercent: 15, totalWithoutVat: 600, vatAmount: 90, totalWithVat: 690 },
          { vatRate: 'zero', vatRatePercent: 0, totalWithoutVat: 300, vatAmount: 0, totalWithVat: 300 },
        ],
      },
    });

    expect(() => generateIsdocXml(invoice)).toThrow(/totals\.totalWithVat/);
  });

  it('builds the full bank-transfer PaymentMeans block when a complete domestic bank account is given', () => {
    const xml = generateIsdocXml(buildRealisticInvoice());

    // Parse with tag-value coercion disabled so the zero-padded bank code
    // ("0800") round-trips as a string rather than depending on the parser
    // library's leading-zero numeric-coercion heuristics.
    const parser = new XMLParser({ parseTagValue: false });
    const parsed = parser.parse(xml).Invoice;

    const payment = parsed.PaymentMeans.Payment;
    expect(payment.PaymentMeansCode).toBe('42');
    expect(payment.PaidAmount).toBe('4015.00');
    // The BankAccount xs:group has no element of its own — ID/BankCode/Name/
    // IBAN/BIC are inlined directly as children of <Details>.
    expect(payment.Details.ID).toBe('19-2000145399');
    expect(payment.Details.BankCode).toBe('0800');
    expect(payment.Details.Name).toBe('Česká spořitelna, a.s.');
    expect(payment.Details.IBAN).toBe('CZ6508000000192000145399');
    expect(payment.Details.BIC).toBe('GIBACZPX');
    expect(payment.Details.VariableSymbol).toBe('20240001');
  });

  it('omits PaymentMeans entirely when the bank account is incomplete (e.g. missing BIC)', () => {
    const xml = generateIsdocXml(
      buildRealisticInvoice({
        bankAccount: { accountNumber: '19-2000145399/0800', iban: 'CZ6508000000192000145399' },
      }),
    );

    expect(xml).not.toContain('<PaymentMeans>');
  });

  it('omits PaymentMeans entirely when no bank account is given at all', () => {
    const xml = generateIsdocXml(buildRealisticInvoice({ bankAccount: undefined }));
    expect(xml).not.toContain('<PaymentMeans>');
  });

  it('sets VATApplicable to false when the supplier is explicitly not a VAT payer', () => {
    const xml = generateIsdocXml(
      buildRealisticInvoice({
        supplier: { ...buildRealisticInvoice().supplier, isVatPayer: false },
      }),
    );
    expect(firstTag(xml, 'VATApplicable')).toBe('false');
  });

  it('falls back to a placeholder party ID when a foreign customer has no IČO', () => {
    const xml = generateIsdocXml(
      buildRealisticInvoice({
        customer: {
          legalName: 'Foreign Customer GmbH',
          dic: 'DE123456789',
          address: { street: 'Hauptstrasse', city: 'Berlin', postalCode: '10115', countryCode: 'DE' },
        },
      }),
    );
    const parser = new XMLParser();
    const parsed = parser.parse(xml).Invoice;
    // No IČO given, but a DIČ is -> falls back to the DIČ rather than a bare literal.
    expect(String(parsed.AccountingCustomerParty.Party.PartyIdentification.ID)).toBe('DE123456789');
    expect(String(parsed.AccountingCustomerParty.Party.PostalAddress.Country.IdentificationCode)).toBe('DE');
  });
});

describe('generateIsdocXml foreign currency', () => {
  it('writes CZK as local, the invoice currency as foreign and the real rate', () => {
    const xml = generateIsdocXml(buildRealisticInvoice({ currency: 'EUR', exchangeRate: 25 }));
    expect(firstTag(xml, 'LocalCurrencyCode')).toBe('CZK');
    expect(firstTag(xml, 'ForeignCurrencyCode')).toBe('EUR');
    expect(firstTag(xml, 'CurrRate')).toBe('25');
    const local = Number(firstTag(xml, 'PayableAmount'));
    const foreign = Number(firstTag(xml, 'PayableAmountCurr'));
    expect(local).toBeCloseTo(foreign * 25, 2);
    // Curr comes before the plain element in lines, after it in the totals.
    expect(xml.indexOf('<LineExtensionAmountCurr>')).toBeLessThan(xml.indexOf('<LineExtensionAmount>'));
    expect(xml.indexOf('<PayableAmount>')).toBeLessThan(xml.indexOf('<PayableAmountCurr>'));
  });

  it('keeps the invoice currency local without a rate or for the home currency', () => {
    for (const input of [{ currency: 'EUR' }, { currency: 'EUR', exchangeRate: 25, localCurrency: 'EUR' }]) {
      const xml = generateIsdocXml(buildRealisticInvoice(input));
      expect(firstTag(xml, 'LocalCurrencyCode')).toBe('EUR');
      expect(firstTag(xml, 'CurrRate')).toBe('1');
      expect(xml).not.toContain('Curr>');
    }
  });
});
