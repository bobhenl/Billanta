'use client';

import { LayoutDashboard } from 'lucide-react';
import type { ComponentProps } from 'react';
import { useSession } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

/**
 * Account entries of the public header and footer. Client-side
 * (`useSession`), like the phone tab bar, so the marketing pages stay
 * static: the server HTML always carries the visitor links, and a signed-in
 * visitor gets the shortcut into the app once the session is known.
 */
function useSignedIn() {
  return useSession().status === 'authenticated';
}

/**
 * Where "Issue an invoice" leads: the free guest invoice for a visitor, the
 * dashboard's own invoice form for someone signed in, who would otherwise
 * fill in a form that never reaches their books.
 */
export function useCreateInvoiceHref() {
  return useSignedIn() ? '/invoices/new' : '/create-invoice';
}

/** A `Link` to `useCreateInvoiceHref()`, for server components. */
export function CreateInvoiceLink(props: Omit<ComponentProps<typeof Link>, 'href'>) {
  return <Link {...props} href={useCreateInvoiceHref()} />;
}

/** Header slot next to the "Issue an invoice" button, from `md` up. */
export function HeaderAccountLink() {
  const t = useTranslations('marketing.nav');
  const signedIn = useSignedIn();
  const className =
    'hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground md:inline-flex';
  if (signedIn) {
    return (
      <Link href="/dashboard" className={className}>
        <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
        {t('app')}
      </Link>
    );
  }
  return (
    <Link href="/login" className={className}>
      {t('login')}
    </Link>
  );
}

/** List items of the footer's "Account" column. */
export function FooterAccountLinks({ className }: { className: string }) {
  const t = useTranslations('marketing.footer.account');
  const signedIn = useSignedIn();
  if (signedIn) {
    return (
      <li>
        <Link href="/dashboard" className={className}>
          {t('openApp')}
        </Link>
      </li>
    );
  }
  return (
    <>
      <li>
        <Link href="/login" className={className}>
          {t('login')}
        </Link>
      </li>
      <li>
        <Link href="/signup" className={className}>
          {t('signup')}
        </Link>
      </li>
    </>
  );
}
