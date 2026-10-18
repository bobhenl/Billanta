import { ConflictException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { czechAccountToIban, generateQrInvoiceString } from "@faktur/cz-compliance";
import { DbService } from "../db/db.service";
import { NotificationsService } from "../notifications/notifications.service";
import { EmailService } from "../email/email.service";
import { ABUSE_PAUSE_THRESHOLD } from "../abuse/sending-guard";
import { resolveInvoiceToken } from "../public-links/resolve";

export type AbuseReason = "fraud" | "not_ordered" | "spam" | "other";

/**
 * Deliberately loose (not a strict RFC-4122 version check) — this only
 * needs to reject obviously-malformed input before it ever reaches a
 * `::uuid` cast in Postgres (which would otherwise raise a raw driver
 * error, not a clean 404). The real access control is the link secret
 * being an unguessable random value with a unique index, not this regex.
 * Link segments themselves are checked by `resolveInvoiceToken`.
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
  amount_paid: string | null;
  payment_method: string;
  payment_method_label: string | null;
  payment_instructions: string | null;
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

type PublicQrDetailsRow = {
  supplier_ico: string | null;
  supplier_dic: string | null;
  supplier_vat_payer: boolean;
  customer_ico: string | null;
  customer_dic: string | null;
  taxable_supply_date: string | Date | null;
  document_type: string;
  reverse_charge: boolean;
  exchange_rate: string | null;
  order_number: string | null;
  customer_country: string | null;
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
  /** Received so far (partial payments); the QR/portal ask for the rest. */
  amountPaid: number;
  /** Built-in method key, plus the custom label/instructions (Settings → Způsoby úhrady). */
  paymentMethod: string;
  paymentMethodLabel: string | null;
  paymentInstructions: string | null;
  /** `null` only if the tenant row was somehow missing (shouldn't happen —
   *  `invoices.tenantId` is a NOT NULL FK) — never omitted silently, so the
   *  frontend can distinguish "no bank account configured yet" (fields
   *  present but null) from this edge case. */
  supplier: PublicInvoiceSupplierView | null;
  /** Files the supplier chose to show in the portal (`get_public_invoice_attachments`). */
  attachments: { id: string; filename: string; mime: string; sizeBytes: number }[];
  /**
   * QR Faktura (SID) string — invoice number, dates, both parties' IČO/DIČ,
   * VAT recap — for the portal's "QR Platba + Faktura" code (X-INV field).
   * Null when the invoice has no number yet.
   */
  qrInvoice: string | null;
  /** Buyer's country as on the document; with the IBAN it picks SPAYD or PAY by square. */
  buyerCountry: string | null;
  /** Quotes only: whether the client may still answer, and the answer if given. */
  quote: { canRespond: boolean; response: "accepted" | "rejected" | null; respondedAt: string | null; name: string | null } | null;
  /** The company accepts cards (own Stripe) and something is left to pay: show "Pay by card". */
  cardPayment: boolean;
  /** Issued in the demo playground: fictional, no payment details (src/demo/). */
  demo: boolean;
}

