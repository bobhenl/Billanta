import { describe, expect, it } from 'vitest';
import { isKnownLawName, lawUrl } from '../law-links.js';

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

  it('returns null for Peppol ids, unknown laws and nothing', () => {
    expect(lawUrl('BR-CO-26')).toBeNull();
    expect(lawUrl('§1 XYZ')).toBeNull();
    expect(lawUrl(undefined)).toBeNull();
  });
});

describe('isKnownLawName', () => {
  it('accepts the laws in LAWS, written out or abbreviated, in cs/sk/en', () => {
    for (const name of [
      'ZDPH',
      'zákona o DPH',
      'zákona o dani z přidané hodnoty',
      'zákona o dani z pridanej hodnoty',
      'slovenského zákona o DPH',
      'českého zákona o DPH',
      'občanského zákoníku',
      'Obchodného zákonníka',
      'ObZ',
      'of the VAT Act',
      'the Civil Code'
    ]) {
      expect(isKnownLawName(`${name} a dále`), name).toBe(true);
    }
  });

  it('rejects laws without a link', () => {
    expect(isKnownLawName('daňového řádu')).toBe(false);
    expect(isKnownLawName('zákona o daních z příjmů')).toBe(false);
    expect(isKnownLawName('ZDP')).toBe(false);
    expect(isKnownLawName('zákoníku práce')).toBe(false);
  });
});
