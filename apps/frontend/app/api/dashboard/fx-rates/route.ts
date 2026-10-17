import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward-json';

export const dynamic = 'force-dynamic';

/** ČNB rates for the dashboard on a day (backend validates and caches the daily list). */
export function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const query = new URLSearchParams({ currencies: (params.get('currencies') ?? 'EUR,USD,GBP').slice(0, 80) });
  const date = params.get('date');
  if (date) query.set('date', date.slice(0, 10));
  return forwardJson(`/api/v1/dashboard/fx-rates?${query}`);
}