type PublicAttachmentRow = { id: string; filename: string; mime: string; size_bytes: number };

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
  private readonly logger = new Logger(PublicInvoicesService.name);

  constructor(
    private readonly dbService: DbService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly email?: EmailService,
  ) {}

  /**
   * A recipient reports a document they did not expect (possible fake
   * invoice). Stored once per invoice and reporter; enough distinct
   * reporters within 7 days pause the company's e-mail sending until the
   * operator reviews it. The company itself is not told who reported.
   * Never throws for an unknown token, so it reveals nothing.
   */
  async reportAbuse(link: string, reason: AbuseReason, message: string | null, reporterEmail: string | null, bucket: string): Promise<void> {
    const token = await resolveInvoiceToken(this.dbService.db, link);
    if (!token) return;
    const rows = await this.dbService.db.execute<{
      tenant_id: string;
      invoice_id: string;
      invoice_number: string | null;
      company_name: string;
      reporters: number;
      paused: boolean;
    }>(sql`SELECT * FROM report_invoice_abuse(${token}, ${reason}, ${message}, ${reporterEmail}, ${bucket}, ${ABUSE_PAUSE_THRESHOLD})`);
    const hit = rows[0];
    if (!hit) return;
    const title = `Nahlášený doklad ${hit.invoice_number ?? ""} (${hit.company_name})`;
    const body =
      `Důvod: ${reason}. Nahlášení od ${hit.reporters} různých příjemců za 7 dní` +
      (hit.paused ? " – odesílání e-mailů firmy je pozastaveno." : ".") +
      (message ? ` Zpráva: ${message}` : "") +
      (reporterEmail ? ` Kontakt: ${reporterEmail}` : "") +
      ` Tenant: ${hit.tenant_id}`;
    const to = process.env.ABUSE_REPORT_EMAIL;
    if (!to || !this.email) {
      this.logger.warn(`${title}: ${body}`);
      return;
    }
    await this.email.sendPlatformEmail({ to, title, body }).catch((err) => this.logger.error(`Abuse report e-mail failed: ${err}`));
  }

  /** True when the company behind the link is suspended; the portal then shows nothing. */
  private async isBlocked(token: string): Promise<boolean> {
    const rows = await this.dbService.db.execute<{ blocked: boolean }>(sql`SELECT public_invoice_blocked(${token}) AS blocked`);
    return Boolean(rows[0]?.blocked);
  }

  /** Bumps the share-link view counter via `record_public_invoice_view`; never throws on a bad token. */
  async recordView(link: string): Promise<void> {
    const token = await resolveInvoiceToken(this.dbService.db, link);
    if (!token) return;
    const rows = await this.dbService.db.execute<{ tenant_id: string; invoice_id: string; invoice_number: string | null; first_view: boolean }>(
      sql`SELECT * FROM record_public_invoice_view(${token})`,
    );
    const hit = rows[0];
    if (hit?.first_view) {
      this.notifications?.notify(hit.tenant_id, "invoice_viewed", {
        title: `Odběratel otevřel fakturu ${hit.invoice_number ?? ""}`,
        body: "Poprvé si ji zobrazil v klientském portálu.",
        link: `/invoices/${hit.invoice_id}`,
      });
    }
  }

  /** The client's accept/reject answer to an issued quote; 409 when already answered or not a quote. */
  async respondToQuote(link: string, response: "accepted" | "rejected", name: string, note: string | null): Promise<void> {
    const token = await resolveInvoiceToken(this.dbService.db, link);
    if (!token || (await this.isBlocked(token))) throw new NotFoundException("Invoice not found");
    const rows = await this.dbService.db.execute<{ tenant_id: string; invoice_id: string; invoice_number: string | null }>(
      sql`SELECT * FROM respond_to_public_quote(${token}, ${response}, ${name}, ${note})`,
    );
    const hit = rows[0];
    if (!hit) throw new ConflictException("Quote cannot be answered");
    const accepted = response === "accepted";
    this.notifications?.notify(hit.tenant_id, "quote_response", {
      title: `${accepted ? "Klient přijal nabídku" : "Klient odmítl nabídku"} ${hit.invoice_number ?? ""}`.trim(),
      body: [name, note].filter(Boolean).join(" – ").slice(0, 500) || undefined,
      link: `/invoices/${hit.invoice_id}`,
    });
  }

  /** `link` is the /i/ segment: a short key behind its readable prefix, or the UUID of an older link. */
  async findByPublicToken(link: string): Promise<PublicInvoiceView> {
    const token = await resolveInvoiceToken(this.dbService.db, link);
    if (!token || (await this.isBlocked(token))) {
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

    const [lineItemRows, supplierRows, attachmentRows, qrRows, quoteRows, cardRows, demoRows] = await Promise.all([
      this.dbService.db.execute<PublicInvoiceLineItemRow>(
        sql`SELECT * FROM get_public_invoice_line_items(${token})`,
      ),
      this.dbService.db.execute<PublicInvoiceSupplierRow>(
        sql`SELECT * FROM get_public_invoice_supplier_info(${token})`,
      ),
      this.dbService.db.execute<PublicAttachmentRow>(sql`SELECT * FROM get_public_invoice_attachments(${token})`),
      this.dbService.db.execute<PublicQrDetailsRow>(sql`SELECT * FROM get_public_invoice_qr_details(${token})`),
      this.dbService.db.execute<{ client_response: "accepted" | "rejected" | null; client_responded_at: string | Date | null; client_response_name: string | null }>(
        sql`SELECT * FROM get_public_quote_response(${token})`,
      ),
      this.dbService.db.execute<{ document_type: string }>(sql`SELECT document_type FROM get_public_card_payment_target(${token})`),
      this.dbService.db.execute<{ demo: boolean }>(sql`SELECT public_invoice_demo(${token}) AS demo`),
    ]);
    const demo = demoRows[0]?.demo === true;
    const quoteRow = quoteRows[0];

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
    const qr = qrRows[0];
    const total = roundMinor(subtotal + vatTotal);
    let qrInvoice: string | null = null;
    if (header.invoice_number && header.issue_date && qr) {
      const byRate = new Map<number, { base: number; vat: number }>();
      for (const item of lineItems) {
        const rate = item.vatRate ?? 0;
        const line = byRate.get(rate) ?? { base: 0, vat: 0 };
        line.base += item.quantity * item.unitPrice;
        line.vat += (item.quantity * item.unitPrice * rate) / 100;
        byRate.set(rate, line);
      }
      qrInvoice = generateQrInvoiceString({
        invoiceNumber: header.invoice_number,
        issueDate: new Date(header.issue_date),
        totalAmount: total,
        currency: header.currency,
        dueDate: header.due_date ? new Date(header.due_date) : undefined,
        taxableSupplyDate: qr.taxable_supply_date ? new Date(qr.taxable_supply_date) : undefined,
        variableSymbol: header.variable_symbol ?? undefined,
        orderNumber: qr.order_number ?? undefined,
        supplierIco: qr.supplier_ico ?? undefined,
        supplierDic: qr.supplier_dic ?? undefined,
        customerIco: qr.customer_ico ?? undefined,
        customerDic: qr.customer_dic ?? undefined,
        vatLines: qr.supplier_vat_payer
          ? [...byRate].map(([rate, v]) => ({ rate, base: roundMinor(v.base), vat: roundMinor(v.vat) }))
          : [],
        documentType: qr.document_type === "proforma" ? 0 : qr.document_type === "credit_note" ? 1 : undefined,
        advance: qr.document_type === "proforma",
        reverseCharge: qr.reverse_charge,
        exchangeRate: qr.exchange_rate ? Number(qr.exchange_rate) : undefined,
        iban:
          supplierRow?.bank_account_iban ??
          (supplierRow?.bank_account_number
            ? (czechAccountToIban(supplierRow.bank_account_number, supplierRow.bank_account_bank_code) ?? undefined)
            : undefined),
        software: "Billanta",
      });
    }

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
      total,
      amountPaid: Number(header.amount_paid ?? 0),
      paymentMethod: header.payment_method,
      paymentMethodLabel: header.payment_method_label,
      paymentInstructions: header.payment_instructions,
      // A demo's account is made up: no payment QR may be built from it.
      supplier: supplierRow
        ? {
            companyName: supplierRow.company_name,
            bankAccountIban: demo ? null : supplierRow.bank_account_iban,
            bankAccountNumber: demo ? null : supplierRow.bank_account_number,
            bankAccountBankCode: demo ? null : supplierRow.bank_account_bank_code,
          }
        : null,
      attachments: attachmentRows.map((r) => ({ id: r.id, filename: r.filename, mime: r.mime, sizeBytes: r.size_bytes })),
      qrInvoice,
      buyerCountry: qr?.customer_country ?? null,
      quote: quoteRow
        ? {
            canRespond: header.status === "issued" && !quoteRow.client_response,
            response: quoteRow.client_response,
            respondedAt: quoteRow.client_responded_at ? new Date(quoteRow.client_responded_at).toISOString() : null,
            name: quoteRow.client_response_name,
          }
        : null,
      cardPayment:
        header.status === "issued" &&
        ["invoice", "proforma"].includes(cardRows[0]?.document_type ?? "") &&
        total - Number(header.amount_paid ?? 0) > 0.005,
      demo,
    };
  }

  /** One portal attachment by token + id (`get_public_invoice_attachment`); 404 for anything else. */
  async downloadAttachment(link: string, attachmentId: string) {
    const token = UUID_PATTERN.test(attachmentId) ? await resolveInvoiceToken(this.dbService.db, link) : null;
    if (!token || (await this.isBlocked(token))) throw new NotFoundException("Attachment not found");
    const rows = await this.dbService.db.execute<{ filename: string; mime: string; data: string }>(
      sql`SELECT * FROM get_public_invoice_attachment(${token}, ${attachmentId})`,
    );
    const row = rows[0];
    if (!row) throw new NotFoundException("Attachment not found");
    return { filename: row.filename, mime: row.mime, content: Buffer.from(row.data, "base64") };
  }
}

function roundMinor(amount: number): number {
  return Math.round(amount * 100) / 100;
}
