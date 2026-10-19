import { describe, expect, it } from 'vitest';
import { lawUrl } from '../law-links.js';

describe('lawUrl', () => {
  it('links Czech rules to zakonyprolidi.cz, odstavec anchored, letter dropped', () => {
    expect(lawUrl('§29/1 ZDPH')).toBe('https://www.zakonyprolidi.cz/cs/2004-235#p29-1');
    expect(lawUrl('§29/1c ZDPH')).toBe('https://www.zakonyprolidi.cz/cs/2004-235#p29-1');
    expect(lawUrl('§29/4 ZDPH')).toBe('https://www.zakonyprolidi.cz/cs/2004-235#p29-4');
    expect(lawUrl('§435 OZ')).toBe('https://www.zakonyprolidi.cz/cs/2012-89#p435');
  });

  it('links Slovak rules to slov-lex.sk', () => {
    expect(lawUrl('§74/1 ZoDPH')).toBe('https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2004/222/#paragraf-74.odsek-1');
    expect(lawUrl('§74 ZoDPH')).toBe('https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2004/222/#paragraf-74');
    expect(lawUrl('§3a ObZ')).toBe('https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/1991/513/#paragraf-3a');
  });

  it('links the income tax acts and the Czech tax code', () => {
    expect(lawUrl('§2a ZDP')).toBe('https://www.zakonyprolidi.cz/cs/1992-586#p2a');
    expect(lawUrl('§7/7 ZDP')).toBe('https://www.zakonyprolidi.cz/cs/1992-586#p7-7');
    expect(lawUrl('§33 DR')).toBe('https://www.zakonyprolidi.cz/cs/2009-280#p33');
    expect(lawUrl('§6/10 ZoDP')).toBe('https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2003/595/#paragraf-6.odsek-10');
  });

  it('returns null for Peppol ids, unknown laws and nothing', () => {
    expect(lawUrl('BR-CO-26')).toBeNull();
    expect(lawUrl('§1 XYZ')).toBeNull();
    expect(lawUrl(undefined)).toBeNull();
  });
});
