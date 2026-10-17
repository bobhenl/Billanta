import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { and, count, eq, gte, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { resolveBuyerContact } from "../invoices/buyer-details.util";
import { BuyerDetailsService } from "../invoices/buyer-details.service";
import { NotificationsService } from "../notifications/notifications.service";
import { publicProfileOf, SLUG_PATTERN } from "../tenants/public-profile";
import {
  DEFAULT_DAILY_ORDER_CAP,
  defaultVatRate,
  orderBlock,
  orderCurrency,
  orderInternalNote,
  orderLines,
  orderPayment,
  parseProfileOrder,
  pragueDayStart,
  prepayVariableSymbol,
  type OrderLine,
  type OrderPayment,
  type ParsedOrder,
} from "./profile-orders.util";

type TenantDb = PostgresJsDatabase<typeof schema>;
type TenantRow = typeof schema.tenants.$inferSelect;
type Order = Extract<ParsedOrder, { kind: "order" }>["order"];

const LANGUAGES = ["cs", "sk", "en"] as const;

/**
 * "Objednat" on the public company profile: a visitor orders a service from
 * "Služby a ceník" and fills in their billing details. The order becomes a
 * draft (`pending_review`, source `profile_order`) with a new or matched
 * contact, and the owner gets the usual buyer-details notification. Nothing
 * is ever issued, and the customer is never e-mailed.
 *
 * No session: the slug is resolved by the `get_profile_order_target`
 * SECURITY DEFINER function (published profile, orders switched on, company
 * not suspended), and everything after that runs in an ordinary
 * tenant-scoped transaction, exactly like the buyer-details link. A matched
 * saved contact is only attached, never written to.
 */
@Injectable()
export class ProfileOrdersService {
  readonly dailyCap = Number(process.env.PROFILE_ORDER_DAILY_LIMIT ?? DEFAULT_DAILY_ORDER_CAP);

  constructor(
    private readonly dbService: DbService,
    private readonly buyerDetails: BuyerDetailsService,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** The company taking orders on this slug; null for anything else. */
  async target(rawSlug: string): Promise<string | null> {
    const slug = rawSlug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) return null;
    const rows = await this.dbService.db.execute<{ tenant_id: string | null }>(sql`SELECT get_profile_order_target(${slug}) AS tenant_id`);
    return [...rows][0]?.tenant_id ?? null;
  }

  /** 404 unless the profile takes orders (used before a registry lookup). */
  async assertOpen(slug: string): Promise<void> {
    if (!(await this.target(slug))) throw new NotFoundException("Profile not found");
  }

  /**
   * The visitor's order. 400 for invalid input, 404 when the profile takes
   * no orders, 429 once the company's daily cap is used up. A filled
   * honeypot is answered like a success and stores nothing. With "Platba
   * předem" on, the answer carries the payment details for the thank-you page.
   */
  async submit(slug: string, body: unknown): Promise<{ payment: OrderPayment | null }> {
    const parsed = parseProfileOrder(body);
    if (parsed.kind === "invalid") throw new BadRequestException({ error: "invalid_input", issues: parsed.issues });
    const tenantId = await this.target(slug);
    if (!tenantId) throw new NotFoundException("Profile not found");
    if (parsed.kind === "bot") return { payment: null };

    const result = await this.buyerDetails.inTenant(tenantId, "customer", (db) => this.createDraft(db, tenantId, parsed.order));
    const n = result.extraLines;
    const extra = n === 0 ? "" : ` a ${n} ${n === 1 ? "další položka" : n < 5 ? "další položky" : "dalších položek"}`;
    const what = result.serviceTitle ? `${result.serviceTitle}${extra}` : "vlastní položky";
    this.notifications?.notify(tenantId, "buyer_details", {
      title: `Objednávka z profilu: ${parsed.order.buyer.legalName}`.slice(0, 200),
      body: [
        `Objednáno: ${what}.`,
        result.mode === "created" ? "Vytvořen nový kontakt." : "Přiřazen uložený kontakt podle IČO/DIČ, nic jsme v něm neměnili.",
        result.payment ? `Zákazník dostal platební údaje k platbě předem (VS ${result.payment.variableSymbol}).` : "",
        "Zkontrolujte koncept a vystavte ho.",
      ]
        .filter(Boolean)
        .join(" ")
        .slice(0, 1000),
      link: `/invoices/${result.invoiceId}`,
    });
    return { payment: result.payment };
  }

  /** The transactional part of `submit`: serialise per company, check, contact, draft, audit. */
  async createDraft(db: TenantDb, tenantId: string, order: Order) {
    // One order at a time per company, so the daily cap can't be raced past.
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`profile_order:${tenantId}`}))`);
    const tenant = await this.loadTenant(db, tenantId);
    if (!tenant) throw new NotFoundException("Profile not found");
    const profile = publicProfileOf(tenant.publicProfile);
    const block = orderBlock({ profile, todayCount: await this.countToday(db), dailyCap: this.dailyCap });
    if (block === "disabled") throw new NotFoundException("Profile not found");
    if (block === "daily_cap") throw new HttpException({ error: "daily_cap" }, HttpStatus.TOO_MANY_REQUESTS);

    const built = orderLines(order, profile, defaultVatRate(tenant.vatStatus, tenant.addressCountry));
    if ("error" in built) throw new BadRequestException({ error: built.error });

    const match = await this.buyerDetails.findByIdentifier(db, order.buyer.ico, order.buyer.dic);
    const resolution = resolveBuyerContact({ attached: null, match, submitted: order.buyer });
    const currency = orderCurrency(tenant.addressCountry);
    const payment = orderPayment({
      prepay: profile.orders.prepay,
      lines: built.lines,
      needsPricing: built.needsAttention,
      currency,
      variableSymbol: prepayVariableSymbol(),
      tenant,
    });

    let contactId: string;
    if (resolution.mode === "created") {
      contactId = await this.buyerDetails.insertContact(db, tenantId, resolution.values);
      await this.audit?.record(db, tenantId, { entityType: "contact", entityId: contactId, entityLabel: resolution.values.legalName, action: "created" });
    } else {
      contactId = resolution.contactId;
    }

    const invoiceId = await this.insertDraft(db, tenantId, {
      contactId,
      currency,
      variableSymbol: payment?.variableSymbol ?? null,
      language: (LANGUAGES as readonly string[]).includes(tenant.defaultLocale.slice(0, 2)) ? tenant.defaultLocale.slice(0, 2) : "cs",
      needsAttention: built.needsAttention || resolution.conflicts.length > 0,
      internalNote: orderInternalNote({
        email: order.buyer.email,
        note: order.note,
        customItems: order.customItems.length,
        contactMatched: resolution.mode !== "created",
        prepaySymbol: payment?.variableSymbol ?? null,
      }),
      lines: built.lines,
    });
    await this.audit?.record(db, tenantId, {
      entityType: "invoice",
      entityId: invoiceId,
      entityLabel: null,
      action: "profile_order",
      changes: [
        { field: "contactId", from: null, to: contactId },
        ...(order.serviceId ? [{ field: "serviceId", from: null, to: order.serviceId }] : []),
        ...(order.customItems.length ? [{ field: "customItems", from: null, to: order.customItems.length }] : []),
      ],
    });
    return { invoiceId, mode: resolution.mode, serviceTitle: built.serviceTitle, extraLines: built.lines.length - (built.serviceTitle ? 1 : 0), payment };
  }

  // ------------------------------------------------------------ data access (small, so tests can stub it)

  async loadTenant(db: TenantDb, tenantId: string): Promise<TenantRow | null> {
    const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    return row ?? null;
  }

  /** Profile orders this company received since midnight in Prague (RLS keeps it to this company). */
  async countToday(db: TenantDb): Promise<number> {
    const [row] = await db
      .select({ n: count() })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.source, "profile_order"), gte(schema.invoices.createdAt, pragueDayStart())));
    return Number(row?.n ?? 0);
  }

  async insertDraft(
    db: TenantDb,
    tenantId: string,
    draft: { contactId: string; currency: string; variableSymbol: string | null; language: string; needsAttention: boolean; internalNote: string; lines: OrderLine[] },
  ): Promise<string> {
    const [invoice] = await db
      .insert(schema.invoices)
      .values({
        tenantId,
        contactId: draft.contactId,
        currency: draft.currency,
        variableSymbol: draft.variableSymbol,
        status: "pending_review",
        source: "profile_order",
        language: draft.language,
        needsAttention: draft.needsAttention,
        internalNote: draft.internalNote,
      })
      .returning({ id: schema.invoices.id });
    await db.insert(schema.invoiceLineItems).values(
      draft.lines.map((line, index) => ({
        tenantId,
        invoiceId: invoice.id,
        description: line.description,
        quantity: line.quantity.toString(),
        unit: line.unit,
        unitPrice: line.unitPrice.toFixed(2),
        vatRate: line.vatRate != null ? line.vatRate.toString() : null,
        sortOrder: index,
      })),
    );
    return invoice.id;
  }
}
