'use client';

import { useMemo } from 'react';
import { mergeSealedStats, mergeSealedSummary } from '@faktur/cz-compliance';
import type { DashboardSummary, PeriodStats } from '@/app/[locale]/(dashboard)/dashboard/types';
import { useOpenedTotals } from './sealed-amounts';

/*
 * Dashboard and report with sealed amounts: the server's sums leave those
 * documents out. Once the key is unlocked their totals are opened here and
 * merged with the shared maths in cz-compliance. `missing` is how many are
 * still out (locked, or under another key), for the "N documents left out" note.
 */

export function useMergedSummary(summary: DashboardSummary): { summary: DashboardSummary; missing: number } {
  const docs = summary.sealed?.docs;
  const { opened } = useOpenedTotals(docs?.map((d) => d.encAmounts) ?? []);
  return useMemo(() => {
    const count = summary.sealed?.count ?? 0;
    // An older backend sends only the ids: nothing to merge with.
    if (!count || !docs || !opened) return { summary, missing: count };
    const merged = mergeSealedSummary({ kpi: summary.kpi, chart: summary.chart, customers: summary.sealed?.customers ?? summary.topCustomers }, docs, opened);
    return { summary: { ...summary, kpi: merged.kpi, chart: merged.chart, topCustomers: merged.topCustomers }, missing: merged.missing };
  }, [summary, docs, opened]);
}

export function useMergedStats(stats: PeriodStats): { stats: PeriodStats; missing: number } {
  const inputs = stats.sealed?.inputs;
  const { opened } = useOpenedTotals(inputs?.sealedDocs.map((d) => d.encAmounts) ?? []);
  return useMemo(() => {
    const count = stats.sealed?.count ?? 0;
    if (!count || !inputs || !opened) return { stats, missing: count };
    const merged = mergeSealedStats(inputs, opened, { from: stats.from, to: stats.to, currency: stats.currency, filters: stats.filters });
    const { missing, ...report } = merged;
    // Same shape as the server's answer (it runs the same `periodReport`).
    return { stats: { ...stats, ...(report as unknown as Partial<PeriodStats>) }, missing };
  }, [stats, inputs, opened]);
}
