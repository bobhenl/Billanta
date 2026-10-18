import {
  BadgeCheck,
  Banknote,
  CalendarClock,
  FileMinus,
  FileText,
  Globe,
  Percent,
  Receipt,
  BellRing,
  type LucideIcon
} from 'lucide-react';
import type { DemoKind } from '@/lib/demo';

/**
 * Ready-to-teach lessons for business schools (/for-schools/lessons).
 *
 * The lesson text itself lives in content/school-lessons/<locale>.json and
 * is read only by server components: it is long, and the dashboard layout
 * hands every message to the client provider, so it stays out of
 * messages/*.json. Only the page labels are messages (schools.lessons).
 *
 * The sk copy follows Slovak law, not a translation of the Czech one; en
 * follows Czech law and says so. A lesson about a Czech-only regime (flat
 * tax) is published in cs and en only, like the Czech calculators in
 * lib/public-tools.ts, and its sk URL shows a noindex pointer.
 */
export interface SchoolLesson {
  slug: string;
  icon: LucideIcon;
  /** Languages the lesson is published in (default: all). */
  locales?: readonly string[];
  /** Demo company the student task uses, per legal system. */
  demo: { cz: DemoKind; sk: DemoKind };
  /**
   * Classroom-mode milestones the task should produce in the student's
   * practice company (docs/classroom-mode-plan.md on the classroom branch).
   * Empty where the task ends with drafts or paper work.
   */
  milestones: readonly string[];
}

const CZ_ONLY = ['cs', 'en'] as const;

/** When the legal references in the lessons were last checked against the consolidated texts. */
export const LESSONS_CHECKED = '2026-10-19';

export const LESSON_MINUTES = 45;

export const SCHOOL_LESSONS: SchoolLesson[] = [
  { slug: 'invoice-essentials', icon: FileText, demo: { cz: 'cz_vat_sro', sk: 'sk_vat_sro' }, milestones: ['invoice_issued', 'invoice_vat'] },
  { slug: 'vat-payers-and-registries', icon: BadgeCheck, demo: { cz: 'cz_freelancer', sk: 'sk_vat_sro' }, milestones: ['contact_created'] },
  { slug: 'tax-point-and-due-dates', icon: CalendarClock, demo: { cz: 'cz_vat_sro', sk: 'sk_vat_sro' }, milestones: [] },
  { slug: 'vat-rates-and-rounding', icon: Percent, demo: { cz: 'cz_vat_sro', sk: 'sk_vat_sro' }, milestones: [] },
  { slug: 'advances-and-proforma', icon: Receipt, demo: { cz: 'cz_vat_sro', sk: 'sk_vat_sro' }, milestones: ['proforma_converted'] },
  { slug: 'credit-notes', icon: FileMinus, demo: { cz: 'cz_vat_sro', sk: 'sk_vat_sro' }, milestones: ['credit_note_issued'] },
  { slug: 'foreign-customers-reverse-charge', icon: Globe, demo: { cz: 'cz_vat_sro', sk: 'sk_vat_sro' }, milestones: ['invoice_foreign_currency', 'invoice_reverse_charge'] },
  { slug: 'payment-reminders-late-interest', icon: BellRing, demo: { cz: 'cz_vat_sro', sk: 'sk_vat_sro' }, milestones: [] },
  { slug: 'flat-tax', icon: Banknote, locales: CZ_ONLY, demo: { cz: 'cz_pausal', sk: 'cz_pausal' }, milestones: ['invoice_issued'] }
];

export const getLesson = (slug: string) => SCHOOL_LESSONS.find((l) => l.slug === slug);

export const lessonPublishedIn = (lesson: SchoolLesson, locale: string) => !lesson.locales || lesson.locales.includes(locale);

/** The demo company for the lesson in this language: Slovak law in sk, Czech law elsewhere. */
export const lessonDemoKind = (lesson: SchoolLesson, locale: string): DemoKind => (locale === 'sk' ? lesson.demo.sk : lesson.demo.cz);

export interface LessonLink {
  label: string;
  href: string;
}

export interface LessonContent {
  title: string;
  /** Short name for cards and the breadcrumb. */
  name: string;
  lead: string;
  metaDescription: string;
  goals: string[];
  teacherNotes: string[];
  timeline: { min: string; text: string }[];
  concepts: { title: string; body: string }[];
  task: { intro: string; steps: string[]; check: string };
  worksheet: { q: string; a: string }[];
  law: LessonLink[];
  tools: LessonLink[];
}

type LessonFile = Record<string, LessonContent>;

const loaders: Record<string, () => Promise<{ default: LessonFile }>> = {
  cs: () => import('@/content/school-lessons/cs.json') as Promise<{ default: LessonFile }>,
  sk: () => import('@/content/school-lessons/sk.json') as Promise<{ default: LessonFile }>,
  en: () => import('@/content/school-lessons/en.json') as Promise<{ default: LessonFile }>
};

/** Server-only: the lesson text in one language (undefined where it is not published). */
export async function lessonContent(slug: string, locale: string): Promise<LessonContent | undefined> {
  const load = loaders[locale];
  if (!load) return undefined;
  return (await load()).default[slug];
}
