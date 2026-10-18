import { describe, expect, it } from 'vitest';
import { parseBucketListing, parseRpoBatchLine, planRpoSync, rpoBatchEntryOf } from '../rpo-batch.js';

// Shortened from batch-daily/actual_2026-10-17.json.gz.
const NAYRA =
  '{"id":520199,"identifiers":[{"value":"35693070","validFrom":"1997-05-06"}],"fullNames":[{"value":"GEO-TECHNIC-Consulting spol. s r.o.","validFrom":"1997-05-06","validTo":"2022-05-04"},{"value":"NAYRA s.r.o.","validFrom":"2022-05-05"}],"addresses":[{"validFrom":"2022-01-13","street":"Seberíniho","regNumber":0,"buildingNumber":"1","postalCodes":["82103"],"municipality":{"value":"Bratislava - mestská časť Ružinov"}},{"validFrom":"2008-06-25","validTo":"2022-01-12","street":"Parcelná","buildingNumber":"18","postalCodes":["82106"],"municipality":{"value":"Bratislava"}}],"legalForms":[{"value":{"code":"112","value":"Spoločnosť s ručením obmedzeným"},"validFrom":"1997-05-06"}],"establishment":"1996-06-10"}';

describe('parseRpoBatchLine', () => {
  it('reads a record with or without the separating comma', () => {
    expect(parseRpoBatchLine(NAYRA)?.id).toBe(520199);
    expect(parseRpoBatchLine(`,${NAYRA}`)?.id).toBe(520199);
    expect(parseRpoBatchLine(`  ,${NAYRA},\r`)?.id).toBe(520199);
  });

  it('skips the header and footer but not a record glued to them', () => {
    expect(parseRpoBatchLine('{"exportDate":"2026-10-17","results":[')).toBeNull();
    expect(parseRpoBatchLine(']}')).toBeNull();
    expect(parseRpoBatchLine('')).toBeNull();
    expect(parseRpoBatchLine(`{"exportDate":"2026-10-17","results":[${NAYRA}`)?.id).toBe(520199);
    expect(parseRpoBatchLine(`,${NAYRA}]}`)?.id).toBe(520199);
    expect(parseRpoBatchLine('{"id":7,"identifiers":[{"value":"1"}]}')?.id).toBe(7);
    expect(parseRpoBatchLine('{"id":"x"}')).toBeNull();
    expect(parseRpoBatchLine('{"id":1,')).toBeNull();
  });
});

describe('rpoBatchEntryOf', () => {
  it('turns an active subject into a compact index row', () => {
    expect(rpoBatchEntryOf(parseRpoBatchLine(NAYRA)!)).toEqual({
      kind: 'upsert',
      row: {
        rpoId: 520199,
        ico: '35693070',
        name: 'NAYRA s.r.o.',
        nameNorm: 'nayra s.r.o.',
        street: 'Seberíniho 1',
        city: 'Bratislava - mestská časť Ružinov',
        postalCode: '82103',
        legalForm: '112',
        establishedOn: '1996-06-10',
      },
    });
  });

  it('folds diacritics into nameNorm and tolerates a missing legal form or date', () => {
    const e = rpoBatchEntryOf({ id: 1, identifiers: [{ value: '36631124' }], fullNames: [{ value: 'Slovenská  pošta, a.s.' }], establishment: '2004' });
    expect(e.kind === 'upsert' && [e.row.nameNorm, e.row.legalForm, e.row.establishedOn]).toEqual(['slovenska posta, a.s.', null, null]);
  });

  it('removes dissolved subjects and records without an IČO or name', () => {
    expect(rpoBatchEntryOf({ ...parseRpoBatchLine(NAYRA)!, termination: '2026-10-17' })).toEqual({ kind: 'remove', rpoId: 520199 });
    expect(rpoBatchEntryOf({ id: 2, fullNames: [{ value: 'Bez IČO' }] })).toEqual({ kind: 'remove', rpoId: 2 });
  });

  it('leaves out subjects whose identifier is not an 8-digit IČO', () => {
    expect(rpoBatchEntryOf({ id: 3, identifiers: [{ value: '420012345678' }], fullNames: [{ value: 'Organizačná zložka' }] })).toEqual({ kind: 'remove', rpoId: 3 });
  });
});

