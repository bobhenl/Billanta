'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { CompanyRegistry } from '@/components/registry-picker';
import { Typeahead } from '@/components/typeahead';
import { hasSlowRegistryPart, type CompanyHit, type RegistryPart } from '@/lib/company-lookup';
import type { AresPrefill, Contact } from '@/app/[locale]/(dashboard)/invoices/new/types';

/**
 * Company name search over the public registers ("Načíst z registru"): type
 * a name, IČO or VAT number and pick a company; every hit shows name, IČO and
 * city. Where the hits come from is up to the page (`fetchHits`):
 * `fetchRegistryHits` in the dashboard, `fetchPublicCompanyHits` on public
 * pages without a session, or a link-scoped route like the buyer-details page.
 * It asks for the fast half (ARES) and the slow half (RPO by name) separately,
 * so Czech hits show at once and Slovak ones are appended.
 */
export function CompanyLookup({
  value,
  onChange,
  onPick,
  fetchHits,
  registry = 'auto',
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
  fetchHits: (query: string, part: RegistryPart) => Promise<CompanyHit[]>;
  /** The register asked; only "auto" and "EU" have a slow half. */
  registry?: CompanyRegistry;
  /** E.g. the form's country: changing it re-runs the search for the current text. */
  refreshKey?: string;
  placeholder?: string;
  ariaLabel?: string;
  inputClassName?: string;
  className?: string;
  emptyHint?: ReactNode;
}) {
  const t = useTranslations('companyLookup');
  const group = async (q: string, part: RegistryPart) => {
    const items = await fetchHits(q, part);
    return items.length ? [{ label: t('group'), items }] : [];
  };
  return (
    <Typeahead<CompanyHit>
      value={value}
      onChange={onChange}
      onPick={onPick}
      fetchGroups={(q) => group(q, 'fast')}
      fetchMoreGroups={async (q) => (hasSlowRegistryPart(q, registry) ? group(q, 'slow') : [])}
      moreLoadingHint={t('searchingSlovak')}
      refreshKey={`${registry}:${refreshKey ?? ''}`}
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
 * Signed-in search (`/api/contacts/search`, the contacts API with its shared
 * register cache): own contacts plus one half of the register search. Never
 * throws; an outage means no hits.
 */
export async function fetchContactSearch(
  query: string,
  registry: CompanyRegistry | 'none',
  part: RegistryPart = 'all'
): Promise<{ contacts: Contact[]; ares: AresPrefill[] }> {
  const q = query.trim();
  if (q.length < 2) return { contacts: [], ares: [] };
  const params = new URLSearchParams({ q: q.slice(0, 120), registry });
  if (part !== 'all') params.set('part', part);
  try {
    const res = await fetch(`/api/contacts/search?${params}`, { cache: 'no-store' });
    if (!res.ok) return { contacts: [], ares: [] };
    const data = (await res.json()) as { contacts?: Contact[]; ares?: AresPrefill[] };
    return { contacts: data.contacts ?? [], ares: data.ares ?? [] };
  } catch {
    return { contacts: [], ares: [] };
  }
}

/**
 * Hits from the public lookup (`/api/public/company-lookup`, no session,
 * rate-limited per visitor). Never throws.
 */
export async function fetchPublicCompanyHits(query: string, country?: string | null, part: RegistryPart = 'all'): Promise<CompanyHit[]> {
  const params = new URLSearchParams({ q: query.trim().slice(0, 120) });
  if (country) params.set('country', country);
  if (part !== 'all') params.set('part', part);
  try {
    const res = await fetch(`/api/public/company-lookup?${params}`, { cache: 'no-store' });
    if (!res.ok) return [];
    const data = (await res.json()) as { hits?: CompanyHit[] };
    return data.hits ?? [];
  } catch {
    return [];
  }
}
