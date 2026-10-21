import type { CompanyRegistry, Source } from '../types.js';

/**
 * Wykaz podatników VAT ("biała lista", art. 96b ustawy o VAT): name, address,
 * VAT status and the bank accounts a VAT payer reported, by NIP, REGON or
 * account. Paying more than PLN 15,000 to an account not on the list costs
 * the buyer the deduction in income tax and makes it jointly liable for VAT
 * (art. 117ba Ordynacji podatkowej). The API is free and needs no key but is
 * rate limited per day.
 */
export const PL_WHITE_LIST: CompanyRegistry = {
  name: 'Wykaz podatników VAT (biała lista)',
  url: 'https://www.podatki.gov.pl/wykaz-podatnikow-vat-wyszukiwarka',
  api: {
    url: 'https://wl-api.mf.gov.pl/',
    auth: 'none',
    notes: 'GET /api/search/nip/{nip}?date=YYYY-MM-DD; daily query limits; a flat file of hashed accounts is published every day',
  },
};

/** Registries beyond the white list; the contract holds a single `registry`. */
export const PL_OTHER_REGISTRIES: readonly CompanyRegistry[] = [
  {
    name: 'GUS REGON (BIR 1.1)',
    url: 'https://wyszukiwarkaregon.stat.gov.pl/',
    api: { url: 'https://api.stat.gov.pl/Home/RegonApi', auth: 'api_key', notes: 'SOAP; free key on request' },
  },
  {
    name: 'Krajowy Rejestr Sądowy (KRS)',
    url: 'https://ekrs.ms.gov.pl/',
    api: { url: 'https://api-krs.ms.gov.pl/', auth: 'none' },
  },
  {
    name: 'CEIDG (sole traders)',
    url: 'https://www.biznes.gov.pl/pl/wyszukiwarka-firm',
    api: { url: 'https://dane.biznes.gov.pl/', auth: 'api_key', notes: 'token on request' },
  },
];

/**
 * Exchange rates for VAT: art. 31a ust. 1 ustawy o VAT converts at the NBP
 * average rate (table A) of the last working day before the tax point; art.
 * 31a ust. 2a allows the ECB rate instead if the taxpayer chose it.
 */
export const PL_NBP_RATES: Source = {
  title: 'Narodowy Bank Polski – API kursów walut (tabela A)',
  url: 'https://api.nbp.pl/',
};

/** `https://api.nbp.pl/api/exchangerates/rates/a/eur/2026-10-20/?format=json` */
export function nbpRateUrl(currency: string, isoDate: string): string {
  return `https://api.nbp.pl/api/exchangerates/rates/a/${currency.toLowerCase()}/${isoDate}/?format=json`;
}
