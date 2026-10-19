import type { Metadata } from 'next';
import { ArrowRight, CircleHelp, Handshake, Mail, PlayCircle, UserSearch } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { CONTACT_EMAIL, SITE_NAME, SITE_URL } from '@/lib/site';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'contact' });
  return publicPageMetadata({ locale, path: '/contact', title: t('title'), description: t('lead') });
}

const HELP_LINKS = [
  { key: 'faq', href: '/#faq', icon: CircleHelp },
  { key: 'demo', href: '/demo', icon: PlayCircle },
  { key: 'accountants', href: '/accountants', icon: UserSearch },
  { key: 'partners', href: '/for-partners', icon: Handshake }
] as const;

const LEGAL_LINKS = [
  { key: 'privacy', href: '/legal/privacy' },
  { key: 'terms', href: '/legal/terms' },
  { key: 'cookies', href: '/legal/cookies' }
] as const;

/**
 * Contact and operator identification (zákon 480/2004 Sb., GDPR controller).
 * The operator line is `legal.operator`, the same string the terms and
 * privacy policy print, so the details are filled in once for all three.
 *
 * There is no contact form: production has no mail provider for it. The
 * e-mail block shows only when NEXT_PUBLIC_CONTACT_EMAIL is set; without it
 * the page points to the FAQ and the demo instead.
 *
 * The JSON-LD says only what is drawn here: a ContactPage about Billanta,
 * with the e-mail only when it is shown. The operator placeholders stay out
 * of the markup. No BreadcrumbList: the trail would be two rungs (home,
 * this page), which earns nothing, as on the calculator and template hubs.
 */
export default async function ContactPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('contact');
  const tLegal = await getTranslations('legal');
  const tFooter = await getTranslations('marketing.footer.legal');

  return (
    <div className="container max-w-3xl py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd({
          ...webPageLd(locale, '/contact', 'ContactPage', t('title'), t('lead')),
          about: {
            '@type': 'Organization',
            name: SITE_NAME,
            url: SITE_URL,
            ...(CONTACT_EMAIL ? { email: CONTACT_EMAIL } : {})
          }
        })}
      />
      <h1 className="text-3xl font-extrabold tracking-tight">{t('title')}</h1>
      <p className="mt-3 text-muted-foreground">{t('lead')}</p>

      <section className="mt-8 rounded-xl border border-border bg-card p-5">
        {CONTACT_EMAIL ? (
          <>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Mail className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              {t('emailTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('emailBody')}</p>
            <a href={`mailto:${CONTACT_EMAIL}`} className="mt-3 inline-block break-all text-lg font-semibold text-primary hover:underline">
              {CONTACT_EMAIL}
            </a>
          </>
        ) : (
          <>
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <CircleHelp className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              {t('noEmailTitle')}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t('noEmailBody')}</p>
          </>
        )}
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold">{t('helpTitle')}</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {HELP_LINKS.map(({ key, href, icon: Icon }) => (
            <li key={key}>
              <Link
                href={href}
                className="group flex h-full items-start gap-3 rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary"
              >
                <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="flex items-center gap-1 font-semibold group-hover:text-primary">
                    {t(`links.${key}.title`)}
                    <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">{t(`links.${key}.body`)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-bold">{t('operatorTitle')}</h2>
        <p className="mt-2 break-words text-sm leading-relaxed text-muted-foreground">{tLegal('operator')}</p>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-bold">{t('privacyTitle')}</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t('privacyBody')}</p>
      </section>

      <section className="mt-10 border-t border-border pt-6">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('legalTitle')}</h2>
        <ul className="mt-3 flex flex-wrap gap-2 text-sm">
          {LEGAL_LINKS.map(({ key, href }) => (
            <li key={key}>
              <Link href={href} className="inline-flex rounded-full border border-border px-3 py-1.5 font-semibold hover:border-primary hover:text-primary">
                {tFooter(key)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
