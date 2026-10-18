'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlertTriangle, Search } from 'lucide-react';
import { parseVatId } from '@faktur/cz-compliance';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { RegistryPicker, useCompanyRegistry, type CompanyRegistry } from '@/components/registry-picker';
import { ResultRow, TextField } from '@/components/public-tools/fields';
import { cn } from '@/lib/utils';

/** One hit of `GET /api/public/company-lookup` (backend `PublicCompanyHit`). */
interface Hit {
  name: string;
  ico: string | null;
  dic: string | null;
  street: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  source: string | null;
  regNumber: string | null;
}

/** `GET /api/public/company-lookup/vat-check` (backend `vatCheck`, bank accounts left out). */
interface VatCheck {
  vatId: string;
  state: 'payer' | 'unreliable' | 'not_registered' | 'valid' | 'invalid' | 'unknown';
  source: 'ADIS' | 'VIES' | null;
  name: string | null;
}

type ErrorCode = 'invalid' | 'notFound' | 'busy';
type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'hits'; hits: Hit[] } | { kind: 'error'; code: ErrorCode };
type Vat = VatCheck | 'loading' | 'busy' | null;

/**
 * What to ask for a typed query: a register search, a VAT check, or both.
 * - up to 8 digits: an IČO (CZ and SK share the format), in the picked register;
 * - a CZ DIČ of a company (CZ + 8 digits): the IČO in ARES, and the CZ register of VAT payers;
 *   a CZ DIČ of a person (CZ + birth number) is only in that register;
 * - another EU VAT number (SK included): VIES, which answers name and address too;
 * - anything else of 3+ characters: a name.
 */
export function lookupPlan(raw: string, registry: CompanyRegistry): { search: { q: string; registry: CompanyRegistry } | null; vatId: string | null } | null {
  const compact = raw.replace(/[\s.-]/g, '').toUpperCase();
  if (/^\d{1,8}$/.test(compact)) return { search: { q: compact.padStart(8, '0'), registry }, vatId: null };
  const vat = parseVatId(compact);
  if (vat) {
    const vatId = vat.country + vat.number;
    if (vat.country === 'CZ') return { search: /^\d{8}$/.test(vat.number) ? { q: vat.number, registry: 'CZ' } : null, vatId };
    return { search: { q: vatId, registry: 'EU' }, vatId };
  }
  if (raw.trim().length >= 3 && !/^\d+$/.test(compact)) return { search: { q: raw.trim(), registry }, vatId: null };
  return null;
}

async function fetchVat(dic: string): Promise<VatCheck | 'busy' | null> {
  try {
    const res = await fetch(`/api/public/company-lookup/vat-check?dic=${encodeURIComponent(dic)}`);
    if (res.status === 429) return 'busy';
    return res.ok ? ((await res.json()) as VatCheck | null) : null;
  } catch {
    return null;
  }
}

/**
 * Company lookup by IČO, DIČ / EU VAT number or name in the registers the
 * app supports (ARES, RPO, VIES and the foreign ones of the registry
 * picker), through the public proxy the order form and the buyer-details
 * page use, so the backend's per-visitor limits cover this page too. The VAT
 * status (payer, nespolehlivý plátce, VIES validity) is asked for the shown
 * company only, since that limit is stricter.
 */
