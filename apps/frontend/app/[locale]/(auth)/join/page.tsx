import type { Metadata } from 'next';
import { Ticket } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { PROMO_CODE } from '@/lib/promo';
import { JoinCodeForm } from './join-code-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('join');
  return { title: t('metaTitle') };
}

/** `/join`: type the code from a poster or a slide; `/join?code=` (the form) goes on to `/join/CODE`. */
export default async function JoinPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const typed = (await searchParams).code?.trim().replace(/\s+/g, '-');
  if (typed && PROMO_CODE.test(typed)) redirect({ href: `/join/${typed.toUpperCase()}`, locale: await getLocale() });
  const t = await getTranslations('join');
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <Ticket className="h-6 w-6 text-primary" aria-hidden="true" />
        <h1 className="mt-3 text-xl font-bold">{t('form.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('form.hint')}</p>
        {typed && (
          <p role="alert" className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
            {t('invalid')}
          </p>
        )}
        <div className="mt-5">
          <JoinCodeForm defaultValue={typed} />
        </div>
      </div>
    </div>
  );
}
