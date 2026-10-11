import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type Stripe from "stripe";
import * as schema from "../../drizzle/schema";
import { decryptSecret, encryptSecret } from "../backup-destinations/encryption.util";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { computeInvoiceTotal, round2 } from "../invoices/invoice-total.util";
import { InvoicesService } from "../invoices/invoices.service";

type TenantDb = PostgresJsDatabase<typeof schema>;

/** Builds a Stripe client for one company's own key (a factory so tests can mock it). */
export const STRIPE_FACTORY = Symbol("STRIPE_FACTORY");
export type StripeFactory = (secretKey: string) => Stripe;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_PATTERN = /^(sk|rk)_(test|live)_[A-Za-z0-9]{16,}$/;
/** Stripe's zero-decimal currencies among those an invoice may use. */
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK"]);
/** How long the sweep keeps asking Stripe about an unfinished checkout (sessions expire after 24 h). */
const OPEN_WINDOW_MS = 25 * 60 * 60 * 1000;

export const toMinor = (amount: number, currency: string) =>
  Math.round(amount * (ZERO_DECIMAL.has(currency.toUpperCase()) ? 1 : 100));
export const fromMinor = (minor: number, currency: string) =>
  ZERO_DECIMAL.has(currency.toUpperCase()) ? minor : minor / 100;

const encryptionKey = () => process.env.AI_KEY_ENCRYPTION_KEY ?? process.env.BACKUP_CONFIG_ENCRYPTION_KEY;
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");

type Target = { tenant_id: string; invoice_id: string; stripe_secret_key_encrypted: string };

export interface CardPaymentSettings {
  connected: boolean;
  enabled: boolean;
  accountName: string | null;
  mode: "test" | "live" | null;
  keyLast4: string | null;
}

/**
 * Card payments from the invoice link (Invoice Ninja's / Fakturoid's "pay
 * online"): the company connects its own Stripe account, the client clicks
 * "Pay by card" on /i/:token and goes through Stripe Checkout, and the
 * invoice is marked paid (with Stripe's fee) when the client comes back, or
 * at the latest on the next sweep. No per-company webhook is needed.
 */
@Injectable()
export class CardPaymentsService {
  private readonly logger = new Logger(CardPaymentsService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly invoices: InvoicesService,
    @Inject(STRIPE_FACTORY) private readonly stripeFor: StripeFactory,
  ) {}

  // --- settings (owner/admin, Settings → Payment methods) ---------------------

