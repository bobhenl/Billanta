import { randomInt } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Logger } from "@nestjs/common";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { CREDIT_PLANS, REFERRAL_REWARDS, planCost, type CreditPlan, type ReferralProgram } from "./rewards";

type TenantDb = PostgresJsDatabase<typeof schema>;

// No 0/O, 1/I/L: the code gets read out loud and typed by hand.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

const newCode = () => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function addMonths(isoDay: string, months: number): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + months);
  // 31 Jan + 1 month → 28/29 Feb, not 3 Mar.
  if (d.getUTCDate() < day) d.setUTCDate(0);
  return isoDate(d);
}

/**
 * Referral programme and credit wallet of the company in `tenantDb`
 * (Settings → Pozvat a získat kredity). Cross-company steps (finding the
 * inviter by code, paying the inviter) go through the claim_referral /
 * reward_referral SECURITY DEFINER functions; everything else is ordinary
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
    const [invited, ledger, balance] = await Promise.all([
      db
        .select({
          createdAt: schema.referrals.createdAt,
          program: schema.referrals.program,
          rewardedAt: schema.referrals.rewardedAt,
          rewardCredits: schema.referrals.rewardCredits,
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
    ]);
    const today = isoDate(new Date());
    const prepaidActive = Boolean(tenant?.prepaidPlan && tenant.prepaidUntil && tenant.prepaidUntil >= today);
    return {
      code,
      program: (tenant?.program ?? "friend") as ReferralProgram,
      canBeAccountant: Boolean(tenant?.ico),
      balance,
      rewards: REFERRAL_REWARDS,
      plans: CREDIT_PLANS,
      prepaid: prepaidActive ? { plan: tenant!.prepaidPlan, until: tenant!.prepaidUntil } : null,
      invited: invited.map((r) => ({
        createdAt: r.createdAt,
        program: r.program,
        paying: Boolean(r.rewardedAt),
        rewardCredits: r.rewardCredits,
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
      const [tenant] = await db.select({ ico: schema.tenants.ico }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
      // The partner programme is for businesses: an IČO keeps it from being
      // a free upgrade anyone can tick.
      if (!tenant?.ico) throw new BadRequestException("ico_required");
    }
    await db.update(schema.tenants).set({ referralProgram: program, updatedAt: new Date() }).where(eq(schema.tenants.id, tenantId));
    return { program };
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
    const from = running ? tenant!.prepaidUntil! : today;
    const until = addMonths(from, months);

    await db.insert(schema.creditLedger).values({ tenantId, amount: -cost, reason: "plan_purchase", plan, months });
    await db
      .update(schema.tenants)
      .set({ prepaidPlan: plan, prepaidUntil: until, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));
    return { plan, until, balance: balance - cost };
  }
}

export { addMonths as _addMonthsForTest };
