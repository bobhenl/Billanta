import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { NOINDEX } from '@/lib/seo';
import { buttonClass } from '@/lib/ui-classes';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'demo' });
  return { title: t('expired.metaTitle'), robots: NOINDEX };
}

/** Where api-client sends a visitor whose demo company the cleanup already deleted. */
export default async function DemoExpiredPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('demo');

  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t('expired.title')}</h1>
      <p className="mt-3 text-muted-foreground">{t('expired.lead')}</p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/demo" className={buttonClass.primary}>
          {t('expired.again')}
        </Link>
        <Link href="/signup" className={buttonClass.secondary}>
          {t('expired.register')}
        </Link>
      </div>
    </div>
  );
}
