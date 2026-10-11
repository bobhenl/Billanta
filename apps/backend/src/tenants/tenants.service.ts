import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, NotImplementedException, Optional } from "@nestjs/common";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";
import type { DashboardRole } from "../tenancy/tenant-context.middleware";
import { findBankAccount, listBankAccounts } from "./bank-accounts";
import type { BankAccountDto } from "./dto/bank-account.dto";
import type { UpdateTenantDto } from "./dto/update-tenant.dto";
import { RESERVED_PROFILE_SLUGS, SLUG_PATTERN } from "./public-profile";

type TenantDb = PostgresJsDatabase<typeof schema>;
type TenantInsert = typeof schema.tenants.$inferInsert;

const blankToNull = (v: string | null | undefined) => (v === undefined ? undefined : v ? v : null);

type BankFields = { accountNumber: string | null; bankCode: string | null; iban: string | null };

/** JSON settings columns: the audit log notes that they changed, not their whole content. */
const JSON_SETTINGS = ["emailPrefs", "templateVars", "paymentMethods", "publicProfile", "enabledModules", "webhooks"];

/** "123456789/0100", else the IBAN, else "–" — for the change alert. */
const formatAccount = (a: BankFields | undefined) =>
  a?.accountNumber ? `${a.accountNumber}${a.bankCode ? `/${a.bankCode}` : ""}` : a?.iban || "–";

