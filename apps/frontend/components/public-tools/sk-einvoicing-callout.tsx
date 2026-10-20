import { ArrowRight, FileCode2 } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';

/**
 * Link card to the Slovak e-invoicing guide for pages Slovak visitors land
 * on (sk comparisons, the sk town directory) and for partners whose members
 * will need it. `partner` swaps the body for one written to them.
 */
export async function SkEinvoicingCallout({ partner = false, className }: { partner?: boolean; className?: string }) {
  const t = await getTranslations('tools.guides.items.skEinvoicing.callout');
  return (
    <Link
      href="/guides/e-invoicing-slovakia-2027"
      className={cn('group flex gap-4 rounded-xl border border-primary/30 bg-primary/5 p-5 transition-colors hover:border-primary', className)}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
        <FileCode2 className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block font-bold">{t('title')}</span>
        <span className="mt-1 block text-sm text-muted-foreground">{partner ? t('partnerBody') : t('body')}</span>
        <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
          {t('cta')}
          <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </span>
      </span>
    </Link>
  );
}
