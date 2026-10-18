import { describe, expect, it } from 'vitest';
import { foldCompanyName, mapRpoResult, rankByName } from '../rpo-client.js';

describe('mapRpoResult', () => {
  it('takes the current name and address', () => {
    expect(
      mapRpoResult({
        id: 1,
        identifiers: [{ value: '35757442' }],
        fullNames: [
          { value: 'Old a.s.', validTo: '1999-10-14' },
          { value: 'VOLKSWAGEN SLOVAKIA, a.s.', validFrom: '1999-10-15' },
        ],
        addresses: [
          { validFrom: '1999-10-15', street: 'J. Jonáša', regNumber: 0, buildingNumber: '1', postalCodes: ['84302'], municipality: { value: 'Bratislava' } },
          { validTo: '1999-10-14', street: 'Old', postalCodes: ['84108'], municipality: { value: 'Bratislava' } },
        ],
      }),
    ).toEqual({
      ico: '35757442',
      name: 'VOLKSWAGEN SLOVAKIA, a.s.',
      street: 'J. Jonáša 1',
      city: 'Bratislava',
      postalCode: '84302',
      terminatedAt: null,
    });
  });

  it('formats súpisné/orientačné číslo and skips incomplete rows', () => {
    const s = mapRpoResult({
      id: 2,
      identifiers: [{ value: '123456' }],
      fullNames: [{ value: 'Malá s.r.o.' }],
      addresses: [{ street: 'Hlavná', regNumber: 120, buildingNumber: '5A', municipality: { value: 'Košice' } }],
    });
    expect(s?.ico).toBe('00123456');
    expect(s?.street).toBe('Hlavná 120/5A');
    expect(mapRpoResult({ id: 3, identifiers: [{ value: '1' }] })).toBeNull();
  });
});

describe('rankByName', () => {
  const hit = (ico: string, name: string) => ({ ico, name });

  it('puts names starting with the query first, then shorter ones, diacritics ignored', () => {
    const hits = [hit('1', 'Stavby Pošta s.r.o.'), hit('2', 'Pošta Plus s.r.o.'), hit('3', 'Slovenská pošta, a.s.'), hit('4', 'Pošta, a.s.')];
    expect(rankByName(hits, 'posta', 10).map((h) => h.ico)).toEqual(['4', '2', '1', '3']);
  });

  it('drops hits whose current name does not match, repeats of an IČO, and stops at the limit', () => {
    const hits = [hit('1', 'Kofola a.s.'), hit('1', 'Kofola a.s.'), hit('2', 'Former Name s.r.o.'), hit('3', 'Kofola Slovakia s.r.o.')];
    expect(rankByName(hits, 'KOFOLA', 10).map((h) => h.ico)).toEqual(['1', '3']);
    expect(rankByName(hits, 'kofola', 1).map((h) => h.ico)).toEqual(['1']);
    expect(rankByName(hits, '  ', 10)).toEqual([]);
  });

  it('folds case, diacritics and runs of spaces', () => {
    expect(foldCompanyName('  Žilinská   Teplárenská, a.s. ')).toBe('zilinska teplarenska, a.s.');
  });
});
