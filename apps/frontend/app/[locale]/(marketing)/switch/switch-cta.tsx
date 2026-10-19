import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { SwitchBrand } from '@/lib/switch';
import { cn } from '@/lib/utils';

/** Sign up and land in the import (`?from=` is remembered for the welcome screen, see middleware). */
export async function SwitchCta({ brand, className }: { brand?: SwitchBrand; className?: string }) {
  const t = await getTranslations('switchPage');
  return (
    <div className={cn('rounded-2xl border border-primary/20 bg-primary/5 p-6', className)}>
      <h2 className="text-lg font-bold">{t('ctaTitle')}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t('ctaLead')}</p>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link
          href={brand ? `/signup?from=${brand}` : '/signup'}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {t('ctaButton')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          href={brand ? `/settings/import?source=${brand}` : '/settings/import'}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-semibold transition-colors hover:border-primary hover:text-primary"
        >
          {t('haveAccount')}
        </Link>
      </div>
    </div>
  );
}