  async getSettings(db: TenantDb, tenantId: string): Promise<CardPaymentSettings> {
    const [row] = await db
      .select({
        key: schema.tenants.stripeSecretKeyEncrypted,
        name: schema.tenants.stripeAccountName,
        enabled: schema.tenants.cardPaymentsEnabled,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    if (!row?.key) return { connected: false, enabled: false, accountName: null, mode: null, keyLast4: null };
    let mode: "test" | "live" | null = null;
    let keyLast4: string | null = null;
    try {
      const key = decryptSecret(row.key, encryptionKey());
      mode = key.includes("_live_") ? "live" : "test";
      keyLast4 = key.slice(-4);
    } catch {
      // Encryption key rotated: show as connected but ask to reconnect.
    }
    return { connected: true, enabled: row.enabled, accountName: row.name, mode, keyLast4 };
  }

  async connect(db: TenantDb, tenantId: string, secretKey: string): Promise<CardPaymentSettings> {
    const key = secretKey.trim();
    if (!KEY_PATTERN.test(key)) throw new BadRequestException("invalid_key_format");
    const accountName = await this.verifyKey(key);
    await db
      .update(schema.tenants)
      .set({
        stripeSecretKeyEncrypted: encryptSecret(key, encryptionKey()),
        stripeAccountName: accountName,
        cardPaymentsEnabled: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.tenants.id, tenantId));
    return this.getSettings(db, tenantId);
  }

  async setEnabled(db: TenantDb, tenantId: string, enabled: boolean): Promise<CardPaymentSettings> {
    const current = await this.getSettings(db, tenantId);
    if (enabled && !current.connected) throw new BadRequestException("not_connected");
    await db.update(schema.tenants).set({ cardPaymentsEnabled: enabled, updatedAt: new Date() }).where(eq(schema.tenants.id, tenantId));
    return this.getSettings(db, tenantId);
  }

  async disconnect(db: TenantDb, tenantId: string): Promise<CardPaymentSettings> {
    await db
      .update(schema.tenants)
      .set({ stripeSecretKeyEncrypted: null, stripeAccountName: null, cardPaymentsEnabled: false, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));
    return this.getSettings(db, tenantId);
  }

  /** Proves the key works (and reads the account name when the key may). */
  private async verifyKey(key: string): Promise<string | null> {
    const stripe = this.stripeFor(key);
    try {
      const account = await stripe.accounts.retrieveCurrent();
      return account.settings?.dashboard?.display_name ?? account.business_profile?.name ?? account.email ?? null;
    } catch (err) {
      // A restricted key without "Account: read" still works for Checkout.
      if ((err as { type?: string }).type !== "StripePermissionError") throw new BadRequestException("invalid_key");
    }
    try {
      await stripe.checkout.sessions.list({ limit: 1 });
      return null;
    } catch {
      throw new BadRequestException("invalid_key");
    }
  }

  // --- public (/i/:token) -------------------------------------------------------

  /** Whether the portal may show "Pay by card" for this link. */
  async isAvailable(token: string): Promise<boolean> {
    return (await this.target(token)) != null;
  }

  /** Starts a Stripe Checkout for the unpaid rest of the invoice and returns its URL. */
  async createCheckout(token: string, locale: string): Promise<{ url: string }> {
    const target = await this.target(token);
    if (!target) throw new NotFoundException("Invoice not found");
    const stripe = this.stripeFor(decryptSecret(target.stripe_secret_key_encrypted, encryptionKey()));
    const lang = ["cs", "sk", "en"].includes(locale) ? locale : "cs";
    const portal = `${siteUrl()}/${lang}/i/${token}`;

    return this.inTenant(target.tenant_id, async (db) => {
      const due = await this.amountDue(db, target.invoice_id);
      if (!due) throw new BadRequestException("not_payable");
      let session: Stripe.Checkout.Session;
      try {
        session = await stripe.checkout.sessions.create({
          mode: "payment",
          locale: lang === "en" ? "en" : lang === "sk" ? "sk" : "cs",
          client_reference_id: target.invoice_id,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: due.currency.toLowerCase(),
                unit_amount: toMinor(due.amount, due.currency),
                product_data: { name: due.label },
              },
            },
          ],
          metadata: { invoice_id: target.invoice_id, billanta: "invoice" },
          payment_intent_data: { description: due.label, metadata: { invoice_id: target.invoice_id } },
          success_url: `${portal}?card=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${portal}?card=cancelled`,
        });
      } catch (err) {
        this.logger.warn(`checkout for invoice ${target.invoice_id} failed: ${(err as Error).message}`);
        throw new BadRequestException("provider_error");
      }
      if (!session.url) throw new BadRequestException("provider_error");
      await db.insert(schema.cardPaymentSessions).values({
        tenantId: target.tenant_id,
        invoiceId: target.invoice_id,
        sessionId: session.id,
        amount: due.amount.toFixed(2),
        currency: due.currency,
      });
      return { url: session.url };
    });
  }

  /** Called when the client returns from Stripe: records the payment if it went through. */
  async confirm(token: string, sessionId: string): Promise<{ status: "paid" | "open" | "expired" }> {
    const target = await this.target(token);
    if (!target || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) throw new NotFoundException("Payment not found");
    const stripe = this.stripeFor(decryptSecret(target.stripe_secret_key_encrypted, encryptionKey()));
    return this.inTenant(target.tenant_id, async (db) => {
      const [row] = await db
        .select()
        .from(schema.cardPaymentSessions)
        .where(and(eq(schema.cardPaymentSessions.sessionId, sessionId), eq(schema.cardPaymentSessions.invoiceId, target.invoice_id)));
      if (!row) throw new NotFoundException("Payment not found");
      if (row.status !== "open") return { status: row.status };
      return { status: await this.check(db, stripe, row) };
    });
  }

  // --- sweep (cron) -------------------------------------------------------------

  /** Settles checkouts whose payer never came back; returns how many were paid. */
  async sweepTenant(db: TenantDb, tenantId: string): Promise<number> {
    const open = await db
      .select()
      .from(schema.cardPaymentSessions)
      .where(and(eq(schema.cardPaymentSessions.status, "open"), gt(schema.cardPaymentSessions.createdAt, new Date(Date.now() - OPEN_WINDOW_MS))));
    // Anything older can no longer be paid (Stripe expires sessions after 24 h).
    await db
      .update(schema.cardPaymentSessions)
      .set({ status: "expired" })
      .where(and(eq(schema.cardPaymentSessions.status, "open"), lt(schema.cardPaymentSessions.createdAt, new Date(Date.now() - OPEN_WINDOW_MS))));
    if (open.length === 0) return 0;
    const [tenant] = await db
      .select({ key: schema.tenants.stripeSecretKeyEncrypted })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    if (!tenant?.key) return 0;
    const stripe = this.stripeFor(decryptSecret(tenant.key, encryptionKey()));
    let paid = 0;
    for (const row of open) {
      try {
        if ((await this.check(db, stripe, row)) === "paid") paid += 1;
      } catch (err) {
        this.logger.warn(`card payment check ${row.id} failed: ${(err as Error).message}`);
      }
    }
    return paid;
  }

  // --- internals ------------------------------------------------------------------

  /** Asks Stripe about one session and books it when paid. */
  private async check(db: TenantDb, stripe: Stripe, row: typeof schema.cardPaymentSessions.$inferSelect): Promise<"paid" | "open" | "expired"> {
    const session = await stripe.checkout.sessions.retrieve(row.sessionId, {
      expand: ["payment_intent.latest_charge.balance_transaction"],
    });
    if (session.metadata?.invoice_id !== row.invoiceId) return "open";
    if (session.status === "expired") {
      await db.update(schema.cardPaymentSessions).set({ status: "expired" }).where(eq(schema.cardPaymentSessions.id, row.id));
      return "expired";
    }
    if (session.payment_status !== "paid") return "open";

    const amount = fromMinor(session.amount_total ?? toMinor(Number(row.amount), row.currency), row.currency);
    const fee = feeOf(session, row.currency);
    // The status guard makes the booking happen once even if the return page and the sweep race.
    const [claimed] = await db
      .update(schema.cardPaymentSessions)
      .set({ status: "paid", paidAt: new Date(), fee: fee != null ? fee.toFixed(2) : null })
      .where(and(eq(schema.cardPaymentSessions.id, row.id), eq(schema.cardPaymentSessions.status, "open")))
      .returning();
    if (!claimed) return "paid";
    try {
      await this.invoices.markPaid(db, row.invoiceId, new Date(), amount, fee ? { fee } : {});
    } catch (err) {
      // Marked paid by hand meanwhile: the card payment stays on record.
      this.logger.warn(`card payment ${row.id}: invoice not updated (${(err as Error).message})`);
    }
    return "paid";
  }

  private async amountDue(db: TenantDb, invoiceId: string): Promise<{ amount: number; currency: string; label: string } | null> {
    const [invoice] = await db.select().from(schema.invoices).where(eq(schema.invoices.id, invoiceId));
    if (!invoice || invoice.status !== "issued" || invoice.documentType === "quote" || invoice.documentType === "credit_note") return null;
    const items = await db.select().from(schema.invoiceLineItems).where(eq(schema.invoiceLineItems.invoiceId, invoiceId));
    const rest = round2(round2(computeInvoiceTotal(items, { reverseCharge: invoice.reverseCharge })) - Number(invoice.amountPaid));
    if (rest <= 0) return null;
    const label = invoice.invoiceNumber ? `${invoice.documentType === "proforma" ? "Záloha" : "Faktura"} ${invoice.invoiceNumber}` : "Faktura";
    return { amount: rest, currency: invoice.currency, label };
  }

  private async target(token: string): Promise<Target | null> {
    if (!UUID_PATTERN.test(token)) return null;
    const rows = await this.dbService.db.execute<Target>(sql`SELECT * FROM get_public_card_payment_target(${token})`);
    return rows[0] ?? null;
  }

  private inTenant<T>(tenantId: string, fn: (db: TenantDb) => Promise<T>): Promise<T> {
    return this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      return fn(drizzleTx(tx, schema));
    }) as Promise<T>;
  }
}

/**
 * Stripe's fee in the invoice currency. The balance transaction is in the
 * account's settlement currency; `exchange_rate` converts the charge into it,
 * so the fee is divided back. Null when Stripe didn't return it.
 */
export function feeOf(session: Stripe.Checkout.Session, currency: string): number | null {
  const intent = session.payment_intent;
  if (!intent || typeof intent === "string") return null;
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string") return null;
  const balance = charge.balance_transaction;
  if (!balance || typeof balance === "string") return null;
  const settled = fromMinor(balance.fee, balance.currency);
  const sameCurrency = balance.currency.toUpperCase() === currency.toUpperCase();
  if (!sameCurrency && !balance.exchange_rate) return null;
  return round2(sameCurrency ? settled : settled / balance.exchange_rate!);
}
