import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LegalDocument } from '@/components/legal-document';
import { publicPageMetadata } from '@/lib/seo';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.dpa' });
  return publicPageMetadata({ locale, path: '/legal/dpa', title: t('title'), description: t('intro') });
}

export default function Page() {
  return <LegalDocument doc="dpa" />;
}