const init = (date: string, n = 2, manifest = true) => [
  ...Array.from({ length: n }, (_, i) => `batch-init/init_${date}_00${i + 1}.json.gz`),
  ...(manifest ? [`batch-init/init_${date}_list.txt`] : []),
];
const daily = (...dates: string[]) => dates.map((d) => `batch-daily/actual_${d}.json.gz`);

describe('planRpoSync', () => {
  const keys = [...init('2026-09-05'), ...init('2026-10-03', 3), ...daily('2026-10-05', '2026-10-03', '2026-10-04', '2026-10-02')];

  it('starts an empty index from the newest finished snapshot plus the deltas after it', () => {
    const plan = planRpoSync(keys, { initDate: null, dailyDate: null });
    expect(plan.init).toEqual({ date: '2026-10-03', keys: init('2026-10-03', 3).slice(0, 3) });
    expect(plan.dailies.map((d) => d.date)).toEqual(['2026-10-04', '2026-10-05']);
  });

  it('applies only the new deltas when the snapshot is already loaded', () => {
    expect(planRpoSync(keys, { initDate: '2026-10-03', dailyDate: '2026-10-04' })).toEqual({
      init: null,
      dailies: [{ date: '2026-10-05', key: 'batch-daily/actual_2026-10-05.json.gz' }],
    });
    expect(planRpoSync(keys, { initDate: '2026-10-03', dailyDate: '2026-10-05' })).toEqual({ init: null, dailies: [] });
    expect(planRpoSync(keys, { initDate: '2026-10-03', dailyDate: null }).dailies.map((d) => d.date)).toEqual(['2026-10-04', '2026-10-05']);
  });

  it('reloads when a newer snapshot appears, and ignores one still uploading', () => {
    expect(planRpoSync(keys, { initDate: '2026-09-05', dailyDate: '2026-10-02' }).init?.date).toBe('2026-10-03');
    const uploading = [...keys, ...init('2026-11-07', 1, false)];
    expect(planRpoSync(uploading, { initDate: '2026-10-03', dailyDate: '2026-10-05' }).init).toBeNull();
  });

  it('reloads the snapshot when the deltas have a gap', () => {
    const later = [...init('2026-10-03'), ...daily('2026-10-20', '2026-10-21')];
    const plan = planRpoSync(later, { initDate: '2026-10-03', dailyDate: '2026-10-10' });
    expect(plan.init?.date).toBe('2026-10-03');
    expect(plan.dailies.map((d) => d.date)).toEqual(['2026-10-20', '2026-10-21']);
    // The day after the last applied one is there: no gap.
    expect(planRpoSync([...init('2026-10-03'), ...daily('2026-10-11', '2026-10-12')], { initDate: '2026-10-03', dailyDate: '2026-10-10' }).init).toBeNull();
  });

  it('has nothing to do without a finished snapshot', () => {
    expect(planRpoSync([...init('2026-10-03', 2, false), ...daily('2026-10-04')], { initDate: null, dailyDate: null })).toEqual({ init: null, dailies: [] });
  });
});

describe('parseBucketListing', () => {
  it('reads the keys and the continuation token', () => {
    const xml =
      '<ListBucketResult><IsTruncated>true</IsTruncated><Contents><Key>batch-init/init_2026-10-03_001.json.gz</Key><Size>1</Size></Contents>' +
      '<Contents><Key>batch-daily/actual_2026-10-17.json.gz</Key></Contents><NextContinuationToken>abc==</NextContinuationToken></ListBucketResult>';
    expect(parseBucketListing(xml)).toEqual({ keys: ['batch-init/init_2026-10-03_001.json.gz', 'batch-daily/actual_2026-10-17.json.gz'], next: 'abc==' });
    expect(parseBucketListing('<IsTruncated>false</IsTruncated><NextContinuationToken>x</NextContinuationToken>').next).toBeNull();
  });
});
