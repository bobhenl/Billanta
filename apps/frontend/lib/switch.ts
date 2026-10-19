import { brandName, marketOf, type BrandKey } from './competitors';

/**
 * The apps with a /switch/<key> guide. Every key is also a source of the
 * import wizard (Settings → Import), so `/settings/import?source=<key>`
 * opens the right export steps. Guides exist in every locale: a Czech
 * company may well come from KROS, a Slovak one from Vyfakturuj.
 */
export const SWITCH_BRANDS = ['fakturoid', 'idoklad', 'superfaktura', 'vyfakturuj', 'kros', 'billdu', 'bitfaktura'] as const satisfies readonly BrandKey[];
export type SwitchBrand = (typeof SWITCH_BRANDS)[number];

export const isSwitchBrand = (v: unknown): v is SwitchBrand => typeof v === 'string' && (SWITCH_BRANDS as readonly string[]).includes(v);

/** The apps people of this locale's market most often come from, first. */
const MARKET_ORDER: Record<ReturnType<typeof marketOf>, readonly SwitchBrand[]> = {
  cz: ['fakturoid', 'idoklad', 'superfaktura', 'vyfakturuj', 'bitfaktura', 'kros', 'billdu'],
  sk: ['superfaktura', 'kros', 'idoklad', 'billdu', 'fakturoid', 'vyfakturuj', 'bitfaktura']
};

export const switchBrandsFor = (locale: string) => MARKET_ORDER[marketOf(locale)].map((key) => ({ key, name: brandName(key, locale) }));

/**
 * The app a visitor said they are leaving: `?from=<key>` (the /switch
 * pages' signup link), kept 30 days so the welcome screen can offer that
 * app's import right after signup.
 */
export const SWITCH_COOKIE = 'billanta_switch_from';
