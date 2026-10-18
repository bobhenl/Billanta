'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Typeahead } from '@/components/typeahead';
import type { CompanyHit } from '@/lib/company-lookup';

/**
 * Company name search over the public registers ("Načíst z registru"): type
 * a name, IČO or VAT number and pick a company; every hit shows name, IČO and
 * city. Where the hits come from is up to the page (`fetchHits`): a server
 * action in the dashboard, `fetchPublicCompanyHits` on public pages without
 * a session, or a link-scoped route like the buyer-details page.
 */
export function CompanyLookup({
  value,
  onChange,
  onPick,
  fetchHits,
  refreshKey,
  placeholder,
  ariaLabel,
  inputClassName,
  className,
  emptyHint
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (hit: CompanyHit) => void;
  fetchHits: (query: string) => Promise<CompanyHit[]>;
  /** E.g. the form's country: changing it re-runs the search for the current text. */
  refreshKey?: string;
  placeholder?: string;
  ariaLabel?: string;
  inputClassName?: string;
  className?: string;
  emptyHint?: ReactNode;
}) {
  const t = useTranslations('companyLookup');
  return (
    <Typeahead<CompanyHit>
      value={value}
      onChange={onChange}
      onPick={onPick}
      fetchGroups={async (q) => {
        const items = await fetchHits(q);
        return items.length ? [{ label: t('group'), items }] : [];
      }}
      refreshKey={refreshKey}
      getKey={(hit) => `${hit.source ?? ''}:${hit.ico ?? hit.dic ?? hit.regNumber ?? hit.name}`}
      renderItem={(hit) => <CompanyHitRow hit={hit} />}
      placeholder={placeholder ?? t('placeholder')}
      ariaLabel={ariaLabel ?? t('placeholder')}
      inputClassName={inputClassName}
      className={className}
      emptyHint={emptyHint ?? t('empty')}
    />
  );
}

/** Name on the first line; IČO (or VAT / registration number), city and register underneath. */
export function CompanyHitRow({ hit }: { hit: CompanyHit }) {
  const t = useTranslations('companyLookup');
  const id = hit.ico ? `${t('ico')} ${hit.ico}` : hit.dic ? hit.dic : hit.regNumber ?? null;
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium">{hit.name}</span>
      <span className="truncate text-xs text-muted-foreground">{[id, hit.city, hit.source].filter(Boolean).join(' · ')}</span>
    </span>
  );
}

/**
 * Hits from the public lookup (`/api/public/company-lookup`, no session,
 * rate-limited per visitor). Never throws.
 */
export async function fetchPublicCompanyHits(query: string, country?: string | null): Promise<CompanyHit[]> {
  const params = new URLSearchParams({ q: query.trim().slice(0, 120) });
  if (country) params.set('country', country);
  try {
    const res = await fetch(`/api/public/company-lookup?${params}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { hits?: CompanyHit[] };
    return data.hits ?? [];
  } catch {
    return [];
  }
}
