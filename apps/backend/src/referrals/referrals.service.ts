import { randomInt } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { prepaidUntilAfterPayment } from "../billing/prepaid-period";
import { CREDIT_PLANS, REFERRAL_REWARDS, planCost, type CreditPlan, type ReferralProgram } from "./rewards";

type TenantDb = PostgresJsDatabase<typeof schema>;

// No 0/O, 1/I/L: the code gets read out loud and typed by hand.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Referral programme and credit wallet of the company in `tenantDb`
 * (Settings → Pozvat a získat kredity). Cross-company steps (finding the
 * inviter by code, paying the inviter) go through the claim_referral /
 * record_referral_payment SECURITY DEFINER functions; everything else is ordinary
 * RLS-scoped reads and spends.
 */
@Injectable()
export class ReferralsService {
  private readonly logger = new Logger(ReferralsService.name);

  async overview(db: TenantDb, tenantId: string) {
    const code = await this.ensureCode(db, tenantId);
    const [tenant] = await db
      .select({
        program: schema.tenants.referralProgram,
        ico: schema.tenants.ico,
        prepaidPlan: schema.tenants.prepaidPlan,
        prepaidUntil: schema.tenants.prepaidUntil,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    const [invited, ledger, balance, partner] = await Promise.all([
      db
        .select({
          createdAt: schema.referrals.createdAt,
          program: schema.referrals.program,
          rewardedAt: schema.referrals.rewardedAt,
          rewardCredits: schema.referrals.rewardCredits,
          firstPaidAt: schema.referrals.firstPaidAt,
          pendingCredits: schema.referrals.pendingCredits,
          releaseAfter: schema.referrals.releaseAfter,
          voidedAt: schema.referrals.voidedAt,
        })
        .from(schema.referrals)
        .orderBy(desc(schema.referrals.createdAt))
        .limit(200),
      db
        .select({
          id: schema.creditLedger.id,
          amount: schema.creditLedger.amount,
          reason: schema.creditLedger.reason,
          plan: schema.creditLedger.plan,
          months: schema.creditLedger.months,
          createdAt: schema.creditLedger.createdAt,
        })
        .from(schema.creditLedger)
        .orderBy(desc(schema.creditLedger.createdAt))
        .limit(100),
      this.balance(db),
      this.partnerState(db, tenantId),
    ]);
    const today = isoDate(new Date());
    const prepaidActive = Boolean(tenant?.prepaidPlan && tenant.prepaidUntil && tenant.prepaidUntil >= today);
    return {
      code,
      program: (tenant?.program ?? "friend") as ReferralProgram,
      // The accountant tier is approved by Billanta staff, never self-service.
      canBeAccountant: partner.status === "approved",
      partner: { ...partner, hasIco: Boolean(tenant?.ico) },
      balance,
      rewards: REFERRAL_REWARDS,
      plans: CREDIT_PLANS,
      prepaid: prepaidActive ? { plan: tenant!.prepaidPlan, until: tenant!.prepaidUntil } : null,
      invited: invited.map((r) => ({
        createdAt: r.createdAt,
        program: r.program,
        paying: Boolean(r.rewardedAt),
        state: r.rewardedAt ? "rewarded" : r.voidedAt ? "voided" : r.firstPaidAt ? "pending" : "waiting",
        rewardCredits: r.rewardCredits,
        pendingCredits: r.rewardedAt || r.voidedAt ? null : r.pendingCredits,
        releaseAfter: r.rewardedAt || r.voidedAt ? null : r.releaseAfter,
      })),
      stats: {
        invited: invited.length,
        paying: invited.filter((r) => r.rewardedAt).length,
        earned: invited.reduce((sum, r) => sum + (r.rewardCredits ?? 0), 0),
      },
      ledger,
    };
  }

  async balance(db: TenantDb): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`coalesce(sum(${schema.creditLedger.amount}), 0)::int` })
      .from(schema.creditLedger);
    return Number(row?.total ?? 0);
  }

  /** The company's invite code, created on first use. */
  private async ensureCode(db: TenantDb, tenantId: string): Promise<string> {
    const [row] = await db
      .select({ code: schema.tenants.referralCode })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    if (row?.code) return row.code;
    // 31^8 ≈ 850 billion codes: a clash is not worth a retry loop (the unique
    // index would reject it and the next page load simply tries again).
    const code = newCode();
    const [updated] = await db
      .update(schema.tenants)
      .set({ referralCode: code })
      .where(and(eq(schema.tenants.id, tenantId), isNull(schema.tenants.referralCode)))
      .returning({ code: schema.tenants.referralCode });
    if (updated?.code) return updated.code;
    const [again] = await db
      .select({ code: schema.tenants.referralCode })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    return again!.code!;
  }

  /**
   * The company was invited with `code` (the `?ref=` the visitor arrived
   * with). Silently `{ claimed: false }` when it doesn't qualify, so a stale
   * cookie never turns into an error page.
   */
  async claim(db: TenantDb, code: string): Promise<{ claimed: boolean; credits: number }> {
    const rows = await db.execute<{ program: string; credits: number }>(
      sql`SELECT * FROM claim_referral(${code.toUpperCase()}, ${REFERRAL_REWARDS.friend.welcome}, ${REFERRAL_REWARDS.accountant.welcome})`,
    );
    const row = [...rows][0];
    if (!row) return { claimed: false, credits: 0 };
    this.logger.log(`referral claimed (${row.program}), welcome credits ${row.credits}`);
    return { claimed: true, credits: Number(row.credits) };
  }

  async setProgram(db: TenantDb, tenantId: string, program: ReferralProgram) {
    if (program === "accountant") {
      // Only after Billanta staff approved the company as an accountant
      // (claim_referral checks the same, so a stale flag pays friend rates).
      const partner = await this.partnerState(db, tenantId);
      if (partner.status !== "approved") throw new BadRequestException("partner_not_approved");
    }
    await db.update(schema.tenants).set({ referralProgram: program, updatedAt: new Date() }).where(eq(schema.tenants.id, tenantId));
    return { program };
  }

  /**
   * The company's accountant partner request and whether it has a directory
   * listing yet. The listing is what staff check before approving.
   */
  async partnerState(db: TenantDb, tenantId: string) {
    const [[request], [listing]] = await Promise.all([
      db
        .select({
          status: schema.accountantPartnerRequests.status,
          requestedAt: schema.accountantPartnerRequests.requestedAt,
          reviewNote: schema.accountantPartnerRequests.reviewNote,
        })
        .from(schema.accountantPartnerRequests)
        .where(eq(schema.accountantPartnerRequests.tenantId, tenantId)),
      db
        .select({ status: schema.accountantListings.status })
        .from(schema.accountantListings)
        .where(eq(schema.accountantListings.tenantId, tenantId)),
    ]);
    return {
      status: (request?.status ?? "none") as "none" | "pending" | "approved" | "rejected",
      requestedAt: request?.requestedAt ?? null,
      reviewNote: request?.status === "rejected" ? (request.reviewNote ?? null) : null,
      listingStatus: listing?.status ?? null,
    };
  }

  /**
   * "Požádat o partnerský program pro účetní": a pending request staff see
   * next to the company's directory listing. Needs an IČO and a listing (the
   * profile is how staff tell an accountant from anyone else). Asking again
   * after a rejection is allowed; an approved company has nothing to ask for.
   */
  async requestPartner(db: TenantDb, tenantId: string) {
    const [tenant] = await db.select({ ico: schema.tenants.ico }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    if (!tenant?.ico) throw new BadRequestException("ico_required");
    const current = await this.partnerState(db, tenantId);
    if (current.status === "approved") return { status: "approved" as const };
    if (!current.listingStatus || current.listingStatus === "withdrawn") throw new BadRequestException("listing_required");
    if (current.status === "pending") return { status: "pending" as const };
    const now = new Date();
    if (current.status === "rejected") {
      await db
        .update(schema.accountantPartnerRequests)
        .set({ status: "pending", requestedAt: now, reviewedAt: null, reviewNote: null })
        .where(eq(schema.accountantPartnerRequests.tenantId, tenantId));
    } else {
      await db.insert(schema.accountantPartnerRequests).values({ tenantId, status: "pending", requestedAt: now }).onConflictDoNothing();
    }
    this.logger.log(`tenant ${tenantId} asked for the accountant partner programme`);
    return { status: "pending" as const };
  }

  /** Pays `months` of `plan` with credits, extending a running prepaid plan of the same kind. */
  async redeem(db: TenantDb, tenantId: string, plan: CreditPlan, months: 1 | 12) {
    // Two clicks at once must not both spend the same balance.
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`credits:${tenantId}`}))`);
    const cost = planCost(plan, months);
    const balance = await this.balance(db);
    if (balance < cost) throw new BadRequestException("insufficient_credits");

    const [tenant] = await db
      .select({ prepaidPlan: schema.tenants.prepaidPlan, prepaidUntil: schema.tenants.prepaidUntil })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    const today = isoDate(new Date());
    const running = tenant?.prepaidPlan && tenant.prepaidUntil && tenant.prepaidUntil >= today;
    if (running && tenant!.prepaidPlan !== plan) throw new ConflictException("other_plan_running");
    const until = prepaidUntilAfterPayment(tenant ?? { prepaidPlan: null, prepaidUntil: null }, plan, months, today);

    await db.insert(schema.creditLedger).values({ tenantId, amount: -cost, reason: "plan_purchase", plan, months });
    await db
      .update(schema.tenants)
      .set({ prepaidPlan: plan, prepaidUntil: until, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));
    return { plan, until, balance: balance - cost };
  }
}
