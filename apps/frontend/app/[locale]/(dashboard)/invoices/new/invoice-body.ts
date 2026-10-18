import { apiFetch, ApiError } from '@/lib/api-client';
import type { Contact, InvoiceDraftInput } from './types';

/*
 * Shared by the form's own save action and the offline sync action
 * (lib/offline-sync-actions.ts), so a draft queued offline reaches the
 * backend in exactly the shape an online save would send. Not a
 * 'use server' file: these must not be callable from the browser.
 */

export async function resolveContact(customer: NonNullable<InvoiceDraftInput['customer']>): Promise<string | null> {
  if (customer.kind === 'contact') return customer.id;
  const a = customer.ares;
  const [created] = await apiFetch<Contact[]>('/api/v1/contacts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      legalName: a.legalName,
      ico: a.ico || undefined,
      dic: a.dic ?? undefined,
      addressStreet: a.addressStreet,
      addressCity: a.addressCity,
      addressPostalCode: a.addressPostalCode,
      addressCountry: a.addressCountry,
      isVatPayer: a.isVatPayer,
      aresVerified: true
    })
  });
  return created?.id ?? null;
}

/** Form state → backend snake_case; empty optional text becomes null so PATCH can clear it. */
export function invoiceBody(input: InvoiceDraftInput) {
  const text = (value: string) => value.trim() || null;
  return {
    document_type: input.documentType,
    issue_date: input.issueDate || undefined,
    due_date: input.dueDate || null,
    taxable_supply_date: input.taxableSupplyDate === undefined ? undefined : input.taxableSupplyDate || null,
    currency: input.currency,
    bank_account_id: input.bankAccountId || null,
    // Already home currency per unit and empty at home (see the form); the API ignores it at home anyway.
    exchange_rate: Number(input.exchangeRate.replace(',', '.')) > 0 ? Number(input.exchangeRate.replace(',', '.')) : null,
    payment_method: input.paymentMethod,
    payment_method_label: text(input.paymentMethodLabel),
    payment_instructions: text(input.paymentInstructions),
    variable_symbol: text(input.variableSymbol),
    constant_symbol: text(input.constantSymbol),
    specific_symbol: text(input.specificSymbol),
    order_number: text(input.orderNumber),
    buyer_contact_person: text(input.buyerContactPerson),
    language: input.language,
    reverse_charge: input.reverseCharge,
    reverse_charge_code: input.reverseChargeCode,
    note_above: text(input.noteAbove),
    note_below: text(input.noteBelow),
    internal_note: text(input.internalNote),
    issue_place: text(input.issuePlace),
    issued_by_name: text(input.issuedByName),
    ...(input.amountPaid !== undefined ? { amount_paid: input.amountPaid } : {}),
    custom_fields: input.customFields
      .map((f) => ({ label: f.label.trim(), value: f.value.trim(), kind: f.kind ?? 'text', internal: Boolean(f.internal) }))
      .filter((f) => f.label && f.value),
    line_items: input.items.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      code: item.code?.trim() || null,
      unit_price: item.unitPrice,
      vat_rate: item.vatRate,
      discount_percent: item.discountPercent
    }))
  };
}

/** The backend's `{ error: "<code>" }` body when it sent one, else a status-based fallback. */
export function errorCode(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body ?? '{}') as { error?: unknown; message?: { error?: unknown } | unknown };
      const nested = typeof body.message === 'object' && body.message ? (body.message as { error?: unknown }).error : undefined;
      const code = typeof body.error === 'string' && body.error.includes('_') ? body.error : nested;
      if (typeof code === 'string') return code;
    } catch {
      // not JSON
    }
    if (error.status === 402 || error.status === 403) return 'not_allowed';
  }
  return fallback;
}
