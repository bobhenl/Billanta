import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EET_DEFAULT_ENVIRONMENT,
  EET_ENDPOINTS,
  EET_PATTERNS,
  eetMinSaleDate,
  eetSaleKey,
  formatEetAmount,
  formatEetDateTime,
  isAssignedIdJednotky,
  isRetryableEetError,
  isValidEic,
  validateEetSaleData,
} from '../eet-fields.js';
import { parseEetResponse } from '../eet-response.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'eet');

describe('EET patterns match the official XSD', () => {
  // Our anchored regexes must be the XSD patterns verbatim, so a change to
  // the schema file shows up here.
  const xsd = readFileSync(join(dir, 'EETXMLSchema.xsd'), 'utf8');
  const pattern = (type: string) => {
    const m = new RegExp(`name="${type}">[\\s\\S]*?<xs:pattern value="([^"]+)"`).exec(xsd);
    return m![1]!.replace(/&amp;/g, '&');
  };
  it.each([
    ['CZEICType', EET_PATTERNS.eic],
    ['IdEvidJednotkyType', EET_PATTERNS.idJednotky],
    ['dateTime', EET_PATTERNS.dateTime],
    ['CastkaType', EET_PATTERNS.amount],
    ['UUIDType', EET_PATTERNS.uuid],
    ['PokType', EET_PATTERNS.pok],
  ])('%s', (type, re) => {
    expect(re.source).toBe(`^${pattern(type)}$`.replace('[+\\-]', '[+-]'));
  });
  it('string20 / string25 allow the same characters', () => {
    expect(pattern('string20')).toBe('[0-9a-zA-Z\\.,:;/#\\-_ ]{1,20}');
    expect(pattern('string25')).toBe('[0-9a-zA-Z\\.,:;/#\\-_ ]{1,25}');
    expect(EET_PATTERNS.idPokl.test('24/A-6/Brno_2')).toBe(true);
    expect(EET_PATTERNS.idPokl.test('x'.repeat(21))).toBe(false);
    expect(EET_PATTERNS.poradCis.test('#135433c/11/2027')).toBe(true);
    expect(EET_PATTERNS.poradCis.test('x'.repeat(26))).toBe(false);
    expect(EET_PATTERNS.idPokl.test('Pokladna č.1')).toBe(false);
  });
});

describe('formatEetAmount (section 3.3.3.12)', () => {
  it.each([
    ['3264.5', '3264.50'],
    ['82', '82.00'],
    ['81.60', '81.60'],
    [82, '82.00'],
    ['0', '0.00'],
    ['-0', '0.00'],
    ['-0.00', '0.00'],
    ['-250', '-250.00'],
    ['-0.01', '-0.01'],
    ['0.005', '0.01'],
    ['0.004', '0.00'],
    ['-1.005', '-1.01'],
    ['99999999.99', '99999999.99'],
  ])('%s -> %s', (input, out) => {
    expect(formatEetAmount(input)).toBe(out);
    expect(EET_PATTERNS.amount.test(out)).toBe(true);
  });
  it('rejects 100 million and more, and non-numbers', () => {
    expect(() => formatEetAmount('100000000')).toThrow('amount_out_of_range');
    expect(() => formatEetAmount('-99999999.995')).toThrow('amount_out_of_range');
    expect(() => formatEetAmount('1e5')).toThrow('invalid_amount');
    expect(() => formatEetAmount(Number.NaN)).toThrow('invalid_amount');
  });
  it('the spec examples of bad formats do not match the pattern', () => {
    for (const bad of ['020.45', '-0.00', '.20', '1.2', '1,20']) expect(EET_PATTERNS.amount.test(bad)).toBe(false);
  });
});

describe('formatEetDateTime (section 3.3.3.2)', () => {
  it('winter time uses +01:00', () => {
    expect(formatEetDateTime(new Date('2027-01-09T03:25:28Z'))).toBe('2027-01-09T04:25:28+01:00');
  });
  it('summer time uses +02:00', () => {
    expect(formatEetDateTime(new Date('2027-06-09T03:25:28Z'))).toBe('2027-06-09T05:25:28+02:00');
  });
  it('switches at the DST change (last Sunday of March, 01:00 UTC)', () => {
    expect(formatEetDateTime(new Date('2027-03-28T00:59:59Z'))).toBe('2027-03-28T01:59:59+01:00');
    expect(formatEetDateTime(new Date('2027-03-28T01:00:00Z'))).toBe('2027-03-28T03:00:00+02:00');
  });
  it('drops milliseconds and crosses midnight and year end correctly', () => {
    expect(formatEetDateTime(new Date('2026-12-31T23:30:00.999Z'))).toBe('2027-01-01T00:30:00+01:00');
  });
});

