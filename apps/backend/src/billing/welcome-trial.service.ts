import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { ContactsService } from "../contacts/contacts.service";
import { CARD_TRIAL_DAYS, trialDays } from "./plans";
import {
  cardHash,
  trialSignals,
  welcomeTrialSkip,
  type CardTrialOutcome,
  type TrialSignal,
  type WelcomeTrialOutcome,
} from "./welcome-trial";

type TenantDb = PostgresJsDatabase<typeof schema>;

/** Supplier accounts printed on the company's own documents, enough to catch a reused one. */
const SNAPSHOT_ACCOUNTS_LIMIT = 50;

/** Starts, watches and extends the welcome trial; the rules are in welcome-trial.ts. */
@Injectable()
export class WelcomeTrialService {
  private readonly logger = new Logger(WelcomeTrialService.name);

  constructor(private readonly contacts: ContactsService) {}

  /**
   * Call after the company's IČO, bank accounts or contacts may have
   * changed, inside the request's tenant transaction. Without a trial yet it
   * tries to grant one (only when `icoChanged`, which asks ARES / RPO); with
   * one it records the new values and may end a no-card trial. Never throws.
   */
  async onCompanyChanged(db: TenantDb, tenantId: string, icoChanged: boolean): Promise<void> {
    const [t] = await db
      .select({ trialStartedAt: schema.tenants.trialStartedAt })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .catch(() => []);
    if (!t) return;
    if (!t.trialStartedAt) {
      if (icoChanged) await this.grantIfEligible(db, tenantId);
      return;
    }
    await this.refreshSignals(db, tenantId);
  }

  /** Never throws: a failure only means no trial yet. */
  async grantIfEligible(db: TenantDb, tenantId: string): Promise<WelcomeTrialOutcome> {
    try {
      const days = trialDays();
      const t = await this.company(db, tenantId);
      if (!t) return "not_eligible";
      const skip = welcomeTrialSkip(t, days);
      if (skip) return skip;
      const known = await this.inRegistry(t.ico!, t.addressCountry);
      if (known !== "ok") return known;

      const signals = await this.signals(db, tenantId);
      const outcome = await this.call<WelcomeTrialOutcome>(
        db,
        sql`SELECT grant_welcome_trial(${tenantId}, ${days}, ${JSON.stringify(signals)}::jsonb) AS outcome`,
      );
      if (outcome === "granted") this.logger.log(`Welcome trial started for tenant ${tenantId}`);
      else if (outcome.startsWith("signal_") || outcome === "ico_had_trial") this.logger.log(`Welcome trial withheld for tenant ${tenantId}: ${outcome}`);
      return outcome;
    } catch (e) {
      this.logger.warn(`Welcome trial check failed for tenant ${tenantId}: ${e instanceof Error ? e.message : e}`);
      return "error";
    }
  }

