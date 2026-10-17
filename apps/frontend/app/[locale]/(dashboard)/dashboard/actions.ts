'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch } from '@/lib/api-client';
import { backendMessage } from '@/lib/action-error';
import { reportQuery } from '@/lib/report-query';
import type { DashboardConfig, PeriodStats, ReportFilters } from './types';

export async function saveDashboardConfig(config: Partial<DashboardConfig>): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await apiFetch('/api/v1/dashboard/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
    revalidatePath('/[locale]/(dashboard)/dashboard', 'page');
    return { ok: true };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}

export async function fetchPeriodStats(
  from: string,
  to: string,
  filters: ReportFilters = {}
): Promise<{ ok: true; stats: PeriodStats } | { ok: false; error: string }> {
  try {
    const qs = reportQuery(from, to, filters);
    return { ok: true, stats: await apiFetch<PeriodStats>(`/api/v1/dashboard/stats?${qs}`) };
  } catch (error) {
    return { ok: false, error: backendMessage(error) };
  }
}
