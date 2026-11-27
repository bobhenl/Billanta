/**
 * Finanční úřady and územní pracoviště for EPO filings: VetaP `c_ufo` and
 * `c_pracufo` of DPHDP3 / DPHKH1 / DPHSHV, VetaD `c_ufo_cil` and VetaP
 * `c_pracufo` of DPFDP7. The XSDs make `c_ufo` required (dphdp3_epo2.xsd,
 * read 2026-11-27); without it EPO asks for the office on import.
 *
 * Static copy of the ADIS code lists "ufo" and "pracufo", offices still in
 * existence only (no d_zaniku), downloaded 2026-11-27 from
 * https://mojedane.gov.cz/mepo/pub/api/ciselniky/soubor/ufo and
 * https://mojedane.gov.cz/mepo/pub/api/ciselniky/soubor/pracufo
 * (described at https://mojedane.gov.cz/pmd/dokumentace/ciselniky/ukazka/ufo
 * and .../ukazka/pracufo). The list has not changed since the 2013 reform
 * (§ 13 zákona č. 456/2011 Sb., o Finanční správě ČR), but re-check it when
 * DATASET_CHECKED.vat_forms moves. Generalní finanční ředitelství (code 0)
 * is left out: no return is filed there.
 */

export interface CzTaxOffice {
  /** c_ufo */
  code: number;
  name: string;
}

export interface CzTaxWorkplace {
  /** c_pracufo */
  code: number;
  /** c_ufo of the office the workplace belongs to. */
  office: number;
  name: string;
}

export const CZ_TAX_OFFICES: readonly CzTaxOffice[] = [
  { code: 13, name: 'Specializovaný finanční úřad' },
  { code: 451, name: 'Finanční úřad pro hlavní město Prahu' },
  { code: 452, name: 'Finanční úřad pro Středočeský kraj' },
  { code: 453, name: 'Finanční úřad pro Jihočeský kraj' },
  { code: 454, name: 'Finanční úřad pro Plzeňský kraj' },
  { code: 455, name: 'Finanční úřad pro Karlovarský kraj' },
  { code: 456, name: 'Finanční úřad pro Ústecký kraj' },
  { code: 457, name: 'Finanční úřad pro Liberecký kraj' },
  { code: 458, name: 'Finanční úřad pro Královéhradecký kraj' },
  { code: 459, name: 'Finanční úřad pro Pardubický kraj' },
  { code: 460, name: 'Finanční úřad pro Kraj Vysočina' },
  { code: 461, name: 'Finanční úřad pro Jihomoravský kraj' },
  { code: 462, name: 'Finanční úřad pro Olomoucký kraj' },
  { code: 463, name: 'Finanční úřad pro Moravskoslezský kraj' },
  { code: 464, name: 'Finanční úřad pro Zlínský kraj' },
];

