import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import type { SwitchBrand } from '@/lib/switch';
import { buttonClass } from '@/lib/ui-classes';
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
          className={buttonClass.primary}
        >
          {t('ctaButton')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          href={brand ? `/settings/import?source=${brand}` : '/settings/import'}
          className="text-sm font-semibold text-primary underline-offset-4 hover:underline"
        >
          {t('haveAccount')}
        </Link>
      </div>
    </div>
  );
}
