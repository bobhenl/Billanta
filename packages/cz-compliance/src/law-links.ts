/**
 * Rule reference from the requirements check ("§29/1c ZDPH", "§435 OZ",
 * "§74/1 ZoDPH") → the law text. CZ: zakonyprolidi.cz (anchors p{§}-{odst}),
 * SK: slov-lex.sk (anchors paragraf-{§}.odsek-{odst}). Peppol rule ids and
 * anything else unknown → null (shown as plain text).
 */
const LAWS: Record<string, (p: string, odst?: string) => string> = {
  // Zákon č. 235/2004 Sb., o dani z přidané hodnoty
  ZDPH: (p, o) => `https://www.zakonyprolidi.cz/cs/2004-235#p${p}${o ? `-${o}` : ''}`,
  // Zákon č. 89/2012 Sb., občanský zákoník
  OZ: (p, o) => `https://www.zakonyprolidi.cz/cs/2012-89#p${p}${o ? `-${o}` : ''}`,
  // Zákon č. 222/2004 Z. z. o dani z pridanej hodnoty
  ZoDPH: (p, o) => `https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2004/222/#paragraf-${p}${o ? `.odsek-${o}` : ''}`,
  // Zákon č. 513/1991 Zb. Obchodný zákonník
  ObZ: (p, o) => `https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/1991/513/#paragraf-${p}${o ? `.odsek-${o}` : ''}`,
};

export function lawUrl(rule: string | null | undefined): string | null {
  // "§29/1c ZDPH" → § 29, odst. 1, (letter c is not anchored), law ZDPH.
  const m = /^§\s*(\d+[a-z]?)(?:\/(\d+)[a-z]?)?\s+(ZDPH|OZ|ZoDPH|ObZ)$/.exec((rule ?? '').trim());
  if (!m) return null;
  return LAWS[m[3]!]!(m[1]!, m[2]);
}
