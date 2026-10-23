'use client';

import { ArrowRight } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

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
        className={cn(buttonClass.primary, 'shrink-0')}
      >
        {t('cta')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
