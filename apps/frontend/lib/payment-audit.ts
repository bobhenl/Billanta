import type { AuditInvoiceStatus, AuditSource, PaymentAuditReport } from '@faktur/cz-compliance';

/** GET /api/v1/payment-audit: the report over plain amounts, and how many invoices it could not open. */
export type PaymentAuditResponse = PaymentAuditReport & { sealed: { count: number } };

/** Statuses that need a look before the tax return, in the order the filter chips show them. */
export const AUDIT_PROBLEMS: AuditInvoiceStatus[] = ['underpaid', 'overpaid', 'manual', 'unpaid', 'unverified', 'sealed'];
export const AUDIT_OK: AuditInvoiceStatus[] = ['paid', 'paid_fee'];

/**
 * The year the audit opens on. Until the end of March it is the previous
 * year: that is when the tax return for it is being prepared (due 1 April,
 * § 136 daňového řádu), and January–March of the new year has hardly any
 * payments to check yet. From April on, the running year.
 */
export function defaultAuditYear(now = new Date()): number {
  return now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
}

export function parseAuditYear(value: string | undefined, now = new Date()): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : defaultAuditYear(now);
}

/** Source keys the frontend names itself; a connection brings its own label. */
export const AUDIT_SOURCE_NAMES = ['upload', 'card', 'paypal', 'stripe', 'wise', 'revolut', 'fio', 'psd2'] as const;

export function auditSourceName(key: string, sources: AuditSource[], t: (k: string) => string): string {
  const label = sources.find((s) => s.key === key)?.label;
  if (label) return label;
  return (AUDIT_SOURCE_NAMES as readonly string[]).includes(key) ? t(`sourceNames.${key}`) : key;
}
