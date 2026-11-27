import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from "@nestjs/common";
import { desc, eq, inArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  buildSignedEetRequest,
  createEetHeader,
  describeCertificate,
  EET_PATTERNS,
  EetFieldError,
  formatEetAmount,
  formatEetDateTime,
  isAssignedIdJednotky,
  isValidEic,
  Pkcs12Error,
  readPkcs12,
  sendEetRequest,
  type EetEnvironment,
  type EetSigner,
  type SendEetResult,
} from "@faktur/cz-compliance/eet";
import * as schema from "../../drizzle/schema";
import { decryptSecret, encryptSecret } from "../backup-destinations/encryption.util";
import { attemptOutcome, planEetPayment, resendDue, reversalAmount, type EetSkipReason } from "./eet-policy";

type TenantDb = PostgresJsDatabase<typeof schema>;
type InvoiceRow = typeof schema.invoices.$inferSelect;
type EetRecordRow = typeof schema.eetRecords.$inferSelect;

/** Sends one signed request (a token so tests never reach the network). */
export const EET_TRANSPORT = Symbol("EET_TRANSPORT");
export type EetTransport = (xml: string, environment: EetEnvironment, timeoutMs: number) => Promise<SendEetResult>;
const defaultTransport: EetTransport = (xml, environment, timeoutMs) => sendEetRequest(xml, { environment, timeoutMs });

const encryptionKey = () => process.env.AI_KEY_ENCRYPTION_KEY ?? process.env.BACKUP_CONFIG_ENCRYPTION_KEY;

/** While the user waits on "Mark as paid": a little over the 2 s the act asks for (§ 19), the cron retries the rest. */
const REQUEST_TIMEOUT_MS = 3_000;
const CRON_TIMEOUT_MS = 10_000;
/** A .p12 from DIS+ is about 4 kB; anything near this is not a pokladní certifikát. */
const MAX_P12_BYTES = 32 * 1024;

export interface EetSettings {
  enabled: boolean;
  environment: EetEnvironment;
  idJednotky: string | null;
  idPokl: string | null;
  cardInPerson: boolean;
  certificate: (typeof schema.tenants.$inferSelect)["eetCertificateInfo"];
  /** The certificate's EIČ differs from the company DIČ (a typo or someone else's certificate). */
  eicMismatch: boolean;
  /** Records still waiting for an answer, and those past the 48 hours. */
  pending: number;
  overdue: number;
}

export interface EetSettingsInput {
  enabled?: boolean;
  environment?: EetEnvironment;
  idJednotky?: string | null;
  idPokl?: string | null;
  cardInPerson?: boolean;
}

export type EetPaymentResult =
  | { recorded: false; reason: EetSkipReason | "amounts_sealed" }
  | { recorded: true; recordId: string; status: EetRecordRow["status"]; pok: string | null; test: boolean | null; error: string | null };

interface TenantEet {
  tenantId: string;
  enabled: boolean;
  environment: EetEnvironment;
  idJednotky: string | null;
  idPokl: string | null;
  cardInPerson: boolean;
  certificate: string | null;
}

/**
 * EET 2.0 (docs/eet.md): settings, the pokladní certifikát, and sending
 * records of kontaktní platby with the § 20 resend. Every method takes the
 * request's (or the cron's) tenant transaction; nothing here crosses tenants.
 * The certificate and its password are never logged or returned.
 */
@Injectable()
export class EetService {
  private readonly logger = new Logger(EetService.name);
  private readonly transport: EetTransport;

  constructor(@Optional() @Inject(EET_TRANSPORT) transport?: EetTransport) {
    this.transport = transport ?? defaultTransport;
  }

  // --- settings (owner/admin, Settings → EET) ------------------------------

  async getSettings(db: TenantDb, tenantId: string): Promise<EetSettings> {
    const t = schema.tenants;
    const [row] = await db
      .select({
        enabled: t.eetEnabled,
        environment: t.eetEnvironment,
        idJednotky: t.eetIdJednotky,
        idPokl: t.eetIdPokl,
        cardInPerson: t.eetCardInPerson,
        certificate: t.eetCertificateInfo,
        dic: t.dic,
      })
      .from(t)
      .where(eq(t.id, tenantId));
    if (!row) throw new NotFoundException("tenant_not_found");
    const counts = await db
      .select({ status: schema.eetRecords.status, n: sql<number>`count(*)::int` })
      .from(schema.eetRecords)
      .where(inArray(schema.eetRecords.status, ["pending", "overdue"]))
      .groupBy(schema.eetRecords.status);
    const cn = row.certificate?.commonName ?? null;
    const dic = row.dic?.replace(/\s+/g, "").toUpperCase() ?? null;
    return {
      enabled: row.enabled,
      environment: row.environment,
      idJednotky: row.idJednotky,
      idPokl: row.idPokl,
      cardInPerson: row.cardInPerson,
      certificate: row.certificate,
      eicMismatch: !!cn && !!dic && cn !== dic,
      pending: counts.find((c) => c.status === "pending")?.n ?? 0,
      overdue: counts.find((c) => c.status === "overdue")?.n ?? 0,
    };
  }

