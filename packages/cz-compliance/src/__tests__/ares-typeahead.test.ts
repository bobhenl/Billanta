import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchSubjectsTypeahead, type AresPoolCache, type AresSubject } from '../ares-client.js';

const POOL: AresSubject[] = [
  { ico: '1', obchodniJmeno: 'Krušovická pekárna a cukrárna s.r.o.' },
  { ico: '2', obchodniJmeno: 'PEKÁRNA KRÁL s.r.o.' },
  { ico: '3', obchodniJmeno: 'Pekárna Zlín s.r.o.' },
];

/** ARES stub: whole-word "pekárna" knows the pool, anything with an unfinished word knows nothing. */
function stubAres() {
  const bodies: { obchodniJmeno: string; pocet: number }[] = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { obchodniJmeno: string; pocet: number };
    bodies.push(body);
    const subjects = body.obchodniJmeno === 'pekárna' ? POOL : [];
    return new Response(JSON.stringify({ ekonomickeSubjekty: subjects, pocetCelkem: subjects.length }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return bodies;
}

function memoryPool(): AresPoolCache & { map: Map<string, AresSubject[]> } {
  const map = new Map<string, AresSubject[]>();
  return { map, get: (k) => map.get(k), set: (k, v) => void map.set(k, v) };
}

describe('searchSubjectsTypeahead', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('completes an unfinished last word from the whole pool of the finished ones', async () => {
    const bodies = stubAres();
    const hits = await searchSubjectsTypeahead('pekárna kr', { limit: 6 });
    expect(hits.map((h) => h.ico)).toEqual(['1', '2']);
    expect(bodies).toEqual([
      { obchodniJmeno: 'pekárna kr', pocet: 6, start: 0 },
      { obchodniJmeno: 'pekárna', pocet: 1000, start: 0 },
    ]);
  });

  it('downloads the pool once while the last word grows', async () => {
    const bodies = stubAres();
    const pool = memoryPool();
    await searchSubjectsTypeahead('pekárna kr', { limit: 6, pool });
    const hits = await searchSubjectsTypeahead('Pekárna krá', { limit: 6, pool });
    expect(hits.map((h) => h.ico)).toEqual(['2']);
    expect(bodies.filter((b) => b.pocet === 1000)).toHaveLength(1);
    expect([...pool.map.keys()]).toEqual(['pekarna']);
  });
});
