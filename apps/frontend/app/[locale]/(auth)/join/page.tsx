import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { classroomEnabled } from '@/lib/classroom';
import { CodeEntry } from './join-form';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('classroomJoin');
  return { title: t('title'), robots: { index: false, follow: false } };
}

/** For a student who has the class code but not the link. */
export default function JoinCodePage() {
  if (!classroomEnabled()) notFound();
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-12">
      <div className="w-full max-w-md">
        <CodeEntry />
      </div>
    </div>
  );
}
