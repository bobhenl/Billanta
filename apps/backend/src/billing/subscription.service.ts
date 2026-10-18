import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, count, desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import QRCode from "qrcode";
import type Stripe from "stripe";
import * as schema from "../../drizzle/schema";
import { platformBillingEntity, proformaAmounts, proformaIdentifiers, proformaSpayd, type ProformaMonths } from "./bank-transfer";
import { planSummary } from "./plan-access";
import { PLAN_PRICES_MINOR, periodPriceMinor, type BillingInterval, type PaidPlan, type PlanCurrency } from "./plans";
import { STRIPE_CLIENT } from "./stripe-client.provider";

type TenantDb = PostgresJsDatabase<typeof schema>;

/** A company may keep this many unpaid proformas open at once. */
const MAX_PENDING_PROFORMAS = 3;

const PRODUCT_NAMES: Record<PaidPlan, string> = { start: "Billanta Start", plus: "Billanta Plus", business: "Billanta Firma" };

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * The company's own side of billing: what plan it is on, Stripe Checkout and
 * the Customer Portal, and proformas for a month or a year paid by bank transfer. Every
 * read and write goes through the request's RLS-bound connection.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(STRIPE_CLIENT) private readonly stripe: Stripe,
  ) {}

  private get stripeConfigured(): boolean {
    return Boolean(this.config.get<string>("STRIPE_SECRET_KEY"));
  }

  private async tenant(db: TenantDb, tenantId: string) {
    const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!t) throw new BadRequestException("tenant_not_found");
    return t;
  }

  async status(db: TenantDb, tenantId: string) {
    const t = await this.tenant(db, tenantId);
    const payee = platformBillingEntity();
    return {
      plan: planSummary(t, new Date()),
      subscriptionInterval: t.subscriptionInterval,
      hasStripeCustomer: Boolean(t.stripeCustomerId),
      prices: PLAN_PRICES_MINOR,
      card: { enabled: this.stripeConfigured },
      bankTransfer: payee
        ? {
            enabled: true,
            vatRate: payee.vatRate,
            amounts: {
              start: proformaAmounts("start", payee.vatRate, 12),
              plus: proformaAmounts("plus", payee.vatRate, 12),
              business: proformaAmounts("business", payee.vatRate, 12),
            },
            monthlyAmounts: {
              start: proformaAmounts("start", payee.vatRate, 1),
              plus: proformaAmounts("plus", payee.vatRate, 1),
              business: proformaAmounts("business", payee.vatRate, 1),
            },
          }
        : { enabled: false },
      proformas: await this.proformas(db, tenantId),
    };
  }

  /**
   * Stripe Checkout for a subscription. No `payment_method_types`: Stripe
   * picks the methods enabled in the dashboard (or in the payment method
   * configuration named by STRIPE_PAYMENT_METHOD_CONFIGURATION) that fit the
   * currency and the buyer's device, so Apple Pay, Google Pay, Link and SEPA
   * Direct Debit appear without code changes.
   */
  async checkout(
    db: TenantDb,
    tenantId: string,
    email: string | undefined,
    input: { plan: PaidPlan; interval: BillingInterval; currency: PlanCurrency; locale?: string },
  ): Promise<{ url: string }> {
    if (!this.stripeConfigured) throw new ServiceUnavailableException("billing_not_configured");
    const t = await this.tenant(db, tenantId);
    const current = planSummary(t, new Date());
    // A second subscription would bill twice; changes go through the portal.
    if (current.source === "subscription") throw new ConflictException("already_subscribed");

    const pmc = this.config.get<string>("STRIPE_PAYMENT_METHOD_CONFIGURATION");
    const metadata = { tenantId, plan: input.plan, interval: input.interval };
    const locale = input.locale === "cs" || input.locale === "sk" || input.locale === "en" ? input.locale : "auto";
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      client_reference_id: tenantId,
      metadata,
      subscription_data: { metadata },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: input.currency.toLowerCase(),
            unit_amount: periodPriceMinor(input.plan, input.currency, input.interval),
            recurring: { interval: input.interval },
            product_data: { name: PRODUCT_NAMES[input.plan] },
          },
        },
      ],
      ...(t.stripeCustomerId
        ? { customer: t.stripeCustomerId, customer_update: { address: "auto" as const, name: "auto" as const } }
        : email
          ? { customer_email: email }
          : {}),
      ...(pmc ? { payment_method_configuration: pmc } : {}),
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      allow_promotion_codes: true,
      locale,
      success_url: `${siteUrl()}/${input.locale ?? "cs"}/billing?checkout=success`,
      cancel_url: `${siteUrl()}/${input.locale ?? "cs"}/billing?checkout=canceled`,
    });
    if (!session.url) throw new ServiceUnavailableException("billing_not_configured");
    return { url: session.url };
  }

  /** Stripe Customer Portal: change card, download invoices, cancel in one step. */
  async portal(db: TenantDb, tenantId: string, locale?: string): Promise<{ url: string }> {
    if (!this.stripeConfigured) throw new ServiceUnavailableException("billing_not_configured");
    const t = await this.tenant(db, tenantId);
    if (!t.stripeCustomerId) throw new BadRequestException("no_stripe_customer");
    const session = await this.stripe.billingPortal.sessions.create({
      customer: t.stripeCustomerId,
      return_url: `${siteUrl()}/${locale ?? "cs"}/billing`,
    });
    return { url: session.url };
  }

  /**
   * Issues a proforma for a month or a year of `plan` payable by bank
   * transfer. It is a request for payment, not a tax document; the plan
   * starts (or the running prepaid period grows by `months`) when a platform
   * admin marks the payment received (`AdminBillingController`). Nothing
   * renews by itself: the next month is a new proforma.
   */
  async requestProforma(db: TenantDb, tenantId: string, userId: string | undefined, plan: PaidPlan, months: ProformaMonths) {
    const payee = platformBillingEntity();
    if (!payee) throw new ServiceUnavailableException("bank_transfer_not_configured");
    const [{ pending }] = await db
      .select({ pending: count() })
      .from(schema.platformProformas)
      .where(and(eq(schema.platformProformas.tenantId, tenantId), eq(schema.platformProformas.status, "pending")));
    if (pending >= MAX_PENDING_PROFORMAS) throw new ConflictException("too_many_pending_proformas");

    const [{ seq }] = await db.execute<{ seq: string }>(sql`SELECT nextval('platform_proforma_seq')::text AS seq`);
    const now = new Date();
    const ids = proformaIdentifiers(now.getUTCFullYear(), Number(seq));
    const amounts = proformaAmounts(plan, payee.vatRate, months);
    const due = new Date(now.getTime() + payee.dueDays * 86_400_000);
    await db.insert(schema.platformProformas).values({
      tenantId,
      number: ids.number,
      variableSymbol: ids.variableSymbol,
      plan,
      months,
      currency: "CZK",
      amountMinor: amounts.amountMinor,
      vatRate: payee.vatRate,
      totalMinor: amounts.totalMinor,
      dueDate: isoDate(due),
      createdByUserId: userId ?? null,
    });
    this.logger.log(`tenant ${tenantId} requested proforma ${ids.number} (${plan}, ${months} months)`);
    const list = await this.proformas(db, tenantId);
    return list.find((p) => p.number === ids.number) ?? null;
  }

  /** Newest first; pending ones carry the payee's account and a QR Platba image. */
  async proformas(db: TenantDb, tenantId: string) {
    const rows = await db
      .select()
      .from(schema.platformProformas)
      .where(eq(schema.platformProformas.tenantId, tenantId))
      .orderBy(desc(schema.platformProformas.createdAt))
      .limit(20);
    const payee = platformBillingEntity();
    return Promise.all(
      rows.map(async (p) => {
        const base = {
          id: p.id,
          number: p.number,
          variableSymbol: p.variableSymbol,
          plan: p.plan,
          months: p.months,
          currency: p.currency,
          amountMinor: p.amountMinor,
          vatRate: p.vatRate,
          totalMinor: p.totalMinor,
          status: p.status,
          dueDate: p.dueDate,
          paidAt: p.paidAt,
          createdAt: p.createdAt,
        };
        if (p.status !== "pending" || !payee) return { ...base, payment: null };
        const spayd = proformaSpayd(payee, p);
        return {
          ...base,
          payment: {
            payee: { name: payee.name, ico: payee.ico, dic: payee.dic, address: payee.address, email: payee.email },
            iban: payee.iban,
            bic: payee.bic,
            account: payee.account,
            qrDataUrl: await QRCode.toDataURL(spayd, { margin: 1, width: 240 }),
          },
        };
      }),
    );
  }
}
