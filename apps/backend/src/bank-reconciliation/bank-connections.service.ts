import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { and, asc, eq, inArray, lt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { decryptSecret, encryptSecret } from "../backup-destinations/encryption.util";
import { NotificationsService } from "../notifications/notifications.service";
import { BankReconciliationService } from "./bank-reconciliation.service";
import {
  EnableBankingClient,
  EnableBankingError,
  enableBankingConfig,
  type Aspsp,
  type Psd2SyncedRow,
} from "./enable-banking-client";
import {
  FIO_MIN_INTERVAL_MS,
  FIO_TOKEN_PATTERN,
  FioApiError,
  fetchFioLast,
  fioCursorAfterFetch,
  planFioStep,
  setFioLastDate,
  setFioLastId,
  type FioStatement,
  type FioSyncedRow,
} from "./fio-client";
import { PaypalApiError, PaypalClient, type PaypalCredentials, type PaypalSyncedRow } from "./paypal-client";

type TenantDb = PostgresJsDatabase<typeof schema>;
type BankConnectionRow = typeof schema.bankConnections.$inferSelect;

/** How far back the first sync looks; later syncs overlap a few days so late-booked movements still arrive. */
const FIRST_SYNC_DAYS = 30;
const OVERLAP_DAYS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** PSD2 allows about 4 unattended reads a day per account: the hourly sweep reads PSD2 accounts every 6 h. */
const PSD2_BACKGROUND_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PSD2_MANUAL_INTERVAL_MS = 15 * 60 * 1000;
const PSD2_MAX_CONSENT_MS = 180 * DAY_MS;
const PAYPAL_MANUAL_INTERVAL_MS = 60_000;
/**
 * The EEA countries Enable Banking covers, home markets first. Neobanks are
 * listed under their licence country: Revolut under LT (and most others),
 * Wise under BE. A country with no banks simply returns an empty list.
 */
export const PSD2_COUNTRIES = [
  "CZ", "SK", "AT", "DE", "PL", "HU", "LT", "BE", "BG", "CY", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "IE", "IS",
  "IT", "LI", "LU", "LV", "MT", "NL", "NO", "PT", "RO", "SE", "SI",
];
/** The bank list per country barely changes: one fetch a day serves every tenant. */
const BANK_LIST_TTL_MS = DAY_MS;
const bankListCache = new Map<string, { at: number; banks: Promise<Aspsp[]> }>();

function encryptionKey(): string | undefined {
  return process.env.AI_KEY_ENCRYPTION_KEY ?? process.env.BACKUP_CONFIG_ENCRYPTION_KEY;
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
}

/** Where the bank sends the user back; must be registered in the Enable Banking application. */
export function psd2RedirectUrl(): string {
  return process.env.ENABLE_BANKING_REDIRECT_URL ?? `${siteUrl()}/bank/psd2-callback`;
}

/** API shape: never includes the token or the consent session. */
function toPublic(row: BankConnectionRow) {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    label: row.label,
    accountNumber: row.accountNumber,
    bankName: row.bankName,
    bankCountry: row.bankCountry,
    consentExpiresAt: row.consentExpiresAt,
    enabled: row.enabled,
    lastSyncedAt: row.lastSyncedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

export interface BankSyncSummary {
  connectionId: string;
  total: number;
  matched: number;
  unmatched: number;
  /**
   * Fio only: this sync just positioned Fio's cursor (one request per 30 s),
   * the movements come with the next one.
   */
  pending?: boolean;
}

/** Fio's per-token limit, counted from our last request of any kind. */
function fioTooSoon(row: BankConnectionRow, now: Date): boolean {
  return row.lastRequestAt !== null && now.getTime() - row.lastRequestAt.getTime() < FIO_MIN_INTERVAL_MS;
}

@Injectable()
export class BankConnectionsService {
  private readonly logger = new Logger(BankConnectionsService.name);

  constructor(
    private readonly reconciliation: BankReconciliationService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  /** Overridable in tests. Throws 503 when the platform has no Enable Banking application configured. */
  protected psd2Client(): EnableBankingClient {
    const config = enableBankingConfig();
    if (!config) throw new ServiceUnavailableException({ error: "psd2_not_configured" });
    return new EnableBankingClient(config);
  }

  psd2Status() {
    return { available: enableBankingConfig() !== null, countries: PSD2_COUNTRIES };
  }

  /** Shared across tenants; a failed fetch is dropped so the next call retries. */
  private cachedBanks(country: string): Promise<Aspsp[]> {
    const hit = bankListCache.get(country);
    if (hit && Date.now() - hit.at < BANK_LIST_TTL_MS) return hit.banks;
    const banks = this.psd2Client().listBanks(country);
    bankListCache.set(country, { at: Date.now(), banks });
    banks.catch(() => bankListCache.delete(country));
    return banks;
  }

  async listPsd2Banks(country: string) {
    const code = country.toUpperCase();
    if (!PSD2_COUNTRIES.includes(code)) throw new BadRequestException({ error: "psd2_country" });
    try {
      const banks = await this.cachedBanks(code);
      return banks
        .map((b) => ({
          name: b.name,
          country: b.country,
          logo: b.logo,
          business: b.psuTypes.length === 0 || b.psuTypes.includes("business"),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "cs"));
    } catch (err) {
      throw this.psd2HttpError(err);
    }
  }

  /**
   * Sends the user to their bank. A new connection starts as `pending`;
   * `reconnectId` renews consent on an existing one (same account, new session).
   */
  async startPsd2(
    db: TenantDb,
    tenantId: string,
    input: { bankName: string; country: string; label: string | null; psuType: "business" | "personal"; reconnectId?: string },
  ): Promise<{ url: string }> {
    const client = this.psd2Client();
    const country = input.country.toUpperCase();
    if (!PSD2_COUNTRIES.includes(country)) throw new BadRequestException({ error: "psd2_country" });
    let maxMs = PSD2_MAX_CONSENT_MS;
    try {
      const bank = (await this.cachedBanks(country)).find((b) => b.name === input.bankName);
      if (!bank) throw new BadRequestException({ error: "psd2_bank_unknown" });
      if (bank.maximumConsentValidity) maxMs = Math.min(maxMs, bank.maximumConsentValidity * 1000);
    } catch (err) {
      throw this.psd2HttpError(err);
    }

    const state = randomBytes(24).toString("hex");
    if (input.reconnectId) {
      const [row] = await db
        .update(schema.bankConnections)
        .set({ authState: state, bankName: input.bankName, bankCountry: country })
        .where(and(eq(schema.bankConnections.id, input.reconnectId), eq(schema.bankConnections.provider, "enable_banking")))
        .returning({ id: schema.bankConnections.id });
      if (!row) throw new NotFoundException("Bank connection not found");
    } else {
      await db.insert(schema.bankConnections).values({
        tenantId,
        provider: "enable_banking",
        status: "pending",
        label: input.label,
        bankName: input.bankName,
        bankCountry: country,
        authState: state,
      });
    }

    try {
      const url = await client.startAuth({
        bankName: input.bankName,
        country,
        // A minute of slack so the bank never sees a validity above its maximum.
        validUntil: new Date(Date.now() + maxMs - 60_000),
        state,
        redirectUrl: psd2RedirectUrl(),
        psuType: input.psuType,
      });
      if (!/^https:\/\//.test(url)) throw new EnableBankingError("Unexpected authorisation URL", "bad_response");
      return { url };
    } catch (err) {
      throw this.psd2HttpError(err);
    }
  }

  /**
   * The bank redirected back with `code` and our `state`. Creates the session
   * and activates the connection; extra accounts granted in the same consent
   * become connections of their own.
   */
  async completePsd2(db: TenantDb, tenantId: string, code: string, state: string) {
    const [row] = await db.select().from(schema.bankConnections).where(eq(schema.bankConnections.authState, state)).limit(1);
    if (!row || row.provider !== "enable_banking") throw new BadRequestException({ error: "psd2_state_invalid" });

    const client = this.psd2Client();
    let session;
    try {
      session = await client.createSession(code);
    } catch (err) {
      await db
        .update(schema.bankConnections)
        .set({ authState: null, lastError: "psd2_auth_failed" })
        .where(eq(schema.bankConnections.id, row.id));
      throw this.psd2HttpError(err);
    }
    if (session.accounts.length === 0) {
      await db
        .update(schema.bankConnections)
        .set({ authState: null, lastError: "psd2_no_accounts" })
        .where(eq(schema.bankConnections.id, row.id));
      throw new BadRequestException({ error: "psd2_no_accounts" });
    }

    const existing = await db.select().from(schema.bankConnections).where(eq(schema.bankConnections.provider, "enable_banking"));
    const previousSession = row.externalSessionId;
    const common = {
      status: "active" as const,
      externalSessionId: session.sessionId,
      consentExpiresAt: session.validUntil ?? new Date(Date.now() + 90 * DAY_MS),
      authState: null,
      lastError: null,
      bankName: row.bankName,
      bankCountry: row.bankCountry,
    };

    // On reconnect the row keeps its own account; a new connection takes the first one.
    const primary =
      session.accounts.find((a) => row.externalAccountId && a.uid === row.externalAccountId) ??
      session.accounts.find((a) => row.accountNumber && a.iban === row.accountNumber) ??
      session.accounts[0]!;
    await db
      .update(schema.bankConnections)
      .set({ ...common, externalAccountId: primary.uid, accountNumber: primary.iban ?? row.accountNumber })
      .where(eq(schema.bankConnections.id, row.id));

    for (const account of session.accounts) {
      if (account === primary) continue;
      const same = existing.find(
        (c) => c.id !== row.id && (c.externalAccountId === account.uid || (account.iban !== null && c.accountNumber === account.iban)),
      );
      if (same) {
        await db
          .update(schema.bankConnections)
          .set({ ...common, externalAccountId: account.uid, accountNumber: account.iban ?? same.accountNumber })
          .where(eq(schema.bankConnections.id, same.id));
      } else {
        await db.insert(schema.bankConnections).values({
          tenantId,
          provider: "enable_banking",
          ...common,
          label: account.name,
          externalAccountId: account.uid,
          accountNumber: account.iban,
        });
      }
    }

    if (previousSession && previousSession !== session.sessionId) {
      await this.endSessionIfUnused(db, previousSession);
    }
    return this.list(db);
  }

  /** Revokes a bank consent once no connection uses it any more. */
  private async endSessionIfUnused(db: TenantDb, sessionId: string) {
    const stillUsed = await db
      .select({ id: schema.bankConnections.id })
      .from(schema.bankConnections)
      .where(eq(schema.bankConnections.externalSessionId, sessionId))
      .limit(1);
    const config = enableBankingConfig();
    if (stillUsed.length === 0 && config) await new EnableBankingClient(config).deleteSession(sessionId);
  }

  private psd2HttpError(err: unknown): Error {
    if (err instanceof HttpException) return err;
    const code = err instanceof EnableBankingError ? err.code : "unavailable";
    if (code === "not_configured") return new ServiceUnavailableException({ error: "psd2_not_configured" });
    if (code === "rate_limited") return new HttpException({ error: "bank_sync_too_soon" }, HttpStatus.TOO_MANY_REQUESTS);
    if (code === "consent_expired") return new BadRequestException({ error: "consent_expired" });
    if (code === "rejected") return new BadRequestException({ error: "psd2_rejected" });
    this.logger.warn(`Enable Banking call failed: ${(err as Error)?.message}`);
    return new ServiceUnavailableException({ error: "bank_unavailable" });
  }

  async list(db: TenantDb) {
    const rows = await db.select().from(schema.bankConnections).orderBy(asc(schema.bankConnections.createdAt));
    return rows.filter((r) => r.status !== "pending").map(toPublic);
  }

  async createFio(db: TenantDb, tenantId: string, token: string, label: string | null) {
    const trimmed = token.trim();
    if (!FIO_TOKEN_PATTERN.test(trimmed)) {
      throw new BadRequestException({ error: "fio_token_format" });
    }
    const key = encryptionKey();
    if (!key) throw new ServiceUnavailableException({ error: "encryption_not_configured" });

    // Puts Fio's cursor 30 days back, so the first sync already brings movements.
    // It doubles as the token check: a rejected token is never stored.
    const now = new Date();
    let cursorReady = false;
    let lastError: string | null = null;
    try {
      const step = planFioStep({ fioLastId: null, fioCursorReady: false, lastSyncedAt: null }, now);
      if (step.kind === "set-last-date") await this.fioApi.setLastDate(trimmed, step.day);
      cursorReady = true;
    } catch (err) {
      const code = err instanceof FioApiError ? err.code : "unavailable";
      if (code === "invalid_token") throw new BadRequestException({ error: "fio_token_invalid" });
      // Fio busy or down: keep the connection, the next sync positions the cursor.
      lastError = code;
    }

    const [row] = await db
      .insert(schema.bankConnections)
      .values({
        tenantId,
        provider: "fio",
        label,
        tokenEncrypted: encryptSecret(trimmed, key),
        fioCursorReady: cursorReady,
        lastRequestAt: now,
        lastError,
      })
      .returning();
    return toPublic(row!);
  }

  /** Overridable in tests. */
  protected readonly fioApi = {
    last: (token: string) => fetchFioLast(token),
    setLastId: (token: string, id: number) => setFioLastId(token, id),
    setLastDate: (token: string, day: Date) => setFioLastDate(token, day),
  };

  /** Overridable in tests. */
  protected paypalClient(credentials: PaypalCredentials): PaypalClient {
    return new PaypalClient(credentials);
  }

  /** Checks the REST app credentials (token + one reporting call) before storing them encrypted. */
  async createPaypal(
    db: TenantDb,
    tenantId: string,
    input: { clientId: string; secret: string; sandbox: boolean; label: string | null },
  ) {
    const key = encryptionKey();
    if (!key) throw new ServiceUnavailableException({ error: "encryption_not_configured" });
    const credentials: PaypalCredentials = { clientId: input.clientId.trim(), secret: input.secret.trim(), sandbox: input.sandbox };
    try {
      await this.paypalClient(credentials).fetchIncoming(new Date(Date.now() - DAY_MS));
    } catch (err) {
      throw this.paypalHttpError(err);
    }
    const [row] = await db
      .insert(schema.bankConnections)
      .values({
        tenantId,
        provider: "paypal",
        label: input.label,
        bankName: input.sandbox ? "PayPal (sandbox)" : "PayPal",
        tokenEncrypted: encryptSecret(JSON.stringify(credentials), key),
      })
      .returning();
    return toPublic(row!);
  }

  private paypalHttpError(err: unknown): Error {
    if (err instanceof HttpException) return err;
    const code = err instanceof PaypalApiError ? err.code : "unavailable";
    if (code === "invalid_credentials") return new BadRequestException({ error: "paypal_credentials_invalid" });
    if (code === "reporting_disabled") return new BadRequestException({ error: "paypal_reporting_disabled" });
    if (code === "rate_limited") return new HttpException({ error: "bank_sync_too_soon" }, HttpStatus.TOO_MANY_REQUESTS);
    this.logger.warn(`PayPal call failed: ${(err as Error)?.message}`);
    return new ServiceUnavailableException({ error: "bank_unavailable" });
  }

  async update(db: TenantDb, id: string, patch: { enabled?: boolean; label?: string | null }) {
    const [row] = await db
      .update(schema.bankConnections)
      .set(patch)
      .where(eq(schema.bankConnections.id, id))
      .returning();
    if (!row) throw new NotFoundException("Bank connection not found");
    return toPublic(row);
  }

  async remove(db: TenantDb, id: string) {
    const deleted = await db
      .delete(schema.bankConnections)
      .where(eq(schema.bankConnections.id, id))
      .returning({ id: schema.bankConnections.id, sessionId: schema.bankConnections.externalSessionId });
    if (deleted.length === 0) throw new NotFoundException("Bank connection not found");
    const sessionId = deleted[0]!.sessionId;
    if (sessionId) await this.endSessionIfUnused(db, sessionId);
  }

  /** Manual "Synchronizovat" button. Errors surface to the caller. */
  async syncOne(db: TenantDb, tenantId: string, id: string): Promise<BankSyncSummary> {
    const [row] = await db.select().from(schema.bankConnections).where(eq(schema.bankConnections.id, id)).limit(1);
    if (!row) throw new NotFoundException("Bank connection not found");
    if (row.status === "pending") throw new BadRequestException({ error: "psd2_pending" });
    if (row.status === "expired") throw new BadRequestException({ error: "consent_expired" });
    const tooSoon =
      row.provider === "fio"
        ? fioTooSoon(row, new Date())
        : row.lastSyncedAt !== null &&
          Date.now() - row.lastSyncedAt.getTime() < (row.provider === "paypal" ? PAYPAL_MANUAL_INTERVAL_MS : PSD2_MANUAL_INTERVAL_MS);
    if (tooSoon) throw new HttpException({ error: "bank_sync_too_soon" }, HttpStatus.TOO_MANY_REQUESTS);
    return this.sync(db, tenantId, row, true);
  }

  /** Hourly sweep for one tenant: every enabled connection, failures recorded on the row. */
  async syncAllForTenant(db: TenantDb, tenantId: string): Promise<number> {
    // Bank redirects abandoned for a day.
    await db
      .delete(schema.bankConnections)
      .where(and(eq(schema.bankConnections.status, "pending"), lt(schema.bankConnections.createdAt, new Date(Date.now() - DAY_MS))));

    const rows = await db.select().from(schema.bankConnections).where(eq(schema.bankConnections.enabled, true));
    let synced = 0;
    for (const row of rows) {
      if (row.status !== "active") continue;
      if (row.provider === "enable_banking") {
        if (row.consentExpiresAt && row.consentExpiresAt.getTime() <= Date.now()) {
          await this.markExpired(db, tenantId, row);
          continue;
        }
        if (row.lastSyncedAt && Date.now() - row.lastSyncedAt.getTime() < PSD2_BACKGROUND_INTERVAL_MS) continue;
      }
      // Someone pressed "sync now" seconds ago; the next sweep picks it up.
      if (row.provider === "fio" && fioTooSoon(row, new Date())) continue;
      try {
        await this.sync(db, tenantId, row, false);
        synced++;
      } catch (err) {
        this.logger.warn(`bank sync failed for connection ${row.id}: ${(err as Error).message}`);
      }
    }
    return synced;
  }

  private async sync(db: TenantDb, tenantId: string, row: BankConnectionRow, throwErrors: boolean): Promise<BankSyncSummary> {
    const now = new Date();
    const from = row.lastSyncedAt
      ? new Date(row.lastSyncedAt.getTime() - OVERLAP_DAYS * DAY_MS)
      : new Date(now.getTime() - FIRST_SYNC_DAYS * DAY_MS);
    const period = `${from.toISOString().slice(0, 10)} – ${now.toISOString().slice(0, 10)}`;

    if (row.provider === "enable_banking") {
      let rows: Psd2SyncedRow[];
      try {
        if (!row.externalAccountId) throw new EnableBankingError("Connection has no account", "consent_expired");
        rows = await this.psd2Client().fetchIncoming(row.externalAccountId, from);
      } catch (err) {
        const code = err instanceof EnableBankingError ? err.code : err instanceof HttpException ? "not_configured" : "unavailable";
        if (code === "consent_expired") await this.markExpired(db, tenantId, row);
        else {
          await db
            .update(schema.bankConnections)
            .set({
              lastError: code === "not_configured" ? "psd2_not_configured" : "bank_unavailable",
              ...(code === "rate_limited" ? {} : { lastSyncedAt: now }),
            })
            .where(eq(schema.bankConnections.id, row.id));
        }
        if (throwErrors) throw this.psd2HttpError(err);
        throw err;
      }
      const summary = await this.storeFresh(db, tenantId, `${row.bankName ?? "Banka"} ${row.accountNumber ?? ""} ${period}`, "psd2", rows);
      await db.update(schema.bankConnections).set({ lastSyncedAt: now, lastError: null }).where(eq(schema.bankConnections.id, row.id));
      return { connectionId: row.id, ...summary };
    }

    if (row.provider === "paypal") {
      let rows: PaypalSyncedRow[];
      try {
        const credentials = JSON.parse(decryptSecret(row.tokenEncrypted ?? "", encryptionKey())) as PaypalCredentials;
        rows = await this.paypalClient(credentials).fetchIncoming(from, now);
      } catch (err) {
        const code = err instanceof PaypalApiError ? err.code : "unavailable";
        const lastError =
          code === "invalid_credentials" ? "paypal_credentials_invalid" : code === "reporting_disabled" ? "paypal_reporting_disabled" : code;
        await db
          .update(schema.bankConnections)
          .set({ lastError, ...(code === "rate_limited" ? {} : { lastSyncedAt: now }) })
          .where(eq(schema.bankConnections.id, row.id));
        if (throwErrors) throw this.paypalHttpError(err);
        throw err;
      }
      const summary = await this.storeFresh(db, tenantId, `${row.label ?? "PayPal"} ${period}`, "paypal", rows);
      await db.update(schema.bankConnections).set({ lastSyncedAt: now, lastError: null }).where(eq(schema.bankConnections.id, row.id));
      return { connectionId: row.id, ...summary };
    }

    return this.syncFio(db, tenantId, row, now, throwErrors);
  }

  /**
   * One Fio request per call (see `planFioStep`): either move Fio's cursor
   * to where our stored movements end, or download what came after it. The
   * token is decrypted only for the request and never logged; FioApiError
   * messages never contain it.
   */
  private async syncFio(
    db: TenantDb,
    tenantId: string,
    row: BankConnectionRow,
    now: Date,
    throwErrors: boolean,
  ): Promise<BankSyncSummary> {
    const step = planFioStep(row, now);
    const connection = eq(schema.bankConnections.id, row.id);
    await db.update(schema.bankConnections).set({ lastRequestAt: now }).where(connection);

    let statement: FioStatement;
    try {
      const token = decryptSecret(row.tokenEncrypted ?? "", encryptionKey());
      if (step.kind !== "last") {
        if (step.kind === "set-last-id") await this.fioApi.setLastId(token, step.id);
        else await this.fioApi.setLastDate(token, step.day);
        await db.update(schema.bankConnections).set({ fioCursorReady: true, lastError: null }).where(connection);
        return { connectionId: row.id, total: 0, matched: 0, unmatched: 0, pending: true };
      }
      statement = await this.fioApi.last(token);
    } catch (err) {
      const code = err instanceof FioApiError ? err.code : "unavailable";
      await db
        .update(schema.bankConnections)
        .set({
          lastError: code,
          // Fio's cursor is older than it serves without a strong authorisation:
          // start again from a date (at most 89 days back).
          ...(code === "history_locked" ? { fioCursorReady: false, fioLastId: null } : {}),
        })
        .where(connection);
      if (throwErrors) {
        if (code === "rate_limited") throw new HttpException({ error: "bank_sync_too_soon" }, HttpStatus.TOO_MANY_REQUESTS);
        if (code === "invalid_token") throw new BadRequestException({ error: "fio_token_invalid" });
        if (code === "history_locked") throw new BadRequestException({ error: "history_locked" });
        throw new ServiceUnavailableException({ error: "bank_unavailable" });
      }
      throw err;
    }

    const title = `Fio ${statement.accountNumber ?? ""} ${now.toISOString().slice(0, 10)}`;
    const summary = await this.storeFresh(db, tenantId, title, "fio", statement.rows);
    await db
      .update(schema.bankConnections)
      .set({
        ...fioCursorAfterFetch(row.fioLastId, statement),
        lastSyncedAt: now,
        lastError: null,
        accountNumber: statement.accountNumber ?? row.accountNumber,
      })
      .where(connection);
    return { connectionId: row.id, ...summary };
  }

  private async markExpired(db: TenantDb, tenantId: string, row: BankConnectionRow) {
    await db
      .update(schema.bankConnections)
      .set({ status: "expired", lastError: "consent_expired" })
      .where(eq(schema.bankConnections.id, row.id));
    this.notifications?.notify(tenantId, "bank_import", {
      title: "Souhlas s přístupem k účtu vypršel",
      body: `${row.bankName ?? "Banka"} ${row.accountNumber ?? ""}: obnovte napojení, ať se platby dál párují samy.`.replace(/\s+/g, " "),
      link: "/bank",
    });
  }

  /**
   * Skips movements already stored by an earlier, overlapping sync (a cheap
   * id lookup that also catches a movement whose booking day changed), then
   * lets `persistAndMatch` drop copies of uploaded statements and store and
   * match the rest. A quiet hour leaves no empty import behind.
   */
  private async storeFresh(
    db: TenantDb,
    tenantId: string,
    title: string,
    source: "fio" | "psd2" | "paypal",
    rows: (FioSyncedRow | Psd2SyncedRow | PaypalSyncedRow)[],
  ) {
    const ids = rows.map((r) => r.externalId);
    const known = ids.length
      ? await db
          .select({ externalId: schema.bankTransactions.externalId })
          .from(schema.bankTransactions)
          .where(and(eq(schema.bankTransactions.tenantId, tenantId), inArray(schema.bankTransactions.externalId, ids)))
      : [];
    const knownIds = new Set(known.map((k) => k.externalId));
    const fresh = rows.filter((r) => !knownIds.has(r.externalId));

    const result = await this.reconciliation.persistAndMatch(db, tenantId, title.replace(/\s+/g, " ").trim(), source, fresh, {
      skipEmpty: true,
    });

    if (result.summary.total > 0) {
      this.notifications?.notify(tenantId, "bank_import", {
        title: "Nové platby z banky",
        body: `${result.summary.total} příchozích plateb, ${result.summary.matched} spárováno automaticky, ${result.summary.unmatched} čeká na vás.`,
        link: "/bank",
      });
    }
    return result.summary;
  }
}
