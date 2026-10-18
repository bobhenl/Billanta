import { BadRequestException, ForbiddenException, Injectable } from "@nestjs/common";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { createHash, randomBytes } from "node:crypto";
import * as schema from "../../drizzle/schema";
import { createContactSchema } from "../contacts/dto/create-contact.dto";
import { ContactsService } from "../contacts/contacts.service";
import { createInvoiceSchema } from "../invoices/dto/create-invoice.dto";
import { InvoicesService } from "../invoices/invoices.service";
import { SUPPLIERS } from "./dataset/kinds";
import { isDemoKind } from "./dataset";

type TenantDb = PostgresJsDatabase<typeof schema>;

export type DemoRole = "owner" | "accountant" | "viewer";
export const DEMO_ROLES: readonly DemoRole[] = ["owner", "accountant", "viewer"];

/** The made-up colleagues of a demo company, in its language. */
const TEAM_NAMES: Record<"cs" | "sk", Record<Exclude<DemoRole, "owner">, string>> = {
  cs: { accountant: "Jana Dvořáková", viewer: "Petr Novotný" },
  sk: { accountant: "Zuzana Horváthová", viewer: "Marek Kováč" },
};

/** What claim_demo_transfer (migration 0069) returns. */
interface TransferPayload {
  kind: string;
  contacts: Array<Record<string, unknown> & { id: string; legal_name: string }>;
  invoices: Array<Record<string, unknown> & { contact_id: string | null; items: Array<Record<string, unknown>> }>;
  expenses: Array<Record<string, unknown>>;
}

export interface TransferResult {
  contacts: number;
  invoices: number;
  expenses: number;
}

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * The demo's team views and "take your work along". Both cross the demo
 * boundary only through the definer functions of migration 0069; whatever
 * lands in a real company is written here through its own RLS context, the
 * same way the dashboard would write it.
 */
@Injectable()
export class DemoTransferService {
  constructor(
    private readonly contacts: ContactsService,
    private readonly invoices: InvoicesService,
  ) {}

  /** The demo user acting as `role` in this demo company (made on first use). */
  async member(db: TenantDb, tenantId: string, role: DemoRole): Promise<string> {
    const [tenant] = await db.select({ kind: schema.tenants.demoKind }).from(schema.tenants).limit(1);
    const language = isDemoKind(tenant?.kind) ? SUPPLIERS[tenant.kind].language : "cs";
    const name = role === "owner" ? "" : TEAM_NAMES[language][role];
    const rows = await db.execute<{ id: string | null }>(sql`SELECT demo_member(${tenantId}, ${role}, ${name}) AS id`);
    const id = rows[0]?.id;
    if (!id) throw new ForbiddenException("demo_forbidden");
    return id;
  }

  /** A one-time token for the visitor's browser; only its hash is stored. */
  async issue(db: TenantDb, tenantId: string): Promise<string> {
    const token = randomBytes(32).toString("base64url");
    await db.execute(sql`SELECT issue_demo_transfer(${tenantId}, ${hashToken(token)})`);
    return token;
  }

  /**
   * Redeems a token into the caller's (real) company. Documents arrive as
   * drafts: numbering, dates and issuing happen in the new account. One
   * transaction with the claim, so a failure leaves the token usable.
   */
  async claim(db: TenantDb, tenantId: string, token: string): Promise<TransferResult> {
    if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) throw new BadRequestException("demo_transfer_invalid");
    const rows = await db.execute<{ payload: TransferPayload | null }>(sql`SELECT claim_demo_transfer(${hashToken(token)}) AS payload`);
    const payload = rows[0]?.payload;
    if (!payload) throw new BadRequestException("demo_transfer_invalid");

    const contactIds = new Map<string, string>();
    for (const c of payload.contacts) {
      const parsed = createContactSchema.safeParse(contactInput(c));
      if (!parsed.success) continue;
      const [row] = await this.contacts.create(db, tenantId, parsed.data);
      if (row) contactIds.set(c.id, row.id);
    }

    let invoices = 0;
    for (const inv of payload.invoices) {
      const parsed = createInvoiceSchema.safeParse({
        document_type: inv.document_type,
        contact_id: inv.contact_id ? (contactIds.get(inv.contact_id) ?? null) : null,
        currency: inv.currency,
        language: inv.language,
        reverse_charge: inv.reverse_charge,
        reverse_charge_code: inv.reverse_charge_code ?? undefined,
        payment_method: inv.payment_method,
        order_number: inv.order_number ?? undefined,
        note_above: inv.note_above ?? undefined,
        note_below: inv.note_below ?? undefined,
        buyer_contact_person: inv.buyer_contact_person ?? undefined,
        line_items: inv.items.map((li) => ({
          description: li.description,
          quantity: li.quantity,
          unit: li.unit,
          code: li.code,
          unit_price: li.unit_price,
          vat_rate: li.vat_rate,
          discount_percent: li.discount_percent ?? 0,
        })),
      });
      if (!parsed.success) continue;
      await this.invoices.create(db, tenantId, parsed.data);
      invoices++;
    }

    let expenses = 0;
    for (const e of payload.expenses) {
      if (typeof e.description !== "string" || e.amount == null || e.vat_rate == null || !e.expense_date) continue;
      await db.insert(schema.expenses).values({
        tenantId,
        supplierNameRaw: str(e.supplier_name_raw),
        supplierIco: str(e.supplier_ico),
        supplierDic: str(e.supplier_dic),
        description: e.description,
        amount: String(e.amount),
        vatRate: String(e.vat_rate),
        currency: str(e.currency) ?? "CZK",
        exchangeRate: e.exchange_rate == null ? null : String(e.exchange_rate),
        expenseDate: new Date(String(e.expense_date)),
        dueDate: e.due_date ? new Date(String(e.due_date)) : null,
        category: str(e.category),
        documentNumber: str(e.document_number),
        variableSymbol: str(e.variable_symbol),
        note: str(e.note),
        reverseCharge: e.reverse_charge === true,
        reverseChargeCode: str(e.reverse_charge_code),
      });
      expenses++;
    }

    return { contacts: contactIds.size, invoices, expenses };
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/** A demo contact as the contacts form would send it; anything the form would reject is left out. */
export function contactInput(c: Record<string, unknown>) {
  const ico = str(c.ico);
  const email = str(c.email);
  return {
    legalName: c.legal_name,
    ico: ico && /^\d{8}$/.test(ico) ? ico : undefined,
    dic: str(c.dic) ?? undefined,
    email: email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined,
    phone: str(c.phone),
    contactPerson: str(c.contact_person),
    addressStreet: str(c.address_street),
    addressCity: str(c.address_city),
    addressPostalCode: str(c.address_postal_code),
    addressCountry: str(c.address_country) ?? undefined,
    isVatPayer: typeof c.is_vat_payer === "boolean" ? c.is_vat_payer : null,
    isPerson: c.is_person === true,
    internalNote: str(c.internal_note),
  };
}
