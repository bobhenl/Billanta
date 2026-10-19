/** Classroom mode (docs/classroom-mode-plan.md): shared types and the switch. */
export const CLASSROOM_TRACKS = ['basic', 'standard', 'advanced'] as const;
export type ClassroomTrack = (typeof CLASSROOM_TRACKS)[number];

export const SCHOOL_LEVELS = ['zs', 'ss', 'vos', 'vs', 'course'] as const;
export type SchoolLevel = (typeof SCHOOL_LEVELS)[number];

/** The progress grid's columns, in the backend's order (src/classroom/milestones.ts). */
export const MILESTONES = [
  'contact_created',
  'invoice_issued',
  'invoice_vat',
  'invoice_foreign_currency',
  'invoice_reverse_charge',
  'proforma_converted',
  'quote_created',
  'credit_note_issued',
  'invoice_paid',
  'bank_matched',
  'expense_recorded',
  'recurring_created',
  'time_logged'
] as const;

/** Server-only: the backend needs its own `CLASSROOM_ENABLED` too; this hides the entry points. */
export const classroomEnabled = () => process.env.CLASSROOM_ENABLED === 'true' && Boolean(process.env.DEMO_PROVISION_SECRET);

/** GET /api/v1/classroom/me */
export interface TeacherStatus {
  teacher: { id: string; name: string; subject: string | null; status: 'pending' | 'approved' | 'rejected' } | null;
  school: { id: string; name: string; country: 'CZ' | 'SK'; level: SchoolLevel; suggestedTrack: ClassroomTrack; suspended: boolean } | null;
}

export interface ClassSummary {
  id: string;
  name: string;
  track: ClassroomTrack;
  language: 'cs' | 'sk' | 'en';
  kinds: string[];
  modules: Record<string, boolean>;
  seeded: boolean;
  joinCode: string;
  joinUrl: string;
  enrolmentOpen: boolean;
  maxStudents: number;
  endsAt: string;
  deletesAt: string;
  ended: boolean;
  isOwner: boolean;
  createdAt: string;
  students?: number;
}

export interface ClassStudent {
  id: string;
  nickname: string;
  kind: string;
  tenantId: string;
  joinedAt: string;
  code: string;
  progress: Record<string, number>;
}

export interface ClassDetail extends Omit<ClassSummary, 'students'> {
  school: { name: string; country: 'CZ' | 'SK' };
  owner: { id: string; name: string };
  coTeachers: { id: string; name: string }[];
  milestones: string[];
  students: ClassStudent[];
}

/** GET /api/v1/classroom/student: the banner inside a practice company. */
export interface StudentCompany {
  classId: string;
  className: string;
  nickname: string;
  kind: string;
  own: boolean;
  joinUrl: string;
  reentryCode: string | null;
  endsAt: string;
  deletesAt: string;
  readOnly: boolean;
}

/** POST /api/v1/public/classroom/preview */
export interface JoinPreview {
  className: string;
  schoolName: string;
  language: 'cs' | 'sk' | 'en';
  companyKinds: string[];
  enrolmentOpen: boolean;
  ended: boolean;
}