describe('field checks', () => {
  it('EIČ: DIČ, CZ + rodné číslo, CZ + VČP', () => {
    expect(isValidEic('CZ00000019')).toBe(true);
    expect(isValidEic('CZ8551015704')).toBe(true);
    expect(isValidEic('CZ683555118')).toBe(true);
    expect(isValidEic('CZ1234567')).toBe(false);
    expect(isValidEic('SK2020202020')).toBe(false);
  });
  it('id_jednotky in the form DIS+ assigns (section 2.2.4 item 5)', () => {
    expect(isAssignedIdJednotky('181')).toBe(true);
    expect(isAssignedIdJednotky('22')).toBe(true);
    expect(isAssignedIdJednotky('1551')).toBe(true);
    expect(isAssignedIdJednotky('303')).toBe(true);
    expect(isAssignedIdJednotky('4')).toBe(false); // one digit
    expect(isAssignedIdJednotky('245')).toBe(false); // last digit 5
    expect(isAssignedIdJednotky('20')).toBe(false); // last digit 0
    expect(isAssignedIdJednotky('0123')).toBe(false); // leading zero fails the XSD
  });
  it('validateEetSaleData lists every broken field', () => {
    expect(
      validateEetSaleData({
        eicPopl: 'CZ00000019',
        idJednotky: '243',
        idPokl: '24/A-6/Brno_2',
        poradCis: '#135433c/11/2027',
        datTrzby: '2027-01-09T16:45:36+01:00',
        celkTrzba: '3264.50',
      }),
    ).toEqual([]);
    expect(
      validateEetSaleData({
        eicPopl: 'CZ1',
        idJednotky: '0',
        idPokl: '',
        poradCis: 'ř',
        datTrzby: '2027-01-09 16:45:36',
        celkTrzba: '1',
        cerpZuct: '-0.00',
      }),
    ).toEqual(['invalid_eic', 'invalid_id_jednotky', 'invalid_id_pokl', 'invalid_porad_cis', 'invalid_dat_trzby', 'invalid_celk_trzba', 'invalid_cerp_zuct']);
  });
});

describe('eetSaleKey (section 4)', () => {
  it('reproduces the example from the interface description', () => {
    expect(
      eetSaleKey({
        eicPopl: 'CZ00000019',
        idJednotky: '243',
        idPokl: '24/A-6/Brno_2',
        poradCis: '#135433c/11/2027',
        datTrzby: '2027-01-09T16:45:36+01:00',
        celkTrzba: '3264.50',
      }),
    ).toBe('CZ00000019|243|24/A-6/Brno_2|#135433c/11/2027|2027-01-09T16:45:36+01:00|3264.50');
  });
});

describe('environments', () => {
  it('defaults to the playground', () => {
    expect(EET_DEFAULT_ENVIRONMENT).toBe('playground');
    expect(EET_ENDPOINTS.playground).toBe('https://pg.trzbyeet.gov.cz/eet/services/EETServiceSOAP/v4');
  });
  it('minimum sale dates (section 2.2.4)', () => {
    expect(eetMinSaleDate('playground').toISOString()).toBe('2026-06-30T22:00:00.000Z');
    expect(eetMinSaleDate('production', new Date('2026-12-31T22:59:59Z')).toISOString()).toBe('2026-10-31T23:00:00.000Z');
    expect(eetMinSaleDate('production', new Date('2027-01-01T00:00:00+01:00')).toISOString()).toBe('2026-12-31T23:00:00.000Z');
  });
  it('only error -1 is retryable', () => {
    expect(isRetryableEetError(-1)).toBe(true);
    for (const c of [0, 2, 3, 4, 6, 7, 8]) expect(isRetryableEetError(c)).toBe(false);
  });
});

