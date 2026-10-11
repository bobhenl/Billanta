import { getLocale, getTranslations } from 'next-intl/server';
import { Banner } from '@/components/banner';
import { FilterField, filterFieldClass as field, FilterPanel } from '@/components/filter-panel';
import { InfoHint } from '@/components/info-hint';
import { apiFetch } from '@/lib/api-client';
import type { InvoiceRow } from '@/lib/invoice-ui';
import { ContactsList, type ContactRow } from './contacts-list';

const KINDS = ['company', 'person'] as const;
const YES_NO = ['yes', 'no'] as const;
const ACTIVITY = ['unpaid', 'active', 'none'] as const;

interface Filters {
  new?: string;
  kind?: string;
  starred?: string;
  vat?: string;
  ares?: string;
  email?: string;
  country?: string;
  activity?: string;
}
const PANEL_KEYS = ['kind', 'starred', 'vat', 'ares', 'email', 'country', 'activity'] as const;

const pick = <T extends string>(allowed: readonly T[], value?: string) => (allowed.includes(value as T) ? value : undefined);
const yes = (filter: string | undefined, value: boolean) => !filter || (filter === 'yes') === value;

/** Customers & suppliers with their invoicing stats; the filters live in the URL like on the other lists. */
export default async function ContactsPage(props: { searchParams: Promise<Filters> }) {
  const searchParams = await props.searchParams;
  const t = await getTranslations('contacts');
  const tDoc = await getTranslations('doc');
  const locale = await getLocale();
  const [contacts, invoices] = await Promise.all([
    apiFetch<Omit<ContactRow, 'stats'>[]>('/api/v1/contacts').catch(() => null),
    apiFetch<InvoiceRow[]>('/api/v1/invoices?type=invoice').catch(() => [] as InvoiceRow[])
  ]);

  const filters: Filters = {
    kind: pick(KINDS, searchParams.kind),
    starred: pick(YES_NO, searchParams.starred),
    vat: pick(YES_NO, searchParams.vat),
    ares: pick(YES_NO, searchParams.ares),
    email: pick(YES_NO, searchParams.email),
    country: /^[A-Z]{2}$/.test(searchParams.country ?? '') ? searchParams.country : undefined,
    activity: pick(ACTIVITY, searchParams.activity)
  };
  const active = PANEL_KEYS.filter((k) => filters[k]).length;

  // Per-customer stats from the issued invoices (drafts and cancelled ones don't count).
  const stats = new Map<string, ContactRow['stats']>();
  for (const inv of invoices) {
    if (!inv.contactId || inv.status === 'draft' || inv.status === 'cancelled') continue;
    const s = stats.get(inv.contactId) ?? {
      count: 0,
      revenueCzk: 0,
      unpaid: 0,
      lastIssue: null
    };
    s.count += 1;
    if (inv.currency === 'CZK') s.revenueCzk += Number(inv.total);
    if (inv.status !== 'paid') s.unpaid += 1;
    if (inv.issueDate && (!s.lastIssue || inv.issueDate > s.lastIssue)) s.lastIssue = inv.issueDate;
    stats.set(inv.contactId, s);
  }

  const all: ContactRow[] = (contacts ?? []).map((c) => ({
    ...c,
    stats: stats.get(c.id) ?? null
  }));
  const rows = all.filter(
    (c) =>
      (!filters.kind || (filters.kind === 'person') === Boolean(c.isPerson)) &&
      yes(filters.starred, c.isStarred) &&
      yes(filters.vat, c.isVatPayer === true) &&
      yes(filters.ares, Boolean(c.aresVerifiedAt)) &&
      yes(filters.email, Boolean(c.email)) &&
      (!filters.country || c.addressCountry === filters.country) &&
      (!filters.activity ||
        (filters.activity === 'unpaid' && (c.stats?.unpaid ?? 0) > 0) ||
        (filters.activity === 'active' && (c.stats?.count ?? 0) > 0) ||
        (filters.activity === 'none' && !c.stats))
  );
  const countries = [...new Set(all.map((c) => c.addressCountry).filter(Boolean))].sort();
  const yesNo = (name: keyof Filters, label: string, yesLabel = tDoc('filters.yes'), noLabel = tDoc('filters.no')) => (
    <FilterField label={label}>
      <select name={name} defaultValue={filters[name] ?? ''} className={field}>
        <option value="">{tDoc('filters.any')}</option>
        <option value="yes">{yesLabel}</option>
        <option value="no">{noLabel}</option>
      </select>
    </FilterField>
  );

  return (
    <div className="mx-auto max-w-4xl">
      <InfoHint hint={t('hint')}>
        <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
      </InfoHint>
      {contacts ? (
        <ContactsList
          initial={rows}
          filtered={active > 0}
          startCreating={searchParams.new === '1'}
          filters={
            <FilterPanel active={active} keep={{}} clearHref="/contacts">
              <FilterField label={t('filters.kind')}>
                <select name="kind" defaultValue={filters.kind ?? ''} className={field}>
                  <option value="">{tDoc('filters.any')}</option>
                  <option value="company">{t('editor.kindCompany')}</option>
                  <option value="person">{t('editor.kindPerson')}</option>
                </select>
              </FilterField>
              <FilterField
                label={
                  <InfoHint hint={t('filters.activityHint')}>
                    <span>{t('filters.activity')}</span>
                  </InfoHint>
                }
              >
                <select name="activity" defaultValue={filters.activity ?? ''} className={field}>
                  <option value="">{tDoc('filters.any')}</option>
                  {ACTIVITY.map((a) => (
                    <option key={a} value={a}>
                      {t(`filters.activityValue.${a}`)}
                    </option>
                  ))}
                </select>
              </FilterField>
              {yesNo('starred', t('filters.starred'))}
              {yesNo('vat', t('filters.vatPayer'))}
              {yesNo('ares', t('filters.ares'))}
              {yesNo('email', t('filters.email'))}
              {countries.length > 1 && (
                <FilterField label={t('filters.country')}>
                  <select name="country" defaultValue={filters.country ?? ''} className={field}>
                    <option value="">{tDoc('filters.any')}</option>
                    {countries.map((c) => (
                      <option key={c} value={c}>
                        {new Intl.DisplayNames([locale], { type: 'region' }).of(c) ?? c}
                      </option>
                    ))}
                  </select>
                </FilterField>
              )}
            </FilterPanel>
          }
        />
      ) : (
        <Banner tone="err" className="mt-6">
          {t('loadError')}
        </Banner>
      )}
    </div>
  );
}
