import type { NextRequest } from 'next/server';
import { forwardJson } from '@/lib/forward-json';

export const dynamic = 'force-dynamic';

/** Today's ČNB rates for the dashboard (backend caches the daily list). */
export function GET(req: NextRequest) {
  const currencies = (req.nextUrl.searchParams.get('currencies') ?? 'EUR,USD,GBP').replace(/[^A-Z,]/gi, '').slice(0, 40);
  return forwardJson(`/api/v1/dashboard/fx-rates?currencies=${encodeURIComponent(currencies)}`);
}
