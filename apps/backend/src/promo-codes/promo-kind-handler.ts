import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type * as schema from "../../drizzle/schema";

export type PromoCodeRow = typeof schema.promoCodes.$inferSelect;

export interface PromoRedeemContext {
  /** The redeeming company's RLS-scoped transaction. */
  db: PostgresJsDatabase<typeof schema>;
  tenantId: string;
  promo: PromoCodeRow;
  source: "signup" | "billing";
}

/**
 * Extra behaviour for one `kind` of code, for modules that reuse the join
 * link (class codes, for example). PromoCodesService has already checked the
 * code, written the company's redemption row, applied the benefit and
 * claimed the referrer when `onRedeem` runs, all in the same transaction:
 * throwing a Nest HTTP exception with a snake_case code rolls all of it back
 * and reaches the frontend like any promo error.
 *
 * Register it from the owning module, e.g. in `onModuleInit`:
 * `promoCodes.registerKindHandler("class", handler)`. The kind also needs a
 * place in the `promo_codes_kind_check` constraint (drop-then-add it in the
 * module's own migration).
 */
export interface PromoKindHandler {
  onRedeem(ctx: PromoRedeemContext): Promise<void>;
}
