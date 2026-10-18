import type { Metadata } from 'next';
import { Check } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { GuidePage, GuideSection, guideMetadata } from '@/components/public-tools/guide-page';
import { VatDeadlines } from '@/components/public-tools/vat-deadlines';
import { getGuide, isPublishedIn } from '@/lib/public-tools';

const SLUG = 'vat-return-control-statement';
type Params = { locale: string };
type Section = { title: string; body: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  return guideMetadata(SLUG, locale);
}

export default async function VatFilingGuide({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Where the guide is not published (sk), GuidePage shows the Czech-rules
  // notice and the catalog has no body, so the body is not even read.
  if (!isPublishedIn(getGuide(SLUG)!, locale)) return <GuidePage slug={SLUG} locale={locale}>{null}</GuidePage>;

  const t = await getTranslations('tools.guides.items.vatFiling');
  const sections = t.raw('sections') as Section[];
  const steps = t.raw('steps') as string[];
  const before = t.raw('before') as string[];

  return (
    <GuidePage slug={SLUG} locale={locale}>
      <VatDeadlines />
      {sections.map((s) => (
        <GuideSection key={s.title} title={s.title}>
          <p>{s.body}</p>
        </GuideSection>
      ))}
      <GuideSection title={t('stepsTitle')}>
        <ol className="space-y-3">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
      </GuideSection>
      <GuideSection title={t('beforeTitle')}>
        <ul className="space-y-3">
          {before.map((s) => (
            <li key={s} className="flex gap-3">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              {s}
            </li>
          ))}
        </ul>
      </GuideSection>
    </GuidePage>
  );
}