export function CompanyLookup() {
  const t = useTranslations('tools.calculators.items.companyLookup');
  const [registry, setRegistry] = useCompanyRegistry();
  const [query, setQuery] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [picked, setPicked] = useState(0);
  const [vat, setVat] = useState<Record<string, Vat>>({});

  async function checkVat(dic: string | null, known?: VatCheck | null) {
    if (!dic) return;
    const key = dic.replace(/\s+/g, '').toUpperCase();
    if (known !== undefined) return setVat((v) => ({ ...v, [key]: known }));
    if (vat[key] && vat[key] !== 'busy') return;
    setVat((v) => ({ ...v, [key]: 'loading' }));
    const check = await fetchVat(key);
    setVat((v) => ({ ...v, [key]: check }));
  }

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const plan = lookupPlan(query, registry);
    if (!plan) return setState({ kind: 'error', code: 'invalid' });
    setState({ kind: 'loading' });
    setPicked(0);
    try {
      const [found, check] = await Promise.all([
        plan.search
          ? fetch(`/api/public/company-lookup?${new URLSearchParams({ q: plan.search.q, registry: plan.search.registry })}`).then(async (res) =>
              res.status === 429 ? 'busy' : ((await res.json()) as { hits?: Hit[] }).hits ?? []
            )
          : Promise.resolve([] as Hit[]),
        plan.vatId ? fetchVat(plan.vatId) : Promise.resolve(null)
      ]);
      if (found === 'busy') return setState({ kind: 'error', code: 'busy' });
      let hits = found;
      // A DIČ no register search answers (a CZ sole trader's DIČ): the VAT register still knows the name.
      if (!hits.length && plan.vatId && check && check !== 'busy' && check.name) {
        hits = [{ name: check.name, ico: null, dic: check.vatId, street: null, city: null, postalCode: null, country: check.vatId.slice(0, 2), source: check.source, regNumber: null }];
      }
      if (!hits.length) return setState({ kind: 'error', code: check === 'busy' ? 'busy' : 'notFound' });
      setState({ kind: 'hits', hits });
      if (plan.vatId && check !== 'busy') checkVat(plan.vatId, check);
      else checkVat(hits[0]!.dic);
    } catch {
      setState({ kind: 'error', code: 'busy' });
    }
  }

  const hits = state.kind === 'hits' ? state.hits : [];
  const c = hits[picked] ?? null;
  const address = c ? [c.street, [c.postalCode, c.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';
  const check = c?.dic ? vat[c.dic.replace(/\s+/g, '').toUpperCase()] : undefined;

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="min-w-0 space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={lookup}>
        <TextField label={t('fields.query')} value={query} onChange={setQuery} maxLength={120} placeholder="27082440" hint={t('fields.queryHint')} />
        <div>
          <p className="text-sm font-medium">{t('fields.registry')}</p>
          <RegistryPicker value={registry} onChange={setRegistry} className="mt-1.5 max-w-full" />
        </div>
        <button type="submit" disabled={state.kind === 'loading'} className={buttonClass.primary}>
          <Search className="h-4 w-4" aria-hidden="true" />
          {state.kind === 'loading' ? t('fields.searching') : t('fields.search')}
        </button>
      </form>
      <section aria-live="polite" className="min-w-0 rounded-xl border border-border bg-card p-5">
        {c ? (
          <>
            {hits.length > 1 && (
              <div className="mb-4">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('result.hits', { n: hits.length })}</p>
                <ul className="mt-2 space-y-1">
                  {hits.map((h, i) => (
                    <li key={`${h.country}-${h.ico ?? h.dic ?? h.name}-${i}`}>
                      <button
                        type="button"
                        aria-pressed={i === picked}
                        onClick={() => {
                          setPicked(i);
                          checkVat(h.dic);
                        }}
                        className={cn(
                          'w-full rounded-lg px-3 py-2 text-left text-sm transition-colors',
                          i === picked ? 'bg-primary/10 font-semibold text-primary' : 'hover:bg-secondary'
                        )}
                      >
                        <span className="block truncate">{h.name}</span>
                        <span className="block text-xs font-normal text-muted-foreground">{[h.ico, h.city, h.country].filter(Boolean).join(' · ')}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <h2 className="break-words text-lg font-semibold">{c.name}</h2>
            <dl className="mt-3 text-sm">
              {c.ico && <ResultRow label={t('result.ico')} value={c.ico} />}
              {c.regNumber && c.regNumber !== c.ico && <ResultRow label={t('result.regNumber')} value={c.regNumber} />}
              <ResultRow label={t('result.dic')} value={c.dic ?? t('result.noDic')} />
              {c.dic && (
                <ResultRow
                  label={t('result.vat')}
                  value={check === 'loading' || check === undefined ? t('result.vatChecking') : check === 'busy' ? t('errors.busy') : t(`result.vatState.${check?.state ?? 'unknown'}`)}
                  note={check && typeof check === 'object' && check.source ? t(`result.vatSource.${check.source}`) : undefined}
                />
              )}
              {address && <ResultRow label={t('result.address')} value={address} />}
              <ResultRow label={t('result.country')} value={c.country} />
            </dl>
            {check && typeof check === 'object' && check.state === 'unreliable' && (
              <p className="mt-3 flex gap-2 rounded-lg bg-warning/10 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                {t('result.unreliableNote')}
              </p>
            )}
            {c.source && <p className="mt-3 text-xs text-muted-foreground">{t('result.source', { source: c.source })}</p>}
            <Link href="/create-invoice" className={`${buttonClass.secondary} mt-4`}>
              {t('result.invoice')}
            </Link>
          </>
        ) : state.kind === 'error' ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {t(`errors.${state.code}`)}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">{t('result.empty')}</p>
        )}
      </section>
    </div>
  );
}
