import type { Metadata } from 'next';
import { ArrowRight, Clock, ExternalLink } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { CzOnlyNotice } from '@/components/public-tools/parts';
import { LessonPrintButtons } from '@/components/school-lessons/print-buttons';
import { Link } from '@/i18n/navigation';
import {
  LESSON_MINUTES,
  LESSONS_CHECKED,
  SCHOOL_LESSONS,
  getLesson,
  lessonContent,
  lessonDemoKind,
  lessonNumberInTrack,
  lessonPublishedIn,
  type LessonTrack
} from '@/lib/school-lessons';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { buttonClass } from '@/lib/ui-classes';

type Params = { locale: string; slug: string };

const HUB = '/for-schools/lessons';

const EDUCATIONAL_LEVEL: Record<LessonTrack, string> = {
  basic: 'lower secondary',
  standard: 'upper secondary',
  advanced: 'higher education'
};

export function generateStaticParams() {
  return SCHOOL_LESSONS.map((l) => ({ slug: l.slug }));
}

export const dynamicParams = false;

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const lesson = getLesson(slug);
  if (!lesson) return {};
  const content = await lessonContent(slug, locale);
  // The sk copy of a Czech-only lesson is a noindex pointer, like the Czech calculators.
  if (!content || !lessonPublishedIn(lesson, locale)) {
    const cs = (await lessonContent(slug, 'cs'))!;
    return { title: cs.name, robots: { index: false, follow: true } };
  }
  return publicPageMetadata({ locale, path: `${HUB}/${slug}`, title: content.title, description: content.metaDescription, locales: lesson.locales });
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  );
}

function OutLink({ href, label }: { href: string; label: string }) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} className="inline-flex items-center gap-1 text-primary hover:underline">
        {label}
        <ArrowRight className="h-3.5 w-3.5 print:hidden" aria-hidden="true" />
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-primary hover:underline">
      {label}
      <ExternalLink className="h-3.5 w-3.5 print:hidden" aria-hidden="true" />
    </a>
  );
}

export default async function SchoolLessonPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const lesson = getLesson(slug);
  if (!lesson) notFound();
  const t = await getTranslations('schoolLessons');

  if (!lessonPublishedIn(lesson, locale)) {
    const cs = (await lessonContent(slug, 'cs'))!;
    return (
      <CzOnlyNotice
        name={cs.name}
        path={`${HUB}/${slug}`}
        skAlternative={{ href: '/calculators/slovak-self-employed-tax', name: t('skAlternative') }}
      />
    );
  }

  const c = (await lessonContent(slug, locale))!;
  const tDemo = await getTranslations('demo.kinds');
  const format = await getFormatter();
  const path = `${HUB}/${slug}`;
  const kind = tDemo(`${lessonDemoKind(lesson, locale)}.title`);
  const checked = format.dateTime(new Date(`${LESSONS_CHECKED}T12:00:00Z`), { dateStyle: 'long', timeZone: 'Europe/Prague' });
  const number = lessonNumberInTrack(lesson, locale);

  const learningResource = {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: c.title,
    description: c.metaDescription,
    inLanguage: locale,
    url: `${SITE_URL}/${locale}${path}`,
    learningResourceType: 'lesson plan',
    educationalLevel: EDUCATIONAL_LEVEL[lesson.track],
    timeRequired: `PT${LESSON_MINUTES}M`,
    isAccessibleForFree: true,
    teaches: c.goals,
    provider: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL }
  };

  return (
    <article className="container py-12 sm:py-16" data-print-sheet>
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(learningResource)} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(
          breadcrumbLd(locale, [
            [t('hubName'), '/for-schools'],
            [t('indexName'), HUB],
            [c.name, path]
          ])
        )}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground print:hidden">
        <Link href="/for-schools" className="hover:text-foreground">
          {t('hubName')}
        </Link>
        <span className="mx-2">/</span>
        <Link href={HUB} className="hover:text-foreground">
          {t('indexName')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{c.name}</span>
      </nav>

      <div className="mt-4 flex items-start gap-4">
        <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary sm:flex print:hidden">
          <lesson.icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Link href={`${HUB}#${lesson.track}`} className="hover:text-foreground print:hidden">
              {t(`tracks.${lesson.track}.name`)}
            </Link>
            <span className="mx-2 print:hidden">·</span>
            {t('lessonNumber', { n: number })}
            <span className="mx-2">·</span>
            <Clock className="-mt-0.5 inline h-3.5 w-3.5" aria-hidden="true" /> {t('minutes', { n: LESSON_MINUTES })}
          </p>
          <h1 className="mt-2 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{c.title}</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{c.lead}</p>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{t('lawBasis')}</p>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/demo" className={buttonClass.primary}>
          {t('demoCta')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <LessonPrintButtons student={t('printStudent')} teacher={t('printTeacher')} />
      </div>

      <div className="mt-10 max-w-3xl space-y-10 print:mt-6 print:space-y-6">
        <Section title={t('goals')}>
          <ul className="list-disc space-y-1.5 pl-5">
            {c.goals.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </Section>

        <section className="teacher-only rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-5">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">{t('teacherOnly')}</p>
          <h2 className="mt-3 text-xl font-semibold">{t('timeline')}</h2>
          <ol className="mt-3 space-y-2 text-sm leading-relaxed text-foreground/90">
            {c.timeline.map((s) => (
              <li key={s.min} className="flex gap-3">
                <span className="w-14 shrink-0 font-semibold tabular-nums text-muted-foreground">{s.min}</span>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
          <h2 className="mt-6 text-xl font-semibold">{t('teacherNotes')}</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground/90">
            {c.teacherNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </section>

        <Section title={t('concepts')}>
          <dl className="space-y-4">
            {c.concepts.map((k) => (
              <div key={k.title}>
                <dt className="font-semibold">{k.title}</dt>
                <dd className="mt-1">{k.body}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section title={t('task')} className="print:break-before-page">
          <p>{c.task.intro}</p>
          <p className="rounded-xl border border-border bg-card p-3 print:hidden">{t('demoPick', { kind })}</p>
          <ol className="list-decimal space-y-2 pl-5">
            {c.task.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <p>
            <strong>{t('check')}:</strong> {c.task.check}
          </p>
        </Section>

        <Section title={t('worksheet')} className="print:break-before-page">
          <p className="hidden print:block">
            {t('worksheetName')} ______________________________
          </p>
          <ol className="list-decimal space-y-5 pl-5">
            {c.worksheet.map((w) => (
              <li key={w.q} className="break-inside-avoid">
                <p className="font-medium">{w.q}</p>
                <div className="answer-lines hidden print:block" aria-hidden="true" />
                <details className="teacher-only mt-2 rounded-xl border border-border bg-card px-3 py-2">
                  <summary className="cursor-pointer text-sm font-semibold text-primary">{t('answer')}</summary>
                  <p className="mt-2">{w.a}</p>
                </details>
              </li>
            ))}
          </ol>
        </Section>

        <Section title={t('law')}>
          <ul className="space-y-1.5">
            {c.law.map((l) => (
              <li key={l.href + l.label}>
                <OutLink {...l} />
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground">{t('lawNote')}</p>
        </Section>

        <Section title={t('tools')} className="print:hidden">
          <ul className="space-y-1.5">
            {c.tools.map((l) => (
              <li key={l.href}>
                <OutLink {...l} />
              </li>
            ))}
          </ul>
        </Section>

        <p className="text-xs text-muted-foreground">{t('checked', { date: checked })}</p>

        <Link href={HUB} className={`${buttonClass.secondary} print:hidden`}>
          {t('allLessons')}
        </Link>
      </div>
    </article>
  );
}
