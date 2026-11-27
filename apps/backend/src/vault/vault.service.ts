import { ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { AuditService } from "../audit/audit.service";
import { planAllows } from "../billing/plan-access";
import { loadPlanSummary } from "../billing/plan.guard";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";
import { isSealed } from "./sealed";
import type { EnableVaultDto, MemberWrapDto, PlainInvoicesQueryDto, RecoveryWrapDto, SealInvoicesDto, VaultSettingsDto } from "./dto/vault.dto";

type TenantDb = PostgresJsDatabase<typeof schema>;
type WrapRow = typeof schema.vaultKeyWraps.$inferSelect;

/** At most this many passkeys per member: enough for a laptop, a phone and two keys. */
const MAX_PASSKEYS = 5;

const notSealed = (column: unknown) => sql`(${column} IS NOT NULL AND ${column} <> '' AND ${column} NOT LIKE 'enc:v1:%')`;

/** What the browser needs to unwrap: never anything secret, the server has nothing secret. */
export function wrapView(w: WrapRow) {
  return {
    id: w.id,
    kind: w.kind,
    kdf: w.kdf,
    iterations: w.iterations,
    salt: w.salt,
    iv: w.iv,
    wrappedKey: w.wrappedKey,
    credentialId: w.credentialId,
    label: w.label,
    createdAt: w.createdAt,
  };
}

/**
 * "Důvěrný režim" key store. The server keeps the company data key only in
 * wrapped form and cannot open it: wrapping and unwrapping happen in the
 * browser (`@faktur/cz-compliance` confidential.ts). It also lets the
 * browser seal texts of existing documents in place ("Zašifrovat").
 */
@Injectable()
export class VaultService {
  constructor(@Optional() private readonly audit?: AuditService) {}

  private async vault(db: TenantDb, tenantId: string) {
    const [vault] = await db.select().from(schema.tenantVaults).where(eq(schema.tenantVaults.tenantId, tenantId)).limit(1);
    return vault ?? null;
  }

  private async requireVault(db: TenantDb, tenantId: string) {
    const vault = await this.vault(db, tenantId);
    if (!vault) throw new NotFoundException("vault_not_enabled");
    return vault;
  }

  /** Whether the mode is on, plus the caller's own wraps and the recovery wrap (useless without the code). */
  async status(db: TenantDb, tenantId: string, userId: string) {
    const [vault, plan] = await Promise.all([this.vault(db, tenantId), loadPlanSummary(db, tenantId)]);
    // Below Plus the switch and bulk encryption are refused, but a vault that
    // already exists keeps unlocking: a downgrade must never hide data.
    const planAllowed = !plan || planAllows(plan, "confidential_mode");
    if (!vault) return { enabled: false as const, planAllowed };
    const wraps = await db
      .select()
      .from(schema.vaultKeyWraps)
      .where(
        and(
          eq(schema.vaultKeyWraps.tenantId, tenantId),
          or(eq(schema.vaultKeyWraps.userId, userId), eq(schema.vaultKeyWraps.kind, "recovery")),
        ),
      )
      .orderBy(asc(schema.vaultKeyWraps.createdAt));
    return {
      enabled: true as const,
      planAllowed,
      sealNew: vault.sealNew,
      emailMode: vault.emailMode,
      autoSendPdf: vault.autoSendPdf,
      categories: vault.categories,
      keyCheck: vault.keyCheck,
      enabledAt: vault.createdAt,
      wraps: wraps.map(wrapView),
    };
  }

  /** Owner only, once: the data key with the owner's password wrap and the recovery wrap. */
  async enable(db: TenantDb, tenantId: string, user: AuthenticatedUser, dto: EnableVaultDto) {
    if (user.role !== "owner") throw new ForbiddenException("owner_only");
    const [created] = await db
      .insert(schema.tenantVaults)
      .values({ tenantId, keyCheck: dto.keyCheck, categories: [...new Set(dto.categories)], enabledBy: user.id })
      .onConflictDoNothing()
      .returning();
    if (!created) throw new ConflictException("vault_already_enabled");
    await db.insert(schema.vaultKeyWraps).values([
      { tenantId, userId: user.id, ...dto.password },
      { tenantId, userId: null, ...dto.recovery, iterations: null },
    ]);
    await this.audit?.record(db, tenantId, { entityType: "tenant", entityId: tenantId, action: "vault_enabled" });
    return this.status(db, tenantId, user.id);
  }

  /** The caller's own vault password (replaces the old one) or a new passkey. */
  async addWrap(db: TenantDb, tenantId: string, userId: string, dto: MemberWrapDto["wrap"]) {
    await this.requireVault(db, tenantId);
    if (dto.kind === "password") {
      await db
        .delete(schema.vaultKeyWraps)
        .where(and(eq(schema.vaultKeyWraps.tenantId, tenantId), eq(schema.vaultKeyWraps.userId, userId), eq(schema.vaultKeyWraps.kind, "password")));
      await db.insert(schema.vaultKeyWraps).values({ tenantId, userId, ...dto });
    } else {
      const own = await db
        .select({ id: schema.vaultKeyWraps.id })
        .from(schema.vaultKeyWraps)
        .where(and(eq(schema.vaultKeyWraps.tenantId, tenantId), eq(schema.vaultKeyWraps.userId, userId), eq(schema.vaultKeyWraps.kind, "passkey")));
      if (own.length >= MAX_PASSKEYS) throw new ConflictException("vault_passkey_limit");
      await db.insert(schema.vaultKeyWraps).values({ tenantId, userId, ...dto, iterations: null, label: dto.label ?? null });
    }
    return this.status(db, tenantId, userId);
  }

  /** Removes one of the caller's own wraps; the recovery wrap is replaced, never removed. */
  async removeWrap(db: TenantDb, tenantId: string, userId: string, id: string) {
    const removed = await db
      .delete(schema.vaultKeyWraps)
      .where(and(eq(schema.vaultKeyWraps.id, id), eq(schema.vaultKeyWraps.tenantId, tenantId), eq(schema.vaultKeyWraps.userId, userId)))
      .returning({ id: schema.vaultKeyWraps.id });
    if (!removed.length) throw new NotFoundException("vault_wrap_not_found");
    return this.status(db, tenantId, userId);
  }

  /** A new recovery code (the browser had the key unlocked to wrap it); the old code stops working. */
  async replaceRecovery(db: TenantDb, tenantId: string, user: AuthenticatedUser, dto: RecoveryWrapDto) {
    if (user.role !== "owner" && user.role !== "admin") throw new ForbiddenException("forbidden");
    await this.requireVault(db, tenantId);
    await db.delete(schema.vaultKeyWraps).where(and(eq(schema.vaultKeyWraps.tenantId, tenantId), eq(schema.vaultKeyWraps.kind, "recovery")));
    await db.insert(schema.vaultKeyWraps).values({ tenantId, userId: null, ...dto.recovery, iterations: null });
    await this.audit?.record(db, tenantId, { entityType: "tenant", entityId: tenantId, action: "vault_recovery_replaced" });
    return this.status(db, tenantId, user.id);
  }

  async updateSettings(db: TenantDb, tenantId: string, user: AuthenticatedUser, dto: VaultSettingsDto) {
    if (user.role !== "owner" && user.role !== "admin") throw new ForbiddenException("forbidden");
    await this.requireVault(db, tenantId);
    await db
      .update(schema.tenantVaults)
      .set({
        ...(dto.sealNew !== undefined ? { sealNew: dto.sealNew } : {}),
        ...(dto.emailMode !== undefined ? { emailMode: dto.emailMode } : {}),
        ...(dto.autoSendPdf !== undefined ? { autoSendPdf: dto.autoSendPdf } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tenantVaults.tenantId, tenantId));
    return this.status(db, tenantId, user.id);
  }

  /**
   * Documents that still have plain text to encrypt, with only those texts.
   * Locked documents are left out: their content needs a fresh re-auth to open.
   */
  async plainInvoices(db: TenantDb, tenantId: string, query: PlainInvoicesQueryDto) {
    await this.requireVault(db, tenantId);
    const i = schema.invoices;
    const hasPlain = or(
      notSealed(i.noteAbove),
      notSealed(i.noteBelow),
      notSealed(i.internalNote),
      sql`EXISTS (SELECT 1 FROM ${schema.invoiceLineItems} li WHERE li.invoice_id = ${i.id} AND li.description NOT LIKE 'enc:v1:%')`,
    );
    const where = and(
      isNull(i.lockedAt),
      query.invoice_id ? eq(i.id, query.invoice_id) : undefined,
      query.contact_id ? eq(i.contactId, query.contact_id) : undefined,
      hasPlain,
    );
    const [{ remaining } = { remaining: 0 }] = await db.select({ remaining: sql<number>`count(*)::int` }).from(i).where(where);
    const rows = await db
      .select({ id: i.id, invoiceNumber: i.invoiceNumber, noteAbove: i.noteAbove, noteBelow: i.noteBelow, internalNote: i.internalNote })
      .from(i)
      .where(where)
      .orderBy(desc(i.createdAt))
      .limit(query.limit);
    const items = rows.length
      ? await db
          .select({ id: schema.invoiceLineItems.id, invoiceId: schema.invoiceLineItems.invoiceId, description: schema.invoiceLineItems.description })
          .from(schema.invoiceLineItems)
          .where(inArray(schema.invoiceLineItems.invoiceId, rows.map((r) => r.id)))
      : [];
    const plain = (v: string | null) => (v && !isSealed(v) ? v : undefined);
    return {
      remaining,
      invoices: rows.map((r) => ({
        id: r.id,
        invoiceNumber: r.invoiceNumber,
        noteAbove: plain(r.noteAbove),
        noteBelow: plain(r.noteBelow),
        internalNote: plain(r.internalNote),
        items: items.filter((it) => it.invoiceId === r.id && !isSealed(it.description)).map(({ id, description }) => ({ id, description })),
      })),
    };
  }

  /**
   * Writes the envelopes back. Only text columns change, and not
   * `updated_at`: the document reads the same, so it was not "edited after
   * sending". Locked documents and unknown ids are skipped.
   */
  async seal(db: TenantDb, tenantId: string, dto: SealInvoicesDto) {
    await this.requireVault(db, tenantId);
    let sealed = 0;
    for (const doc of dto.invoices) {
      const [invoice] = await db
        .select({ id: schema.invoices.id, invoiceNumber: schema.invoices.invoiceNumber })
        .from(schema.invoices)
        .where(and(eq(schema.invoices.id, doc.id), eq(schema.invoices.tenantId, tenantId), isNull(schema.invoices.lockedAt)))
        .limit(1);
      if (!invoice) continue;
      const notes = {
        ...(doc.noteAbove ? { noteAbove: doc.noteAbove } : {}),
        ...(doc.noteBelow ? { noteBelow: doc.noteBelow } : {}),
        ...(doc.internalNote ? { internalNote: doc.internalNote } : {}),
      };
      if (Object.keys(notes).length) await db.update(schema.invoices).set(notes).where(eq(schema.invoices.id, invoice.id));
      for (const item of doc.items) {
        await db
          .update(schema.invoiceLineItems)
          .set({ description: item.description })
          .where(and(eq(schema.invoiceLineItems.id, item.id), eq(schema.invoiceLineItems.invoiceId, invoice.id)));
      }
      await this.audit?.record(db, tenantId, { entityType: "invoice", entityId: invoice.id, entityLabel: invoice.invoiceNumber, action: "sealed" });
      sealed++;
    }
    return { sealed };
  }
}
