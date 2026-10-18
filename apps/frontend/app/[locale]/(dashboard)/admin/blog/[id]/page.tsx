import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { BlogPostEditor } from '@/components/admin-blog';
import { Link } from '@/i18n/navigation';
import { adminBlogFetch, BLOG_STATUS_TONE, type AdminBlogPost } from '@/lib/admin-blog';
import { NOINDEX } from '@/lib/seo';
import { cn } from '@/lib/utils';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('adminBlog');
  return { title: t('editTitle'), robots: NOINDEX };
}

export default async function AdminBlogPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const t = await getTranslations('adminBlog');
  const post = await adminBlogFetch<AdminBlogPost>(`/${id}`);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/blog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('title')}
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">{t('editTitle')}</h1>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold', BLOG_STATUS_TONE[post.status])}>{t(`status.${post.status}`)}</span>
        <span className="text-xs text-muted-foreground">{t(`kind.${post.kind}`)}</span>
      </div>
      <div className="mt-6">
        <BlogPostEditor post={post} />
      </div>
    </div>
  );
}
