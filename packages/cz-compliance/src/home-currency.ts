/**
 * The currency a company keeps its books and files its taxes in, decided by
 * the country it is registered in (its address in Settings), never by the
 * user's language: EUR in Slovakia, CZK in Czechia.
 */
export type HomeCurrency = 'CZK' | 'EUR';

export function homeCurrencyOf(country: string | null | undefined): HomeCurrency {
  return country?.toUpperCase() === 'SK' ? 'EUR' : 'CZK';
}
