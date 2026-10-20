import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LegalDocument } from '@/components/legal-document';
import { publicPageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.schoolContract' });
  // Only a placeholder until the contract is published, so it stays out of search and the sitemap.
  return {
    ...publicPageMetadata({ locale, path: '/legal/school-contract', title: t('title'), description: t('intro') }),
    robots: { index: false, follow: true }
  };
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <LegalDocument doc="schoolContract" />;
}
