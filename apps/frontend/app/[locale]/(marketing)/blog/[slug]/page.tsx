import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowRight, Sparkles } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { routing } from '@/i18n/routing';
import { BlogMarkdown } from '@/components/blog-markdown';
import { NewsletterSignup } from '@/components/newsletter-signup';
import { fetchBlogPost, formatBlogDate, isAiWritten, type BlogPost } from '@/lib/blog';
import { breadcrumbLd, jsonLd, publicPageMetadata } from '@/lib/seo';
import { SITE_NAME, SITE_URL } from '@/lib/site';

type Params = { locale: string; slug: string };

/** translation_key of the article on Slovak e-invoicing from 2027 (same in every language). */
const SK_EINVOICING_KEY = 'slovakia-e-invoicing-2027';

/** hreflang from the post's own published translations, which may use other slugs. */
function alternates(locale: string, post: BlogPost): NonNullable<Metadata['alternates']> {
  const languages: Record<string, string> = { [locale]: `${SITE_URL}/${locale}/blog/${post.slug}` };
  for (const a of post.alternates) languages[a.locale] = `${SITE_URL}/${a.locale}/blog/${a.slug}`;
  languages['x-default'] = languages[routing.defaultLocale] ?? languages[locale]!;
  return { canonical: languages[locale], languages };
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale, slug } = await params;
  const post = await fetchBlogPost(locale, slug);
  if (!post) return {};
  const meta = publicPageMetadata({ locale, path: '/blog', title: post.title, description: post.description });
  return {
    ...meta,
    alternates: alternates(locale, post),
    openGraph: { ...meta.openGraph, type: 'article', url: `${SITE_URL}/${locale}/blog/${post.slug}`, publishedTime: post.publishedAt, modifiedTime: post.updatedAt }
  };
}

export default async function BlogPostPage({ params }: { params: Promise<Params> }) {
  const { locale, slug } = await params;
  const post = await fetchBlogPost(locale, slug);
  if (!post) notFound();
  const t = await getTranslations('blog');
  const path = `/blog/${post.slug}`;
  const ai = isAiWritten(post.kind);

  return (
    <article className="container max-w-3xl py-10 sm:py-14">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={jsonLd([
          {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: post.title,
            description: post.description,
            datePublished: post.publishedAt,
            dateModified: post.updatedAt,
            inLanguage: locale,
            url: `${SITE_URL}/${locale}${path}`,
            // No author for AI posts: claiming one would pass machine text off as someone's work.
            ...(ai ? {} : { author: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL } }),
            publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_URL }
          },
          breadcrumbLd(locale, [
            [SITE_NAME, '/'],
            [t('title'), '/blog'],
            [post.title, path]
          ])
        ])}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href="/blog" className="hover:text-foreground">
          {t('title')}
        </Link>
      </nav>
      <h1 className="mt-4 text-3xl font-extrabold tracking-tight sm:text-4xl">{post.title}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        <time dateTime={post.publishedAt}>{formatBlogDate(locale, post.publishedAt)}</time>
        {post.updatedAt.slice(0, 10) > post.publishedAt.slice(0, 10) && (
          <> · {t('updated', { date: formatBlogDate(locale, post.updatedAt) })}</>
        )}
      </p>
      {ai && (
        <p className="mt-4 flex gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {/* Claim a human review only when the backend says so (an older backend sends no flag). */}
            {t.rich(post.autoPublished === false ? 'aiReviewed' : 'aiAuto', {
              contact: (chunks) => (
                <Link href="/contact" className="text-primary underline underline-offset-2 hover:no-underline">
                  {chunks}
                </Link>
              )
            })}
          </span>
        </p>
      )}
      <p className="mt-6 text-lg text-muted-foreground">{post.description}</p>

      <div className="mt-8">
        <BlogMarkdown body={post.body} />
      </div>

      {post.sources.length > 0 && (
        <section className="mt-10 border-t border-border pt-6">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('sources')}</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {post.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:no-underline">
                  {s.title}
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">{t('disclaimer')}</p>
        </section>
      )}

      <div className="mt-10 rounded-2xl border border-primary/20 bg-primary/5 p-6">
        <h2 className="text-lg font-bold">{t('ctaTitle')}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t('ctaBody')}</p>
        <Link href="/signup" className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
          {t('ctaButton')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {/* The SK e-invoicing article signs people up for exactly that topic. */}
      {post.translationKey === SK_EINVOICING_KEY ? (
        <NewsletterSignup source="sk_einvoicing" country="SK" topics={['sk_einvoicing', 'deadlines']} className="mt-10" />
      ) : (
        <NewsletterSignup source="blog" className="mt-10" />
      )}
    </article>
  );
}
