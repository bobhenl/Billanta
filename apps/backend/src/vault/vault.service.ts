import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { AuditService } from "../audit/audit.service";
import { assertStepUp, stepUpChange, type StepUpMethod } from "../auth/step-up";
import { planAllows } from "../billing/plan-access";
import { loadPlanSummary } from "../billing/plan.guard";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";
import { documentKeyWrap } from "@faktur/cz-compliance";
import { MAX_ATTACHMENT_BYTES } from "../invoices/invoice-attachments.service";
import { assertOneDocumentKey, confidentialPlanRequired, isSealed, rekeyWrites } from "./sealed";
import { assertFileSealingAllowed, classifyUpload, ENCRYPTED_FILENAME, ENCRYPTED_MIME, type UploadedFileLike } from "./sealed-files";
import { openablePage, vaultDocumentView } from "./documents";
import { SEALED_BUYER_SNAPSHOT_FIELDS, SEALED_CONTACT_FIELDS } from "@faktur/cz-compliance";
import { SEALED_PLACEHOLDER } from "./sealed";
import { assertContactShape, assertContactsCategory } from "./sealed-contacts";
import { b64url, CHALLENGE_TTL_MS, parsePasskeyPublicKey, passkeyOrigin, verifyPasskeyAssertion } from "./passkey-step-up";
import { assertAmountsCategory, assertAmountsShape, paymentsOnSeal } from "./sealed-amounts";
import { SEALED_ITEM_PLACEHOLDER } from "@faktur/cz-compliance";
import { assertInvoiceOpen } from "../invoices/invoice-lock";
import type {
  EnableVaultDto,
  MemberWrapDto,
  PasskeyStepUpDto,
  PlainAmountsQueryDto,
  PlainAttachmentsQueryDto,
  PlainContactsQueryDto,
  PlainInvoicesQueryDto,
  RecoveryWrapDto,
  RekeyInvoiceDto,
  SealAmountsDto,
  SealContactsDto,
  SealInvoicesDto,
  VaultDocumentsQueryDto,
  VaultSettingsDto,
} from "./dto/vault.dto";

/** Every stored plain file is at most this big, so its ciphertext is too (plus the overhead). */
const MAX_SEALED_SOURCE_BYTES = MAX_ATTACHMENT_BYTES;

type TenantDb = PostgresJsDatabase<typeof schema>;
type WrapRow = typeof schema.vaultKeyWraps.$inferSelect;

/** At most this many passkeys per member: enough for a laptop, a phone and two keys. */
const MAX_PASSKEYS = 5;

/** The challenge an assertion says it answers; only used to find (and burn) the row we issued. */
function claimedChallenge(clientDataJSON: string): string | null {
  try {
    const challenge = (JSON.parse(Buffer.from(clientDataJSON, "base64url").toString("utf8")) as { challenge?: unknown }).challenge;
    return typeof challenge === "string" && challenge.length <= 128 ? challenge : null;
  } catch {
    return null;
  }
}

