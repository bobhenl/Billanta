'use client';

import { useEffect, useState } from 'react';
import { useIsTeacher } from '@/lib/use-is-teacher';

/** One request per lesson and page view, shared by the worksheet and the print buttons. */
const cache = new Map<string, Promise<string[] | null>>();

function load(slug: string, locale: string): Promise<string[] | null> {
  const key = `${locale}:${slug}`;
  let pending = cache.get(key);
  if (!pending) {
    const query = new URLSearchParams({ slug, locale });
    pending = fetch(`/api/school-lessons/answers?${query}`, { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<{ answers?: unknown }>) : null))
      .then((data) => (Array.isArray(data?.answers) ? (data.answers as string[]) : null))
      .catch(() => null);
    // A failed load may be retried on the next mount (e.g. after signing in).
    pending.then((answers) => answers ?? cache.delete(key));
    cache.set(key, pending);
  }
  return pending;
}

export type LessonAnswers = { state: 'loading' } | { state: 'locked' } | { state: 'ready'; answers: string[] };

/**
 * The worksheet answers, fetched in the browser for a teacher only
 * (app/api/school-lessons/answers). Everyone else gets `locked` and never
 * sees them: they are not in the page's HTML.
 */
export function useLessonAnswers(slug: string, locale: string): LessonAnswers {
  const teacher = useIsTeacher();
  const [answers, setAnswers] = useState<string[] | null | undefined>(undefined);

  useEffect(() => {
    if (teacher !== 'teacher') return;
    let live = true;
    void load(slug, locale).then((a) => live && setAnswers(a));
    return () => {
      live = false;
    };
  }, [teacher, slug, locale]);

  if (teacher === 'loading') return { state: 'loading' };
  if (teacher === 'other') return { state: 'locked' };
  if (answers === undefined) return { state: 'loading' };
  return answers ? { state: 'ready', answers } : { state: 'locked' };
}
