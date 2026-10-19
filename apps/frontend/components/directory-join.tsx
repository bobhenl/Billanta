import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { buttonClass } from '@/lib/ui-classes';
import { SITE_NAME } from '@/lib/site';

/** "How it works" and "List your company" boxes under every directory page. */
export async function DirectoryJoin() {
  const t = await getTranslations('businessDirectory');
  return (
    <div className="mt-12 grid gap-4 sm:grid-cols-2">
      <div className="rounded-2xl border border-border bg-card p-6">
        <h2 className="text-lg font-bold tracking-tight">{t('howTitle')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('howBody', { site: SITE_NAME })}</p>
      </div>
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
        <h2 className="text-lg font-bold tracking-tight">{t('joinTitle')}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('joinBody', { site: SITE_NAME })}</p>
        <Link href="/signup" className={`${buttonClass.primary} mt-4`}>
          {t('joinCta')}
        </Link>
      </div>
    </div>
  );
}
