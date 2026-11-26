import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { LegalDocument } from '@/components/legal-document';
import { publicPageMetadata } from '@/lib/seo';

/*
 * TODO(legal): open points the text in `legal.privacy` cannot settle from code:
 * - Resend sending region: it is a dashboard setting, not in code, so §4/§5
 *   still say Resend may process data in the USA. Name the region once confirmed.
 * - Sign-in providers: lib/oauth-providers.ts enables any of Google, Microsoft,
 *   Apple, Seznam, Discord and GitHub by env. §4 only says "other providers
 *   offered on the sign-in page"; list the ones enabled in production by name.
 * - Change history (audit_log) has no retention period of its own: rows live
 *   until the company is deleted (ON DELETE CASCADE). §6 says exactly that;
 *   decide whether a fixed period is wanted.
 * - Expired team invitations: no cleanup or retention is defined, so §2 does
 *   not promise one.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'legal.privacy' });
  return publicPageMetadata({ locale, path: '/legal/privacy', title: t('title'), description: t('intro') });
}

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  setRequestLocale((await params).locale);
  return <LegalDocument doc="privacy" />;
}
