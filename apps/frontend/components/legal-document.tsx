import { AlertTriangle } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { chipClass } from '@/components/chip-row';
import { Link } from '@/i18n/navigation';
import { breadcrumbLd, jsonLd, webPageLd } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

export type LegalDocKey = 'terms' | 'privacy' | 'dpa' | 'classroomPrivacy' | 'schoolContract';

interface LegalSection {
  title: string;
  body: string[];
}

const DOCS: { key: 'terms' | 'privacy' | 'dpa'; href: string }[] = [
  { key: 'terms', href: '/legal/terms' },
  { key: 'privacy', href: '/legal/privacy' },
  { key: 'dpa', href: '/legal/dpa' }
];

/** The classroom texts are not in the footer, so their URL is not their key. */
const PATHS: Record<LegalDocKey, string> = {
  terms: '/legal/terms',
  privacy: '/legal/privacy',
  dpa: '/legal/dpa',
  classroomPrivacy: '/legal/classroom-privacy',
  schoolContract: '/legal/school-contract'
};

/**
 * Shared renderer for the terms, privacy policy and DPA. The text lives in
 * `legal.<doc>.sections` as an array of { title, body[] } read with `t.raw`,
 * so adding a clause is a message-only change. `{operator}` inside a body is
 * replaced with the operator identity from `legal.operator`.
 *
 * The wording is a working draft, not attorney-reviewed: the banner says so
 * and must stay until a lawyer has signed off and the bracketed operator
 * placeholders are filled in.
 */
export async function LegalDocument({ doc }: { doc: LegalDocKey }) {
  const t = await getTranslations('legal');
  const tFooter = await getTranslations('marketing.footer.legal');
  const sections = t.raw(`${doc}.sections`) as LegalSection[];
  const operator = t('operator');
  const locale = await getLocale();
  const path = PATHS[doc];

  return (
    <article className="container max-w-2xl py-12 sm:py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          webPageLd(locale, path, 'WebPage', t(`${doc}.title`), t(`${doc}.intro`)),
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t(`${doc}.title`), path]
          ])
        ])}
      />
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t(`${doc}.title`)}</h1>
      <p className="mt-3 text-muted-foreground sm:text-lg">{t(`${doc}.intro`)}</p>
      <p className="mt-2 text-xs text-muted-foreground">{t('updated')}</p>

      <div className="mt-6 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm font-medium text-warning">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{t('draftNotice')}</span>
      </div>

      <nav aria-label={t('toc')} className="mt-8 rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('toc')}</p>
        <ol className="mt-3 grid gap-1.5 text-sm">
          {sections.map((section, index) => (
            <li key={section.title}>
              <a href={`#s${index + 1}`} className="text-foreground/80 hover:text-primary hover:underline">
                {index + 1}. {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 space-y-8">
        {sections.map((section, index) => (
          <section key={section.title} id={`s${index + 1}`} className="scroll-mt-24">
            <h2 className="text-xl font-bold tracking-tight">
              <span className="text-muted-foreground">{index + 1}.</span> {section.title}
            </h2>
            <div className="mt-3 space-y-3 text-[15px] leading-7 text-foreground/90">
              {section.body.map((paragraph, i) => (
                <p key={i}>{paragraph.replace('{operator}', operator)}</p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-12 border-t border-border pt-6">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('related')}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {[...DOCS.filter((d) => d.key !== doc), { key: 'cookies' as const, href: '/legal/cookies' }].map((d) => (
            <li key={d.key}>
              <Link href={d.href} className={chipClass}>
                {tFooter(d.key)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
