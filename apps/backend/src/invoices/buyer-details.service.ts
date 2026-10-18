import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { assertCanSendEmail, recordEmailSent } from "../abuse/sending-guard";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { EmailService } from "../email/email.service";
import { NotificationsService } from "../notifications/notifications.service";
import {
  buyerDetailsSchema,
  DRAFT_STATUSES,
  missingRequired,
  newBuyerDetailsToken,
  normalizeToken,
  requestBlock,
  requiredFieldsOf,
  resolveBuyerContact,
  shouldAutoIssue,
  submitBlock,
  TOKEN_PATTERN,
  type BuyerContact,
  type BuyerDetailsField,
  type BuyerDetails,
  type ContactResolution,
} from "./buyer-details.util";
import { computeInvoiceTotal, computeVatBreakdown, formatInvoiceAmount, round2 } from "./invoice-total.util";
import { InvoicesService } from "./invoices.service";

type TenantDb = PostgresJsDatabase<typeof schema>;
type InvoiceRow = typeof schema.invoices.$inferSelect;
type Actor = "customer" | "system";

/** The public page where the customer fills in their details (frontend `app/[locale]/d/[token]`). */
export function buyerDetailsUrlOf(token: string): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://faktur.app").replace(/\/$/, "");
  return `${siteUrl}/d/${token}`;
}

const FIELD_LABELS: Record<string, string> = {
  legalName: "název",
  email: "e-mail",
  phone: "telefon",
  ico: "IČO",
  dic: "DIČ",
  address: "adresa",
  isPerson: "soukromá osoba",
};
const labels = (fields: string[]) => fields.map((f) => FIELD_LABELS[f] ?? f).join(", ");
const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export interface BuyerDetailsPublicView {
  documentType: string;
  currency: string;
  language: string;
  dueDate: string | null;
  supplier: { name: string; ico: string | null; dic: string | null; street: string | null; city: string | null; postalCode: string | null; country: string };
  items: { description: string; quantity: number; unit: string | null; unitPrice: number; vatRate: number | null; total: number }[];
  totals: { withoutVat: number; vat: number; total: number };
  submitted: boolean;
  prefill: { name: string | null; email: string | null; country: string | null; isPerson: boolean };
  /** Fields the supplier made mandatory for this link (name and address always are). */
  required: BuyerDetailsField[];
}

/**
 * "Odběratel si doplní údaje sám": the user sends a draft to the customer,
 * who fills in their own billing details on a public page; the details go
 * into the address book (never silently overwriting a saved contact), the
 * contact is attached to the draft, the user is notified, and – when they
 * asked for it – the draft is issued and sent through the normal
 * `InvoicesService.issue`/`sendInvoice` path.
 *
 * The public side has no session: the link's token is resolved to its
 * company by the `get_buyer_details_target` SECURITY DEFINER function
 * (drafts only, not for suspended companies), and everything after that
 * runs in an ordinary tenant-scoped transaction, like card payments.
 * Issued documents are never touched: the function and every write below
 * are limited to draft statuses.
 */
