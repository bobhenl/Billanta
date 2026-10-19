import type { Metadata } from 'next';
import { ArrowRight, Clock } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { LESSON_MINUTES, LESSON_TRACKS, SCHOOL_LESSONS, lessonContent, lessonPublishedIn } from '@/lib/school-lessons';
import { breadcrumbLd, jsonLd, publicPageMetadata, webPageLd } from '@/lib/seo';
import { buttonClass } from '@/lib/ui-classes';

type Params = { locale: string };

const PATH = '/for-schools/lessons';

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'schoolLessons' });
  return publicPageMetadata({ locale, path: PATH, title: t('indexMetaTitle'), description: t('indexMeta') });
}

export default async function SchoolLessonsIndex({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations('schoolLessons');
  const lessons = await Promise.all(
    SCHOOL_LESSONS.filter((l) => lessonPublishedIn(l, locale)).map(async (l) => ({ ...l, content: (await lessonContent(l.slug, locale))! }))
  );
  const tracks = LESSON_TRACKS.map((track) => ({ track, lessons: lessons.filter((l) => l.track === track) })).filter((g) => g.lessons.length);

  return (
    <article className="container py-12 sm:py-16">
      <script type="application/ld+json" dangerouslySetInnerHTML={jsonLd(webPageLd(locale, PATH, 'CollectionPage', t('indexTitle'), t('indexMeta')))} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(
          breadcrumbLd(locale, [
            [t('hubName'), '/for-schools'],
            [t('indexName'), PATH]
          ])
        )}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/for-schools" className="hover:text-foreground">
          {t('hubName')}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{t('indexName')}</span>
      </nav>
      <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{t('indexTitle')}</h1>
      <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{t('indexLead')}</p>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{t('lawBasis')}</p>

      <nav aria-label={t('levelNav')} className="mt-8 flex flex-wrap gap-2">
        {tracks.map(({ track }) => (
          <a
            key={track}
            href={`#${track}`}
            className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-primary/40 hover:text-primary"
          >
            {t(`tracks.${track}.name`)}
          </a>
        ))}
      </nav>

      {tracks.map(({ track, lessons: group }) => (
        <section key={track} id={track} className="mt-12 scroll-mt-24">
          <h2 className="text-2xl font-semibold tracking-tight">{t(`tracks.${track}.name`)}</h2>
          <p className="mt-1 text-sm font-medium text-primary">{t(`tracks.${track}.audience`)}</p>
          <p className="mt-2 max-w-2xl text-muted-foreground">{t(`tracks.${track}.lead`)}</p>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {group.map(({ slug, icon: Icon, content }, i) => (
              <li key={slug}>
                <Link
                  href={`${PATH}/${slug}`}
                  className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('lessonNumber', { n: i + 1 })}</span>
                    <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('minutes', { n: LESSON_MINUTES })}
                    </span>
                  </div>
                  <h3 className="mt-4 font-semibold">{content.name}</h3>
                  <p className="mt-2 flex-1 text-sm text-muted-foreground">{content.lead}</p>
                  <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                    {t('openLesson')}
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ))}

      <section className="mt-14 max-w-3xl">
        <h2 className="text-xl font-semibold">{t('howTitle')}</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground/90">
          {(t.raw('how') as string[]).map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ul>
        <p className="mt-4 text-sm text-muted-foreground">{t('rvpNote')}</p>
        <Link href="/demo" className={`${buttonClass.primary} mt-6`}>
          {t('demoCta')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </section>
    </article>
  );
}