const envelope = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`;

describe('parseEetResponse (sections 3.4.3 and 3.5.3 examples)', () => {
  it('confirmation with warnings from the playground', () => {
    const r = parseEetResponse(
      envelope(`<tns:Odpoved xmlns:tns="http://fs.gov.cz/eet/schema/v4">
         <tns:Hlavicka uuid_zpravy="123e4567-e89b-42d3-a456-426655440000"
         dat_prij="2027-03-04T18:25:21+01:00" />
         <tns:Potvrzeni pok="987a6be5-6af5-44f3-b4fc-987654321000-ff"
         test="true" />
         <tns:Varovani kod_varov="1" >
                   EIC poplatnika v datove zprave se neshoduje s EIC
v certifikatu
         </tns:Varovani>
         <tns:Varovani kod_varov="2" >
                   Chybny format EIC poverujiciho poplatnika
         </tns:Varovani>
</tns:Odpoved>`),
    );
    expect(r).toEqual({
      kind: 'confirmed',
      pok: '987a6be5-6af5-44f3-b4fc-987654321000-ff',
      uuidZpravy: '123e4567-e89b-42d3-a456-426655440000',
      datPrij: '2027-03-04T18:25:21+01:00',
      test: true,
      warnings: [
        { code: 1, text: 'EIC poplatnika v datove zprave se neshoduje s EIC v certifikatu' },
        { code: 2, text: 'Chybny format EIC poverujiciho poplatnika' },
      ],
    });
  });

  it('production confirmation without the test flag', () => {
    const r = parseEetResponse(
      envelope(
        `<eet:Odpoved xmlns:eet="http://fs.gov.cz/eet/schema/v4"><eet:Hlavicka uuid_zpravy="123e4567-e89b-42d3-a456-426655440000" dat_prij="2027-03-04T18:25:21+01:00"/><eet:Potvrzeni pok="987a6be5-6af5-44f3-b4fc-987654321000-03"/></eet:Odpoved>`,
      ),
    );
    expect(r.kind === 'confirmed' && r.test).toBe(false);
  });

  it('temporary error -1 is retryable', () => {
    const r = parseEetResponse(
      envelope(`<tns:Odpoved xmlns:tns="http://fs.gov.cz/eet/schema/v4">
         <tns:Hlavicka dat_odmit="2027-03-04T18:25:21+01:00" />
         <tns:Chyba kod="-1">
                   Docasna technicka chyba zpracovani - odeslete prosim
                   datovou zpravu pozdeji
         </tns:Chyba>
</tns:Odpoved>`),
    );
    expect(r).toMatchObject({ kind: 'error', code: -1, retryable: true, datOdmit: '2027-03-04T18:25:21+01:00', uuidZpravy: null });
  });

  it('error 7 from the playground is not retryable', () => {
    const r = parseEetResponse(
      envelope(`<tns:Odpoved xmlns:tns="http://fs.gov.cz/eet/schema/v4"><tns:Hlavicka uuid_zpravy="123e4567-e89b-42d3-a456-426655440000" dat_odmit="2027-03-04T18:25:21+01:00" /><tns:Chyba kod="7" test="true" >
                   Datova zprava je prilis velka
         </tns:Chyba></tns:Odpoved>`),
    );
    expect(r).toMatchObject({ kind: 'error', code: 7, test: true, retryable: false, text: 'Datova zprava je prilis velka' });
  });

  it('verification mode answers with code 0 and its warnings', () => {
    const r = parseEetResponse(
      envelope(
        `<Odpoved xmlns="http://fs.gov.cz/eet/schema/v4"><Hlavicka dat_odmit="2027-03-04T18:25:21+01:00"/><Chyba kod="0" test="true">Datovou zpravu evidovane trzby v overovacim modu se podarilo zpracovat</Chyba><Varovani kod_varov="6">id_jednotky neodpovida formatem pridelenemu c. evidencni jednotky</Varovani></Odpoved>`,
      ),
    );
    expect(r).toMatchObject({ kind: 'error', code: 0, retryable: false, warnings: [{ code: 6 }] });
  });

  it('SOAP fault and garbage', () => {
    expect(
      parseEetResponse(envelope('<soapenv:Fault><faultcode>soapenv:Client</faultcode><faultstring>Bad &amp; wrong</faultstring></soapenv:Fault>')),
    ).toEqual({ kind: 'fault', faultCode: 'soapenv:Client', faultString: 'Bad & wrong' });
    expect(parseEetResponse('<html>502 Bad Gateway</html>')).toEqual({ kind: 'unparseable' });
    expect(parseEetResponse(envelope('<Odpoved><Hlavicka/><Potvrzeni pok="nope"/></Odpoved>'))).toEqual({ kind: 'unparseable' });
  });
});
