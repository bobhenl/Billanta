import type { VatStatus } from '@faktur/cz-compliance';

// Client-safe: lib/tenant.ts pulls in next/headers via api-client, so client components import these from here.

/** OSVČ monthly advances typed in Settings → Firma; a missing key = not set. */
export type TaxAdvances = Partial<Record<'social' | 'health' | 'flat_tax', number>>;
export const ADVANCE_KINDS = ['social', 'health', 'flat_tax'] as const;

export const vatStatusOf = (t: { vatStatus?: VatStatus | null; dicVatPayer?: boolean | null } | null | undefined): VatStatus =>
  t?.vatStatus ?? (t?.dicVatPayer ? 'payer' : 'non_payer');
