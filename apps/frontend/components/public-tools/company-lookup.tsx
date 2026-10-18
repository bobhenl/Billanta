'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { ResultRow, TextField } from '@/components/public-tools/fields';

interface Company {
  ico: string;
  dic: string | null;
  legalName: string;
  addressStreet: string | null;
  addressCity: string | null;
  addressPostalCode: string | null;
}

type State = { kind: 'idle' } | { kind: 'loading' } | { kind: 'found'; company: Company } | { kind: 'error'; code: 'invalid' | 'notFound' | 'busy' };

/**
 * ARES lookup through the same proxy the guest invoice uses, so the backend's
 * per-visitor rate limit covers this page too.
 */
export function CompanyLookup() {
  const t = useTranslations('tools.calculators.items.companyLookup');
  const [ico, setIco] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    const digits = ico.replace(/\s+/g, '');
    if (!/^\d{1,8}$/.test(digits)) {
      setState({ kind: 'error', code: 'invalid' });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const res = await fetch(`/api/public/guest-invoice/lookup?ico=${encodeURIComponent(digits.padStart(8, '0'))}`);
      if (res.ok) setState({ kind: 'found', company: (await res.json()) as Company });
      else setState({ kind: 'error', code: res.status === 400 || res.status === 404 ? 'notFound' : 'busy' });
    } catch {
      setState({ kind: 'error', code: 'busy' });
    }
  }

  const c = state.kind === 'found' ? state.company : null;
  const address = c ? [c.addressStreet, [c.addressPostalCode, c.addressCity].filter(Boolean).join(' ')].filter(Boolean).join(', ') : '';

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <form className="space-y-4 rounded-xl border border-border bg-card p-5" onSubmit={lookup}>
        <TextField label={t('fields.ico')} value={ico} onChange={setIco} inputMode="numeric" maxLength={10} placeholder="27082440" hint={t('fields.icoHint')} />
        <button type="submit" disabled={state.kind === 'loading'} className={buttonClass.primary}>
          <Search className="h-4 w-4" aria-hidden="true" />
          {state.kind === 'loading' ? t('fields.searching') : t('fields.search')}
        </button>
      </form>
      <section aria-live="polite" className="rounded-xl border border-border bg-card p-5">
        {c ? (
          <>
            <h2 className="text-lg font-semibold">{c.legalName}</h2>
            <dl className="mt-3 text-sm">
              <ResultRow label={t('result.ico')} value={c.ico} />
              <ResultRow label={t('result.dic')} value={c.dic ?? t('result.noDic')} />
              {address && <ResultRow label={t('result.address')} value={address} />}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">{t('result.source')}</p>
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
