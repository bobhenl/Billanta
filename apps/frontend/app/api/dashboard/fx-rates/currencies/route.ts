import { forwardJson } from '@/lib/forward-json';

export const dynamic = 'force-dynamic';

/** Every currency in today's ČNB list, for the dashboard currency picker. */
export function GET() {
  return forwardJson('/api/v1/dashboard/fx-rates/currencies');
}
