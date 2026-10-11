import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";

export type BillingProvider = (typeof schema.billingProviderEnum.enumValues)[number];

/**
 * Webhook idempotency log (blueprint §5): every Stripe/GoPay event must
 * land in `subscription_events`, keyed by `(provider, provider_event_id)`,
 * BEFORE any side effect runs. Split out of `BillingService` so its
 * control flow is unit-testable via a plain mocked interface instead of a
 * mocked drizzle-orm query-builder chain.
 */
@Injectable()
export class SubscriptionEventsRepository {
  constructor(private readonly dbService: DbService) {}

  /**
   * Attempts the INSERT via `ON CONFLICT (provider, provider_event_id) DO
   * NOTHING`, relying on `subscription_events_provider_event_unique` — the
   * unique index already declared in `drizzle/schema.ts` on exactly that
   * column pair, so no schema change was needed for this task. Returns
   * `true` only if the insert actually happened (this is genuinely the
   * first delivery of this event); `false` means it's a provider
   * retry/replay and the caller MUST skip all side effects and return 200
   * immediately (blueprint §5, "safe against provider retries").
   *
   * Runs through the same `sql.begin` + `set_config(...)` pattern as
   * `TenantBillingRepository.updateSubscriptionStatus` — real and
   * RLS-safe once `tenantId` is known (see that class's doc comment for
   * the one upstream step, resolving `tenantId` in the first place, that
   * is NOT yet RLS-safe pending `drizzle/rls-policies.sql` work out of
   * this task's scope).
   */
  async insertIfNew(
    tenantId: string,
    provider: BillingProvider,
    providerEventId: string,
    eventType: string,
    rawPayload: unknown,
  ): Promise<boolean> {
    return this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      const inserted = await db
        .insert(schema.subscriptionEvents)
        .values({
          tenantId,
          provider,
          providerEventId,
          eventType,
          rawPayload: rawPayload as object,
        })
        .onConflictDoNothing({
          target: [schema.subscriptionEvents.provider, schema.subscriptionEvents.providerEventId],
        })
        .returning({ id: schema.subscriptionEvents.id });
      return inserted.length > 0;
    });
  }

  /** Marks a previously-inserted event row as processed once its side effects have run. */
  async markProcessed(
    tenantId: string,
    provider: BillingProvider,
    providerEventId: string,
  ): Promise<void> {
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${tenantId}, true)`;
      const db = drizzleTx(tx, schema);
      await db
        .update(schema.subscriptionEvents)
        .set({ processedAt: new Date() })
        .where(
          and(
            eq(schema.subscriptionEvents.provider, provider),
            eq(schema.subscriptionEvents.providerEventId, providerEventId),
          ),
        );
    });
  }
}