export const CZ_TAX_WORKPLACES: readonly CzTaxWorkplace[] = [
  { code: 2001, office: 451, name: 'Územní pracoviště pro Prahu 1' },
  { code: 2002, office: 451, name: 'Územní pracoviště pro Prahu 2' },
  { code: 2003, office: 451, name: 'Územní pracoviště pro Prahu 3' },
  { code: 2004, office: 451, name: 'Územní pracoviště pro Prahu 4' },
  { code: 2005, office: 451, name: 'Územní pracoviště pro Prahu 5' },
  { code: 2006, office: 451, name: 'Územní pracoviště pro Prahu 6' },
  { code: 2007, office: 451, name: 'Územní pracoviště pro Prahu 7' },
  { code: 2008, office: 451, name: 'Územní pracoviště pro Prahu 8' },
  { code: 2009, office: 451, name: 'Územní pracoviště pro Prahu 9' },
  { code: 2010, office: 451, name: 'Územní pracoviště pro Prahu 10' },
  { code: 2011, office: 451, name: 'Územní pracoviště pro Prahu - Jižní Město' },
  { code: 2012, office: 451, name: 'Územní pracoviště v Praze - Modřanech' },
  { code: 2101, office: 452, name: 'Územní pracoviště Praha-východ' },
  { code: 2102, office: 452, name: 'Územní pracoviště Praha-západ' },
  { code: 2103, office: 452, name: 'Územní pracoviště v Benešově' },
  { code: 2104, office: 452, name: 'Územní pracoviště v Berouně' },
  { code: 2105, office: 452, name: 'Územní pracoviště v Brandýse n.L.-Staré Bol.' },
  { code: 2106, office: 452, name: 'Územní pracoviště v Čáslavi' },
  { code: 2109, office: 452, name: 'Územní pracoviště v Hořovicích' },
  { code: 2110, office: 452, name: 'Územní pracoviště v Kladně' },
  { code: 2111, office: 452, name: 'Územní pracoviště v Kolíně' },
  { code: 2112, office: 452, name: 'Územní pracoviště v Kralupech nad Vltavou' },
  { code: 2113, office: 452, name: 'Územní pracoviště v Kutné Hoře' },
  { code: 2114, office: 452, name: 'Územní pracoviště v Mělníce' },
  { code: 2115, office: 452, name: 'Územní pracoviště v Mladé Boleslavi' },
  { code: 2118, office: 452, name: 'Územní pracoviště v Nymburku' },
  { code: 2119, office: 452, name: 'Územní pracoviště v Poděbradech' },
  { code: 2120, office: 452, name: 'Územní pracoviště v Příbrami' },
  { code: 2121, office: 452, name: 'Územní pracoviště v Rakovníku' },
  { code: 2122, office: 452, name: 'Územní pracoviště v Říčanech' },
  { code: 2124, office: 452, name: 'Územní pracoviště ve Slaném' },
  { code: 2125, office: 452, name: 'Územní pracoviště ve Vlašimi' },
  { code: 2201, office: 453, name: 'Územní pracoviště v Českých Budějovicích' },
  { code: 2203, office: 453, name: 'Územní pracoviště v Českém Krumlově' },
  { code: 2205, office: 453, name: 'Územní pracoviště v Jindřichově Hradci' },
  { code: 2208, office: 453, name: 'Územní pracoviště v Písku' },
  { code: 2209, office: 453, name: 'Územní pracoviště v Prachaticích' },
  { code: 2211, office: 453, name: 'Územní pracoviště ve Strakonicích' },
  { code: 2212, office: 453, name: 'Územní pracoviště v Táboře' },
  { code: 2301, office: 454, name: 'Územní pracoviště v Plzni' },
  { code: 2302, office: 454, name: 'Územní pracoviště Plzeň-sever' },
  { code: 2303, office: 454, name: 'Územní pracoviště Plzeň-jih' },
  { code: 2305, office: 454, name: 'Územní pracoviště v Domažlicích' },
  { code: 2308, office: 454, name: 'Územní pracoviště v Klatovech' },
  { code: 2312, office: 454, name: 'Územní pracoviště v Rokycanech' },
  { code: 2313, office: 454, name: 'Územní pracoviště v Tachově' },
  { code: 2401, office: 455, name: 'Územní pracoviště v Karlových Varech' },
  { code: 2403, office: 455, name: 'Územní pracoviště v Chebu' },
  { code: 2407, office: 455, name: 'Územní pracoviště v Sokolově' },
  { code: 2501, office: 456, name: 'Územní pracoviště v Ústí nad Labem' },
  { code: 2503, office: 456, name: 'Územní pracoviště v Děčíně' },
  { code: 2504, office: 456, name: 'Územní pracoviště v Chomutově' },
  { code: 2505, office: 456, name: 'Územní pracoviště v Kadani' },
  { code: 2507, office: 456, name: 'Územní pracoviště v Litoměřicích' },
  { code: 2509, office: 456, name: 'Územní pracoviště v Lounech' },
  { code: 2510, office: 456, name: 'Územní pracoviště v Mostě' },
  { code: 2512, office: 456, name: 'Územní pracoviště v Roudnici nad Labem' },
  { code: 2513, office: 456, name: 'Územní pracoviště v Rumburku' },
  { code: 2514, office: 456, name: 'Územní pracoviště v Teplicích' },
  { code: 2515, office: 456, name: 'Územní pracoviště v Žatci' },
  { code: 2601, office: 457, name: 'Územní pracoviště v Liberci' },
  { code: 2602, office: 457, name: 'Územní pracoviště v České Lípě' },
  { code: 2604, office: 457, name: 'Územní pracoviště v Jablonci nad Nisou' },
  { code: 2607, office: 457, name: 'Územní pracoviště v Semilech' },
  { code: 2609, office: 457, name: 'Územní pracoviště v Turnově' },
  { code: 2701, office: 458, name: 'Územní pracoviště v Hradci Králové' },
  { code: 2707, office: 458, name: 'Územní pracoviště v Jičíně' },
  { code: 2709, office: 458, name: 'Územní pracoviště v Náchodě' },
  { code: 2712, office: 458, name: 'Územní pracoviště v Rychnově nad Kněžnou' },
  { code: 2713, office: 458, name: 'Územní pracoviště v Trutnově' },
  { code: 2801, office: 459, name: 'Územní pracoviště v Pardubicích' },
  { code: 2804, office: 459, name: 'Územní pracoviště v Chrudimi' },
  { code: 2808, office: 459, name: 'Územní pracoviště ve Svitavách' },
  { code: 2809, office: 459, name: 'Územní pracoviště v Ústí nad Orlicí' },
  { code: 2810, office: 459, name: 'Územní pracoviště ve Vysokém Mýtě' },
  { code: 2811, office: 459, name: 'Územní pracoviště v Žamberku' },
  { code: 2901, office: 460, name: 'Územní pracoviště v Jihlavě' },
  { code: 2903, office: 460, name: 'Územní pracoviště v Havlíčkově Brodě' },
  { code: 2910, office: 460, name: 'Územní pracoviště v Pelhřimově' },
  { code: 2912, office: 460, name: 'Územní pracoviště v Třebíči' },
  { code: 2913, office: 460, name: 'Územní pracoviště ve Velkém Meziříčí' },
  { code: 2914, office: 460, name: 'Územní pracoviště ve Žďáru nad Sázavou' },
  { code: 3001, office: 461, name: 'Územní pracoviště Brno I' },
  { code: 3002, office: 461, name: 'Územní pracoviště Brno II' },
  { code: 3003, office: 461, name: 'Územní pracoviště Brno III' },
  { code: 3004, office: 461, name: 'Územní pracoviště Brno IV' },
  { code: 3005, office: 461, name: 'Územní pracoviště Brno-venkov' },
  { code: 3006, office: 461, name: 'Územní pracoviště v Blansku' },
  { code: 3007, office: 461, name: 'Územní pracoviště v Boskovicích' },
  { code: 3008, office: 461, name: 'Územní pracoviště v Břeclavi' },
  { code: 3010, office: 461, name: 'Územní pracoviště v Hodoníně' },
  { code: 3011, office: 461, name: 'Územní pracoviště v Hustopečích' },
  { code: 3013, office: 461, name: 'Územní pracoviště v Kyjově' },
  { code: 3018, office: 461, name: 'Územní pracoviště ve Veselí nad Moravou' },
  { code: 3019, office: 461, name: 'Územní pracoviště ve Vyškově' },
  { code: 3020, office: 461, name: 'Územní pracoviště ve Znojmě' },
  { code: 3101, office: 462, name: 'Územní pracoviště v Olomouci' },
  { code: 3102, office: 462, name: 'Územní pracoviště v Hranicích' },
  { code: 3103, office: 462, name: 'Územní pracoviště v Jeseníku' },
  { code: 3106, office: 462, name: 'Územní pracoviště v Prostějově' },
  { code: 3107, office: 462, name: 'Územní pracoviště v Přerově' },
  { code: 3108, office: 462, name: 'Územní pracoviště ve Šternberku' },
  { code: 3109, office: 462, name: 'Územní pracoviště v Šumperku' },
  { code: 3110, office: 462, name: 'Územní pracoviště v Zábřehu' },
  { code: 3201, office: 463, name: 'Územní pracoviště Ostrava I' },
  { code: 3202, office: 463, name: 'Územní pracoviště Ostrava II' },
  { code: 3203, office: 463, name: 'Územní pracoviště Ostrava III' },
  { code: 3205, office: 463, name: 'Územní pracoviště v Bruntále' },
  { code: 3207, office: 463, name: 'Územní pracoviště ve Frýdku-Místku' },
  { code: 3210, office: 463, name: 'Územní pracoviště v Havířově' },
  { code: 3212, office: 463, name: 'Územní pracoviště v Karviné' },
  { code: 3213, office: 463, name: 'Územní pracoviště v Kopřivnici' },
  { code: 3214, office: 463, name: 'Územní pracoviště v Krnově' },
  { code: 3215, office: 463, name: 'Územní pracoviště v Novém Jičíně' },
  { code: 3216, office: 463, name: 'Územní pracoviště v Opavě' },
  { code: 3218, office: 463, name: 'Územní pracoviště v Třinci' },
  { code: 3301, office: 464, name: 'Územní pracoviště ve Zlíně' },
  { code: 3304, office: 464, name: 'Územní pracoviště v Kroměříži' },
  { code: 3306, office: 464, name: 'Územní pracoviště v Otrokovicích' },
  { code: 3307, office: 464, name: 'Územní pracoviště v Rožnově pod Radhoštěm' },
  { code: 3308, office: 464, name: 'Územní pracoviště v Uherském Brodě' },
  { code: 3309, office: 464, name: 'Územní pracoviště v Uherském Hradišti' },
  { code: 3310, office: 464, name: 'Územní pracoviště ve Valašském Meziříčí' },
  { code: 3312, office: 464, name: 'Územní pracoviště ve Vsetíně' },
];

export function czTaxOffice(code: number | null | undefined): CzTaxOffice | null {
  return CZ_TAX_OFFICES.find((o) => o.code === code) ?? null;
}

export function czTaxWorkplace(code: number | null | undefined): CzTaxWorkplace | null {
  return CZ_TAX_WORKPLACES.find((w) => w.code === code) ?? null;
}

/** The workplaces of one office, for the second dropdown. */
export function czTaxWorkplacesOf(office: number | null | undefined): CzTaxWorkplace[] {
  return CZ_TAX_WORKPLACES.filter((w) => w.office === office);
}

/**
 * Whether the pair can go into a filing: a known office, and a workplace
 * (when given) that belongs to it. EPO rejects a pracoviště of another office.
 */
export function isValidCzTaxOfficePair(office: number | null | undefined, workplace: number | null | undefined): boolean {
  if (office == null) return workplace == null;
  if (!czTaxOffice(office)) return false;
  return workplace == null || czTaxWorkplace(workplace)?.office === office;
}