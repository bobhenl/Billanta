import type { ComponentType } from 'react';
import {
  Archive,
  BellRing,
  Building2,
  Calculator,
  Coins,
  CreditCard,
  FileCheck2,
  FileSignature,
  FileSpreadsheet,
  FileText,
  Files,
  FolderInput,
  Globe2,
  History,
  Landmark,
  Languages,
  Mail,
  Mic,
  QrCode,
  Receipt,
  RefreshCw,
  Repeat,
  ShieldCheck,
  Sparkles,
  Store,
  Timer,
  UserCheck,
  Users,
  Wallet,
  Webhook
} from 'lucide-react';
import type { DemoViewRole } from './demo';

/**
 * Public feature landing pages (`/features/<slug>`). Each describes a feature
 * the app really has; the copy lives in `featurePages.items.<key>` and must
 * stay true to the product — no invented numbers or promises. Slugs are
 * Czech in every locale (same as `/invoicing`), so hreflang alternates
 * share one path.
 */
export const FEATURE_PAGES = [
  { slug: 'qr-payments', key: 'qr', icon: QrCode },
  { slug: 'company-lookup-ares', key: 'registry', icon: Building2 },
  { slug: 'isdoc', key: 'isdoc', icon: FileText },
  { slug: 'required-fields-check', key: 'requirements', icon: ShieldCheck },
  { slug: 'payment-reminders', key: 'reminders', icon: BellRing },
  { slug: 'payment-matching', key: 'bankMatching', icon: Landmark },
  { slug: 'fio-bank-sync', key: 'bankSync', icon: RefreshCw },
  { slug: 'recurring-invoices', key: 'recurring', icon: Repeat },
  { slug: 'partial-payments', key: 'partialPayments', icon: Coins },
  { slug: 'voice-invoicing', key: 'voice', icon: Mic },
  { slug: 'ai-invoice-prefill', key: 'aiPrefill', icon: Sparkles },
  { slug: 'expense-tracking', key: 'expenses', icon: Receipt },
  { slug: 'time-tracking', key: 'time', icon: Timer },
  { slug: 'vat-returns-epo', key: 'vat', icon: FileCheck2 },
  { slug: 'accountant-export', key: 'accounting', icon: FileSpreadsheet },
  { slug: 'api-webhooks', key: 'integrations', icon: Webhook },
  { slug: 'quotes-and-proforma-invoices', key: 'quotes', icon: FileSignature },
  { slug: 'foreign-currency-invoices', key: 'currencies', icon: Globe2 },
  { slug: 'bilingual-invoices', key: 'bilingual', icon: Languages },
  { slug: 'templates-and-bulk-invoicing', key: 'templates', icon: Files },
  { slug: 'card-payments', key: 'cardPayments', icon: CreditCard },
  { slug: 'custom-payment-methods', key: 'paymentMethods', icon: Wallet },
  { slug: 'emails-and-variables', key: 'emails', icon: Mail },
  { slug: 'client-portal', key: 'clientPortal', icon: UserCheck },
  { slug: 'public-company-profile', key: 'publicProfile', icon: Store },
  { slug: 'data-backups', key: 'backups', icon: Archive },
  { slug: 'team-and-roles', key: 'team', icon: Users },
  { slug: 'multiple-companies', key: 'companies', icon: Building2 },
  { slug: 'switch-from-another-app', key: 'migration', icon: FolderInput },
  { slug: 'tax-estimate', key: 'taxEstimate', icon: Calculator },
  { slug: 'audit-log', key: 'auditLog', icon: History }
] as const satisfies readonly { slug: string; key: string; icon: ComponentType<{ className?: string }> }[];

export type FeaturePage = (typeof FEATURE_PAGES)[number];

/** Features the demo can't show: they need a real bank, card processor, phone, import file or a second company. */
const NOT_IN_DEMO: ReadonlySet<string> = new Set(['bankSync', 'cardPayments', 'voice', 'integrations', 'migration', 'backups', 'companies']);

/** Features best seen through a colleague's eyes in the demo (`/demo?view=`). */
const DEMO_VIEW: Readonly<Record<string, DemoViewRole>> = { accounting: 'accountant', vat: 'accountant', team: 'accountant' };

/** How the feature's page offers the demo, or null when the demo can't show it. */
export function featureDemo(key: string): { view: DemoViewRole } | null {
  return NOT_IN_DEMO.has(key) ? null : { view: DEMO_VIEW[key] ?? 'owner' };
}

export function getFeaturePage(slug: string): FeaturePage | undefined {
  return FEATURE_PAGES.find((f) => f.slug === slug);
}

/** A few neighbours for internal linking, wrapping around the list. */
export function relatedFeaturePages(slug: string, count = 3): FeaturePage[] {
  const i = FEATURE_PAGES.findIndex((f) => f.slug === slug);
  return Array.from({ length: count }, (_, n) => FEATURE_PAGES[(i + 1 + n) % FEATURE_PAGES.length]!);
}