@Injectable()
export class BuyerDetailsService {
  private readonly logger = new Logger(BuyerDetailsService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly invoices: InvoicesService,
    private readonly email: EmailService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  // ------------------------------------------------------------ signed-in user

  /**
   * Opens (or replaces) the request for a draft: a fresh token, so any older
   * link stops working, and optionally an e-mail with the link.
   */
  async request(db: TenantDb, tenantId: string, userId: string, invoiceId: string, opts: { email?: string | null; autoIssue?: boolean; required?: BuyerDetailsField[]; saveAsDefault?: boolean }) {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId)).limit(1);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);
    const block = requestBlock(invoice);
    if (block === "not_draft") throw new BadRequestException("Only a draft can be sent to the customer to fill in their details");
    if (block) throw new BadRequestException("A credit note always has the customer of its invoice");

    // 12 base62 characters (~71 bits); the unique index on the column backs it up.
    const token = newBuyerDetailsToken();
    const email = opts.email?.trim().toLowerCase() || null;
    const now = new Date();
    // No list from the client = the company's default (null keeps following later changes of it).
    const required = opts.required ? requiredFieldsOf(opts.required) : null;
    if (required && opts.saveAsDefault) {
      await db.update(schema.tenants).set({ buyerDetailsRequired: required, updatedAt: now }).where(eq(schema.tenants.id, tenantId));
    }
    const [updated] = await db
      .update(schema.invoices)
      .set({
        buyerDetailsToken: token,
        buyerDetailsRequestedAt: now,
        buyerDetailsRequestedBy: userId,
        buyerDetailsEmail: email,
        buyerDetailsAutoIssue: opts.autoIssue ?? false,
        buyerDetailsRequired: required,
        buyerDetailsSubmittedAt: null,
        buyerDetailsOutcome: null,
        updatedAt: now,
      })
      .where(and(eq(schema.invoices.id, invoiceId), inArray(schema.invoices.status, [...DRAFT_STATUSES])))
      .returning();
    if (!updated) throw new BadRequestException("Only a draft can be sent to the customer to fill in their details");

    await this.audit?.record(db, tenantId, {
      entityType: "invoice",
      entityId: invoiceId,
      entityLabel: invoice.invoiceNumber ?? null,
      action: "buyer_details_requested",
      changes: [
        ...(email ? [{ field: "email", from: null, to: email }] : []),
        { field: "autoIssue", from: null, to: opts.autoIssue ?? false },
        ...(required ? [{ field: "required", from: null, to: required.join(",") }] : []),
      ],
    });

    const url = buyerDetailsUrlOf(token);
    if (email) {
      const [tenant] = await db
        .select({ companyName: schema.tenants.companyName, email: schema.tenants.email })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId))
        .limit(1);
      const items = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, invoiceId));
      const total = computeInvoiceTotal(items, { reverseCharge: invoice.reverseCharge });
      // Queued in the same transaction: a refused request (sending limits) rolls everything back.
      await assertCanSendEmail(db, tenantId);
      await this.email.sendBuyerDetailsRequestEmail(
        {
          to: email,
          companyName: tenant?.companyName ?? "",
          amount: formatInvoiceAmount(total, invoice.currency),
          url,
          replyTo: tenant?.email ?? null,
        },
        { tenantId, db },
      );
      await recordEmailSent(db, tenantId, "buyer_details", email);
    }
    return { token, url, emailed: Boolean(email), autoIssue: updated.buyerDetailsAutoIssue };
  }

  /** Closes the request: the link stops working at once. */
  async cancel(db: TenantDb, tenantId: string, invoiceId: string) {
    const [updated] = await db
      .update(schema.invoices)
      .set({ buyerDetailsToken: null, updatedAt: new Date() })
      .where(and(eq(schema.invoices.id, invoiceId), inArray(schema.invoices.status, [...DRAFT_STATUSES])))
      .returning({ id: schema.invoices.id, invoiceNumber: schema.invoices.invoiceNumber });
    if (!updated) throw new BadRequestException("Only a draft's request can be closed");
    await this.audit?.record(db, tenantId, { entityType: "invoice", entityId: invoiceId, entityLabel: updated.invoiceNumber, action: "buyer_details_cancelled" });
    return { ok: true };
  }

  // ------------------------------------------------------------ public (no session)

  /** Which company and draft an open link belongs to; null for anything else. */
  async target(token: string): Promise<{ tenant_id: string; invoice_id: string } | null> {
    if (!TOKEN_PATTERN.test(token)) return null;
    const rows = await this.dbService.db.execute<{ tenant_id: string; invoice_id: string }>(sql`SELECT * FROM get_buyer_details_target(${normalizeToken(token)})`);
    return rows[0] ?? null;
  }

  /** 404 unless the link is open and nothing was submitted yet (used before a registry lookup). */
  async assertOpen(token: string): Promise<void> {
    const target = await this.target(token);
    if (!target) throw new NotFoundException("Link not found");
    const block = await this.inTenant(target.tenant_id, "customer", async (db) => submitBlock(await this.loadInvoice(db, target.invoice_id), token));
    if (block) throw new NotFoundException("Link not found");
  }

  /** What the customer sees: supplier, items and amount (read-only), plus what to prefill. */
  async publicView(token: string): Promise<BuyerDetailsPublicView> {
    const target = await this.target(token);
    if (!target) throw new NotFoundException("Link not found");
    return this.inTenant(target.tenant_id, "customer", async (db) => {
      const invoice = await this.loadInvoice(db, target.invoice_id);
      const block = submitBlock(invoice, token);
      if (!invoice || (block && block !== "submitted")) throw new NotFoundException("Link not found");
      const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, target.tenant_id)).limit(1);
      const items = await db
        .select()
        .from(schema.invoiceLineItems)
        .where(eq(schema.invoiceLineItems.invoiceId, invoice.id))
        .orderBy(asc(schema.invoiceLineItems.sortOrder));
      const contact = invoice.contactId ? await this.loadContact(db, invoice.contactId) : null;
      const totals = computeVatBreakdown(items, { reverseCharge: invoice.reverseCharge });
      return {
        documentType: invoice.documentType,
        currency: invoice.currency,
        language: invoice.language,
        dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
        supplier: {
          name: tenant?.legalName || tenant?.companyName || "",
          ico: tenant?.ico ?? null,
          dic: tenant?.dic ?? null,
          street: tenant?.addressStreet ?? null,
          city: tenant?.addressCity ?? null,
          postalCode: tenant?.addressPostalCode ?? null,
          country: tenant?.addressCountry ?? "CZ",
        },
        items: items.map((item) => {
          const quantity = Number(item.quantity);
          const unitPrice = Number(item.unitPrice);
          const discount = item.discountPercent != null ? Number(item.discountPercent) : 0;
          return {
            description: item.description,
            quantity,
            unit: item.unit ?? null,
            unitPrice,
            vatRate: item.vatRate != null && !invoice.reverseCharge ? Number(item.vatRate) : null,
            total: round2(quantity * unitPrice * (1 - discount / 100)),
          };
        }),
        totals: { withoutVat: totals.totalWithoutVat, vat: totals.totalVat, total: totals.totalWithVat },
        submitted: block === "submitted",
        // Only what the company already used to address this customer; never the saved address or IDs.
        prefill: {
          name: contact?.legalName ?? null,
          email: invoice.buyerDetailsEmail ?? contact?.email ?? null,
          country: contact?.addressCountry ?? null,
          isPerson: contact?.isPerson ?? false,
        },
        required: requiredFieldsOf(invoice.buyerDetailsRequired ?? tenant?.buyerDetailsRequired),
      };
    });
  }

  /** The customer's submission. Single use: a second one gets 409 until the user sends a new link. */
  async submit(token: string, body: unknown): Promise<void> {
    if (!TOKEN_PATTERN.test(token)) throw new NotFoundException("Link not found");
    const parsed = buyerDetailsSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        error: "invalid_input",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const target = await this.target(token);
    if (!target) throw new NotFoundException("Link not found");
    const tenantId = target.tenant_id;

    const result = await this.inTenant(tenantId, "customer", (db) => this.applySubmission(db, tenantId, target.invoice_id, token, parsed.data));

    if (result.auto && result.requestedBy) {
      result.outcome.autoIssue = await this.autoIssue(tenantId, target.invoice_id, result.requestedBy, result.outcome);
      await this.inTenant(tenantId, "system", (db) =>
        db.update(schema.invoices).set({ buyerDetailsOutcome: result.outcome }).where(eq(schema.invoices.id, target.invoice_id)),
      );
    } else if (result.auto) {
      result.outcome.autoIssue = "skipped";
    }
    this.notifyUser(tenantId, target.invoice_id, result.details, result.resolution, result.outcome, result.previousContactName);
  }

  /** The transactional part of `submit`: lock, check, contact, attach, audit. */
  async applySubmission(db: TenantDb, tenantId: string, invoiceId: string, token: string, details: BuyerDetails) {
    const invoice = await this.lockInvoice(db, invoiceId);
    const block = submitBlock(invoice, token);
    if (block === "not_found" || !invoice) throw new NotFoundException("Link not found");
    if (block) throw new ConflictException({ error: block });
    const required = await this.requiredFor(db, tenantId, invoice);
    const missing = missingRequired(details, required);
    if (missing.length) {
      throw new BadRequestException({ error: "invalid_input", issues: missing.map((field) => ({ path: field, message: "required" })) });
    }

    const attached = invoice.contactId ? await this.loadContact(db, invoice.contactId) : null;
    const match = await this.findByIdentifier(db, details.ico, details.dic);
    const resolution = resolveBuyerContact({ attached, match, submitted: details });

    let contactId: string;
    if (resolution.mode === "created") {
      contactId = await this.insertContact(db, tenantId, resolution.values);
      await this.audit?.record(db, tenantId, { entityType: "contact", entityId: contactId, entityLabel: resolution.values.legalName, action: "created" });
    } else {
      contactId = resolution.contactId;
      const before = (match ?? attached)!;
      if (Object.keys(resolution.patch).length > 0) {
        await this.updateContact(db, contactId, resolution.patch);
        await this.audit?.record(db, tenantId, {
          entityType: "contact",
          entityId: contactId,
          entityLabel: before.legalName,
          action: "updated",
          changes: this.audit.diff(before as unknown as Record<string, unknown>, resolution.patch as Record<string, unknown>),
        });
      }
    }

    const auto = shouldAutoIssue(invoice.buyerDetailsAutoIssue, resolution, attached?.id ?? null);
    const outcome: schema.BuyerDetailsOutcome = {
      mode: resolution.mode,
      contactId,
      filled: resolution.filled,
      conflicts: resolution.conflicts,
      autoIssue: invoice.buyerDetailsAutoIssue && !auto ? "skipped" : null,
    };
    const now = new Date();
    await db
      .update(schema.invoices)
      .set({ contactId, buyerDetailsSubmittedAt: now, buyerDetailsOutcome: outcome, updatedAt: now })
      .where(and(eq(schema.invoices.id, invoiceId), inArray(schema.invoices.status, [...DRAFT_STATUSES])));

    await this.audit?.record(db, tenantId, {
      entityType: "invoice",
      entityId: invoiceId,
      entityLabel: invoice.invoiceNumber ?? null,
      action: "buyer_details_submitted",
      changes: [
        ...(invoice.contactId !== contactId ? [{ field: "contactId", from: invoice.contactId, to: contactId }] : []),
        { field: "buyerDetails", from: null, to: resolution.mode },
        ...resolution.conflicts.map((c) => ({ field: `conflict.${c.field}`, from: c.saved, to: c.submitted })),
      ],
    });

    return {
      auto,
      outcome,
      resolution,
      details,
      requestedBy: invoice.buyerDetailsRequestedBy,
      previousContactName: attached && attached.id !== contactId ? attached.legalName : null,
    };
  }

  /** Issues (and, with an e-mail on file, sends) through the normal path, so the party snapshot is taken as usual. */
  private async autoIssue(tenantId: string, invoiceId: string, userId: string, outcome: schema.BuyerDetailsOutcome): Promise<schema.BuyerDetailsOutcome["autoIssue"]> {
    try {
      await this.inTenant(tenantId, "system", (db) => this.invoices.issue(db, tenantId, invoiceId, userId));
    } catch (err) {
      outcome.autoIssueError = errorText(err);
      this.logger.warn(`Auto-issue after buyer details failed for ${invoiceId}: ${outcome.autoIssueError}`);
      return "failed";
    }
    try {
      await this.inTenant(tenantId, "system", (db) => this.invoices.sendInvoice(db, invoiceId, tenantId));
      return "sent";
    } catch (err) {
      outcome.autoIssueError = errorText(err);
      return "issued";
    }
  }

  private notifyUser(
    tenantId: string,
    invoiceId: string,
    details: BuyerDetails,
    resolution: ContactResolution,
    outcome: schema.BuyerDetailsOutcome,
    previousContactName: string | null,
  ) {
    const parts: string[] = [];
    if (resolution.mode === "created") {
      parts.push(`Vytvořen nový kontakt ${details.legalName}.`);
      if (previousContactName) parts.push(`Původní kontakt ${previousContactName} zůstal beze změny.`);
    } else if (resolution.mode === "existing") {
      parts.push(`Přiřazen uložený kontakt podle ${details.ico ? "IČO" : "DIČ"}.`);
    } else {
      parts.push("Údaje patří ke kontaktu, který už na konceptu byl.");
    }
    if (resolution.filled.length) parts.push(`Doplněno: ${labels(resolution.filled)}.`);
    if (resolution.conflicts.length) parts.push(`Liší se od uložených a nic nebylo přepsáno: ${labels(resolution.conflicts.map((c) => c.field))}.`);
    parts.push(
      outcome.autoIssue === "sent"
        ? "Faktura byla automaticky vystavena a odeslána."
        : outcome.autoIssue === "issued"
          ? `Faktura byla vystavena, ale e-mail se nepodařilo odeslat${outcome.autoIssueError ? ` (${outcome.autoIssueError})` : ""}.`
          : outcome.autoIssue === "failed"
            ? `Automatické vystavení se nepovedlo${outcome.autoIssueError ? ` (${outcome.autoIssueError})` : ""}. Zkontrolujte koncept.`
            : outcome.autoIssue === "skipped"
              ? "Automatické vystavení čeká na vaše potvrzení, protože je potřeba údaje zkontrolovat."
              : "Zkontrolujte koncept a vystavte ho.",
    );
    this.notifications?.notify(tenantId, "buyer_details", {
      title: `Odběratel doplnil fakturační údaje: ${details.legalName}`.slice(0, 200),
      body: parts.join(" ").slice(0, 1000),
      link: `/invoices/${invoiceId}`,
    });
  }

  // ------------------------------------------------------------ data access (small, so tests can stub it)

  /** The link's own list, else the company default. */
  async requiredFor(db: TenantDb, tenantId: string, invoice: InvoiceRow): Promise<BuyerDetailsField[]> {
    if (invoice.buyerDetailsRequired) return requiredFieldsOf(invoice.buyerDetailsRequired);
    const [tenant] = await db.select({ required: schema.tenants.buyerDetailsRequired }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    return requiredFieldsOf(tenant?.required);
  }

  async loadInvoice(db: TenantDb, id: string): Promise<InvoiceRow | null> {
    const [row] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
    return row ?? null;
  }

  async lockInvoice(db: TenantDb, id: string): Promise<InvoiceRow | null> {
    const [row] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, id)).for("update").limit(1);
    return row ?? null;
  }

  async loadContact(db: TenantDb, id: string): Promise<BuyerContact | null> {
    const [row] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, id)).limit(1);
    return row ?? null;
  }

  /** A saved contact of this company with the same IČO, else the same DIČ (ignoring spaces and case). */
  async findByIdentifier(db: TenantDb, ico: string | null, dic: string | null): Promise<BuyerContact | null> {
    if (ico) {
      const [row] = await db.select().from(schema.contacts).where(eq(schema.contacts.ico, ico)).orderBy(asc(schema.contacts.createdAt)).limit(1);
      if (row) return row;
    }
    if (dic) {
      const [row] = await db
        .select()
        .from(schema.contacts)
        .where(sql`upper(regexp_replace(coalesce(${schema.contacts.dic}, ''), '[\\s.-]', '', 'g')) = ${dic}`)
        .orderBy(asc(schema.contacts.createdAt))
        .limit(1);
      if (row) return row;
    }
    return null;
  }

  async insertContact(db: TenantDb, tenantId: string, values: Omit<BuyerContact, "id">): Promise<string> {
    const [row] = await db
      .insert(schema.contacts)
      .values({ tenantId, ...values, isVatPayer: null, aresVerifiedAt: null })
      .returning({ id: schema.contacts.id });
    return row.id;
  }

  async updateContact(db: TenantDb, id: string, patch: Partial<BuyerContact>): Promise<void> {
    await db.update(schema.contacts).set({ ...patch, updatedAt: new Date() }).where(eq(schema.contacts.id, id));
  }

  /** A tenant-scoped transaction for the no-session flow; the audit log records `actor` instead of a user. */
  inTenant<T>(tenantId: string, actor: Actor, fn: (db: TenantDb) => Promise<T>): Promise<T> {
    return this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true), set_config('app.current_actor', ${actor}, true)`;
      return fn(drizzleTx(tx, schema));
    }) as Promise<T>;
  }
}
