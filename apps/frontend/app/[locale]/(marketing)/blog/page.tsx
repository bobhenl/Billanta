import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { fetchBlogPosts, formatBlogDate } from '@/lib/blog';
import { breadcrumbLd, jsonLd, NOINDEX, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME } from '@/lib/site';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'blog' });
  const posts = await fetchBlogPosts(locale);
  const meta = publicPageMetadata({ locale, path: '/blog', title: t('seoTitle'), description: t('lead') });
  // An empty list is a thin page; it becomes indexable with its first post.
  return posts.length ? meta : { ...meta, robots: NOINDEX };
}

/**
 * Billanta's blog: tax deadlines, legislation and how-tos. Posts live in the
 * backend (`blog_posts`) so a staff member can publish without a deploy.
 */
export default async function BlogIndexPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations('blog');
  const posts = await fetchBlogPosts(locale);

  return (
    <section className="container max-w-3xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd(
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/blog']
          ])
        )}
      />
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{t('title')}</h1>
      <p className="mt-3 text-base text-muted-foreground sm:text-lg">{t('lead')}</p>

      {posts.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-8 space-y-4">
          {posts.map((p) => (
            <li key={p.slug}>
              <Link href={`/blog/${p.slug}`} className="group block rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary">
                <time dateTime={p.publishedAt} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {formatBlogDate(locale, p.publishedAt)}
                </time>
                <h2 className="mt-1 text-lg font-bold group-hover:text-primary">{p.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{p.description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary">
                  {t('read')}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
