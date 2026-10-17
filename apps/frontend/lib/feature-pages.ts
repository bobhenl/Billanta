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

/**
 * Public feature landing pages (`/funkce/<slug>`). Each describes a feature
 * the app really has; the copy lives in `featurePages.items.<key>` and must
 * stay true to the product — no invented numbers or promises. Slugs are
 * Czech in every locale (same as `/faktury-pro`), so hreflang alternates
 * share one path.
 */
export const FEATURE_PAGES = [
  { slug: 'qr-platba', key: 'qr', icon: QrCode },
  { slug: 'vyhledani-firem-ares', key: 'registry', icon: Building2 },
  { slug: 'isdoc', key: 'isdoc', icon: FileText },
  { slug: 'kontrola-povinnych-udaju', key: 'requirements', icon: ShieldCheck },
  { slug: 'upominky', key: 'reminders', icon: BellRing },
  { slug: 'parovani-plateb', key: 'bankMatching', icon: Landmark },
  { slug: 'napojeni-na-fio-banku', key: 'bankSync', icon: RefreshCw },
  { slug: 'opakovane-faktury', key: 'recurring', icon: Repeat },
  { slug: 'castecne-uhrady', key: 'partialPayments', icon: Coins },
  { slug: 'faktura-hlasem', key: 'voice', icon: Mic },
  { slug: 'ai-predvyplneni-faktur', key: 'aiPrefill', icon: Sparkles },
  { slug: 'evidence-vydaju', key: 'expenses', icon: Receipt },
  { slug: 'evidence-casu', key: 'time', icon: Timer },
  { slug: 'dph-priznani-epo', key: 'vat', icon: FileCheck2 },
  { slug: 'export-pro-ucetni', key: 'accounting', icon: FileSpreadsheet },
  { slug: 'api-webhooky', key: 'integrations', icon: Webhook },
  { slug: 'nabidky-a-zalohove-faktury', key: 'quotes', icon: FileSignature },
  { slug: 'faktury-v-cizi-mene', key: 'currencies', icon: Globe2 },
  { slug: 'dvojjazycne-faktury', key: 'bilingual', icon: Languages },
  { slug: 'sablony-a-hromadna-fakturace', key: 'templates', icon: Files },
  { slug: 'platba-kartou', key: 'cardPayments', icon: CreditCard },
  { slug: 'vlastni-zpusoby-uhrady', key: 'paymentMethods', icon: Wallet },
  { slug: 'emaily-a-promenne', key: 'emails', icon: Mail },
  { slug: 'klientsky-portal', key: 'clientPortal', icon: UserCheck },
  { slug: 'verejny-profil-firmy', key: 'publicProfile', icon: Store },
  { slug: 'zalohovani-dat', key: 'backups', icon: Archive },
  { slug: 'tym-a-role', key: 'team', icon: Users },
  { slug: 'vice-firem', key: 'companies', icon: Building2 },
  { slug: 'prechod-z-jineho-systemu', key: 'migration', icon: FolderInput },
  { slug: 'odhad-dane-a-odvodu', key: 'taxEstimate', icon: Calculator },
  { slug: 'historie-zmen', key: 'auditLog', icon: History }
] as const satisfies readonly { slug: string; key: string; icon: ComponentType<{ className?: string }> }[];

export type FeaturePage = (typeof FEATURE_PAGES)[number];

export function getFeaturePage(slug: string): FeaturePage | undefined {
  return FEATURE_PAGES.find((f) => f.slug === slug);
}

/** A few neighbours for internal linking, wrapping around the list. */
export function relatedFeaturePages(slug: string, count = 3): FeaturePage[] {
  const i = FEATURE_PAGES.findIndex((f) => f.slug === slug);
  return Array.from({ length: count }, (_, n) => FEATURE_PAGES[(i + 1 + n) % FEATURE_PAGES.length]!);
}
