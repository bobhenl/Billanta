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
  // Zákon č. 563/1991 Sb., o účetnictví
  ZU: (p, o) => `https://www.zakonyprolidi.cz/cs/1991-563#p${p}${o ? `-${o}` : ''}`,
  // Zákon č. 99/1963 Sb., občanský soudní řád
  OSR: (p, o) => `https://www.zakonyprolidi.cz/cs/1963-99#p${p}${o ? `-${o}` : ''}`,
  // Nařízení vlády č. 351/2013 Sb. (výše úroku z prodlení a nákladů spojených s uplatněním pohledávky)
  NVU: (p, o) => `https://www.zakonyprolidi.cz/cs/2013-351#p${p}${o ? `-${o}` : ''}`,
  // Zákon č. 222/2004 Z. z. o dani z pridanej hodnoty
  ZoDPH: (p, o) => `https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2004/222/#paragraf-${p}${o ? `.odsek-${o}` : ''}`,
  // Zákon č. 513/1991 Zb. Obchodný zákonník
  ObZ: (p, o) => `https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/1991/513/#paragraf-${p}${o ? `.odsek-${o}` : ''}`,
  // Zákon č. 431/2002 Z. z. o účtovníctve
  ZoU: (p, o) => `https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2002/431/#paragraf-${p}${o ? `.odsek-${o}` : ''}`,
  // Nariadenie vlády č. 21/2013 Z. z. (výška úrokov z omeškania v obchodných vzťahoch)
  NVUO: (p, o) => `https://www.slov-lex.sk/pravne-predpisy/SK/ZZ/2013/21/#paragraf-${p}${o ? `.odsek-${o}` : ''}`,
};

export function lawUrl(rule: string | null | undefined): string | null {
  // "§29/1c ZDPH" → § 29, odst. 1, (letter c is not anchored), law ZDPH.
  const m = /^§\s*(\d+[a-z]?)(?:\/(\d+)[a-z]?)?\s+(ZDPH|OZ|ZU|OSR|NVU|ZoDPH|ObZ|ZoU|NVUO)$/.exec((rule ?? '').trim());
  if (!m) return null;
  return LAWS[m[3]!]!(m[1]!, m[2]);
}
