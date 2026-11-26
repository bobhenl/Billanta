'use client';

import { ArrowRight } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * "Keep your invoices" strip on the guest invoice page: sign up / log in for a
 * visitor, a shortcut into the app for someone already signed in. Client-side
 * (`useSession`) so the page itself stays static and indexable. For a
 * visitor it is one line of text links, not buttons: the form below is what
 * they came for, and its download button is the page's one primary action.
 */
export function GuestAccountCta() {
  const t = useTranslations('guestInvoice.account');
  const { status } = useSession();
  if (status === 'loading') return <div className="mt-4 h-5" aria-hidden="true" />;

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
    <p className="mt-4 text-sm text-muted-foreground">
      {t('title')}{' '}
      <Link href="/signup" className="font-semibold text-primary hover:underline">
        {t('signup')}
      </Link>
      {' · '}
      <Link href="/login" className="font-semibold text-primary hover:underline">
        {t('login')}
      </Link>
    </p>
  );
}
