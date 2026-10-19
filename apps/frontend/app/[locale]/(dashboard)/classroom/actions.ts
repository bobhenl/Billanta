'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, fetchMyCompanies, isStudentCompanyOfOthers } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import type { ClassSummary } from '@/lib/classroom';
import { switchTenant } from '@/lib/tenant-actions';
import type { SettingsResult } from '../settings/actions';

/** JWT-only endpoints under /api/v1/classroom; the X-Tenant-Id apiFetch adds is ignored there. */
async function call<T>(path: string, method: string, body?: unknown): Promise<SettingsResult<T>> {
  try {
    const data = await apiFetch<T>(`/api/v1/classroom${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    revalidatePath('/[locale]/(dashboard)/classroom', 'layout');
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

const cls = (id: string) => `/classes/${encodeURIComponent(id)}`;

export interface ApplyInput {
  country: 'CZ' | 'SK';
  ico: string;
  schoolName: string;
  level: string;
  legalForm?: string;
  address?: string;
  webUrl?: string;
  name: string;
  subject?: string;
  expectedStudents?: number;
  acceptTerms: true;
}

export const applyAsTeacher = async (input: ApplyInput) => call('/apply', 'POST', input);
export const inviteColleague = async (email: string) => call<{ approved: boolean }>('/invites', 'POST', { email });

export interface CreateClassInput {
  name: string;
  track: string;
  language: string;
  kinds?: string[];
  seeded?: boolean;
  endsAt?: string;
}

export const createClass = async (input: CreateClassInput) => call<ClassSummary>('/classes', 'POST', input);
export const updateClass = async (id: string, patch: { name?: string; enrolmentOpen?: boolean; kinds?: string[] }) =>
  call<ClassSummary>(cls(id), 'PATCH', patch);
export const rotateJoinCode = async (id: string) => call<ClassSummary>(`${cls(id)}/join-code`, 'POST');
export const extendClass = async (id: string, endsAt?: string) => call<ClassSummary>(`${cls(id)}/extend`, 'POST', endsAt ? { endsAt } : {});
export const addCoTeacher = async (id: string, teacherId: string) => call(`${cls(id)}/teachers`, 'POST', { teacherId });
export const removeCoTeacher = async (id: string, teacherId: string) => call(`${cls(id)}/teachers/${encodeURIComponent(teacherId)}`, 'DELETE');
export const newStudentCode = async (id: string, studentId: string) =>
  call<{ code: string }>(`${cls(id)}/students/${encodeURIComponent(studentId)}/code`, 'POST');
export const removeStudent = async (id: string, studentId: string) => call(`${cls(id)}/students/${encodeURIComponent(studentId)}`, 'DELETE');
export const deleteClass = async (id: string) => call(cls(id), 'DELETE');

/** Opens a student's practice company, where the teacher is a viewer. */
export async function openStudentCompany(tenantId: string): Promise<SettingsResult> {
  const result = await switchTenant(tenantId);
  return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.error };
}

/** Back from a student's company to the teacher's own one, so the dashboard is theirs again. */
export async function leaveStudentCompany(): Promise<SettingsResult> {
  try {
    const { tenants } = await fetchMyCompanies();
    const own = tenants.find((t) => !t.classroom && !isStudentCompanyOfOthers(t));
    if (!own) return { ok: true, data: undefined };
    const result = await switchTenant(own.id);
    return result.ok ? { ok: true, data: undefined } : { ok: false, error: result.error };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
