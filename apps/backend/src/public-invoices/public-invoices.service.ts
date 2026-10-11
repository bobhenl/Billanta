import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbService } from "../db/db.service";

/**
 * Deliberately loose (not a strict RFC-4122 version check) — this only
 * needs to reject obviously-malformed input before it ever reaches a
 * `::uuid` cast in Postgres (which would otherwise raise a raw driver
 * error, not a clean 404). The real access control is `public_token`
 * being an unguessable random value with a unique index, not this regex.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// `type` (not `interface`) deliberately — `DbService.db.execute<TRow>()`
// constrains `TRow extends Record<string, unknown>`, and a plain object
// type literal alias satisfies that structurally (TS infers a compatible
// implicit index signature for it), whereas a named `interface` does not
// (tsc: "Index signature for type 'string' is missing").
type PublicInvoiceHeaderRow = {
  invoice_number: string | null;
  variable_symbol: string | null;
  issue_date: string | Date | null;
  due_date: string | Date | null;
  currency: string;
  status: string;
};

type PublicInvoiceLineItemRow = {
  description: string;
  quantity: string;
  unit_price: string;
  vat_rate: string | null;
  sort_order: number;
};

type PublicInvoiceSupplierRow = {
  company_name: string;
  bank_account_iban: string | null;
  bank_account_number: string | null;
  bank_account_bank_code: string | null;
};

export interface PublicInvoiceLineItemView {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate: number | null;
  sortOrder: number;
}

export interface PublicInvoiceSupplierView {
  companyName: string;
  bankAccountIban: string | null;
  bankAccountNumber: string | null;
  bankAccountBankCode: string | null;
}

export interface PublicInvoiceView {
  invoiceNumber: string | null;
  variableSymbol: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string;
  status: string;
  lineItems: PublicInvoiceLineItemView[];
  /** Derived from `lineItems` — `invoices` has no stored subtotal/vat/total
   *  columns (see the note in `drizzle/rls-policies.sql`'s
   *  `get_public_invoice_view` comment), so these are computed here rather
   *  than sourced from any column. */
  subtotal: number;
  vatTotal: number;
  total: number;
  /** `null` only if the tenant row was somehow missing (shouldn't happen —
   *  `invoices.tenantId` is a NOT NULL FK) — never omitted silently, so the
   *  frontend can distinguish "no bank account configured yet" (fields
   *  present but null) from this edge case. */
  supplier: PublicInvoiceSupplierView | null;
}

/**
 * Backs the public, unauthenticated client-portal endpoint
 * (`PublicInvoicesController`). Every read here goes through one of the
 * three narrow `SECURITY DEFINER` functions in `drizzle/rls-policies.sql`
 * (`get_public_invoice_view`, `get_public_invoice_line_items`,
 * `get_public_invoice_supplier_info`) via the shared pool (`DbService.db`)
 * — there is no `req.tenantDb` in this flow (no tenant context exists yet;
 * see `PublicInvoicesController`'s doc comment), and there must never be a
 * plain, un-scoped query against `invoices`/`invoice_line_items`/`tenants`
 * added here. If a future change needs another column, extend one of those
 * three SQL functions deliberately rather than bypassing them.
 */
@Injectable()
export class PublicInvoicesService {
  constructor(private readonly dbService: DbService) {}

  async findByPublicToken(token: string): Promise<PublicInvoiceView> {
    if (!UUID_PATTERN.test(token)) {
      throw new NotFoundException("Invoice not found");
    }

    const headerRows = await this.dbService.db.execute<PublicInvoiceHeaderRow>(
      sql`SELECT * FROM get_public_invoice_view(${token})`,
    );
    const header = headerRows[0];
    if (!header) {
      // No row for this token — either it never existed or (in principle)
      // was regenerated. Same 404 shape as the malformed-token case above:
      // an external caller can never tell "wrong shape" from "right shape,
      // no match" apart.
      throw new NotFoundException("Invoice not found");
    }

    const [lineItemRows, supplierRows] = await Promise.all([
      this.dbService.db.execute<PublicInvoiceLineItemRow>(
        sql`SELECT * FROM get_public_invoice_line_items(${token})`,
      ),
      this.dbService.db.execute<PublicInvoiceSupplierRow>(
        sql`SELECT * FROM get_public_invoice_supplier_info(${token})`,
      ),
    ]);

    const lineItems: PublicInvoiceLineItemView[] = lineItemRows.map((row) => ({
      description: row.description,
      quantity: Number(row.quantity),
      unitPrice: Number(row.unit_price),
      vatRate: row.vat_rate != null ? Number(row.vat_rate) : null,
      sortOrder: row.sort_order,
    }));

    const subtotal = lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
    const vatTotal = lineItems.reduce(
      (sum, item) => sum + (item.quantity * item.unitPrice * (item.vatRate ?? 0)) / 100,
      0,
    );

    const supplierRow = supplierRows[0];

    return {
      invoiceNumber: header.invoice_number,
      variableSymbol: header.variable_symbol,
      issueDate: header.issue_date ? new Date(header.issue_date).toISOString() : null,
      dueDate: header.due_date ? new Date(header.due_date).toISOString() : null,
      currency: header.currency,
      status: header.status,
      lineItems,
      subtotal: roundMinor(subtotal),
      vatTotal: roundMinor(vatTotal),
      total: roundMinor(subtotal + vatTotal),
      supplier: supplierRow
        ? {
            companyName: supplierRow.company_name,
            bankAccountIban: supplierRow.bank_account_iban,
            bankAccountNumber: supplierRow.bank_account_number,
            bankAccountBankCode: supplierRow.bank_account_bank_code,
          }
        : null,
    };
  }
}

function roundMinor(amount: number): number {
  return Math.round(amount * 100) / 100;
}
