import { forwardJson } from '@/lib/forward-json';

export const dynamic = 'force-dynamic';

/** Months with services to EU businesses / foreign purchases, so the dashboard can show only the VAT filings that apply. */
export function GET() {
  return forwardJson('/api/v1/dashboard/vat-activity');
}
