import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { auth } from '@/auth';
import { Banner } from '@/components/banner';
import { Link } from '@/i18n/navigation';
import { classroomEnabled } from '@/lib/classroom';
import { fetchJoinPreview } from '@/lib/classroom-join';
import { JoinForm } from '../join-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('classroomJoin');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/**
 * The class link a teacher hands out: the class and school by name, then a
 * nickname (no e-mail, no real name) and, when the teacher allows several,
 * the kind of practice company.
 */
export default async function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  if (!classroomEnabled()) notFound();
  const { code } = await params;
  const t = await getTranslations('classroomJoin');
  const [preview, session] = await Promise.all([fetchJoinPreview(decodeURIComponent(code)), auth().catch(() => null)]);
  const signedIn = Boolean(session?.user && !session.isDemo);

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        {!preview ? (
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
            <h1 className="text-xl font-extrabold tracking-tight">{t('notFound.title')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('notFound.body')}</p>
            <Link href="/join" className="mt-4 inline-block text-sm font-semibold text-primary hover:underline">
              {t('notFound.retry')}
            </Link>
          </div>
        ) : (
          <>
            {signedIn && (
              <Banner tone="warn" title={t('signedIn.title')} className="mb-4">
                {t('signedIn.body')}
              </Banner>
            )}
            <JoinForm code={decodeURIComponent(code)} preview={preview} disabled={signedIn} />
          </>
        )}
      </div>
    </div>
  );
}