  async updateSettings(db: TenantDb, tenantId: string, input: EetSettingsInput): Promise<EetSettings> {
    const [current] = await db
      .select({
        enabled: schema.tenants.eetEnabled,
        environment: schema.tenants.eetEnvironment,
        idJednotky: schema.tenants.eetIdJednotky,
        idPokl: schema.tenants.eetIdPokl,
        certificate: schema.tenants.eetCertificateInfo,
        country: schema.tenants.country,
        isDemo: schema.tenants.isDemo,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    if (!current) throw new NotFoundException("tenant_not_found");
    const idJednotky = input.idJednotky === undefined ? current.idJednotky : input.idJednotky?.trim() || null;
    const idPokl = input.idPokl === undefined ? current.idPokl : input.idPokl?.trim() || null;
    // DIS+ numbers end in the unit type 1–4; anything else is answered with warning 6.
    if (idJednotky && !isAssignedIdJednotky(idJednotky)) throw new BadRequestException("invalid_id_jednotky");
    if (idPokl && !EET_PATTERNS.idPokl.test(idPokl)) throw new BadRequestException("invalid_id_pokl");
    const enabled = input.enabled ?? current.enabled;
    if (enabled) {
      if ((current.country ?? "CZ").toUpperCase() !== "CZ") throw new BadRequestException("eet_cz_only");
      if (current.isDemo) throw new BadRequestException("eet_not_for_demo");
      if (!current.certificate) throw new BadRequestException("certificate_missing");
      if (!idJednotky || !idPokl) throw new BadRequestException("eet_not_configured");
      if (new Date(current.certificate.validTo) < new Date()) throw new BadRequestException("certificate_expired");
    }
    await db
      .update(schema.tenants)
      .set({
        eetEnabled: enabled,
        ...(input.environment ? { eetEnvironment: input.environment } : {}),
        eetIdJednotky: idJednotky,
        eetIdPokl: idPokl,
        ...(input.cardInPerson !== undefined ? { eetCardInPerson: input.cardInPerson } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tenants.id, tenantId));
    return this.getSettings(db, tenantId);
  }

  /** Checks the .p12 opens with the password and holds a usable certificate, then stores both encrypted. */
  async uploadCertificate(db: TenantDb, tenantId: string, p12: Buffer, password: string): Promise<EetSettings> {
    if (p12.length === 0 || p12.length > MAX_P12_BYTES) throw new BadRequestException("invalid_p12");
    let info: ReturnType<typeof describeCertificate>;
    try {
      info = describeCertificate(readPkcs12(p12, password).certificate);
    } catch (err) {
      if (err instanceof Pkcs12Error) throw new BadRequestException(err.code);
      throw new BadRequestException("invalid_p12");
    }
    if (!info.commonName || !isValidEic(info.commonName)) throw new BadRequestException("certificate_not_eet");
    if (info.validTo < new Date()) throw new BadRequestException("certificate_expired");
    await db
      .update(schema.tenants)
      .set({
        eetCertificateEncrypted: encryptSecret(JSON.stringify({ p12: p12.toString("base64"), password }), encryptionKey()),
        eetCertificateInfo: {
          commonName: info.commonName,
          serialNumber: info.serialNumber,
          validFrom: info.validFrom.toISOString(),
          validTo: info.validTo.toISOString(),
          issuer: info.issuer,
          fingerprint256: info.fingerprint256,
        },
        updatedAt: new Date(),
      })
      .where(eq(schema.tenants.id, tenantId));
    return this.getSettings(db, tenantId);
  }

  /** Removing the certificate switches recording off; unanswered records wait until a new one is uploaded. */
  async removeCertificate(db: TenantDb, tenantId: string): Promise<EetSettings> {
    await db
      .update(schema.tenants)
      .set({ eetCertificateEncrypted: null, eetCertificateInfo: null, eetEnabled: false, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));
    return this.getSettings(db, tenantId);
  }

  async listRecords(db: TenantDb, opts: { invoiceId?: string; limit?: number } = {}) {
    const r = schema.eetRecords;
    return db
      .select()
      .from(r)
      .where(opts.invoiceId ? eq(r.invoiceId, opts.invoiceId) : undefined)
      .orderBy(desc(r.createdAt))
      .limit(Math.min(opts.limit ?? 100, 500));
  }

  // --- recording -----------------------------------------------------------

  /**
   * A payment entered by hand on an invoice ("Mark as paid"). Called only
   * from that route: bank matching and online card checkout are remote
   * payments and never reach this. Sends at once; without an answer the
   * record stays pending for EetCron.
   */
  async recordInvoicePayment(
    db: TenantDb,
    before: InvoiceRow,
    after: InvoiceRow,
    opts: { receivedCzk?: number; paidAt?: Date; now?: Date } = {},
  ): Promise<EetPaymentResult> {
    const tenant = await this.tenantEet(db, after.tenantId);
    if (!tenant.enabled) return { recorded: false, reason: "disabled" };
    if (!tenant.certificate || !tenant.idJednotky || !tenant.idPokl) return { recorded: false, reason: "not_configured" };
    if (after.encAmounts) return { recorded: false, reason: "amounts_sealed" };
    const plan = planEetPayment({
      environment: tenant.environment,
      method: after.paymentMethod,
      cardInPerson: tenant.cardInPerson,
      documentType: after.documentType,
      currency: after.currency,
      exchangeRate: after.exchangeRate,
      paidDelta: Number(after.amountPaid) - Number(before.amountPaid),
      receivedCzk: opts.receivedCzk,
      paidAt: opts.paidAt,
      now: opts.now ?? new Date(),
    });
    if (!plan.record) return { recorded: false, reason: plan.reason };
    return this.createAndSend(db, tenant, after.id, plan.kind, plan.celkTrzba, plan.datTrzby, opts.now);
  }

  /**
   * "Undo payment" on a document with recorded sales: the sum goes back as
   * a negative record (§ 8). Sent with the current settings even when
   * recording was switched off since, as long as a certificate is there.
   */
  async recordInvoiceReversal(db: TenantDb, invoice: InvoiceRow, opts: { now?: Date } = {}): Promise<EetPaymentResult> {
    const records = await db
      .select({ celkTrzba: schema.eetRecords.celkTrzba, status: schema.eetRecords.status })
      .from(schema.eetRecords)
      .where(eq(schema.eetRecords.invoiceId, invoice.id));
    const amount = reversalAmount(records);
    if (!amount) return { recorded: false, reason: "zero_amount" };
    const tenant = await this.tenantEet(db, invoice.tenantId);
    if (!tenant.certificate || !tenant.idJednotky || !tenant.idPokl) return { recorded: false, reason: "not_configured" };
    const now = opts.now ?? new Date();
    return this.createAndSend(db, tenant, invoice.id, "refund", amount, formatEetDateTime(now), now);
  }

  /** Manual "send again" from the dashboard, for a pending or overdue record. */
  async resend(db: TenantDb, tenantId: string, recordId: string): Promise<EetRecordRow> {
    const [row] = await db.select().from(schema.eetRecords).where(eq(schema.eetRecords.id, recordId));
    if (!row) throw new NotFoundException("eet_record_not_found");
    if (row.status !== "pending" && row.status !== "overdue") throw new BadRequestException("eet_record_not_pending");
    const tenant = await this.tenantEet(db, tenantId);
    return this.attempt(db, tenant, row, REQUEST_TIMEOUT_MS, new Date());
  }

  /** EetCron: resends what is due in one company (§ 20). Returns how many got a POK. */
  async sweepTenant(db: TenantDb, tenantId: string, now = new Date()): Promise<number> {
    const tenant = await this.tenantEet(db, tenantId);
    if (!tenant.certificate) return 0;
    // SKIP LOCKED: a resend clicked in the dashboard at the same moment wins, the sweep moves on.
    const rows = await db
      .select()
      .from(schema.eetRecords)
      .where(inArray(schema.eetRecords.status, ["pending", "overdue"]))
      .orderBy(schema.eetRecords.createdAt)
      .limit(50)
      .for("update", { skipLocked: true });
    let confirmed = 0;
    for (const row of rows) {
      if (!resendDue(row.attempts, row.lastAttemptAt, now)) continue;
      const updated = await this.attempt(db, tenant, row, CRON_TIMEOUT_MS, now);
      if (updated.status === "confirmed") confirmed++;
    }
    return confirmed;
  }

  // --- internals -----------------------------------------------------------

  private async tenantEet(db: TenantDb, tenantId: string): Promise<TenantEet> {
    const t = schema.tenants;
    const [row] = await db
      .select({
        enabled: t.eetEnabled,
        environment: t.eetEnvironment,
        idJednotky: t.eetIdJednotky,
        idPokl: t.eetIdPokl,
        cardInPerson: t.eetCardInPerson,
        certificate: t.eetCertificateEncrypted,
      })
      .from(t)
      .where(eq(t.id, tenantId));
    if (!row) throw new NotFoundException("tenant_not_found");
    return { tenantId, ...row };
  }

  private signer(tenant: TenantEet): EetSigner & { eic: string } {
    const { p12, password } = JSON.parse(decryptSecret(tenant.certificate!, encryptionKey())) as { p12: string; password: string };
    const contents = readPkcs12(Buffer.from(p12, "base64"), password);
    const eic = describeCertificate(contents.certificate).commonName;
    if (!eic || !isValidEic(eic)) throw new EetFieldError("certificate_not_eet");
    return { privateKey: contents.privateKey, certificateDer: contents.certificateDer, eic };
  }

  private async createAndSend(
    db: TenantDb,
    tenant: TenantEet,
    invoiceId: string,
    kind: "sale" | "refund",
    celkTrzba: string,
    datTrzby: string,
    now = new Date(),
  ): Promise<EetPaymentResult> {
    let signer: EetSigner & { eic: string };
    try {
      signer = this.signer(tenant);
    } catch {
      // A rotated encryption key or a broken stored file: nothing can be signed until a new upload.
      return { recorded: false, reason: "not_configured" };
    }
    // The counter row lock also orders two payments entered at the same moment.
    const [counter] = await db
      .update(schema.tenants)
      .set({ eetLastPoradCis: sql`${schema.tenants.eetLastPoradCis} + 1` })
      .where(eq(schema.tenants.id, tenant.tenantId))
      .returning({ n: schema.tenants.eetLastPoradCis });
    const [row] = await db
      .insert(schema.eetRecords)
      .values({
        tenantId: tenant.tenantId,
        invoiceId,
        kind,
        environment: tenant.environment,
        eicPopl: signer.eic,
        idJednotky: tenant.idJednotky!,
        idPokl: tenant.idPokl!,
        poradCis: String(counter!.n),
        datTrzby,
        celkTrzba,
      })
      .returning();
    const updated = await this.attempt(db, tenant, row!, REQUEST_TIMEOUT_MS, now, signer);
    return { recorded: true, recordId: updated.id, status: updated.status, pok: updated.pok, test: updated.test, error: updated.lastError };
  }

  /**
   * One send of a stored record. The first attempt has prvni_zaslani=true,
   * every later one false with a new message UUID and the same <Data>
   * (interface section 4 makes the server treat it as the same sale).
   */
  private async attempt(
    db: TenantDb,
    tenant: TenantEet,
    row: EetRecordRow,
    timeoutMs: number,
    now: Date,
    signer?: EetSigner,
  ): Promise<EetRecordRow> {
    let result: SendEetResult;
    try {
      const s = signer ?? this.signer(tenant);
      const { xml } = buildSignedEetRequest(
        {
          header: createEetHeader({ first: row.attempts === 0, now }),
          data: {
            eicPopl: row.eicPopl,
            idJednotky: row.idJednotky,
            idPokl: row.idPokl,
            poradCis: row.poradCis,
            datTrzby: row.datTrzby,
            celkTrzba: formatEetAmount(row.celkTrzba),
          },
        },
        s,
      );
      // Always the environment the record was made in, so switching to production never re-sends playground records there.
      result = await this.transport(xml, row.environment, timeoutMs);
    } catch (err) {
      const code = err instanceof EetFieldError ? err.code : err instanceof Pkcs12Error ? `certificate_${err.code}` : "signing_failed";
      // Data that fails validation fails the same way next time.
      const final = err instanceof EetFieldError && err.code !== "certificate_not_eet";
      const [updated] = await db
        .update(schema.eetRecords)
        .set({ status: final ? "rejected" : row.status, lastError: code, lastAttemptAt: now })
        .where(eq(schema.eetRecords.id, row.id))
        .returning();
      this.logger.warn(`EET record ${row.id} not sent: ${code}`);
      return updated!;
    }
    const outcome = attemptOutcome(result, parseSaleTime(row.datTrzby), now);
    const [updated] = await db
      .update(schema.eetRecords)
      .set({
        status: outcome.status,
        pok: outcome.pok,
        test: outcome.test,
        lastError: outcome.lastError,
        warnings: outcome.warnings,
        transactionId: outcome.transactionId,
        attempts: sql`${schema.eetRecords.attempts} + 1`,
        lastAttemptAt: now,
        ...(outcome.status === "confirmed" ? { confirmedAt: now } : {}),
      })
      .where(eq(schema.eetRecords.id, row.id))
      .returning();
    if (outcome.status === "confirmed" && row.invoiceId) {
      // The invoice shows the POK of its sale; a confirmed reversal takes it away.
      await db
        .update(schema.invoices)
        .set({ eetPok: row.kind === "sale" ? outcome.pok : null })
        .where(eq(schema.invoices.id, row.invoiceId));
    }
    return updated!;
  }
}

/** dat_trzby is stored as sent ("2027-01-05T10:22:13+01:00"), which Date parses. */
function parseSaleTime(datTrzby: string): Date {
  return new Date(datTrzby);
}
