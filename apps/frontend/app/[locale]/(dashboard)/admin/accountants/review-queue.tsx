'use client';

import { useState, useTransition } from 'react';
import { Check, Loader2, X } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { formatDate } from '@/lib/invoice-ui';
import { cn } from '@/lib/utils';
import { reviewListing } from './actions';

/** A row of `admin_accountant_listings()` (snake_case, straight from SQL). */
export interface ReviewListing {
  id: string;
  company_name: string;
  ico: string | null;
  display_name: string;
  bio: string | null;
  regions: string[] | null;
  remote: boolean;
  services: string[] | null;
  languages: string[] | null;
  price_hint: string | null;
  contact_email: string | null;
  website: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  review_note: string | null;
  reviewed_at: string | null;
  updated_at: string;
}

export function ReviewQueue({ listings }: { listings: ReviewListing[] }) {
  const t = useTranslations('adminAccountants');
  if (listings.length === 0) {
    return <p className="mt-6 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  }
  return (
    <ul className="mt-5 space-y-4">
      {listings.map((l) => (
        <ListingCard key={`${l.id}:${l.updated_at}`} listing={l} />
      ))}
    </ul>
  );
}

function ListingCard({ listing: l }: { listing: ReviewListing }) {
  const t = useTranslations('adminAccountants');
  const td = useTranslations('accountantDirectory');
  const locale = useLocale();
  const router = useRouter();
  const [note, setNote] = useState(l.review_note ?? '');
  const [pending, startTransition] = useTransition();

  const review = (status: 'approved' | 'rejected') =>
    startTransition(async () => {
      const result = await reviewListing(l.id, status, note.trim() || null, l.updated_at);
      if (result.ok) toast({ text: t(status === 'approved' ? 'approved' : 'rejected'), tone: 'ok' });
      else toast({ text: result.error === 'listing_changed' ? t('changed') : `${t('failed')}: ${result.error}`, tone: 'err' });
      router.refresh();
    });

  const label = (key: string, value: string) => (td.has(key) ? td(key) : value);
  const places = [...(l.regions ?? []).map((r) => label(`regions.${r}`, r)), ...(l.remote ? [td('remote')] : [])];
  const row = 'grid gap-0.5 sm:grid-cols-[9rem_1fr] sm:gap-3';

  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{l.display_name}</h2>
        <span className="text-xs text-muted-foreground">{t('updated', { date: formatDate(l.updated_at, locale) ?? '' })}</span>
      </div>
      <p className="text-xs text-muted-foreground">
        {l.company_name}
        {l.ico ? ` · ${t('ico')} ${l.ico}` : ''}
      </p>
      {l.bio && <p className="mt-2 whitespace-pre-line text-sm">{l.bio}</p>}
      <dl className="mt-3 space-y-1.5 text-sm">
        <div className={row}>
          <dt className="text-muted-foreground">{t('fields.places')}</dt>
          <dd>{places.join(', ') || '–'}</dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">{t('fields.services')}</dt>
          <dd>{(l.services ?? []).map((s) => label(`services.${s}`, s)).join(', ') || '–'}</dd>
        </div>
        <div className={row}>
          <dt className="text-muted-foreground">{t('fields.languages')}</dt>
          <dd>{(l.languages ?? []).join(', ') || '–'}</dd>
        </div>
        {l.price_hint && (
          <div className={row}>
            <dt className="text-muted-foreground">{t('fields.price')}</dt>
            <dd>{l.price_hint}</dd>
          </div>
        )}
        <div className={row}>
          <dt className="text-muted-foreground">{t('fields.contact')}</dt>
          {/* Plain text, not links: the address is unreviewed until the admin approves it. */}
          <dd className="break-all">{[l.contact_email, l.website].filter(Boolean).join(' · ')}</dd>
        </div>
      </dl>
      {l.status === 'withdrawn' ? (
        <p className="mt-4 text-xs text-muted-foreground">{t('withdrawnHint')}</p>
      ) : (
        <div className="mt-4 space-y-2">
          <label className="block text-sm font-medium">
            {t('note')}
            <textarea
              className={cn(inputClass, 'mt-1 min-h-[3.5rem]')}
              maxLength={500}
              value={note}
              disabled={pending}
              placeholder={t('notePlaceholder')}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {l.status !== 'approved' && (
              <button type="button" className={buttonClass.primary} disabled={pending} onClick={() => review('approved')}>
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {t('approve')}
              </button>
            )}
            {l.status !== 'rejected' && (
              <button type="button" className={buttonClass.secondary} disabled={pending} onClick={() => review('rejected')}>
                <X className="h-4 w-4" />
                {t('reject')}
              </button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
