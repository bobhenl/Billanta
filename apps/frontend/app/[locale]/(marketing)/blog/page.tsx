import type { Metadata } from 'next';
import { ArrowRight } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { NewsletterSignup } from '@/components/newsletter-signup';
import { normalizeDashes } from '@/components/blog-markdown';
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
    <section className="container max-w-3xl py-12 sm:py-16">
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
      <p className="mt-3 max-w-2xl text-muted-foreground sm:text-lg">{t('lead')}</p>

      {posts.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-8 space-y-3">
          {posts.map((p) => (
            <li key={p.slug}>
              <Link href={`/blog/${p.slug}`} className="group block rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/40">
                <time dateTime={p.publishedAt} className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {formatBlogDate(locale, p.publishedAt)}
                </time>
                <h2 className="mt-1 flex items-start justify-between gap-2 text-lg font-bold leading-snug group-hover:text-primary">
                  {normalizeDashes(p.title)}
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
                </h2>
                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-muted-foreground">{normalizeDashes(p.description)}</p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <NewsletterSignup source="blog" className="mt-10" />
    </section>
  );
}
