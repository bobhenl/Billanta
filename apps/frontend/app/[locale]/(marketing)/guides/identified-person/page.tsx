import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GuidePage, GuideSection, guideMetadata } from '@/components/public-tools/guide-page';
import { glossaryLinker } from '@/components/glossary-linker';
import { getGuide, isPublishedIn } from '@/lib/public-tools';

const SLUG = 'identified-person';
type Params = { locale: string };
type Section = { title: string; body: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return guideMetadata(SLUG, locale);
}

export default async function IdentifiedPersonGuide({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Not published in sk: GuidePage shows the Czech-rules notice instead.
  if (!isPublishedIn(getGuide(SLUG)!, locale)) return <GuidePage slug={SLUG} locale={locale}>{null}</GuidePage>;

  const t = await getTranslations('tools.guides.items.identified');
  const [who, ads, filing, payer] = t.raw('sections') as Section[];
  const whoList = t.raw('who') as string[];
  // Glossary terms are linked where they first appear on the page.
  const link = glossaryLinker(locale);

  return (
    <GuidePage slug={SLUG} locale={locale}>
      <GuideSection title={who!.title}>
        <p>{link(who!.body)}</p>
        <ul className="list-disc space-y-1.5 pl-5">
          {whoList.map((w) => (
            <li key={w}>{link(w)}</li>
          ))}
        </ul>
      </GuideSection>
      <GuideSection title={t('registrationTitle')}>
        <p>{link(t('registration'))}</p>
      </GuideSection>
      <GuideSection title={ads!.title}>
        <p>{link(ads!.body)}</p>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('exampleTitle')}</p>
          <p className="mt-1">{link(t('example'))}</p>
        </div>
      </GuideSection>
      <GuideSection title={filing!.title}>
        <p>{link(filing!.body)}</p>
      </GuideSection>
      <GuideSection title={payer!.title}>
        <p>{link(payer!.body)}</p>
      </GuideSection>
    </GuidePage>
  );
}
