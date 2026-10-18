'use client';

import { ArrowRight } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * "Otevřít s mými čísly" on a public calculator: for a signed-in visitor, a
 * link to the same calculator inside the app, prefilled from their invoices
 * and expenses. Client-side (`useSession`) so the public page stays static;
 * a visitor who is not signed in sees nothing.
 */
export function MyNumbersLink({ href }: { href: string }) {
  const t = useTranslations('tools.common.myNumbers');
  const { status } = useSession();
  if (status !== 'authenticated') return null;
  return (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-muted-foreground">{t('hint')}</p>
      <Link
        href={href}
        className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t('cta')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
