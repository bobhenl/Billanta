'use client';

import { ArrowRight, LogIn, UserPlus } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * "Keep your invoices" strip on the guest invoice page: sign up / log in for a
 * visitor, a shortcut into the app for someone already signed in. Client-side
 * (`useSession`) so the page itself stays static and indexable.
 */
export function GuestAccountCta() {
  const t = useTranslations('guestInvoice.account');
  const { status } = useSession();
  if (status === 'loading') return <div className="mt-6 h-[88px]" aria-hidden="true" />;

  if (status === 'authenticated') {
    return (
      <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">{t('signedIn')}</p>
        <Link
          href="/invoices/new"
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {t('openApp')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-sm font-semibold">{t('title')}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('body')}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link
          href="/signup"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 sm:flex-none"
        >
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {t('signup')}
        </Link>
        <Link
          href="/login"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold transition-colors hover:bg-secondary sm:flex-none"
        >
          <LogIn className="h-4 w-4" aria-hidden="true" />
          {t('login')}
        </Link>
      </div>
    </div>
  );
}
