import { forwardJson } from '@/lib/forward-json';

export const dynamic = 'force-dynamic';

/** Upcoming rows of the official tax calendar (backend caches Finanční správa's CSV daily). */
export function GET() {
  return forwardJson('/api/v1/dashboard/tax-calendar?days=45');
}
