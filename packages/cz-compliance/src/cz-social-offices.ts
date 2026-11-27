/**
 * Offices an OSVČ sends the yearly přehledy to: the příslušná OSSZ / PSSZ
 * (§ 15 zákona č. 589/1992 Sb., by place of residence) and the zdravotní
 * pojišťovna the person is registered with (§ 24 zákona č. 592/1992 Sb.).
 *
 * Static copies of two ČSSZ code lists published at
 * https://www.cssz.gov.cz/web/cz/ciselniky, downloaded 2026-11-27:
 * - C_COKR, e-podání edition of 2022-08-25:
 *   https://www.cssz.gov.cz/documents/20143/179422/C_COKR_e-pod%C3%A1n%C3%AD_20220825.xlsx/46264587-08c2-27ec-d714-e617bf61f87c
 *   Code 101 (ústředí) is left out because the list says not to use it for
 *   e-podání. The code is what the ČSSZ přehled carries as `dep`.
 * - C_ZPOJ:
 *   https://www.cssz.gov.cz/documents/20143/179422/C_ZPOJ.pdf/19e67942-68f1-3ba3-7eb1-e79471715efb
 *   Only insurers without an end date. 300 (samoplátce) and 999 (ostatní)
 *   are left out: nobody is registered with them.
 */

export interface CzSocialOffice {
  /** ČSSZ office code (C_COKR). */
  code: number;
  name: string;
}

export interface CzHealthInsurer {
  /** Three-digit insurer code (C_ZPOJ). */
  code: string;
  name: string;
}

