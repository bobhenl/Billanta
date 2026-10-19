import type { Metadata } from 'next';
import { AlertTriangle } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { BlogAutomation, BlogDraftForms } from '@/components/admin-blog';
import { Link } from '@/i18n/navigation';
import { adminBlogFetch, BLOG_STATUS_TONE, type AdminBlogListItem, type BlogAutopublish, type BlogStatus } from '@/lib/admin-blog';
import { formatBlogDate } from '@/lib/blog';
import { NOINDEX } from '@/lib/seo';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminBlog');
  return { title: t('title'), robots: NOINDEX };
}

const ORDER: BlogStatus[] = ['pending_review', 'draft', 'published', 'rejected'];

/** Billanta staff: the review queue for AI drafts and every other blog post. */
export default async function AdminBlogPage() {
  const t = await getTranslations('adminBlog');
  const locale = await getLocale();
  const [posts, autopublish] = await Promise.all([
    adminBlogFetch<AdminBlogListItem[]>(''),
    adminBlogFetch<BlogAutopublish>('/autopublish')
  ]);
  const sorted = [...posts].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-extrabold tracking-tight">{t('title')}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{t('description')}</p>

      <div className="mt-6 space-y-4">
        <BlogAutomation autopublish={autopublish} />
        <BlogDraftForms />
      </div>

      {sorted.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <ul className="mt-6 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
          {sorted.map((p) => (
            <li key={p.id}>
              <Link href={`/admin/blog/${p.id}`} className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-accent sm:flex-row sm:items-center sm:gap-3">
                <span className="flex shrink-0 items-center gap-2">
                  <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', BLOG_STATUS_TONE[p.status])}>{t(`status.${p.status}`)}</span>
                  <span className="text-xs font-bold uppercase text-muted-foreground">{p.locale}</span>
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{p.title}</span>
                <span className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
                  {p.warnings.length > 0 && (
                    <span className="inline-flex items-center gap-1 text-warning">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('warningCount', { n: p.warnings.length })}
                    </span>
                  )}
                  <span>
                    {t(`kind.${p.kind}`)}
                    {p.autoPublished && ` · ${t('autopublish.badge')}`}
                  </span>
                  <time dateTime={p.updatedAt}>{formatBlogDate(locale, p.updatedAt)}</time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
