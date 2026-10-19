const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export interface BlogSource {
  title: string;
  url: string;
}

/** manual: written by a person; brief: AI from an admin's facts; the rest: AI from our own data. */
export type BlogKind = 'manual' | 'brief' | 'tax_deadlines' | 'tool_howto' | 'trade_invoicing';

export interface BlogListItem {
  slug: string;
  title: string;
  description: string;
  kind: BlogKind;
  publishedAt: string;
}

export interface BlogPost extends BlogListItem {
  translationKey: string;
  body: string;
  sources: BlogSource[];
  updatedAt: string;
  alternates: { locale: string; slug: string }[];
}

export interface BlogSitemapItem {
  locale: string;
  slug: string;
  translationKey: string;
  updatedAt: string;
}

/**
 * Published posts from the public backend endpoint, cached for five minutes
 * so a post goes live shortly after it is published. An unreachable backend
 * means an empty blog, never a broken marketing site.
 */
async function getJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/blog${path}`, {
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(3000)
    });
    return res.ok ? ((await res.json()) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const fetchBlogPosts = (locale: string) => getJson<BlogListItem[]>(`/${locale}`, []);

export const fetchBlogPost = (locale: string, slug: string) =>
  /^[a-z0-9-]{1,100}$/.test(slug) ? getJson<BlogPost | null>(`/${locale}/${slug}`, null) : Promise.resolve(null);

export const fetchBlogSitemap = () => getJson<BlogSitemapItem[]>('/sitemap', []);

export function formatBlogDate(locale: string, iso: string): string {
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-GB' : locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso));
}