@Injectable()
export class TenantsService {
  constructor(
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /** The tenant's own row, minus secrets: the encrypted AI key never leaves the backend (see src/ai/). */
  async findById(db: TenantDb, id: string) {
    const rows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id)).limit(1);
    // The logo is served separately (GET /tenants/me/logo) to keep this row small.
    return rows.map(({ aiApiKeyEncrypted: _secret, logoData, ...tenant }) => ({ ...tenant, hasLogo: Boolean(logoData) }));
  }

  /**
   * Settings → Company. Only an owner or admin may change what is printed
   * as the issuer on every document. Fields left out stay as they are.
   */
  async update(db: TenantDb, id: string, role: DashboardRole | string | undefined, dto: UpdateTenantDto) {
    if (role !== "owner" && role !== "admin") {
      throw new ForbiddenException("Only an owner or admin can change company settings");
    }
    const values: Partial<TenantInsert> = {
      companyName: dto.company_name,
      legalName: dto.legal_name,
      ico: blankToNull(dto.ico),
      dic: blankToNull(dto.dic),
      dicVatPayer: dto.dic_vat_payer,
      addressStreet: blankToNull(dto.address_street),
      addressCity: blankToNull(dto.address_city),
      addressPostalCode: blankToNull(dto.address_postal_code),
      addressCountry: dto.address_country?.toUpperCase(),
      email: blankToNull(dto.email),
      phone: blankToNull(dto.phone),
      website: blankToNull(dto.website),
      registryNote: blankToNull(dto.registry_note),
      bankAccountNumber: blankToNull(dto.bank_account_number),
      bankAccountBankCode: blankToNull(dto.bank_account_bank_code),
      bankAccountIban: blankToNull(dto.bank_account_iban),
      bankAccountSwift: blankToNull(dto.bank_account_swift),
      defaultLocale: dto.default_locale,
      defaultDueDays: dto.default_due_days,
      defaultPaymentMethod: dto.default_payment_method,
      defaultNoteBelow: blankToNull(dto.default_note_below),
      invoiceFormPrefs: dto.invoice_form_prefs,
      emailPrefs: dto.email_prefs,
      templateVars: dto.template_vars,
      paymentMethods: dto.payment_methods,
      publicProfile: dto.public_profile,
      enabledModules: dto.enabled_modules,
    };
    for (const key of Object.keys(values) as Array<keyof TenantInsert>) {
      if (values[key] === undefined) delete values[key];
    }
    const slug = dto.public_profile?.slug;
    if (slug && (await this.profileSlugTaken(db, id, slug))) throw new ConflictException({ error: "slug_taken" });
    const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id)).limit(1);
    await db
      .update(schema.tenants)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(schema.tenants.id, id));
    if (row) {
      const before: BankFields = { accountNumber: row.bankAccountNumber, bankCode: row.bankAccountBankCode, iban: row.bankAccountIban };
      const after: BankFields = {
        accountNumber: values.bankAccountNumber !== undefined ? (values.bankAccountNumber ?? null) : before.accountNumber,
        bankCode: values.bankAccountBankCode !== undefined ? (values.bankAccountBankCode ?? null) : before.bankCode,
        iban: values.bankAccountIban !== undefined ? (values.bankAccountIban ?? null) : before.iban,
      };
      if (after.accountNumber !== before.accountNumber || after.bankCode !== before.bankCode || after.iban !== before.iban) {
        this.alertBankChange(id, "Bankovní účet na fakturách byl změněn", `${formatAccount(before)} → ${formatAccount(after)}`);
      }
      // Form layout prefs change on every save of the invoice form — not history.
      // Settings objects are logged as "changed" only; their content is in the current settings.
      // Secrets (encrypted keys) never reach the history, not even as ciphertext.
      const changes = (this.audit?.diff(row as Record<string, unknown>, values as Record<string, unknown>, ["invoiceFormPrefs"]) ?? []).map((c) =>
        JSON_SETTINGS.includes(c.field) || /Encrypted$/.test(c.field) ? { field: c.field, from: null, to: null } : c,
      );
      if (changes.length > 0) {
        await this.audit?.record(db, id, { entityType: "tenant", entityId: id, entityLabel: row.companyName, action: "updated", changes });
      }
    }
    const [tenant] = await this.findById(db, id);
    return tenant;
  }

  // --- Public profile (Settings → Veřejný profil) ---------------------------

  /** Live check for the slug field: format, reserved names, and other companies (via a SECURITY DEFINER boolean). */
  async profileSlugStatus(db: TenantDb, tenantId: string, raw: string) {
    const slug = raw.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) return { slug, available: false, reason: "invalid" as const };
    if (RESERVED_PROFILE_SLUGS.includes(slug)) return { slug, available: false, reason: "reserved" as const };
    if (await this.profileSlugTaken(db, tenantId, slug)) return { slug, available: false, reason: "taken" as const };
    return { slug, available: true, reason: null };
  }

  private async profileSlugTaken(db: TenantDb, tenantId: string, slug: string) {
    const rows = await db.execute<{ taken: boolean }>(sql`SELECT public_profile_slug_taken(${slug}, ${tenantId}::uuid) AS taken`);
    return Boolean([...rows][0]?.taken);
  }

  signup(): never {
    // TODO: tenant signup happens BEFORE any tenant context exists — see
    // the bootstrap caveat in drizzle/rls-policies.sql on the `tenants`
    // table policy. Needs its own transactional bootstrap path (e.g. a
    // SECURITY DEFINER function, or a dedicated signup-only DB role) that
    // inserts the first tenant + owner tenant_membership + tos_acceptance
    // row together, since the normal request flow assumes tenant_id is
    // already known (blueprint §4, §9 signup gate).
    throw new NotImplementedException();
  }

  // --- Logo (Settings → Company) -------------------------------------------

  async getLogo(db: TenantDb, tenantId: string): Promise<{ data: Buffer; mime: string } | null> {
    const [row] = await db
      .select({ data: schema.tenants.logoData, mime: schema.tenants.logoMime })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId))
      .limit(1);
    if (!row?.data || !row.mime) return null;
    return { data: Buffer.from(row.data, "base64"), mime: row.mime };
  }

  /** `file` is already size-limited by the controller; the type is checked from magic bytes, not the client's claim. */
  async setLogo(db: TenantDb, tenantId: string, role: string | undefined, file: Buffer | null) {
    this.assertAdmin(role);
    let mime: string | null = null;
    if (file) {
      mime = detectLogoMime(file);
      if (!mime) throw new BadRequestException({ error: "unsupported_file_type" });
    }
    await db
      .update(schema.tenants)
      .set({ logoData: file ? file.toString("base64") : null, logoMime: mime, updatedAt: new Date() })
      .where(eq(schema.tenants.id, tenantId));
    await this.audit?.record(db, tenantId, { entityType: "tenant", entityId: tenantId, action: file ? "logo_uploaded" : "logo_removed" });
    return { ok: true, hasLogo: Boolean(file) };
  }

  // --- Extra bank accounts (Settings → Company) ---------------------------

  listBankAccounts(db: TenantDb, tenantId: string) {
    return listBankAccounts(db, tenantId);
  }

  async createBankAccount(db: TenantDb, tenantId: string, role: string | undefined, dto: BankAccountDto) {
    this.assertAdmin(role);
    const [row] = await db
      .insert(schema.tenantBankAccounts)
      .values({ tenantId, ...this.bankValues(dto) })
      .returning();
    this.alertBankChange(tenantId, "Přibyl bankovní účet pro platby", `${row.label}: ${formatAccount(row)}`);
    await this.audit?.record(db, tenantId, {
      entityType: "bank_account",
      entityId: row.id,
      entityLabel: row.label,
      action: "created",
      changes: [{ field: "account", from: null, to: formatAccount(row) }],
    });
    return row;
  }

  async updateBankAccount(db: TenantDb, tenantId: string, role: string | undefined, id: string, dto: BankAccountDto) {
    this.assertAdmin(role);
    const before = await findBankAccount(db, tenantId, id);
    if (!before) throw new NotFoundException("Bank account not found");
    const [row] = await db
      .update(schema.tenantBankAccounts)
      .set(this.bankValues(dto))
      .where(and(eq(schema.tenantBankAccounts.tenantId, tenantId), eq(schema.tenantBankAccounts.id, id)))
      .returning();
    if (formatAccount(before) !== formatAccount(row)) {
      this.alertBankChange(tenantId, "Bankovní účet pro platby byl změněn", `${row.label}: ${formatAccount(before)} → ${formatAccount(row)}`);
    }
    const changes = this.audit?.diff(before as Record<string, unknown>, row as Record<string, unknown>, ["id", "tenantId", "createdAt", "updatedAt"]) ?? [];
    if (changes.length > 0) {
      await this.audit?.record(db, tenantId, { entityType: "bank_account", entityId: id, entityLabel: row.label, action: "updated", changes });
    }
    return row;
  }

  /** Invoices that pointed at the account fall back to automatic choice (FK on delete set null). */
  async deleteBankAccount(db: TenantDb, tenantId: string, role: string | undefined, id: string) {
    this.assertAdmin(role);
    const deleted = await db
      .delete(schema.tenantBankAccounts)
      .where(and(eq(schema.tenantBankAccounts.tenantId, tenantId), eq(schema.tenantBankAccounts.id, id)))
      .returning({ id: schema.tenantBankAccounts.id, label: schema.tenantBankAccounts.label, accountNumber: schema.tenantBankAccounts.accountNumber, bankCode: schema.tenantBankAccounts.bankCode, iban: schema.tenantBankAccounts.iban });
    if (deleted.length === 0) throw new NotFoundException("Bank account not found");
    this.alertBankChange(tenantId, "Bankovní účet pro platby byl odebrán", `${deleted[0].label}: ${formatAccount(deleted[0])}`);
    await this.audit?.record(db, tenantId, {
      entityType: "bank_account",
      entityId: id,
      entityLabel: deleted[0].label,
      action: "deleted",
      changes: [{ field: "account", from: formatAccount(deleted[0]), to: null }],
    });
    return { ok: true };
  }

  /**
   * Defence against payment fraud: a swapped account number sends the
   * client's money elsewhere, so every member hears about it, whatever their
   * notification settings.
   */
  private alertBankChange(tenantId: string, title: string, change: string) {
    this.notifications?.notifySecurity(tenantId, {
      title,
      body: `${change}. Pokud jste změnu neprovedli vy ani nikdo z týmu, zkontrolujte účet v Nastavení a změňte si heslo.`,
      link: "/settings",
    });
  }

  private assertAdmin(role: string | undefined) {
    if (role !== "owner" && role !== "admin") {
      throw new ForbiddenException("Only an owner or admin can change bank accounts");
    }
  }

  private bankValues(dto: BankAccountDto) {
    return {
      label: dto.label,
      accountNumber: dto.account_number ?? null,
      bankCode: dto.bank_code ?? null,
      iban: dto.iban ?? null,
      swift: dto.swift ?? null,
      currency: dto.currency ?? null,
      ...(dto.sort_order !== undefined ? { sortOrder: dto.sort_order } : {}),
    };
  }
}

/** PNG or JPEG — the two formats PDFKit can embed. */
export function detectLogoMime(buf: Buffer): "image/png" | "image/jpeg" | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  return null;
}
