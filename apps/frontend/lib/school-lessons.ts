import {
  ArrowLeftRight,
  BadgeCheck,
  Banknote,
  CalendarClock,
  CircleCheck,
  FileMinus,
  FilePen,
  FileQuestion,
  FileText,
  Globe,
  Handshake,
  Landmark,
  Mail,
  Percent,
  Receipt,
  BellRing,
  type LucideIcon
} from 'lucide-react';
import type { DemoKind } from '@/lib/demo';
import { scenarioKind, type DemoScenarioKey } from '@/lib/demo-scenarios';

/**
 * Ready-to-teach lessons for schools (/for-schools/lessons), grouped by
 * track: financial literacy at ZŠ, business schools, and VOŠ/VŠ or courses.
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
  /** Demo preset the student task starts (company and landing page), see lib/demo-scenarios.ts. */
  scenario: DemoScenarioKey;
  /**
   * Classroom-mode milestones the task should produce in the student's
   * practice company (docs/classroom-mode-plan.md on the classroom branch).
   * Empty where the task ends with drafts or paper work.
   */
  milestones: readonly string[];
  /**
   * Classroom-mode track: basic (ZŠ), standard (SŠ/OA), advanced (VOŠ/VŠ).
   * The index groups lessons by it and numbers them within the track.
   */
  track: LessonTrack;
}

export type LessonTrack = 'basic' | 'standard' | 'advanced';

export const LESSON_TRACKS: readonly LessonTrack[] = ['basic', 'standard', 'advanced'];

const CZ_ONLY = ['cs', 'en'] as const;

/** When the legal references in the lessons were last checked against the consolidated texts. */
export const LESSONS_CHECKED = '2026-10-19';

export const LESSON_MINUTES = 45;

export const SCHOOL_LESSONS: SchoolLesson[] = [
  { slug: 'invoice-essentials', icon: FileText, scenario: 'vatInvoices', milestones: ['invoice_issued', 'invoice_vat'], track: 'standard' },
  { slug: 'vat-payers-and-registries', icon: BadgeCheck, scenario: 'registries', milestones: ['contact_created'], track: 'standard' },
  { slug: 'tax-point-and-due-dates', icon: CalendarClock, scenario: 'vatInvoices', milestones: [], track: 'standard' },
  { slug: 'vat-rates-and-rounding', icon: Percent, scenario: 'vatInvoices', milestones: [], track: 'standard' },
  { slug: 'advances-and-proforma', icon: Receipt, scenario: 'vatInvoices', milestones: ['proforma_converted'], track: 'standard' },
  { slug: 'credit-notes', icon: FileMinus, scenario: 'vatInvoices', milestones: ['credit_note_issued'], track: 'standard' },
  { slug: 'foreign-customers-reverse-charge', icon: Globe, scenario: 'vatInvoices', milestones: ['invoice_foreign_currency', 'invoice_reverse_charge'], track: 'advanced' },
  { slug: 'payment-reminders-late-interest', icon: BellRing, scenario: 'vatOverdue', milestones: [], track: 'standard' },
  { slug: 'flat-tax', icon: Banknote, locales: CZ_ONLY, scenario: 'flatTax', milestones: ['invoice_issued'], track: 'standard' },
  { slug: 'what-is-an-invoice', icon: FileQuestion, scenario: 'invoices', milestones: [], track: 'basic' },
  { slug: 'first-invoice', icon: FilePen, scenario: 'firstInvoice', milestones: ['contact_created', 'invoice_issued'], track: 'basic' },
  { slug: 'paid-or-unpaid', icon: CircleCheck, scenario: 'overdue', milestones: ['invoice_paid'], track: 'basic' },
  { slug: 'simple-reminder', icon: Mail, scenario: 'overdue', milestones: [], track: 'basic' },
  { slug: 'vat-return-control-statement', icon: Landmark, scenario: 'vatInvoices', milestones: ['expense_recorded'], track: 'advanced' },
  { slug: 'bank-matching-expenses', icon: ArrowLeftRight, scenario: 'bank', milestones: ['bank_matched', 'expense_recorded'], track: 'advanced' },
  { slug: 'working-with-accountant', icon: Handshake, scenario: 'accountant', milestones: ['expense_recorded'], track: 'advanced' }
];

export const getLesson = (slug: string) => SCHOOL_LESSONS.find((l) => l.slug === slug);

export const lessonPublishedIn = (lesson: SchoolLesson, locale: string) => !lesson.locales || lesson.locales.includes(locale);

/** Position of the lesson within its track among the lessons published in this language (1-based). */
export const lessonNumberInTrack = (lesson: SchoolLesson, locale: string) =>
  SCHOOL_LESSONS.filter((l) => l.track === lesson.track && lessonPublishedIn(l, locale)).indexOf(lesson) + 1;

/** The demo company for the lesson in this language: Slovak law in sk, Czech law elsewhere. */
export const lessonDemoKind = (lesson: SchoolLesson, locale: string): DemoKind => scenarioKind(lesson.scenario, locale);

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