  /** Records the company's current identifiers; may end a running no-card trial. Never throws. */
  async refreshSignals(db: TenantDb, tenantId: string): Promise<void> {
    try {
      const signals = await this.signals(db, tenantId);
      if (!signals.length) return;
      const outcome = await this.call<string>(db, sql`SELECT refresh_trial_signals(${tenantId}, ${JSON.stringify(signals)}::jsonb) AS outcome`);
      if (outcome.startsWith("ended:")) this.logger.log(`Welcome trial ended for tenant ${tenantId}: ${outcome.slice(6)}`);
    } catch (e) {
      this.logger.warn(`Trial signal refresh failed for tenant ${tenantId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  /**
   * A card saved through Stripe (setup mode) makes the trial CARD_TRIAL_DAYS
   * long. `fingerprint` is Stripe's card fingerprint, the same for the same
   * card in every customer; only its hash is stored. Never throws.
   */
  async extendWithCard(db: TenantDb, tenantId: string, fingerprint: string): Promise<CardTrialOutcome> {
    try {
      const t = await this.company(db, tenantId);
      if (!t) return "not_eligible";
      // A company that already had its trial still qualifies: the card is the point.
      const skip = welcomeTrialSkip({ ...t, trialStartedAt: null }, CARD_TRIAL_DAYS);
      if (skip === "tenant_had_trial") return "not_eligible";
      if (skip) return skip;
      const known = await this.inRegistry(t.ico!, t.addressCountry);
      if (known !== "ok") return known;

      const signals = await this.signals(db, tenantId);
      const outcome = await this.call<CardTrialOutcome>(
        db,
        sql`SELECT extend_trial_with_card(${tenantId}, ${cardHash(fingerprint)}, ${CARD_TRIAL_DAYS}, ${JSON.stringify(signals)}::jsonb) AS outcome`,
      );
      this.logger.log(`Card trial extension for tenant ${tenantId}: ${outcome}`);
      return outcome;
    } catch (e) {
      this.logger.warn(`Card trial extension failed for tenant ${tenantId}: ${e instanceof Error ? e.message : e}`);
      return "error";
    }
  }

  private async company(db: TenantDb, tenantId: string) {
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
    return t;
  }

  private async inRegistry(ico: string, country: string): Promise<"ok" | "not_in_registry" | "registry_down"> {
    return this.contacts.lookupById(ico, country).then(
      () => "ok" as const,
      (e: unknown) => (e instanceof NotFoundException ? ("not_in_registry" as const) : ("registry_down" as const)),
    );
  }

  /** In a savepoint, so a failure here can't abort the save that called it. */
  private async call<T extends string>(db: TenantDb, query: ReturnType<typeof sql>): Promise<T> {
    const rows = await db.transaction((tx) => tx.execute<{ outcome: T }>(query));
    return rows[0]?.outcome ?? ("error" as T);
  }

  /** Everything the company itself can read (RLS), nothing of anyone else's. */
  private async signals(db: TenantDb, tenantId: string): Promise<TrialSignal[]> {
    const [t] = await db
      .select({
        country: schema.tenants.addressCountry,
        account: schema.tenants.bankAccountNumber,
        bankCode: schema.tenants.bankAccountBankCode,
        iban: schema.tenants.bankAccountIban,
        email: schema.tenants.email,
        phone: schema.tenants.phone,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    if (!t) return [];
    const accounts = await db
      .select({ account: schema.tenantBankAccounts.accountNumber, bankCode: schema.tenantBankAccounts.bankCode, iban: schema.tenantBankAccounts.iban })
      .from(schema.tenantBankAccounts)
      .where(eq(schema.tenantBankAccounts.tenantId, tenantId));
    // Imported documents carry the supplier's account as it was printed.
    const printed = await db.execute<{ account: string | null; bank_code: string | null; iban: string | null }>(sql`
      SELECT DISTINCT seller_snapshot->>'bankAccountNumber' AS account, seller_snapshot->>'bankAccountBankCode' AS bank_code,
             seller_snapshot->>'bankAccountIban' AS iban
      FROM invoices
      WHERE tenant_id = ${tenantId} AND seller_snapshot IS NOT NULL
      LIMIT ${SNAPSHOT_ACCOUNTS_LIMIT}`);
    const owners = await db
      .select({ email: schema.users.email })
      .from(schema.tenantMemberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.tenantMemberships.userId))
      .where(and(eq(schema.tenantMemberships.tenantId, tenantId), eq(schema.tenantMemberships.role, "owner")));
    const ips = await db
      .select({ ip: schema.tosAcceptances.ipAddress })
      .from(schema.tosAcceptances)
      .where(and(eq(schema.tosAcceptances.tenantId, tenantId), isNotNull(schema.tosAcceptances.ipAddress)));

    const banks = [
      { account: t.iban },
      { account: t.account, bankCode: t.bankCode },
      ...accounts.flatMap((a) => [{ account: a.iban }, { account: a.account, bankCode: a.bankCode }]),
      ...[...printed].flatMap((p) => [{ account: p.iban }, { account: p.account, bankCode: p.bank_code }]),
    ];
    return trialSignals({
      country: t.country,
      banks,
      emails: [t.email, ...owners.map((o) => o.email)],
      phones: [t.phone],
      ips: ips.map((i) => i.ip),
    });
  }
}
