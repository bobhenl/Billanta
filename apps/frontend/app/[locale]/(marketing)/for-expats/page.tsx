import type { Metadata } from 'next';
import { ArrowLeftRight, FileCheck2, Globe2, Languages, Laptop, Repeat } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PartnerChecklist, PartnerSegmentPage } from '@/components/partner-segment';
import { Link } from '@/i18n/navigation';
import { publicPageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'partnerSegments.expats' });
  return publicPageMetadata({ locale, path: '/for-expats', title: t('seoTitle'), description: t('lead') });
}

/** Further reading for the "what an invoice must contain" box; the two guides are published in cs and en only. */
const READ_MORE = [
  ['requiredFields', '/features/required-fields-check', null],
  ['currencies', '/features/foreign-currency-invoices', null],
  ['bilingual', '/features/bilingual-invoices', null],
  ['fx', '/calculators/cnb-exchange-rates', null],
  ['identified', '/guides/identified-person', ['cs', 'en']],
  ['vatFiling', '/guides/vat-return-control-statement', ['cs', 'en']]
] as const;

/**
 * For foreigners and digital nomads doing business in CZ/SK, and for the
 * relocation agencies, expat groups and coworkings that help them. Written
 * for English first; the demo always opens in English (`demoLocale`).
 */
export default async function ForExpatsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('partnerSegments.expats');
  return (
    <PartnerSegmentPage
      locale={locale}
      segment="expats"
      demoLocale="en"
      offers={[
        { key: 'english', icon: Languages },
        { key: 'currencies', icon: ArrowLeftRight },
        { key: 'reverseCharge', icon: Globe2 },
        { key: 'checks', icon: FileCheck2 },
        { key: 'recurring', icon: Repeat },
        { key: 'remote', icon: Laptop }
      ]}
    >
      <PartnerChecklist className="mt-12" title={t('musts.title')} lead={t('musts.lead')} points={t.raw('musts.points') as string[]}>
        <p className="mt-4 text-xs text-muted-foreground">{t('musts.note')}</p>
        <h3 className="mt-5 text-sm font-bold">{t('musts.readMore')}</h3>
        <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          {READ_MORE.map(([key, href, locales]) => (
            <li key={key}>
              {/* A Czech-rules guide has no Slovak edition; read it in English then. */}
              <Link
                href={href}
                locale={locales && !(locales as readonly string[]).includes(locale) ? 'en' : undefined}
                className="font-medium text-primary hover:underline"
              >
                {t(`musts.links.${key}`)} →
              </Link>
            </li>
          ))}
        </ul>
      </PartnerChecklist>
    </PartnerSegmentPage>
  );
}
