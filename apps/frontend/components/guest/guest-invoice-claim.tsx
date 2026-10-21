'use client';

import { useEffect, useState, useTransition } from 'react';
import { Save } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname } from '@/i18n/navigation';
import { toast } from '@/components/toaster';
import { importGuestInvoices } from '@/app/[locale]/(dashboard)/welcome/actions';
import { forgetGuestInvoices, readGuestInvoices, type GuestInvoiceBody } from '@/lib/guest-invoices';
import { buttonClass } from '@/lib/ui-classes';
import { cn } from '@/lib/utils';

/**
 * Invoices this browser kept from /create-invoice, offered to someone who
 * logged in instead of signing up (a new account gets the same offer on the
 * welcome screen, so it is not shown there). Nothing moves without a click:
 * on a shared computer the list may well be somebody else's.
 */
export function GuestInvoiceClaim() {
  const t = useTranslations('welcome.guest');
  const pathname = usePathname();
  const [guest, setGuest] = useState<GuestInvoiceBody[]>([]);
  const [pending, start] = useTransition();

  useEffect(() => setGuest(readGuestInvoices()), []);

  if (guest.length === 0 || pathname.startsWith('/welcome')) return null;

  const claim = () =>
    start(async () => {
      const r = await importGuestInvoices(guest);
      if (!r.ok) {
        toast({ text: `${t('failed')}${r.error ? `: ${r.error}` : ''}`, tone: 'err' });
        return;
      }
      forgetGuestInvoices();
      setGuest([]);
      toast({ text: t('done', { invoices: r.data.invoices, contacts: r.data.contactsCreated }), tone: 'ok' });
    });

  const dismiss = () => {
    forgetGuestInvoices();
    setGuest([]);
  };

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex gap-2.5">
        <Save className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t('title', { n: guest.length })}</p>
          <p className="text-muted-foreground">{t('bannerHint')}</p>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={claim} className={cn(buttonClass.primary, 'py-1.5')}>
          {t('claim')}
        </button>
        <button type="button" disabled={pending} onClick={dismiss} className={cn(buttonClass.secondary, 'py-1.5')}>
          {t('dismiss')}
        </button>
      </div>
    </div>
  );
}
