'use client';

import { useTransition } from 'react';
import { BadgeCheck, Clock, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { buttonClass } from '@/components/modal';
import { toast } from '@/components/toaster';
import { cn } from '@/lib/utils';
import { requestPartnerProgram } from './actions';
import type { PartnerStatus } from './listing-form';

/**
 * The accountant partner tier is approved by Billanta staff. This shows where
 * the company stands and, until then, the button to ask. Asking needs a
 * directory listing, which is what staff look at.
 */
export function PartnerRequest({
  status,
  note,
  hasListing,
  readOnly,
  showProfileLink = false,
  className
}: {
  status: PartnerStatus;
  note: string | null;
  hasListing: boolean;
  readOnly: boolean;
  /** On the referrals page: point to Profil účetního, where the listing lives. */
  showProfileLink?: boolean;
  className?: string;
}) {
  const t = useTranslations('accountantDirectory.partner');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const ask = () =>
    startTransition(async () => {
      const result = await requestPartnerProgram();
      if (!result.ok) {
        const code = ['listing_required', 'ico_required'].find((c) => result.error.includes(c));
        return void toast({ text: t(`errors.${code ?? 'generic'}`), tone: 'err' });
      }
      toast({ text: t('sent'), tone: 'ok' });
      router.refresh();
    });

  if (status === 'approved') {
    return (
      <p className={cn('flex items-start gap-2 rounded-lg bg-success/10 p-3 text-sm text-success', className)}>
        <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('approved')}
      </p>
    );
  }
  if (status === 'pending') {
    return (
      <p className={cn('flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-sm text-warning', className)}>
        <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {t('pending')}
      </p>
    );
  }
  return (
    <div className={cn('rounded-lg border border-border p-3 text-sm', className)}>
      <p className="text-muted-foreground">{t('intro')}</p>
      {status === 'rejected' && <p className="mt-2">{note ? t('rejectedNote', { note }) : t('rejected')}</p>}
      {!hasListing && <p className="mt-2">{t('needListing')}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" onClick={ask} disabled={readOnly || pending || !hasListing} className={buttonClass.secondary}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {t('ask')}
        </button>
        {showProfileLink && (
          <Link href="/settings/accountant-profile" className="text-sm font-semibold text-primary hover:underline">
            {t('profileLink')}
          </Link>
        )}
      </div>
    </div>
  );
}
