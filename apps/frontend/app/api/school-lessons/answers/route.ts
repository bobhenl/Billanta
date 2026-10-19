import { NextResponse } from 'next/server';
import { getLesson, lessonContent, lessonPublishedIn } from '@/lib/school-lessons';
import { isTeacher } from '@/lib/teacher-server';

const PRIVATE = { 'cache-control': 'private, no-store' };

/**
 * The worksheet answers of one lesson, for teachers only. The lesson pages
 * are static and indexable, so the answers are never in their HTML: a
 * signed-in teacher's browser fetches them from here once the session is
 * known (components/school-lessons/worksheet.tsx).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const lesson = getLesson(url.searchParams.get('slug') ?? '');
  const locale = url.searchParams.get('locale') ?? '';
  if (!lesson || !lessonPublishedIn(lesson, locale)) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: PRIVATE });
  if (!(await isTeacher())) return NextResponse.json({ error: 'teachers_only' }, { status: 403, headers: PRIVATE });
  const content = await lessonContent(lesson.slug, locale);
  if (!content) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: PRIVATE });
  return NextResponse.json({ answers: content.worksheet.map((w) => w.a) }, { headers: PRIVATE });
}
