import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuzSubjectByIco, mapRuzUnit, pickRuzSubject, type RuzSubject } from '../ruz-client.js';

// Trimmed real answer for VOLKSWAGEN SLOVAKIA (uctovna-jednotka?id=388477).
const VW = {
  id: 388477,
  ico: '35757442',
  dic: '2020220862',
  nazovUJ: 'VOLKSWAGEN SLOVAKIA, a.s.',
  mesto: 'Bratislava - mestská časť Devínska Nová Ves',
  ulica: 'J. Jonáša 1',
  psc: '84302',
  datumPoslednejUpravy: '2026-07-03',
  datumZalozenia: '1998-12-07',
  pravnaForma: '121',
};

const subject = (over: Partial<RuzSubject>): RuzSubject => ({
  ico: '35757442', dic: null, name: 'X', street: null, city: null, postalCode: null, legalForm: null, terminatedAt: null, updatedAt: null, ...over,
});

describe('mapRuzUnit', () => {
  it('maps a live unit, DIČ included', () => {
    expect(mapRuzUnit(VW)).toEqual({
      ico: '35757442',
      dic: '2020220862',
      name: 'VOLKSWAGEN SLOVAKIA, a.s.',
      street: 'J. Jonáša 1',
      city: 'Bratislava - mestská časť Devínska Nová Ves',
      postalCode: '84302',
      legalForm: '121',
      terminatedAt: null,
      updatedAt: '2026-07-03',
    });
  });

  it('drops deleted units, pads short IČOs and ignores a malformed DIČ', () => {
    expect(mapRuzUnit({ id: 1067328, stav: 'ZMAZANÉ', datumPoslednejUpravy: '2024-05-31' })).toBeNull();
    expect(mapRuzUnit({ id: 2, stav: 'Neverejná', ico: '1', nazovUJ: 'A' })).toBeNull();
    const s = mapRuzUnit({ id: 3, ico: '151742', nazovUJ: 'Obec', dic: 'SK123', psc: '831 01' });
    expect([s?.ico, s?.dic, s?.postalCode]).toEqual(['00151742', null, '83101']);
  });
});

describe('pickRuzSubject', () => {
  it('prefers a live unit, then the most recently updated one, and only the asked IČO', () => {
    const old = subject({ name: 'Old', updatedAt: '2019-01-01' });
    const fresh = subject({ name: 'Fresh', updatedAt: '2026-07-03' });
    const gone = subject({ name: 'Gone', updatedAt: '2026-09-01', terminatedAt: '2026-08-01' });
    expect(pickRuzSubject([old, gone, fresh, null], '35757442')?.name).toBe('Fresh');
    expect(pickRuzSubject([gone], '35757442')?.name).toBe('Gone');
    expect(pickRuzSubject([subject({ ico: '11111111' })], '35757442')).toBeNull();
  });
});

describe('getRuzSubjectByIco', () => {
  afterEach(() => vi.unstubAllGlobals());

  const stubFetch = (answers: Record<string, unknown>) => {
    const fetch = vi.fn(async (url: string) => {
      const key = Object.keys(answers).find((k) => url.includes(k));
      return new Response(JSON.stringify(key ? answers[key] : {}), { status: key ? 200 : 404 });
    });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };

  it('lists the units of the IČO, then reads them', async () => {
    const fetch = stubFetch({ 'ico=35757442': { id: [388477, 1067328] }, 'id=388477': VW, 'id=1067328': { id: 1067328, stav: 'ZMAZANÉ' } });
    expect((await getRuzSubjectByIco('35757442'))?.dic).toBe('2020220862');
    expect(fetch.mock.calls[0]?.[0]).toContain('uctovne-jednotky?zmenene-od=2000-01-01&ico=35757442');
  });

  it('is null for an unknown or dissolved company and for a non-IČO', async () => {
    stubFetch({ 'ico=12345678': { id: [] }, 'ico=87654321': { id: [9] }, 'id=9': { ...VW, id: 9, ico: '87654321', datumZrusenia: '2025-01-01' } });
    expect(await getRuzSubjectByIco('12345678')).toBeNull();
    expect(await getRuzSubjectByIco('87654321')).toBeNull();
    expect(await getRuzSubjectByIco('abc')).toBeNull();
  });

  it('throws on an outage instead of answering "unknown"', async () => {
    stubFetch({});
    await expect(getRuzSubjectByIco('35757442')).rejects.toThrow(/RÚZ responded 404/);
  });
});
