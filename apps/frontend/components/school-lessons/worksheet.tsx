'use client';

import { Lock, LogIn, UserPlus } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { TEACHER_SIGNUP_HREF } from '@/lib/teacher';
import { useLessonAnswers } from './answers';

export interface WorksheetLabels {
  answer: string;
  locked: string;
  login: string;
  signup: string;
}

/**
 * The worksheet questions, server-rendered like the rest of the lesson, with
 * the answers added in the browser for teachers only. Students and
 * signed-out visitors get a note on how a teacher sees them instead.
 */
export function LessonWorksheet({ slug, locale, questions, labels }: { slug: string; locale: string; questions: string[]; labels: WorksheetLabels }) {
  const answers = useLessonAnswers(slug, locale);
  return (
    <>
      <ol className="list-decimal space-y-5 pl-5">
        {questions.map((q, i) => (
          <li key={q} className="break-inside-avoid">
            <p className="font-medium">{q}</p>
            <div className="answer-lines hidden print:block" aria-hidden="true" />
            {answers.state === 'ready' && answers.answers[i] && (
              <details className="teacher-only mt-2 rounded-xl border border-border bg-card px-3 py-2">
                <summary className="cursor-pointer text-sm font-semibold text-primary">{labels.answer}</summary>
                <p className="mt-2">{answers.answers[i]}</p>
              </details>
            )}
          </li>
        ))}
      </ol>
      {answers.state === 'locked' && (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between print:hidden">
          <p className="flex items-center gap-2 font-medium">
            <Lock className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            {labels.locked}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/login" className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 font-semibold hover:bg-secondary">
              <LogIn className="h-4 w-4" aria-hidden="true" />
              {labels.login}
            </Link>
            <Link
              href={TEACHER_SIGNUP_HREF}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 font-semibold text-primary-foreground hover:opacity-90"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
              {labels.signup}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
