import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward-json';

export const dynamic = 'force-dynamic';

/**
 * Contacts + register typeahead for the dashboard forms. A route rather than a
 * server action: Next runs one action at a time per tab, so the several
 * seconds of the Slovak half (`part=slow`) would hold up every keystroke after it.
 */
export function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const query = new URLSearchParams({ q: (params.get('q') ?? '').trim().slice(0, 120) });
  const registry = params.get('registry');
  if (registry && /^[A-Za-z]{2,5}$/.test(registry)) query.set('registry', registry);
  const part = params.get('part');
  if (part === 'fast' || part === 'slow') query.set('part', part);
  return forwardJson(`/api/v1/contacts/search?${query}`, { signal: AbortSignal.timeout(15000) });
}