export const CZ_SOCIAL_OFFICES: readonly CzSocialOffice[] = [
  { code: 110, name: 'PSSZ Praha 10' },
  { code: 111, name: 'PSSZ Praha 1' },
  { code: 112, name: 'PSSZ Praha 2' },
  { code: 113, name: 'PSSZ Praha 3' },
  { code: 114, name: 'PSSZ Praha 4' },
  { code: 115, name: 'PSSZ Praha 5' },
  { code: 116, name: 'PSSZ Praha 6' },
  { code: 117, name: 'PSSZ Praha 7' },
  { code: 118, name: 'PSSZ Praha 8' },
  { code: 119, name: 'PSSZ Praha 9' },
  { code: 121, name: 'PSSZ Praha 5 – Jihozápadní Město' },
  { code: 122, name: 'PSSZ Praha 4 – Modřany' },
  { code: 123, name: 'PSSZ Praha 4 – Jižní Město' },
  { code: 220, name: 'OSSZ Benešov' },
  { code: 221, name: 'OSSZ Beroun' },
  { code: 222, name: 'OSSZ Kladno' },
  { code: 223, name: 'OSSZ Kolín' },
  { code: 224, name: 'OSSZ Kutná Hora' },
  { code: 225, name: 'OSSZ Mělník' },
  { code: 226, name: 'OSSZ Mladá Boleslav' },
  { code: 227, name: 'OSSZ Nymburk' },
  { code: 228, name: 'OSSZ Praha-východ' },
  { code: 229, name: 'OSSZ Praha-západ' },
  { code: 230, name: 'OSSZ Příbram' },
  { code: 231, name: 'OSSZ Rakovník' },
  { code: 332, name: 'OSSZ České Budějovice' },
  { code: 333, name: 'OSSZ Český Krumlov' },
  { code: 334, name: 'OSSZ Jindřichův Hradec' },
  { code: 335, name: 'OSSZ Pelhřimov' },
  { code: 336, name: 'OSSZ Písek' },
  { code: 337, name: 'OSSZ Prachatice' },
  { code: 338, name: 'OSSZ Strakonice' },
  { code: 339, name: 'OSSZ Tábor' },
  { code: 440, name: 'OSSZ Domažlice' },
  { code: 441, name: 'OSSZ Cheb' },
  { code: 442, name: 'OSSZ Karlovy Vary' },
  { code: 443, name: 'OSSZ Klatovy' },
  { code: 444, name: 'OSSZ Plzeň-město' },
  { code: 445, name: 'OSSZ Plzeň-jih' },
  { code: 446, name: 'OSSZ Plzeň-sever' },
  { code: 447, name: 'OSSZ Rokycany' },
  { code: 448, name: 'OSSZ Sokolov' },
  { code: 449, name: 'OSSZ Tachov' },
  { code: 550, name: 'OSSZ Česká Lípa' },
  { code: 551, name: 'OSSZ Děčín' },
  { code: 552, name: 'OSSZ Chomutov' },
  { code: 553, name: 'OSSZ Jablonec nad Nisou' },
  { code: 554, name: 'OSSZ Liberec' },
  { code: 555, name: 'OSSZ Litoměřice' },
  { code: 556, name: 'OSSZ Louny' },
  { code: 557, name: 'OSSZ Most' },
  { code: 558, name: 'OSSZ Teplice' },
  { code: 559, name: 'OSSZ Ústí nad Labem' },
  { code: 660, name: 'OSSZ Havlíčkův Brod' },
  { code: 661, name: 'OSSZ Hradec Králové' },
  { code: 662, name: 'OSSZ Chrudim' },
  { code: 663, name: 'OSSZ Jičín' },
  { code: 664, name: 'OSSZ Náchod' },
  { code: 665, name: 'OSSZ Pardubice' },
  { code: 666, name: 'OSSZ Rychnov nad Kněžnou' },
  { code: 667, name: 'OSSZ Semily' },
  { code: 668, name: 'OSSZ Svitavy' },
  { code: 669, name: 'OSSZ Trutnov' },
  { code: 670, name: 'OSSZ Ústí nad Orlicí' },
  { code: 771, name: 'OSSZ Blansko' },
  { code: 772, name: 'MSSZ Brno' },
  { code: 773, name: 'OSSZ Brno-venkov' },
  { code: 774, name: 'OSSZ Břeclav' },
  { code: 775, name: 'OSSZ Zlín' },
  { code: 776, name: 'OSSZ Hodonín' },
  { code: 777, name: 'OSSZ Jihlava' },
  { code: 778, name: 'OSSZ Kroměříž' },
  { code: 779, name: 'OSSZ Prostějov' },
  { code: 780, name: 'OSSZ Třebíč' },
  { code: 781, name: 'OSSZ Uherské Hradiště' },
  { code: 782, name: 'OSSZ Vyškov' },
  { code: 783, name: 'OSSZ Znojmo' },
  { code: 784, name: 'OSSZ Žďár nad Sázavou' },
  { code: 884, name: 'OSSZ Jeseník' },
  { code: 885, name: 'OSSZ Bruntál' },
  { code: 886, name: 'OSSZ Frýdek-Místek' },
  { code: 887, name: 'OSSZ Karviná' },
  { code: 888, name: 'OSSZ Nový Jičín' },
  { code: 889, name: 'OSSZ Olomouc' },
  { code: 890, name: 'OSSZ Opava' },
  { code: 891, name: 'OSSZ Ostrava' },
  { code: 892, name: 'OSSZ Přerov' },
  { code: 893, name: 'OSSZ Šumperk' },
  { code: 894, name: 'OSSZ Vsetín' },
];

export const CZ_HEALTH_INSURERS: readonly CzHealthInsurer[] = [
  { code: '111', name: 'Všeobecná zdravotní pojišťovna ČR' },
  { code: '201', name: 'Vojenská zdravotní pojišťovna ČR' },
  { code: '205', name: 'Česká průmyslová zdravotní pojišťovna' },
  { code: '207', name: 'Oborová zdravotní pojišťovna zaměstnanců bank, pojišťoven a stavebnictví' },
  { code: '209', name: 'Zaměstnanecká pojišťovna ŠKODA' },
  { code: '211', name: 'Zdravotní pojišťovna Ministerstva vnitra ČR' },
  { code: '213', name: 'Revírní bratrská pokladna, zdravotní pojišťovna' },
];

export function czSocialOffice(code: number | null | undefined): CzSocialOffice | null {
  return CZ_SOCIAL_OFFICES.find((o) => o.code === code) ?? null;
}

export function czHealthInsurer(code: string | null | undefined): CzHealthInsurer | null {
  return CZ_HEALTH_INSURERS.find((i) => i.code === code) ?? null;
}
