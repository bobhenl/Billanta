import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LegalDocument } from '@/components/legal-document';
import { publicPageMetadata } from '@/lib/seo';

/*
 * TODO(legal): the clauses on team members, 2FA, API keys and own-storage
 * backups (§3, §8, §11, §13) were added without bumping TOS_VERSION, because
 * the whole text is still an unreviewed draft. Bump it when the lawyer-reviewed
 * version is published, so new acceptances refer to that text.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.terms' });
  return publicPageMetadata({ locale, path: '/legal/terms', title: t('title'), description: t('intro') });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <LegalDocument doc="terms" />;
}
