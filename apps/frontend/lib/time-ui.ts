/** Shapes returned by the backend's `/api/v1/projects` and `/api/v1/time-entries`. */

export interface Project {
  id: string;
  name: string;
  contactId: string | null;
  contactName?: string | null;
  hourlyRate: string | null;
  currency: string;
  color: string | null;
  archived: boolean;
  unbilledMinutes?: number;
  totalMinutes?: number;
}

export interface TimeEntry {
  id: string;
  projectId: string | null;
  contactId: string | null;
  description: string;
  startedAt: string;
  endedAt: string | null;
  minutes: number;
  hourlyRate: string | null;
  billable: boolean;
  invoiceId: string | null;
  projectName?: string | null;
  projectColor?: string | null;
  contactName?: string | null;
  invoiceNumber?: string | null;
  currency?: string;
  rate?: number | null;
  amount?: number | null;
}

export interface RunningTimer extends TimeEntry {
  projectName: string | null;
}

export interface TimeSummary {
  weekMinutes: number;
  unbilledMinutes: number;
  unbilled: { currency: string; amount: number }[];
  running: RunningTimer | null;
}

export type EntryState = 'unbilled' | 'billed' | 'nonbillable';

export const entryState = (e: TimeEntry): EntryState => (e.invoiceId ? 'billed' : e.billable ? 'unbilled' : 'nonbillable');

export const ENTRY_STATE_CLASSES: Record<EntryState, string> = {
  unbilled: 'bg-warning/15 text-warning',
  billed: 'bg-success/15 text-success',
  nonbillable: 'bg-muted text-muted-foreground'
};

/** 95 → "1:35". */
export function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Elapsed seconds → "1:05:09". */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** "1:30", "1,5", "90m", "2h" → minutes (null when it can't be read). */
export function parseDuration(value: string): number | null {
  const v = value.trim().toLowerCase().replace(/\s/g, '');
  if (!v) return null;
  const hm = /^(\d{1,4}):(\d{1,2})$/.exec(v);
  if (hm) return Number(hm[1]) * 60 + Number(hm[2]);
  const min = /^(\d{1,6})m(in)?$/.exec(v);
  if (min) return Number(min[1]);
  const h = /^(\d{1,4}(?:[.,]\d+)?)h?$/.exec(v);
  if (h) return Math.round(Number(h[1]!.replace(',', '.')) * 60);
  return null;
}