const notSealed =(column: unknown) => sql`(${column} IS NOT NULL AND ${column} <> '' AND ${column} NOT LIKE 'enc:v1:%')`;

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
    /** A passkey that can confirm a step-up; older ones only unlock until added again. */
    stepUp: w.kind === "passkey" && w.publicKey !== null,
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

  /**
   * The caller's own vault password or a new passkey. Replacing a password
   * needs a step-up: the server cannot tell a real wrap from garbage, so a
   * bad one would take the old way in away.
   */
  async addWrap(db: TenantDb, tenantId: string, user: AuthenticatedUser, dto: MemberWrapDto["wrap"]) {
    const userId = user.id;
    await this.requireVault(db, tenantId);
    if (dto.kind === "password") {
      const [old] = await db
        .select({ id: schema.vaultKeyWraps.id })
        .from(schema.vaultKeyWraps)
        .where(and(eq(schema.vaultKeyWraps.tenantId, tenantId), eq(schema.vaultKeyWraps.userId, userId), eq(schema.vaultKeyWraps.kind, "password")))
        .limit(1);
      const stepUp = old ? assertStepUp(user) : null;
      await db
        .delete(schema.vaultKeyWraps)
        .where(and(eq(schema.vaultKeyWraps.tenantId, tenantId), eq(schema.vaultKeyWraps.userId, userId), eq(schema.vaultKeyWraps.kind, "password")));
      await db.insert(schema.vaultKeyWraps).values({ tenantId, userId, ...dto });
      if (stepUp) {
        await this.audit?.record(db, tenantId, { entityType: "tenant", entityId: tenantId, action: "vault_password_replaced", changes: [stepUpChange(stepUp)] });
      }
    } else {
      const own = await db
        .select({ id: schema.vaultKeyWraps.id })
        .from(schema.vaultKeyWraps)
        .where(and(eq(schema.vaultKeyWraps.tenantId, tenantId), eq(schema.vaultKeyWraps.userId, userId), eq(schema.vaultKeyWraps.kind, "passkey")));
      if (own.length >= MAX_PASSKEYS) throw new ConflictException("vault_passkey_limit");
      const { publicKey, publicKeyAlg, ...wrap } = dto;
      // A passkey that can confirm step-ups is itself a way past them, so
      // adding one needs a step-up; an unlock-only passkey does not.
      let stepUp: StepUpMethod | null = null;
      if (publicKey !== undefined || publicKeyAlg !== undefined) {
        if (publicKey === undefined || publicKeyAlg === undefined) throw new BadRequestException("passkey_public_key_invalid");
        parsePasskeyPublicKey(publicKey, publicKeyAlg);
        stepUp = assertStepUp(user);
      }
      await db.insert(schema.vaultKeyWraps).values({
        tenantId,
        userId,
        ...wrap,
        iterations: null,
        label: dto.label ?? null,
        publicKey: publicKey ?? null,
        publicKeyAlg: publicKeyAlg ?? null,
      });
      if (stepUp) {
        await this.audit?.record(db, tenantId, {
          entityType: "tenant",
          entityId: tenantId,
          entityLabel: dto.label ?? null,
          action: "vault_passkey_added",
          changes: [{ field: "vaultWrap", from: null, to: "passkey" }, stepUpChange(stepUp)],
        });
      }
    }
    return this.status(db, tenantId, userId);
  }

  /**
   * A fresh challenge for a passkey step-up, plus which of the caller's
   * passkeys can answer it. Any older challenge of theirs goes: one attempt
   * at a time, and expired rows don't pile up.
   */
  async passkeyChallenge(db: TenantDb, tenantId: string, user: AuthenticatedUser) {
    await this.requireVault(db, tenantId);
    const keys = await db
      .select({ credentialId: schema.vaultKeyWraps.credentialId })
      .from(schema.vaultKeyWraps)
      .where(
        and(
          eq(schema.vaultKeyWraps.tenantId, tenantId),
          eq(schema.vaultKeyWraps.userId, user.id),
          eq(schema.vaultKeyWraps.kind, "passkey"),
          isNotNull(schema.vaultKeyWraps.publicKey),
        ),
      );
    if (!keys.length) throw new NotFoundException("passkey_step_up_unavailable");
    await db
      .delete(schema.webauthnChallenges)
      .where(or(eq(schema.webauthnChallenges.userId, user.id), lt(schema.webauthnChallenges.expiresAt, new Date())));
    const challenge = b64url(randomBytes(32));
    await db.insert(schema.webauthnChallenges).values({ challenge, tenantId, userId: user.id, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
    return { challenge, credentialIds: keys.map((k) => k.credentialId!) };
  }

  /**
   * Checks a passkey assertion. The challenge is deleted before anything
   * else, so it works once even when the check then fails. On success the
   * frontend writes the step-up cookie with method `passkey`.
   */
  async passkeyStepUp(db: TenantDb, tenantId: string, user: AuthenticatedUser, dto: PasskeyStepUpDto) {
    const fail = new ForbiddenException("passkey_step_up_failed");
    const claimed = claimedChallenge(dto.clientDataJSON);
    if (!claimed) throw fail;
    const [issued] = await db
      .delete(schema.webauthnChallenges)
      .where(
        and(
          eq(schema.webauthnChallenges.challenge, claimed),
          eq(schema.webauthnChallenges.userId, user.id),
          gt(schema.webauthnChallenges.expiresAt, new Date()),
        ),
      )
      .returning({ challenge: schema.webauthnChallenges.challenge });
    if (!issued) throw fail;
    const [wrap] = await db
      .select()
      .from(schema.vaultKeyWraps)
      .where(
        and(
          eq(schema.vaultKeyWraps.tenantId, tenantId),
          eq(schema.vaultKeyWraps.userId, user.id),
          eq(schema.vaultKeyWraps.kind, "passkey"),
          eq(schema.vaultKeyWraps.credentialId, dto.credentialId),
        ),
      )
      .limit(1);
    if (!wrap?.publicKey || wrap.publicKeyAlg === null) throw fail;
    const { signCount } = verifyPasskeyAssertion(
      dto,
      { publicKey: wrap.publicKey, publicKeyAlg: wrap.publicKeyAlg, signCount: wrap.signCount },
      { challenge: issued.challenge, origin: passkeyOrigin() },
    );
    await db.update(schema.vaultKeyWraps).set({ signCount }).where(eq(schema.vaultKeyWraps.id, wrap.id));
    return { ok: true as const, method: "passkey" as const };
  }

  /** Removes one of the caller's own wraps (step-up first); the recovery wrap is replaced, never removed. */
  async removeWrap(db: TenantDb, tenantId: string, user: AuthenticatedUser, id: string) {
    const userId = user.id;
    const stepUp = assertStepUp(user);
    const removed = await db
      .delete(schema.vaultKeyWraps)
      .where(and(eq(schema.vaultKeyWraps.id, id), eq(schema.vaultKeyWraps.tenantId, tenantId), eq(schema.vaultKeyWraps.userId, userId)))
      .returning({ id: schema.vaultKeyWraps.id, kind: schema.vaultKeyWraps.kind, label: schema.vaultKeyWraps.label });
    if (!removed.length) throw new NotFoundException("vault_wrap_not_found");
    await this.audit?.record(db, tenantId, {
      entityType: "tenant",
      entityId: tenantId,
      entityLabel: removed[0].label,
      action: "vault_wrap_removed",
      changes: [{ field: "vaultWrap", from: removed[0].kind, to: null }, stepUpChange(stepUp)],
    });
    return this.status(db, tenantId, userId);
  }

  /** A new recovery code (the browser had the key unlocked to wrap it); the old code stops working. */
  async replaceRecovery(db: TenantDb, tenantId: string, user: AuthenticatedUser, dto: RecoveryWrapDto) {
    if (user.role !== "owner" && user.role !== "admin") throw new ForbiddenException("forbidden");
    await this.requireVault(db, tenantId);
    // The old code stops working, and the server cannot check the new wrap.
    const stepUp = assertStepUp(user);
    await db.delete(schema.vaultKeyWraps).where(and(eq(schema.vaultKeyWraps.tenantId, tenantId), eq(schema.vaultKeyWraps.kind, "recovery")));
    await db.insert(schema.vaultKeyWraps).values({ tenantId, userId: null, ...dto.recovery, iterations: null });
    await this.audit?.record(db, tenantId, { entityType: "tenant", entityId: tenantId, action: "vault_recovery_replaced", changes: [stepUpChange(stepUp)] });
    return this.status(db, tenantId, user.id);
  }

  /**
   * Turning something on (encrypt by default, a new category) needs Plus;
   * turning it off never does. Dropping a category only stops encrypting new
   * files and texts, whatever is encrypted stays so.
   */
  async updateSettings(db: TenantDb, tenantId: string, user: AuthenticatedUser, dto: VaultSettingsDto) {
    if (user.role !== "owner" && user.role !== "admin") throw new ForbiddenException("forbidden");
    const vault = await this.requireVault(db, tenantId);
    const categories = dto.categories ? [...new Set(dto.categories)] : undefined;
    const adds = dto.sealNew === true || (categories ?? []).some((c) => !vault.categories.includes(c));
    if (adds) {
      const plan = await loadPlanSummary(db, tenantId);
      if (plan && !planAllows(plan, "confidential_mode")) throw confidentialPlanRequired();
    }
    // Switching encryption of new documents off, or dropping a category, weakens the mode.
    const sealOff = dto.sealNew === false && vault.sealNew;
    const dropped = categories ? vault.categories.filter((c) => !(categories as string[]).includes(c)) : [];
    const stepUp = sealOff || dropped.length ? assertStepUp(user) : null;
    await db
      .update(schema.tenantVaults)
      .set({
        ...(dto.sealNew !== undefined ? { sealNew: dto.sealNew } : {}),
        ...(dto.emailMode !== undefined ? { emailMode: dto.emailMode } : {}),
        ...(dto.autoSendPdf !== undefined ? { autoSendPdf: dto.autoSendPdf } : {}),
        ...(categories ? { categories } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tenantVaults.tenantId, tenantId));
    if (sealOff) {
      await this.audit?.record(db, tenantId, {
        entityType: "tenant",
        entityId: tenantId,
        action: "vault_seal_new_off",
        changes: [{ field: "sealNew", from: true, to: false }, stepUpChange(stepUp!)],
      });
    }
    if (categories) {
      await this.audit?.record(db, tenantId, {
        entityType: "tenant",
        entityId: tenantId,
        action: "vault_categories_changed",
        ...(dropped.length ? { changes: [{ field: "vaultCategories", from: dropped.join(","), to: null }, stepUpChange(stepUp!)] } : {}),
      });
    }
    return this.status(db, tenantId, user.id);
  }

  /**
   * Files stored before "Přílohy a účtenky" was on, for the browser to
   * download, encrypt and upload back. Attachments of locked documents are
   * left out like their texts.
   */
  async plainAttachments(db: TenantDb, tenantId: string, query: PlainAttachmentsQueryDto) {
    const vault = await this.requireVault(db, tenantId);
    if (!vault.categories.includes("attachments")) throw new ForbiddenException("vault_category_off");
    const ia = schema.invoiceAttachments;
    const ea = schema.expenseAttachments;
    const invoiceWhere = and(isNull(ia.encMeta), isNull(schema.invoices.lockedAt));
    const [[{ invoices } = { invoices: 0 }], [{ expenses } = { expenses: 0 }]] = await Promise.all([
      db.select({ invoices: sql<number>`count(*)::int` }).from(ia).innerJoin(schema.invoices, eq(schema.invoices.id, ia.invoiceId)).where(invoiceWhere),
      db.select({ expenses: sql<number>`count(*)::int` }).from(ea).where(isNull(ea.encMeta)),
    ]);
    const invoiceRows = await db
      .select({ id: ia.id, parentId: ia.invoiceId, filename: ia.filename, mime: ia.mime, sizeBytes: ia.sizeBytes })
      .from(ia)
      .innerJoin(schema.invoices, eq(schema.invoices.id, ia.invoiceId))
      .where(invoiceWhere)
      .orderBy(asc(ia.createdAt))
      .limit(query.limit);
    const expenseRows =
      invoiceRows.length < query.limit
        ? await db
            .select({ id: ea.id, parentId: ea.expenseId, filename: ea.filename, mime: ea.mime, sizeBytes: ea.sizeBytes })
            .from(ea)
            .where(isNull(ea.encMeta))
            .orderBy(asc(ea.createdAt))
            .limit(query.limit - invoiceRows.length)
        : [];
    return {
      remaining: invoices + expenses,
      files: [...invoiceRows.map((r) => ({ kind: "invoice" as const, ...r })), ...expenseRows.map((r) => ({ kind: "expense" as const, ...r }))],
    };
  }

  /**
   * Replaces a plain file with the ciphertext the browser made from it. Only
   * a file that is still plain (and, for an invoice, not locked) changes, so
   * a second tab or a retry can't overwrite an encrypted one. The portal
   * switch goes off: the client has no key.
   */
  async sealAttachment(db: TenantDb, tenantId: string, kind: "invoice" | "expense", id: string, file: UploadedFileLike, encMeta: unknown) {
    await this.requireVault(db, tenantId);
    const sealedMeta = classifyUpload(file, encMeta, MAX_SEALED_SOURCE_BYTES);
    if (!sealedMeta) throw new BadRequestException({ error: "not_encrypted" });
    await assertFileSealingAllowed(db, tenantId, sealedMeta);
    const stored = { filename: ENCRYPTED_FILENAME, mime: ENCRYPTED_MIME, sizeBytes: file.size, data: file.buffer.toString("base64"), encMeta: sealedMeta };
    let updated: { id: string }[];
    if (kind === "invoice") {
      const ia = schema.invoiceAttachments;
      updated = await db
        .update(ia)
        .set({ ...stored, showInPortal: false })
        .where(
          and(
            eq(ia.id, id),
            isNull(ia.encMeta),
            sql`EXISTS (SELECT 1 FROM ${schema.invoices} inv WHERE inv.id = ${ia.invoiceId} AND inv.locked_at IS NULL)`,
          ),
        )
        .returning({ id: ia.id });
    } else {
      const ea = schema.expenseAttachments;
      updated = await db.update(ea).set(stored).where(and(eq(ea.id, id), isNull(ea.encMeta))).returning({ id: ea.id });
    }
    return { sealed: updated.length };
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
        // The key the document's sealed printed texts already use, so the rest joins it (one key per client link).
        documentKeyWrap:
          [r.noteAbove, r.noteBelow, ...items.filter((it) => it.invoiceId === r.id).map((it) => it.description)].map(documentKeyWrap).find(Boolean) ?? null,
      })),
    };
  }

  /**
   * Documents with their texts as stored, a page at a time, ordered by id.
   * The browser opens the envelopes after unlock for its own search, item
   * suggestions and the readable export; nothing here can open them.
   */
  async documents(db: TenantDb, tenantId: string, user: AuthenticatedUser, query: VaultDocumentsQueryDto) {
    await this.requireVault(db, tenantId);
    const i = schema.invoices;
    const sealedText = (column: unknown) => sql`${column} LIKE 'enc:v1:%'`;
    const hasSealed = or(
      sealedText(i.noteAbove),
      sealedText(i.noteBelow),
      sealedText(i.internalNote),
      sql`EXISTS (SELECT 1 FROM ${schema.invoiceLineItems} li WHERE li.invoice_id = ${i.id} AND li.description LIKE 'enc:v1:%')`,
    );
    const rows = await db
      .select({ invoice: i, legalName: schema.contacts.legalName, ico: schema.contacts.ico })
      .from(i)
      .leftJoin(schema.contacts, eq(schema.contacts.id, i.contactId))
      .where(
        and(
          query.after ? gt(i.id, query.after) : undefined,
          query.from ? gte(i.issueDate, new Date(`${query.from}T00:00:00Z`)) : undefined,
          query.to ? lt(i.issueDate, new Date(Date.parse(`${query.to}T00:00:00Z`) + 86_400_000)) : undefined,
          query.sealed_only === "true" ? hasSealed : undefined,
        ),
      )
      .orderBy(asc(i.id))
      .limit(query.limit + 1);
    const { open, skippedLocked, next } = openablePage(
      rows.map((r) => ({ ...r, id: r.invoice.id, lockedAt: r.invoice.lockedAt })),
      query.limit,
      user,
    );
    const items = open.length
      ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, open.map((r) => r.id)))
      : [];
    return {
      documents: open.map((r) =>
        vaultDocumentView(r.invoice, r.invoice.contactId && r.legalName != null ? { legalName: r.legalName, ico: r.ico } : null, items.filter((it) => it.invoiceId === r.id)),
      ),
      skippedLocked,
      next,
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

  /**
   * What "Zašifrovat stávající kontakty" still has to do, a page at a time:
   * plain contacts first, then the documents of encrypted contacts whose
   * buyer snapshot or contact person is still plain. Only plain values are
   * sent. Locked documents are left out like their texts; so are documents
   * without a contact. `remaining` counts both kinds.
   */
  async plainContacts(db: TenantDb, tenantId: string, query: PlainContactsQueryDto) {
    const vault = await this.requireVault(db, tenantId);
    if (!vault.categories.includes("contacts")) throw new ForbiddenException("vault_category_off");
    const c = schema.contacts;
    const i = schema.invoices;
    const plainContact = notSealed(c.legalName);
    const plainBuyer = and(
      isNull(i.lockedAt),
      sql`${i.contactId} IS NOT NULL`,
      or(...SEALED_BUYER_SNAPSHOT_FIELDS.map((k) => notSealed(sql`(${i.buyerSnapshot} ->> ${k})`)), notSealed(i.buyerContactPerson)),
    );
    const [[{ contacts } = { contacts: 0 }], [{ invoices } = { invoices: 0 }]] = await Promise.all([
      db.select({ contacts: sql<number>`count(*)::int` }).from(c).where(plainContact),
      db.select({ invoices: sql<number>`count(*)::int` }).from(i).where(plainBuyer),
    ]);
    const contactRows = await db.select().from(c).where(plainContact).orderBy(asc(c.createdAt), asc(c.id)).limit(query.limit);
    // Documents only once their contact is encrypted: the snapshot must not be sealed before the contact is.
    const invoiceRows =
      contactRows.length < query.limit
        ? await db
            .select({ id: i.id, invoiceNumber: i.invoiceNumber, buyerSnapshot: i.buyerSnapshot, buyerContactPerson: i.buyerContactPerson })
            .from(i)
            .innerJoin(c, eq(c.id, i.contactId))
            .where(and(plainBuyer, sql`${c.legalName} LIKE 'enc:v1:%'`))
            .orderBy(asc(i.createdAt), asc(i.id))
            .limit(query.limit - contactRows.length)
        : [];
    const plain = (v: unknown) => (typeof v === "string" && v !== "" && !isSealed(v) ? v : undefined);
    return {
      remaining: contacts + invoices,
      contacts: contactRows.map((r) => ({
        id: r.id,
        ...Object.fromEntries(SEALED_CONTACT_FIELDS.map((k) => [k, plain(r[k])])),
        // A sealed e-mail stays as it is; a plain one stays plain (the user decides per contact).
      })),
      invoices: invoiceRows.map((r) => {
        const snap = (r.buyerSnapshot ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          invoiceNumber: r.invoiceNumber,
          buyer: Object.fromEntries(SEALED_BUYER_SNAPSHOT_FIELDS.map((k) => [k, plain(snap[k])])),
          buyerContactPerson: plain(r.buyerContactPerson),
        };
      }),
    };
  }

  /**
   * Writes the envelopes back. A contact changes only while its name is
   * still plain (a retry or a second tab can't overwrite an encrypted one),
   * and only when every plain sealable column comes back sealed, so the
   * contact is never half-encrypted. A document's snapshot value changes
   * only while it is plain. Not `updated_at`: nothing reads differently.
   */
  async sealContacts(db: TenantDb, tenantId: string, dto: SealContactsDto) {
    await this.requireVault(db, tenantId);
    await assertContactsCategory(db, tenantId);
    const c = schema.contacts;
    let contacts = 0;
    for (const given of dto.contacts) {
      const [row] = await db.select().from(c).where(eq(c.id, given.id)).limit(1);
      if (!row || isSealed(row.legalName)) continue;
      const set: Record<string, string> = {};
      for (const k of SEALED_CONTACT_FIELDS) {
        const value = given[k];
        if (value && row[k] != null && row[k] !== "" && !isSealed(row[k])) set[k] = value;
      }
      assertContactShape({ ...row, ...set });
      const updated = await db
        .update(c)
        .set(set)
        .where(and(eq(c.id, row.id), sql`${c.legalName} NOT LIKE 'enc:v1:%'`))
        .returning({ id: c.id });
      if (!updated.length) continue;
      await this.audit?.record(db, tenantId, { entityType: "contact", entityId: row.id, entityLabel: SEALED_PLACEHOLDER, action: "sealed" });
      contacts++;
    }
    const i = schema.invoices;
    let invoices = 0;
    for (const given of dto.invoices) {
      const [row] = await db
        .select({ id: i.id, invoiceNumber: i.invoiceNumber, buyerSnapshot: i.buyerSnapshot, buyerContactPerson: i.buyerContactPerson, contactName: c.legalName })
        .from(i)
        .innerJoin(c, eq(c.id, i.contactId))
        .where(and(eq(i.id, given.id), isNull(i.lockedAt)))
        .limit(1);
      if (!row || !isSealed(row.contactName)) continue;
      const snap = { ...((row.buyerSnapshot ?? {}) as Record<string, unknown>) };
      let changed = false;
      for (const k of SEALED_BUYER_SNAPSHOT_FIELDS) {
        const value = given.buyer[k];
        if (value && typeof snap[k] === "string" && snap[k] !== "" && !isSealed(snap[k])) {
          snap[k] = value;
          changed = true;
        }
      }
      if (SEALED_BUYER_SNAPSHOT_FIELDS.some((k) => typeof snap[k] === "string" && snap[k] !== "" && !isSealed(snap[k]))) {
        throw new BadRequestException("contact_plaintext");
      }
      const person = given.buyerContactPerson && row.buyerContactPerson && !isSealed(row.buyerContactPerson) ? given.buyerContactPerson : undefined;
      if (row.buyerContactPerson && !isSealed(row.buyerContactPerson) && !person) throw new BadRequestException("contact_plaintext");
      if (!changed && !person) continue;
      await db
        .update(i)
        .set({ ...(changed ? { buyerSnapshot: snap as typeof row.buyerSnapshot } : {}), ...(person ? { buyerContactPerson: person } : {}) })
        .where(eq(i.id, row.id));
      await this.audit?.record(db, tenantId, { entityType: "invoice", entityId: row.id, entityLabel: row.invoiceNumber, action: "sealed" });
      invoices++;
    }
    return { sealed: contacts + invoices, contacts, invoices };
  }

  /**
   * What "Zašifrovat stávající částky" still has to do, a page at a time:
   * documents whose amounts are plain, with the numbers the browser seals.
   * Locked documents are left out (they need a fresh re-auth to open). The
   * payment columns come along: the browser seals them as one payment of the
   * document (`paymentsOnSeal`), so a partly paid document keeps what was paid.
   */
  async plainAmounts(db: TenantDb, tenantId: string, query: PlainAmountsQueryDto) {
    const vault = await this.requireVault(db, tenantId);
    if (!vault.categories.includes("amounts")) throw new ForbiddenException("vault_category_off");
    const i = schema.invoices;
    const li = schema.invoiceLineItems;
    const where = and(isNull(i.encAmounts), isNull(i.lockedAt), query.invoice_id ? eq(i.id, query.invoice_id) : undefined);
    const [{ remaining } = { remaining: 0 }] = await db.select({ remaining: sql<number>`count(*)::int` }).from(i).where(where);
    const rows = await db
      .select({
        id: i.id,
        invoiceNumber: i.invoiceNumber,
        reverseCharge: i.reverseCharge,
        noteAbove: i.noteAbove,
        noteBelow: i.noteBelow,
        status: i.status,
        amountPaid: i.amountPaid,
        paymentFees: i.paymentFees,
        receivedCzk: i.receivedCzk,
      })
      .from(i)
      .where(where)
      .orderBy(asc(i.createdAt), asc(i.id))
      .limit(query.limit);
    const items = rows.length ? await db.select().from(li).where(inArray(li.invoiceId, rows.map((r) => r.id))) : [];
    return {
      remaining,
      invoices: rows.map((r) => {
        const own = items.filter((it) => it.invoiceId === r.id).sort((a, b) => a.sortOrder - b.sortOrder);
        const paid = Number(r.amountPaid ?? 0);
        const fee = Number(r.paymentFees ?? 0);
        return {
          id: r.id,
          invoiceNumber: r.invoiceNumber,
          reverseCharge: r.reverseCharge,
          // What the browser seals as the carried payment; null when nothing was paid.
          paid: paid !== 0 || fee !== 0 || r.receivedCzk != null
            ? { amount: paid, fee, receivedHome: r.receivedCzk == null ? null : Number(r.receivedCzk), full: r.status === "paid" }
            : null,
          items: own.map((it) => ({
            id: it.id,
            quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice),
            vatRate: it.vatRate == null ? null : Number(it.vatRate),
            discountPercent: Number(it.discountPercent),
          })),
          // The key the document's sealed texts already use, so the amounts join it (one key per client link).
          documentKeyWrap: [r.noteAbove, r.noteBelow, ...own.map((it) => it.description)].map(documentKeyWrap).find(Boolean) ?? null,
        };
      }),
    };
  }

  /**
   * Writes the envelopes back and puts the placeholder into the plain
   * columns. A document changes only while its amounts are still plain and
   * it is not locked, re-checked in the UPDATE itself, so a retry or a
   * second tab is a no-op. Every item must come back sealed, or the document
   * is skipped untouched. Not `updated_at`: the document reads the same.
   */
  async sealAmounts(db: TenantDb, tenantId: string, dto: SealAmountsDto) {
    await this.requireVault(db, tenantId);
    await assertAmountsCategory(db, tenantId);
    const i = schema.invoices;
    const li = schema.invoiceLineItems;
    let sealed = 0;
    let skipped = 0;
    for (const given of dto.invoices) {
      const [row] = await db
        .select({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          status: i.status,
          amountPaid: i.amountPaid,
          paymentFees: i.paymentFees,
          receivedCzk: i.receivedCzk,
          noteAbove: i.noteAbove,
          noteBelow: i.noteBelow,
        })
        .from(i)
        .where(and(eq(i.id, given.id), isNull(i.encAmounts), isNull(i.lockedAt)))
        .limit(1);
      if (!row) continue;
      let paid: ReturnType<typeof paymentsOnSeal>;
      try {
        paid = paymentsOnSeal(row, given.encPaid);
      } catch {
        skipped++;
        continue;
      }
      const items = await db.select({ id: li.id, description: li.description }).from(li).where(eq(li.invoiceId, row.id));
      const byId = new Map(given.items.map((it) => [it.id, it.encAmounts]));
      if (items.length !== given.items.length || items.some((it) => !byId.has(it.id))) {
        skipped++;
        continue;
      }
      // One document key for everything a client link opens.
      assertOneDocumentKey([
        given.encAmounts,
        ...given.items.map((it) => it.encAmounts),
        paid.carry,
        row.noteAbove,
        row.noteBelow,
        ...items.map((it) => it.description),
      ]);
      const placeholder = {
        quantity: String(SEALED_ITEM_PLACEHOLDER.quantity),
        unitPrice: String(SEALED_ITEM_PLACEHOLDER.unitPrice),
        vatRate: null,
        discountPercent: String(SEALED_ITEM_PLACEHOLDER.discountPercent),
      };
      assertAmountsShape(
        { encAmounts: given.encAmounts, amountPaid: paid.set.amountPaid ?? row.amountPaid },
        items.map((it) => ({ ...placeholder, encAmounts: byId.get(it.id)! })),
      );
      const updated = await db
        .update(i)
        .set({ encAmounts: given.encAmounts, ...paid.set })
        .where(and(eq(i.id, row.id), isNull(i.encAmounts), isNull(i.lockedAt)))
        .returning({ id: i.id });
      if (!updated.length) continue;
      if (paid.carry) {
        // No date: the plain columns never said when the money came.
        await db.insert(schema.invoiceSealedPayments).values({ tenantId, invoiceId: row.id, paidAt: null, encAmount: paid.carry });
      }
      for (const it of items) {
        await db
          .update(li)
          .set({ ...placeholder, encAmounts: byId.get(it.id)! })
          .where(and(eq(li.id, it.id), eq(li.invoiceId, row.id)));
      }
      await this.audit?.record(db, tenantId, { entityType: "invoice", entityId: row.id, entityLabel: row.invoiceNumber, action: "sealed" });
      sealed++;
    }
    return { sealed, skipped };
  }

  /**
   * Stores one document's printed texts re-encrypted under its own key (see
   * `rekeyWrites`). Like `seal`, only text columns change and not
   * `updated_at`. A locked document needs the usual fresh re-auth. The
   * buyer can only be re-keyed in the document's own snapshot: a draft
   * without one shows the live contact, which this never changes.
   */
  async rekey(db: TenantDb, tenantId: string, user: AuthenticatedUser, id: string, dto: RekeyInvoiceDto) {
    await this.requireVault(db, tenantId);
    await assertInvoiceOpen(db, id, user);
    const [invoice] = await db
      .select({
        id: schema.invoices.id,
        invoiceNumber: schema.invoices.invoiceNumber,
        noteAbove: schema.invoices.noteAbove,
        noteBelow: schema.invoices.noteBelow,
        buyerSnapshot: schema.invoices.buyerSnapshot,
        buyerContactPerson: schema.invoices.buyerContactPerson,
        encAmounts: schema.invoices.encAmounts,
      })
      .from(schema.invoices)
      .where(and(eq(schema.invoices.id, id), eq(schema.invoices.tenantId, tenantId)))
      .limit(1);
    if (!invoice) throw new NotFoundException("Invoice not found");
    const stored = await db
      .select({ id: schema.invoiceLineItems.id, description: schema.invoiceLineItems.description, encAmounts: schema.invoiceLineItems.encAmounts })
      .from(schema.invoiceLineItems)
      .where(eq(schema.invoiceLineItems.invoiceId, id));
    const byId = new Map(stored.map((i) => [i.id, i.description]));
    const amountsById = new Map(stored.map((i) => [i.id, i.encAmounts]));
    const itemAmounts = dto.itemAmounts ?? [];
    if (dto.items.some((i) => !byId.has(i.id)) || itemAmounts.some((i) => !byId.has(i.id))) throw new NotFoundException("rekey_unknown_item");
    const snapshot = (invoice.buyerSnapshot ?? {}) as Record<string, unknown>;
    const buyer = Object.entries(dto.buyer ?? {}).filter((e): e is [string, `enc:v1:${string}`] => typeof e[1] === "string");
    rekeyWrites([
      ...(dto.noteAbove ? [{ incoming: dto.noteAbove, stored: invoice.noteAbove }] : []),
      ...(dto.noteBelow ? [{ incoming: dto.noteBelow, stored: invoice.noteBelow }] : []),
      ...dto.items.map((i) => ({ incoming: i.description, stored: byId.get(i.id) })),
      ...buyer.map(([k, v]) => ({ incoming: v, stored: snapshot[k] as string | undefined })),
      ...(dto.buyerContactPerson ? [{ incoming: dto.buyerContactPerson, stored: invoice.buyerContactPerson }] : []),
      // Only amounts that are sealed already: a re-key never seals plain amounts (that is "seal-amounts").
      ...(dto.encAmounts ? [{ incoming: dto.encAmounts, stored: invoice.encAmounts }] : []),
      ...itemAmounts.map((i) => ({ incoming: i.encAmounts, stored: amountsById.get(i.id) })),
    ]);
    const nextSnapshot = buyer.length ? { ...snapshot, ...Object.fromEntries(buyer) } : null;
    // What the document prints afterwards, the texts this re-key left alone included.
    assertOneDocumentKey([
      dto.noteAbove ?? invoice.noteAbove,
      dto.noteBelow ?? invoice.noteBelow,
      ...stored.map((s) => dto.items.find((i) => i.id === s.id)?.description ?? s.description),
      ...SEALED_BUYER_SNAPSHOT_FIELDS.map((k) => (nextSnapshot ?? snapshot)[k] as string | undefined),
      dto.buyerContactPerson ?? invoice.buyerContactPerson,
      dto.encAmounts ?? invoice.encAmounts,
      ...stored.map((s) => itemAmounts.find((i) => i.id === s.id)?.encAmounts ?? s.encAmounts),
    ]);
    const notes = {
      ...(dto.noteAbove ? { noteAbove: dto.noteAbove } : {}),
      ...(dto.noteBelow ? { noteBelow: dto.noteBelow } : {}),
      ...(nextSnapshot ? { buyerSnapshot: nextSnapshot as typeof invoice.buyerSnapshot } : {}),
      ...(dto.buyerContactPerson ? { buyerContactPerson: dto.buyerContactPerson } : {}),
      ...(dto.encAmounts ? { encAmounts: dto.encAmounts } : {}),
    };
    if (Object.keys(notes).length) await db.update(schema.invoices).set(notes).where(eq(schema.invoices.id, id));
    for (const item of dto.items) {
      await db
        .update(schema.invoiceLineItems)
        .set({ description: item.description })
        .where(and(eq(schema.invoiceLineItems.id, item.id), eq(schema.invoiceLineItems.invoiceId, id)));
    }
    for (const item of itemAmounts) {
      await db
        .update(schema.invoiceLineItems)
        .set({ encAmounts: item.encAmounts })
        .where(and(eq(schema.invoiceLineItems.id, item.id), eq(schema.invoiceLineItems.invoiceId, id)));
    }
    await this.audit?.record(db, tenantId, { entityType: "invoice", entityId: id, entityLabel: invoice.invoiceNumber, action: "sealed" });
    return {
      rekeyed:
        [dto.noteAbove, dto.noteBelow, dto.buyerContactPerson, dto.encAmounts].filter(Boolean).length + buyer.length + dto.items.length + itemAmounts.length,
    };
  }
}
