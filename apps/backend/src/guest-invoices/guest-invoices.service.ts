import { Injectable } from "@nestjs/common";
import { z } from "zod";
import * as schema from "../../drizzle/schema";
import { InvoicePdfService } from "../invoices/invoice-pdf.service";
import { computeVatBreakdown } from "../invoices/invoice-total.util";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type ContactRow = typeof schema.contacts.$inferSelect;
type TenantRow = typeof schema.tenants.$inferSelect;
type LineItemRow = typeof schema.invoiceLineItems.$inferSelect;

const text = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  text(max)
    .optional()
    .transform((v) => (v ? v : null));
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .transform((v) => new Date(`${v}T00:00:00Z`));

const partySchema = z.object({
  name: text(200).min(1),
  street: optionalText(200),
  city: optionalText(120),
  postalCode: optionalText(20),
  ico: optionalText(20),
  dic: optionalText(20),
});

/** A payment reminder letter from the public generator: its title and the text the visitor sees and may edit. */
export const guestLetterSchema = z.object({
  language: z.enum(["cs", "sk", "en"]).default("cs"),
  title: text(200).min(1),
  body: text(8000).min(1),
});
export type GuestLetterInput = z.infer<typeof guestLetterSchema>;

export const guestInvoiceSchema = z.object({
  language: z.enum(["cs", "sk", "en"]).default("cs"),
  invoiceNumber: text(40).min(1),
  issueDate: date,
  taxableSupplyDate: date.optional(),
  dueDate: date.optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).default("CZK"),
  paymentMethod: z.enum(["bank_transfer", "cash", "card", "cash_on_delivery", "other"]).default("bank_transfer"),
  variableSymbol: z
    .string()
    .regex(/^\d{0,10}$/)
    .optional()
    .transform((v) => v || null),
  vatPayer: z.boolean().default(false),
  // The public invoice templates (/invoice-templates) open the form with one of these preset.
  documentType: z.enum(["invoice", "proforma", "credit_note"]).default("invoice"),
  /** Domestic reverse charge (§92a ZDPH, §69/12 ZoDPH); only a VAT payer can use it. */
  reverseCharge: z.boolean().default(false),
  /** Number of the invoice a credit note corrects ("K dokladu" on the PDF). */
  relatedInvoiceNumber: optionalText(40),
  supplier: partySchema.extend({
    email: optionalText(200),
    phone: optionalText(40),
    bankAccountNumber: optionalText(40),
    bankCode: optionalText(10),
    iban: optionalText(40),
  }),
  customer: partySchema,
  note: optionalText(2000),
  items: z
    .array(
      z.object({
        description: text(500).min(1),
        quantity: z.number().positive().max(1e6),
        unit: optionalText(20),
        unitPrice: z.number().min(-1e9).max(1e9),
        vatRate: z.number().min(0).max(100).default(0),
      }),
    )
    .min(1)
    .max(50),
});

export type GuestInvoiceInput = z.infer<typeof guestInvoiceSchema>;

/**
 * Builds a one-off invoice PDF from a visitor's form input without storing
 * anything. The input is mapped onto in-memory stand-ins for the DB rows
 * `InvoicePdfService.generate` expects, so the guest gets exactly the same
 * layout (incl. QR Platba) as a signed-in user. Only the fields the PDF
 * reads are filled; everything else stays null/default.
 */
@Injectable()
export class GuestInvoicesService {
  constructor(private readonly pdf: InvoicePdfService) {}

  generateLetterPdf(input: GuestLetterInput): Promise<Buffer> {
    return this.pdf.generateLetter(input);
  }

  async generatePdf(input: GuestInvoiceInput): Promise<Buffer> {
    const s = input.supplier;
    const c = input.customer;
    const tenant = {
      legalName: s.name,
      addressStreet: s.street,
      addressCity: s.city,
      addressPostalCode: s.postalCode,
      ico: s.ico,
      dic: s.dic,
      dicVatPayer: input.vatPayer,
      vatStatus: input.vatPayer ? "payer" : "non_payer",
      email: s.email,
      phone: s.phone,
      bankAccountNumber: s.bankAccountNumber,
      bankAccountBankCode: s.bankCode,
      bankAccountIban: s.iban,
      bankAccountSwift: null,
      logoData: null,
      invoiceFormPrefs: {},
      templateVars: [],
    } as unknown as TenantRow;

    const contact = {
      legalName: c.name,
      addressStreet: c.street,
      addressCity: c.city,
      addressPostalCode: c.postalCode,
      ico: c.ico,
      dic: c.dic,
    } as unknown as ContactRow;

    const reverseCharge = input.vatPayer && input.reverseCharge;
    const invoice = {
      documentType: input.documentType,
      status: "issued",
      language: input.language,
      invoiceNumber: input.invoiceNumber,
      issueDate: input.issueDate,
      taxableSupplyDate: input.vatPayer ? (input.taxableSupplyDate ?? input.issueDate) : null,
      dueDate: input.dueDate ?? null,
      currency: input.currency,
      paymentMethod: input.paymentMethod,
      variableSymbol: input.variableSymbol ?? (input.invoiceNumber.replace(/\D/g, "").slice(-10) || null),
      constantSymbol: null,
      specificSymbol: null,
      orderNumber: null,
      issuePlace: null,
      reverseCharge,
      exchangeRate: null,
      amountPaid: "0",
      customFields: [],
      noteAbove: null,
      noteBelow: input.note,
      issuedByName: null,
    } as unknown as InvoiceRow;

    const lineItems = input.items.map(
      (item, i) =>
        ({
          description: item.description,
          code: null,
          quantity: String(item.quantity),
          unit: item.unit,
          unitPrice: String(item.unitPrice),
          vatRate: String(input.vatPayer ? item.vatRate : 0),
          discountPercent: null,
          sortOrder: i,
        }) as unknown as LineItemRow,
    );

    const totals = computeVatBreakdown(lineItems, { reverseCharge });
    const related = input.documentType === "credit_note" && input.relatedInvoiceNumber ? { invoiceNumber: input.relatedInvoiceNumber, documentType: "invoice" as const } : null;
    return this.pdf.generate(invoice, contact, tenant, lineItems, totals, related);
  }
}
