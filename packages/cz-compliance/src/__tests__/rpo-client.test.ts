import { describe, expect, it } from 'vitest';
import { mapRpoResult } from '../rpo-client.js';

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
