import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { desc, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { normalizePromoCode, PROMO_BENEFITS, PROMO_KINDS, PROMO_MAX_VALUE, promoPatch, promoRejection, type PromoError } from "./promo-logic";

type TenantDb = PostgresJsDatabase<typeof schema>;

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const redeemPromoSchema = z.object({
  // Loose on purpose: anything that isn't a code gets the same promo_invalid as an unknown one.
  code: z.string().max(64),
  source: z.enum(["signup", "billing"]).default("billing"),
});

export const promoCodeSchema = z
  .object({
    code: z
      .string()
      .transform((c) => normalizePromoCode(c) ?? "")
      .refine((c) => c !== "", "3–32 letters, digits or dashes"),
    kind: z.enum(PROMO_KINDS),
    benefit_type: z.enum(PROMO_BENEFITS),
    benefit_plan: z.enum(["start", "plus", "business"]),
    benefit_value: z.coerce.number().int().min(1),
    max_redemptions: z.coerce.number().int().min(1).max(1_000_000).nullish(),
    valid_from: isoDay.nullish(),
    valid_until: isoDay.nullish(),
    owner_label: z.string().trim().max(120).nullish(),
    note: z.string().trim().max(500).nullish(),
    active: z.boolean().default(true),
  })
  .refine((p) => p.benefit_value <= PROMO_MAX_VALUE[p.benefit_type], { path: ["benefit_value"], message: "too_large" })
  .refine((p) => !p.valid_from || !p.valid_until || p.valid_from <= p.valid_until, { path: ["valid_until"], message: "before_valid_from" });
export type PromoCodeInput = z.infer<typeof promoCodeSchema>;

/** What staff may change on an issued code. The code and its benefit stay: companies already got that. */
export const updatePromoCodeSchema = z.object({
  active: z.boolean().optional(),
  max_redemptions: z.coerce.number().int().min(1).max(1_000_000).nullish(),
  valid_until: isoDay.nullish(),
  owner_label: z.string().trim().max(120).nullish(),
  note: z.string().trim().max(500).nullish(),
});
export type UpdatePromoCodeInput = z.infer<typeof updatePromoCodeSchema>;

const today = () => new Date().toISOString().slice(0, 10);

const promoError = (code: PromoError) => (code === "promo_already_applied" || code === "promo_used_up" ? new ConflictException(code) : new BadRequestException(code));

/**
 * Promo codes: redeeming one for the company in `tenantDb` (Billing, or the
 * `?promo=` the founder signed up with) and the staff catalogue. The code
 * table is global, so the redeeming transaction locks and counts it
 * directly; the company's redemption row and plan change go through RLS
 * like any other write. Nothing here reads another company's data except
 * the counts from promo_code_stats().
 */
@Injectable()
export class PromoCodesService {
  private readonly logger = new Logger(PromoCodesService.name);

  constructor(private readonly dbService: DbService) {}

  /** The code this company redeemed, if any (Billing shows it instead of the form). */
  async current(db: TenantDb) {
    const [row] = await db
      .select({
        code: schema.promoRedemptions.code,
        benefitType: schema.promoRedemptions.benefitType,
        benefitPlan: schema.promoRedemptions.benefitPlan,
        benefitValue: schema.promoRedemptions.benefitValue,
        createdAt: schema.promoRedemptions.createdAt,
      })
      .from(schema.promoRedemptions)
      .limit(1);
    return { redemption: row ?? null };
  }

  async redeem(db: TenantDb, tenantId: string, rawCode: string, source: "signup" | "billing") {
    // Two tabs redeeming at once must not both pass the "already applied" check.
    await db.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`promo:${tenantId}`}))`);
    const [already] = await db.select({ id: schema.promoRedemptions.id }).from(schema.promoRedemptions).limit(1);
    if (already) throw promoError("promo_already_applied");

    const code = normalizePromoCode(rawCode);
    if (!code) throw promoError("promo_invalid");
    const [promo] = await db
      .select()
      .from(schema.promoCodes)
      .where(sql`upper(${schema.promoCodes.code}) = ${code}`)
      .for("update");
    if (!promo) throw promoError("promo_invalid");
    const rejected = promoRejection(promo, today());
    if (rejected) throw promoError(rejected);

    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    // A demo playground already has everything and is thrown away.
    if (!tenant || tenant.isDemo) throw promoError("promo_invalid");
    const now = new Date();
    const result = promoPatch(tenant, { benefit: promo.benefitType, plan: promo.benefitPlan, value: promo.benefitValue }, now);
    if (!result.ok) throw promoError(result.error);

    await db.insert(schema.promoRedemptions).values({
      tenantId,
      promoCodeId: promo.id,
      code: promo.code,
      benefitType: promo.benefitType,
      benefitPlan: promo.benefitPlan,
      benefitValue: promo.benefitValue,
      source,
    });
    await db
      .update(schema.promoCodes)
      .set({ redemptionCount: sql`${schema.promoCodes.redemptionCount} + 1` })
      .where(eq(schema.promoCodes.id, promo.id));
    await db
      .update(schema.tenants)
      .set({ ...result.patch, updatedAt: now })
      .where(eq(schema.tenants.id, tenantId));
    this.logger.log(`promo ${promo.code} redeemed (${source}): ${promo.benefitValue} ${promo.benefitType} of ${promo.benefitPlan}`);
    return {
      code: promo.code,
      benefitType: promo.benefitType,
      benefitPlan: promo.benefitPlan,
      benefitValue: promo.benefitValue,
      ...("trialEndsAt" in result.patch ? { trialEndsAt: result.patch.trialEndsAt.toISOString() } : { prepaidUntil: result.patch.prepaidUntil }),
    };
  }

  // --- staff (PlatformAdminGuard), pool connection on the global table ---

  async listAll() {
    const db = this.dbService.db;
    const [codes, stats] = await Promise.all([
      db.select().from(schema.promoCodes).orderBy(desc(schema.promoCodes.createdAt)),
      db.execute<{ promo_code_id: string; redemptions: number; paying: number }>(sql`SELECT * FROM promo_code_stats()`),
    ]);
    const byId = new Map([...stats].map((s) => [s.promo_code_id, s]));
    return codes.map((c) => ({ ...c, paying: Number(byId.get(c.id)?.paying ?? 0) }));
  }

  async create(input: PromoCodeInput, createdBy: string | undefined) {
    try {
      const [row] = await this.dbService.db
        .insert(schema.promoCodes)
        .values({
          code: input.code,
          kind: input.kind,
          benefitType: input.benefit_type,
          benefitPlan: input.benefit_plan,
          benefitValue: input.benefit_value,
          maxRedemptions: input.max_redemptions ?? null,
          validFrom: input.valid_from ?? null,
          validUntil: input.valid_until ?? null,
          ownerLabel: input.owner_label || null,
          note: input.note || null,
          active: input.active,
          createdBy: createdBy ?? null,
        })
        .returning();
      return row;
    } catch (error) {
      const code = (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
      throw code === "23505" ? new ConflictException("code_taken") : error;
    }
  }

  async update(id: string, input: UpdatePromoCodeInput) {
    const row: Partial<typeof schema.promoCodes.$inferInsert> = { updatedAt: new Date() };
    if (input.active !== undefined) row.active = input.active;
    if (input.max_redemptions !== undefined) row.maxRedemptions = input.max_redemptions ?? null;
    if (input.valid_until !== undefined) row.validUntil = input.valid_until ?? null;
    if (input.owner_label !== undefined) row.ownerLabel = input.owner_label || null;
    if (input.note !== undefined) row.note = input.note || null;
    try {
      const [updated] = await this.dbService.db.update(schema.promoCodes).set(row).where(eq(schema.promoCodes.id, id)).returning();
      if (!updated) throw new NotFoundException("promo_not_found");
      return updated;
    } catch (error) {
      // The table's check constraint: valid_until before valid_from.
      if ((error as { code?: string })?.code === "23514" || (error as { cause?: { code?: string } })?.cause?.code === "23514") {
        throw new BadRequestException("invalid_dates");
      }
      throw error;
    }
  }
}
