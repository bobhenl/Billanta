import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { ContactsService } from "../contacts/contacts.service";
import { trialDays } from "./plans";
import { welcomeTrialSkip, type WelcomeTrialOutcome } from "./welcome-trial";

type TenantDb = PostgresJsDatabase<typeof schema>;

/** Starts the welcome trial once a company has a real IČO; the rules are in welcome-trial.ts. */
@Injectable()
export class WelcomeTrialService {
  private readonly logger = new Logger(WelcomeTrialService.name);

  constructor(private readonly contacts: ContactsService) {}

  /**
   * Call after the company's IČO may have changed, inside the request's
   * tenant transaction. Never throws: a failure only means no trial yet.
   */
  async grantIfEligible(db: TenantDb, tenantId: string): Promise<WelcomeTrialOutcome> {
    try {
      const days = trialDays();
      const [t] = await db
        .select({
          ico: schema.tenants.ico,
          isDemo: schema.tenants.isDemo,
          classroomClassId: schema.tenants.classroomClassId,
          trialStartedAt: schema.tenants.trialStartedAt,
          addressCountry: schema.tenants.addressCountry,
        })
        .from(schema.tenants)
        .where(eq(schema.tenants.id, tenantId));
      if (!t) return "not_eligible";
      const skip = welcomeTrialSkip(t, days);
      if (skip) return skip;

      const known = await this.contacts.lookupById(t.ico!, t.addressCountry).then(
        () => true,
        (e: unknown) => (e instanceof NotFoundException ? false : null),
      );
      if (known === null) return "registry_down";
      if (!known) return "not_in_registry";

      // A savepoint, so a failure here can't abort the save that called it.
      const rows = await db.transaction((tx) => tx.execute<{ outcome: WelcomeTrialOutcome }>(sql`SELECT grant_welcome_trial(${tenantId}, ${days}) AS outcome`));
      const outcome = rows[0]?.outcome ?? "error";
      if (outcome === "granted") this.logger.log(`Welcome trial started for tenant ${tenantId}`);
      return outcome;
    } catch (e) {
      this.logger.warn(`Welcome trial check failed for tenant ${tenantId}: ${e instanceof Error ? e.message : e}`);
      return "error";
    }
  }
}
