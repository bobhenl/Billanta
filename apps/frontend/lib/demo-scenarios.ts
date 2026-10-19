import type { DemoKind, DemoViewRole } from './demo';

export interface DemoScenario {
  /** The demo company for Czech law (cs and en). */
  kind: DemoKind;
  /** The one for Slovak law (sk), which the Slovak lesson copy is written around. */
  skKind: DemoKind;
  /** A key of BUSINESS_PRESETS. */
  preset: string;
  /** No documents yet ("start from scratch"). */
  empty: boolean;
  /** Dashboard path to land on instead of /dashboard, without the locale. */
  landing: string;
  view?: DemoViewRole;
}

/**
 * `/demo?scenario=<key>` from the school lessons (lib/school-lessons.ts):
 * the company the lesson's task is written for, and the page its first step
 * opens. Like `?for=` (lib/demo-audiences.ts) it only preselects the picker,
 * plus the landing page once the visitor starts that company. Only keys
 * from this list are accepted, on the page and in /api/demo/start.
 */
export const DEMO_SCENARIOS = {
  // "Moje první faktura": a firm with no documents; the first step creates a contact.
  firstInvoice: { kind: 'cz_freelancer', skKind: 'sk_vat_sro', preset: 'invoicingOnly', empty: true, landing: '/contacts' },
  invoices: { kind: 'cz_freelancer', skKind: 'sk_vat_sro', preset: 'invoicingOnly', empty: false, landing: '/invoices' },
  overdue: { kind: 'cz_freelancer', skKind: 'sk_vat_sro', preset: 'invoicingOnly', empty: false, landing: '/invoices?status=overdue' },
  registries: { kind: 'cz_freelancer', skKind: 'sk_vat_sro', preset: 'tradesman', empty: false, landing: '/invoices' },
  vatInvoices: { kind: 'cz_vat_sro', skKind: 'sk_vat_sro', preset: 'withAccountant', empty: false, landing: '/invoices' },
  vatOverdue: { kind: 'cz_vat_sro', skKind: 'sk_vat_sro', preset: 'withAccountant', empty: false, landing: '/invoices?status=overdue' },
  bank: { kind: 'cz_vat_sro', skKind: 'sk_vat_sro', preset: 'withAccountant', empty: false, landing: '/bank' },
  accountant: { kind: 'cz_vat_sro', skKind: 'sk_vat_sro', preset: 'withAccountant', empty: false, landing: '/bank', view: 'accountant' },
  flatTax: { kind: 'cz_pausal', skKind: 'cz_pausal', preset: 'flatTax', empty: false, landing: '/invoices' }
} as const satisfies Record<string, DemoScenario>;

export type DemoScenarioKey = keyof typeof DEMO_SCENARIOS;

export function demoScenario(value: unknown): DemoScenarioKey | null {
  return typeof value === 'string' && Object.hasOwn(DEMO_SCENARIOS, value) ? (value as DemoScenarioKey) : null;
}

/** The company a scenario starts with in this locale: Slovak law in sk, Czech law elsewhere. */
export function scenarioKind(key: DemoScenarioKey, locale: string): DemoKind {
  const s: DemoScenario = DEMO_SCENARIOS[key];
  return locale === 'sk' ? s.skKind : s.kind;
}
