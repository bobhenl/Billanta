import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CheckCircle2, Clock, ExternalLink } from 'lucide-react';
import { GuidePage, GuideSection, guideMetadata } from '@/components/public-tools/guide-page';
import { SkEinvoicingCheck } from '@/components/public-tools/sk-einvoicing-check';
import { FaqList, faqLd } from '@/components/segment-page';
import { jsonLd } from '@/lib/seo';

const SLUG = 'e-invoicing-slovakia-2027';
type Params = { locale: string };

/**
 * The date the facts below were checked against Finančná správa SR and
 * Slov-Lex (docs/sk-einvoicing-2027.md lists every source). Move it only
 * after re-checking them, since the page prints it as "updated".
 */
const CHECKED = '2026-10-19';
const FS = 'https://www.financnasprava.sk';
const OFFICIAL_URL = `${FS}/sk/podnikatelia/dane/dan-z-pridanej-hodnoty/e-faktura`;
const LINKS = {
  faq: `${FS}/_img/pfsedit/Dokumenty_PFS/Podnikatelia/Dan_z_pridanej_hodnoty/efaktura/2026/2026.10.12_FAQ_eFaktura.pdf`,
  providers: 'https://vpds.financnasprava.sk/',
  law: 'https://www.slov-lex.sk/ezbierky-fe/pravne-predpisy/SK/ZZ/2004/222/?ucinnost=01.01.2027',
  bill: 'https://www.nrsr.sk/web/Default.aspx?sid=zakony/zakon&ZakZborID=13&CisObdobia=9&CPT=1454'
} as const;

type Milestone = { date: string; text: string };
type Feature = { text: string; soon: boolean };
type Faq = { q: string; a: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return guideMetadata(SLUG, locale);
}

function Bullets({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5">
      {items.map((i) => (
        <li key={i}>{i}</li>
      ))}
    </ul>
  );
}

export default async function SkEinvoicingGuide({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('tools.guides.items.skEinvoicing');
  const timeline = t.raw('timeline') as Milestone[];
  const features = t.raw('billanta') as Feature[];
  const faq = t.raw('faq') as Faq[];

  return (
    <GuidePage
      slug={SLUG}
      locale={locale}
      sources={{ checked: CHECKED, officialUrl: OFFICIAL_URL, officialLabel: t('officialSource'), disclaimer: t('disclaimer') }}
    >
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(faqLd(faq))} />
      <GuideSection title={t('whenTitle')}>
        <ol className="space-y-3 border-l-2 border-primary/30 pl-4">
          {timeline.map((m) => (
            <li key={m.date}>
              <p className="font-semibold text-primary">{m.date}</p>
              <p>{m.text}</p>
            </li>
          ))}
        </ol>
      </GuideSection>
      <GuideSection title={t('whoTitle')}>
        <p className="font-semibold">{t('issueLabel')}</p>
        <Bullets items={t.raw('issuers') as string[]} />
        <p className="font-semibold">{t('receiveLabel')}</p>
        <p>{t('receivers')}</p>
        <p className="font-semibold">{t('outsideLabel')}</p>
        <Bullets items={t.raw('outside') as string[]} />
        <p className="text-muted-foreground">{t('czNote')}</p>
      </GuideSection>
      <GuideSection title={t('howTitle')}>
        <p>{t('howBody')}</p>
        <Bullets items={t.raw('howSteps') as string[]} />
      </GuideSection>
      <GuideSection title={t('correctionsTitle')}>
        <p>{t('corrections')}</p>
      </GuideSection>
      <GuideSection title={t('penaltiesTitle')}>
        <p>{t('penalties')}</p>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('pendingTitle')}</p>
          <p className="mt-1">
            {t('pending')}{' '}
            <a href={LINKS.bill} target="_blank" rel="noopener noreferrer" className="font-medium text-primary hover:underline">
              {t('links.bill')}
            </a>
          </p>
        </div>
      </GuideSection>
      <GuideSection title={t('checklistTitle')}>
        <ol className="list-decimal space-y-1.5 pl-5">
          {(t.raw('checklist') as string[]).map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ol>
      </GuideSection>
      <GuideSection title={t('checkTitle')}>
        <p>{t('checkLead')}</p>
        <SkEinvoicingCheck />
      </GuideSection>
      <GuideSection title={t('billantaTitle')}>
        <ul className="space-y-2">
          {features.map((f) => (
            <li key={f.text} className="flex gap-2">
              {f.soon ? (
                <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              )}
              <span>
                {f.text}
                {f.soon && <span className="ml-1.5 rounded bg-secondary px-1.5 py-0.5 text-xs font-semibold text-muted-foreground">{t('soon')}</span>}
              </span>
            </li>
          ))}
        </ul>
      </GuideSection>
      <section>
        <FaqList title={t('faqTitle')} faq={faq} />
      </section>
      <GuideSection title={t('linksTitle')}>
        <ul className="space-y-1.5">
          {(['faq', 'providers', 'law'] as const).map((k) => (
            <li key={k}>
              <a href={LINKS[k]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                {t(`links.${k}`)}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            </li>
          ))}
        </ul>
      </GuideSection>
    </GuidePage>
  );
}
