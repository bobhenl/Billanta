import { TAX_ADVANCE_KINDS, type TaxAdvancePeriod, type VatStatus } from '@faktur/cz-compliance';

// Client-safe: lib/tenant.ts pulls in next/headers via api-client, so client components import these from here.

/**
 * OSVČ monthly advances typed in Settings → Fakturační údaje, by period: each
 * entry applies from its month on (see advancesFor in @faktur/cz-compliance).
 */
export type TaxAdvances = TaxAdvancePeriod[];
export const ADVANCE_KINDS = TAX_ADVANCE_KINDS;

export const vatStatusOf = (t: { vatStatus?: VatStatus | null; dicVatPayer?: boolean | null } | null | undefined): VatStatus =>
  t?.vatStatus ?? (t?.dicVatPayer ? 'payer' : 'non_payer');
