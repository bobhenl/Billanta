import { Injectable, Logger } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { referralPaymentArgs, type ReferralPayment } from "../referrals/rewards";

export type SubscriptionStatus = (typeof schema.subscriptionStatusEnum.enumValues)[number];

/** The live Stripe subscription as `tenants` keeps it for the billing panel (0063). */
export interface SubscriptionDetails {
  stripeSubscriptionId: string | null;
  subscriptionCurrency: "CZK" | "EUR" | null;
  subscriptionPeriodEnd: Date | null;
  subscriptionCancelAt: Date | null;
}
const DETAIL_KEYS = ["stripeSubscriptionId", "subscriptionCurrency", "subscriptionPeriodEnd", "subscriptionCancelAt"] as const;

/**
 * Billing-side reads/writes against `tenants`. Split out of
 * `BillingService` so the service's event-handling control flow can be
 * unit-tested against a plain mocked interface, without mocking
 * drizzle-orm's fluent query builder.
 */
@Injectable()
export class TenantBillingRepository {
  private readonly logger = new Logger(TenantBillingRepository.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * ============================================================================
   * RLS-before-tenant-is-known resolved via a SECURITY DEFINER function —
   * see `apps/backend/drizzle/rls-policies.sql`'s "SECURITY DEFINER lookup
   * functions" section for the full rationale.
   * ============================================================================
   * Finding a tenant BY `stripe_customer_id` has to happen BEFORE
   * `app.current_tenant_id` is known — that identifier is the very thing
   * this lookup exists to resolve. `tenants` has `FORCE ROW LEVEL
   * SECURITY` with policy `id = current_setting('app.current_tenant_id',
   * true)::uuid`, so a plain pooled SELECT with no tenant context set
   * would match ZERO rows against a real RLS-enabled Postgres instance —
   * silently, not as an error — which would make every Stripe event after
   * `checkout.session.completed` (which carries its tenant id directly in
   * `metadata`/`client_reference_id`, not via this lookup) a silent no-op.
   *
   * Fixed by calling `find_tenant_id_by_stripe_customer_id(text): uuid`, a
   * `SECURITY DEFINER` Postgres function (`drizzle/rls-policies.sql`) that
   * runs with the table-owner's privileges and returns ONLY the matching
   * `id` — no other `tenants` column is exposed through it, and it does
   * not require `app.current_tenant_id` to be set. This intentionally does
   * NOT go through `req.tenantDb`/`sql.begin` — there is no tenant
   * transaction to join yet — it's a plain call through the shared pool
   * (`DbService.db`), which is safe specifically because the function
   * itself — not the caller's RLS context — is what scopes the result.
   */
  async findTenantIdByStripeCustomerId(stripeCustomerId: string): Promise<string | null> {
    const rows = await this.dbService.db.execute<{ id: string | null }>(
      sql`SELECT find_tenant_id_by_stripe_customer_id(${stripeCustomerId}) AS id`,
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Same RLS-bootstrap fix as {@link findTenantIdByStripeCustomerId}, via
   * the analogous `find_tenant_id_by_gopay_payer_id(text): uuid` SECURITY
   * DEFINER function, keyed on `gopay_payer_id` instead.
   */
  async findTenantIdByGopayPayerId(gopayPayerId: string): Promise<string | null> {
    const rows = await this.dbService.db.execute<{ id: string | null }>(
      sql`SELECT find_tenant_id_by_gopay_payer_id(${gopayPayerId}) AS id`,
    );
    return rows[0]?.id ?? null;
  }

  /**
   * Real, RLS-safe write — mirrors `TenantContextMiddleware`'s
   * `sql.begin(...)` + `set_config('app.current_tenant_id', ...)` pattern
   * (see its long comment for the full rationale) using a `tenantId` the
   * caller has ALREADY resolved. Because the transaction sets the tenant
   * context itself before writing, this is genuinely correct under
   * `FORCE ROW LEVEL SECURITY` — unlike the lookups above, which run
   * before any tenant id is known at all.
   */
  async updateSubscriptionStatus(
    tenantId: string,
    status: SubscriptionStatus,
    extra?: { stripeCustomerId?: string; gopayPayerId?: string; subscriptionPlan?: string; subscriptionInterval?: "month" | "year" } & Partial<SubscriptionDetails>,
  ): Promise<void> {
    // Details are copied as given, null included: a cleared cancel_at must reach the row.
    const details = Object.fromEntries(DETAIL_KEYS.filter((k) => extra?.[k] !== undefined).map((k) => [k, extra![k]]));
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      await db
        .update(schema.tenants)
        .set({
          subscriptionStatus: status,
          ...(extra?.stripeCustomerId ? { stripeCustomerId: extra.stripeCustomerId } : {}),
          ...(extra?.gopayPayerId ? { gopayPayerId: extra.gopayPayerId } : {}),
          ...(extra?.subscriptionPlan ? { subscriptionPlan: extra.subscriptionPlan } : {}),
          ...(extra?.subscriptionInterval ? { subscriptionInterval: extra.subscriptionInterval } : {}),
          ...details,
          updatedAt: new Date(),
        })
        .where(eq(schema.tenants.id, tenantId));
    });
    this.logger.log(`tenant ${tenantId} subscription_status -> ${status}`);
  }

  /**
   * A real payment by `tenantId`, for its inviter's reward (migration 0079).
   * The first payment fixes the reward (what was paid, capped) and holds it
   * back; a second monthly payment or the daily job after the hold pays it.
   * A no-op for an unreferred company or one already rewarded or voided.
   * Callers dedupe by event, so one payment is never counted twice.
   */
  async recordReferralPayment(tenantId: string, payment: ReferralPayment, paidAt = new Date()): Promise<number> {
    const args = referralPaymentArgs(payment, paidAt);
    if (!args) return 0;
    const rows = await this.dbService.db.execute<{ paid: number | null }>(
      sql`SELECT record_referral_payment(${tenantId}::uuid, ${args.friend}::integer, ${args.accountant}::integer, ${args.releaseAfter?.toISOString() ?? null}::timestamptz) AS paid`,
    );
    const paid = Number(rows[0]?.paid ?? 0);
    if (paid > 0) this.logger.log(`tenant ${tenantId}: referral reward of ${paid} credits released to its inviter`);
    return paid;
  }

  /** A refund or cancellation before the reward was paid: the inviter gets nothing. */
  async voidReferralReward(tenantId: string, reason: "refunded" | "canceled"): Promise<boolean> {
    const rows = await this.dbService.db.execute<{ voided: boolean | null }>(
      sql`SELECT void_referral_reward(${tenantId}::uuid, ${reason}) AS voided`,
    );
    const voided = rows[0]?.voided === true;
    if (voided) this.logger.log(`tenant ${tenantId}: pending referral reward voided (${reason})`);
    return voided;
  }

  /**
   * `invoice.paid` (blueprint §5): only clears `past_due` back to
   * `active` — deliberately conditional on the CURRENT status being
   * `past_due` so a stray/late `invoice.paid` event can never resurrect a
   * tenant that was already explicitly `canceled` in the meantime.
   */
  async clearPastDue(tenantId: string): Promise<void> {
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      await db
        .update(schema.tenants)
        .set({ subscriptionStatus: "active", updatedAt: new Date() })
        .where(
          and(eq(schema.tenants.id, tenantId), eq(schema.tenants.subscriptionStatus, "past_due")),
        );
    });
    this.logger.log(`tenant ${tenantId} subscription_status past_due -> active (if it was past_due)`);
  }
}
