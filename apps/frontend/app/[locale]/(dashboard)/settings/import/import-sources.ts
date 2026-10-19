/** The apps the import wizard has export steps for (`settings.import.sources.<key>`); shared with the server page for `?source=`. */
export const SOURCES = ['fakturoid', 'idoklad', 'superfaktura', 'vyfakturuj', 'kros', 'billdu', 'bitfaktura', 'faktorio', 'invoiceNinja', 'excel'] as const;
export type Source = (typeof SOURCES)[number];
export const isSource = (v: unknown): v is Source => typeof v === 'string' && (SOURCES as readonly string[]).includes(v);
