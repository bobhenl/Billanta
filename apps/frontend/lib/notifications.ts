/** The header bell and Settings → Notifikace (backend: `v1/me/notifications`). */
export interface AppNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

export const NOTIFICATION_EVENTS = [
  'invoice_paid',
  'invoice_viewed',
  'invoice_overdue',
  'reminder_sent',
  'invoice_sent',
  'draft_ready',
  'bank_import',
  'member_joined',
  'quote_response',
  'buyer_details',
  'profile_message'
] as const;
export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number];

export interface NotificationPrefs {
  events: Record<NotificationEvent, { app: boolean; email: boolean }>;
  browserPopups: boolean;
}

/** Lucide-free colour per event, for the bell's dots. */
export const EVENT_TONE: Record<string, string> = {
  invoice_paid: 'bg-emerald-500',
  invoice_viewed: 'bg-sky-500',
  invoice_overdue: 'bg-red-500',
  reminder_sent: 'bg-amber-500',
  invoice_sent: 'bg-primary',
  draft_ready: 'bg-violet-500',
  bank_import: 'bg-teal-500',
  member_joined: 'bg-pink-500',
  quote_response: 'bg-indigo-500',
  buyer_details: 'bg-cyan-500',
  profile_message: 'bg-violet-500',
  security_alert: 'bg-red-600'
};
