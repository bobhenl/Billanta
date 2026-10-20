import type { AppModule } from './access';

/** Modules a company can switch on/off in Settings → Modules (recurring has no dashboard UI yet). */
export const TOGGLEABLE_MODULES = ['expenses', 'bank', 'quotes', 'time', 'reports', 'ai'] as const satisfies readonly AppModule[];
export type ToggleableModule = (typeof TOGGLEABLE_MODULES)[number];
export type ModuleSet = Record<ToggleableModule, boolean>;

export interface BusinessPreset {
  key: string;
  modules: ModuleSet;
}

/**
 * Starting points per kind of business: the app shows only what that kind of
 * company typically uses. Everything stays switchable one by one afterwards.
 */
export const BUSINESS_PRESETS: BusinessPreset[] = [
  { key: 'invoicingOnly', modules: { expenses: false, bank: false, quotes: false, time: false, reports: false, ai: false } },
  { key: 'flatTax', modules: { expenses: false, bank: true, quotes: true, time: true, reports: false, ai: true } },
  { key: 'tradesman', modules: { expenses: true, bank: true, quotes: true, time: true, reports: false, ai: true } },
  { key: 'withAccountant', modules: { expenses: true, bank: true, quotes: true, time: true, reports: true, ai: true } },
  { key: 'eshop', modules: { expenses: true, bank: true, quotes: false, time: false, reports: true, ai: false } }
];

export const sameModules = (a: ModuleSet, b: ModuleSet) => TOGGLEABLE_MODULES.every((m) => a[m] === b[m]);

export function presetForModules(modules: ModuleSet): string | null {
  return BUSINESS_PRESETS.find((p) => sameModules(p.modules, modules))?.key ?? null;
}

/**
 * Trades of the business directory (/directory): what a listed company
 * does, picked by the owner in Settings → Public profile. Not the presets
 * above (those are module bundles), though tradesman and eshop share their
 * keys. Same list as DIRECTORY_TRADES in apps/backend/src/tenants/public-profile.ts.
 */
export const DIRECTORY_TRADES = [
  'tradesman', 'construction', 'it', 'design', 'marketing', 'photo', 'consulting', 'education',
  'beauty', 'health', 'transport', 'gastro', 'eshop', 'cleaning', 'other'
] as const;
export type DirectoryTrade = (typeof DIRECTORY_TRADES)[number];

export const isDirectoryTrade = (v: string | null | undefined): v is DirectoryTrade => (DIRECTORY_TRADES as readonly string[]).includes(v ?? '');
