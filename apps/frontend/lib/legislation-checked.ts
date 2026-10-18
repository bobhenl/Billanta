import { datasetChecked, type LegislationDataset } from '@faktur/cz-compliance';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * "Last checked" date of a group of tax constants: the backend's weekly
 * legislation monitor when it has confirmed the official pages unchanged,
 * else the manual date in @faktur/cz-compliance. Server-only; an
 * unreachable backend falls back to the manual date.
 */
export async function checkedDate(dataset: LegislationDataset): Promise<string> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/legislation/checked`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000)
    });
    return datasetChecked(dataset, res.ok ? ((await res.json()) as Record<string, string | null>) : null);
  } catch {
    return datasetChecked(dataset);
  }
}
