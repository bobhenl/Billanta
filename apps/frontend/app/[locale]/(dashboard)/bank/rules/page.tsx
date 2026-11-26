import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { Banner } from '@/components/banner';
import { apiFetch, ApiError, NoTenantError, NotSignedInError } from '@/lib/api-client';
import type { BankRule } from '@/lib/bank-rules';
import { canManage, fetchCanWrite, fetchMyRole } from '@/lib/tenant';
import type { BankConnection } from '../actions';
import { RulesManager, type RulePrefill } from './rules-manager';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('bankRules');
  return { title: t('title') };
}

/**
 * `GET /bank/rules` – what happens to payments no invoice matched. The row
 * menu on /bank links here with `?new=1&name=…&account=…&dir=in|out` to start
 * a rule from one payment, and the connection's edit form with
 * `?new=import&connection=…` to start an "only download" rule for it.
 */
export default async function BankRulesPage(props: {
  searchParams: Promise<{ new?: string; name?: string; account?: string; dir?: string; connection?: string }>;
}) {
  const searchParams = await props.searchParams;
  const t = await getTranslations('bankRules');
  const locale = await getLocale();
  const [canEdit, role] = await Promise.all([fetchCanWrite('bank'), fetchMyRole().catch(() => null)]);

  let rules: BankRule[];
  let contacts: { id: string; legalName: string }[];
  let connections: BankConnection[];
  try {
    [rules, contacts, connections] = await Promise.all([
      apiFetch<BankRule[]>('/api/v1/bank-reconciliation/rules'),
      canEdit ? apiFetch<{ id: string; legalName: string }[]>('/api/v1/contacts').catch(() => []) : Promise.resolve([]),
      // Names for the "only download" rules; the rest of the page works without them.
      apiFetch<BankConnection[]>('/api/v1/bank-reconciliation/connections').catch(() => [] as BankConnection[])
    ]);
  } catch (err) {
    if (err instanceof NotSignedInError) redirect({ href: '/login', locale });
    if (err instanceof NoTenantError) return <Banner tone="info" className="mt-6">{t('noTenant')}</Banner>;
    return (
      <Banner tone="err" title={t('loadError')} className="mt-6">
        <span className="font-mono text-xs">{err instanceof ApiError ? err.message : String(err)}</span>
      </Banner>
    );
  }

  const text = (v?: string) => v?.trim().slice(0, 200) || undefined;
  // Only PSD2 accounts are filtered on download (Fio, PayPal and Stripe are company accounts).
  const psd2 = connections
    .filter((c) => c.provider === 'enable_banking')
    .map((c) => ({ id: c.id, name: [c.label || c.bankName || 'Banka', c.currency].filter(Boolean).join(' · ') }));
  const prefill: RulePrefill | null = !canEdit
    ? null
    : searchParams.new === '1'
      ? {
          name: text(searchParams.name),
          account: text(searchParams.account),
          direction: searchParams.dir === 'in' || searchParams.dir === 'out' ? searchParams.dir : 'any'
        }
      : searchParams.new === 'import' && canManage(role)
        ? { direction: 'any', importFor: psd2.find((c) => c.id === searchParams.connection)?.id ?? '' }
        : null;

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/bank" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary">
        <ArrowLeft className="h-4 w-4" />
        {t('backToBank')}
      </Link>
      <RulesManager
        rules={rules}
        contacts={contacts.map((c) => ({ id: c.id, name: c.legalName })).sort((a, b) => a.name.localeCompare(b.name, locale))}
        connections={psd2}
        canManageImport={canManage(role)}
        prefill={prefill}
      />
    </div>
  );
}
