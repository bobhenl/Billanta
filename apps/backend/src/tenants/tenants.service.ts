import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, NotImplementedException, Optional } from "@nestjs/common";
import { TAX_ADVANCE_KINDS, isValidCzTaxOfficePair, normalizeTaxAdvances, vatPayerOf, type TaxAdvancePeriod, type VatStatus } from "@faktur/cz-compliance";
import { and, eq, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { AuditService } from "../audit/audit.service";
import { WelcomeTrialService } from "../billing/welcome-trial.service";
import { demoConfig } from "../demo/demo-config";
import type { EmailLocale } from "../email/email-render";
import { NotificationsService } from "../notifications/notifications.service";
import { assertMayDo, sectionsForTenantPatch, type Actor } from "../tenancy/permissions";
import { findBankAccount, listBankAccounts } from "./bank-accounts";
import { countryChange, isCountryLocked } from "./country-change";
import type { BankAccountDto } from "./dto/bank-account.dto";
import type { UpdateTenantDto } from "./dto/update-tenant.dto";
import { getNumberFormats, saveNumberFormats, type NumberFormatsInput } from "./number-formats";
import { RESERVED_PROFILE_SLUGS, SLUG_PATTERN, withServiceIds } from "./public-profile";
import { NUMBER_DOCUMENT_TYPES } from "@faktur/cz-compliance";

type TenantDb = PostgresJsDatabase<typeof schema>;
type TenantInsert = typeof schema.tenants.$inferInsert;

const blankToNull = (v: string | null | undefined) => (v === undefined ? undefined : v ? v : null);

type BankFields = { accountNumber: string | null; bankCode: string | null; iban: string | null };

/** JSON settings columns: the audit log notes that they changed, not their whole content. */
const JSON_SETTINGS = ["emailPrefs", "templateVars", "paymentMethods", "publicProfile", "enabledModules", "webhooks"];

/** "123456789/0100", else the IBAN, else "–" — for the change alert. */
const formatAccount = (a: BankFields | undefined) =>
  a?.accountNumber ? `${a.accountNumber}${a.bankCode ? `/${a.bankCode}` : ""}` : a?.iban || "–";

type BankAlertKind = "invoiceAccountChanged" | "added" | "changed" | "removed";

/** The payout-account alert in the company's language (every member gets it, see `alertBankChange`). */
const BANK_ALERT: Record<EmailLocale, Record<BankAlertKind | "check", string>> = {
  cs: {
    invoiceAccountChanged: "Bankovní účet na fakturách byl změněn",
    added: "Přibyl bankovní účet pro platby",
    changed: "Bankovní účet pro platby byl změněn",
    removed: "Bankovní účet pro platby byl odebrán",
    check: "Pokud jste změnu neprovedli vy ani nikdo z týmu, zkontrolujte účet v Nastavení a změňte si heslo.",
  },
  sk: {
    invoiceAccountChanged: "Bankový účet na faktúrach bol zmenený",
    added: "Pribudol bankový účet na platby",
    changed: "Bankový účet na platby bol zmenený",
    removed: "Bankový účet na platby bol odstránený",
    check: "Ak ste zmenu neurobili vy ani nikto z tímu, skontrolujte účet v Nastaveniach a zmeňte si heslo.",
  },
  en: {
    invoiceAccountChanged: "The bank account on your invoices was changed",
    added: "A bank account for payments was added",
    changed: "A bank account for payments was changed",
    removed: "A bank account for payments was removed",
    check: "If neither you nor anyone in your team made this change, check the account in Settings and change your password.",
  },
};

/**
 * vat_status and the legacy dic_vat_payer flag, always written together (the
 * DB CHECK keeps them equal). A client sending only the boolean: true = payer;
 * false = non-payer, except that an identified person stays identified.
 */
export function vatFields(
  dto: Pick<UpdateTenantDto, "vat_status" | "dic_vat_payer">,
  current: VatStatus | undefined,
): { vatStatus: VatStatus; dicVatPayer: boolean } | Record<string, never> {
  let status = dto.vat_status;
  if (!status && dto.dic_vat_payer !== undefined) status = dto.dic_vat_payer ? "payer" : current === "identified" ? "identified" : "non_payer";
  return status ? { vatStatus: status, dicVatPayer: vatPayerOf(status) } : {};
}

/**
 * The advance periods as stored: oldest first, amounts rounded to cents,
 * null = not set in that period (0 stays: nothing to pay from then). A period
 * without any amount says nothing and is dropped.
 */
export function cleanAdvances(input: NonNullable<UpdateTenantDto["tax_advances"]>): TaxAdvancePeriod[] {
  return input
    .map((entry) => {
      const out: TaxAdvancePeriod = { from: entry.from };
      for (const k of TAX_ADVANCE_KINDS) {
        const value = entry[k];
        if (value != null) out[k] = Math.round(value * 100) / 100;
      }
      return out;
    })
    .filter((entry) => TAX_ADVANCE_KINDS.some((k) => entry[k] !== undefined))
    .sort((a, b) => a.from.localeCompare(b.from));
}

@Injectable()
export class TenantsService {
  constructor(
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() private readonly audit?: AuditService,
    @Optional() private readonly welcomeTrial?: WelcomeTrialService,
  ) {}

  /**
   * The tenant's own row, minus secrets: the encrypted AI and Stripe keys
   * never leave the backend (see src/ai/ and src/card-payments/). The page
   * only needs to know whether a Stripe key is set.
   */
  async findById(db: TenantDb, id: string) {
    const rows = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id)).limit(1);
    // The logo is served separately (GET /tenants/me/logo) to keep this row small.
    // Advances always go out as the period list (a row not yet migrated by 0044 still holds the old single object).
    // A demo shows how many AI calls it has left (the count lives in demo_sessions, see src/demo/).
    const demoAiCallsLeft = rows[0]?.isDemo
      ? ((await db.execute<{ left: number }>(sql`SELECT demo_ai_calls_left(${id}, ${demoConfig().aiPerSession}) AS left`))[0]?.left ?? 0)
      : null;
    const countryLocked = rows[0] ? await isCountryLocked(db) : false;
    // The tax model (partners, their credits and shares) is owner/admin only and is read through
    // GET /tenants/me/tax-model; this row goes to every member.
    return rows.map(({ aiApiKeyEncrypted: _aiKey, stripeSecretKeyEncrypted, logoData, taxModel: _taxModel, ...tenant }) => ({
      ...tenant,
      hasStripeKey: Boolean(stripeSecretKeyEncrypted),
      taxAdvances: normalizeTaxAdvances(tenant.taxAdvances),
      hasLogo: Boolean(logoData),
      demoAiCallsLeft,
      countryLocked,
    }));
  }

  /**
   * Settings → Company and the other settings pages that save here. Each
   * field belongs to a settings section (`TENANT_FIELD_SECTIONS`); a member
   * needs every section the patch touches, and fields outside the sections
   * stay with owners and admins. Fields left out stay as they are.
   */
  async update(db: TenantDb, id: string, actor: Actor, dto: UpdateTenantDto) {
    const sent = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    const sections = sectionsForTenantPatch(sent);
    if (actor.role !== "owner" && actor.role !== "admin") {
      if (!sections) throw new ForbiddenException("Only an owner or admin can change company settings");
      for (const section of sections) assertMayDo(actor, section);
    }
    const values: Partial<TenantInsert> = {
      companyName: dto.company_name,
      legalName: dto.legal_name,
      ico: blankToNull(dto.ico),
      dic: blankToNull(dto.dic),
      addressStreet: blankToNull(dto.address_street),
      addressCity: blankToNull(dto.address_city),
      addressPostalCode: blankToNull(dto.address_postal_code),
      addressCountry: dto.address_country?.toUpperCase(),
      email: blankToNull(dto.email),
      phone: blankToNull(dto.phone),
      website: blankToNull(dto.website),
      registryNote: blankToNull(dto.registry_note),
      dataBoxId: blankToNull(dto.data_box_id),
      taxOffice: dto.tax_office,
      taxWorkplace: dto.tax_workplace,
      healthInsurer: blankToNull(dto.health_insurer),
      socialOffice: dto.social_office,
      residenceStreet: blankToNull(dto.residence_street),
      residenceCity: blankToNull(dto.residence_city),
      residencePostalCode: blankToNull(dto.residence_postal_code),
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
      publicProfile: dto.public_profile && withServiceIds(dto.public_profile),
      enabledModules: dto.enabled_modules,
      flatTaxRegime: dto.flat_tax_regime,
      activityKind: dto.activity_kind,
      buyerDetailsRequired: dto.buyer_details_required ? [...new Set(dto.buyer_details_required)] : undefined,
    };
    for (const key of Object.keys(values) as Array<keyof TenantInsert>) {
      if (values[key] === undefined) delete values[key];
    }
    const slug = dto.public_profile?.slug;
    if (slug && (await this.profileSlugTaken(db, id, slug))) throw new ConflictException({ error: "slug_taken" });
    const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id)).limit(1);
    // EPO rejects a pracoviště that belongs to another office, so the pair is
    // checked as it will be stored, whichever half the patch changes.
    if (dto.tax_office !== undefined || dto.tax_workplace !== undefined) {
      const office = dto.tax_office !== undefined ? dto.tax_office : (row?.taxOffice ?? null);
      const workplace = dto.tax_workplace !== undefined ? dto.tax_workplace : (row?.taxWorkplace ?? null);
      if (!isValidCzTaxOfficePair(office ?? null, workplace ?? null)) throw new BadRequestException("tax_workplace_mismatch");
    }
    Object.assign(values, vatFields(dto, row?.vatStatus));
    if (dto.country !== undefined) {
      const change = countryChange(row?.country, dto.country, await isCountryLocked(db));
      if (change) Object.assign(values, change);
    }
    if (dto.tax_advances) values.taxAdvances = cleanAdvances(dto.tax_advances);
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
        this.alertBankChange(id, "invoiceAccountChanged", `${formatAccount(before)} → ${formatAccount(after)}`);
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
      // The welcome trial starts with the first real IČO; later bank and contact
      // changes are checked against other trial companies (billing/welcome-trial.ts).
      await this.welcomeTrial?.onCompanyChanged(db, id, Boolean(values.ico));
    }
    const [tenant] = await this.findById(db, id);
    return tenant;
  }

  // --- Number formats (Settings → Číslování dokladů) -----------------------

  getNumberFormats(db: TenantDb, tenantId: string, actor: Actor) {
    assertMayDo(actor, "settings.numbering");
    return getNumberFormats(db, tenantId);
  }

  async updateNumberFormats(db: TenantDb, tenantId: string, actor: Actor, dto: NumberFormatsInput) {
    assertMayDo(actor, "settings.numbering");
    const { before, after } = await saveNumberFormats(db, tenantId, dto);
    const changes: schema.AuditChange[] = [];
    for (const type of NUMBER_DOCUMENT_TYPES) {
      if ((before[type] ?? null) !== (after[type] ?? null)) {
        changes.push({ field: `numberFormat.${type}`, from: before[type] ?? null, to: after[type] ?? null });
      }
      const next = dto.nextNumbers[type];
      if (next != null) changes.push({ field: `nextNumber.${type}`, from: null, to: next });
    }
    if (changes.length > 0) {
      await this.audit?.record(db, tenantId, { entityType: "tenant", entityId: tenantId, action: "number_formats_updated", changes });
    }
    return getNumberFormats(db, tenantId);
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
  async setLogo(db: TenantDb, tenantId: string, actor: Actor, file: Buffer | null) {
    assertMayDo(actor, "settings.company");
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

  async createBankAccount(db: TenantDb, tenantId: string, actor: Actor, dto: BankAccountDto) {
    assertMayDo(actor, "settings.company");
    const [row] = await db
      .insert(schema.tenantBankAccounts)
      .values({ tenantId, ...this.bankValues(dto) })
      .returning();
    this.alertBankChange(tenantId, "added", `${row.label}: ${formatAccount(row)}`);
    await this.audit?.record(db, tenantId, {
      entityType: "bank_account",
      entityId: row.id,
      entityLabel: row.label,
      action: "created",
      changes: [{ field: "account", from: null, to: formatAccount(row) }],
    });
    await this.welcomeTrial?.refreshSignals(db, tenantId);
    return row;
  }

  async updateBankAccount(db: TenantDb, tenantId: string, actor: Actor, id: string, dto: BankAccountDto) {
    assertMayDo(actor, "settings.company");
    const before = await findBankAccount(db, tenantId, id);
    if (!before) throw new NotFoundException("Bank account not found");
    const [row] = await db
      .update(schema.tenantBankAccounts)
      .set(this.bankValues(dto))
      .where(and(eq(schema.tenantBankAccounts.tenantId, tenantId), eq(schema.tenantBankAccounts.id, id)))
      .returning();
    if (formatAccount(before) !== formatAccount(row)) {
      this.alertBankChange(tenantId, "changed", `${row.label}: ${formatAccount(before)} → ${formatAccount(row)}`);
    }
    const changes = this.audit?.diff(before as Record<string, unknown>, row as Record<string, unknown>, ["id", "tenantId", "createdAt", "updatedAt"]) ?? [];
    if (changes.length > 0) {
      await this.audit?.record(db, tenantId, { entityType: "bank_account", entityId: id, entityLabel: row.label, action: "updated", changes });
    }
    await this.welcomeTrial?.refreshSignals(db, tenantId);
    return row;
  }

  /** Invoices that pointed at the account fall back to automatic choice (FK on delete set null). */
  async deleteBankAccount(db: TenantDb, tenantId: string, actor: Actor, id: string) {
    assertMayDo(actor, "settings.company");
    const deleted = await db
      .delete(schema.tenantBankAccounts)
      .where(and(eq(schema.tenantBankAccounts.tenantId, tenantId), eq(schema.tenantBankAccounts.id, id)))
      .returning({ id: schema.tenantBankAccounts.id, label: schema.tenantBankAccounts.label, accountNumber: schema.tenantBankAccounts.accountNumber, bankCode: schema.tenantBankAccounts.bankCode, iban: schema.tenantBankAccounts.iban });
    if (deleted.length === 0) throw new NotFoundException("Bank account not found");
    this.alertBankChange(tenantId, "removed", `${deleted[0].label}: ${formatAccount(deleted[0])}`);
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
  private alertBankChange(tenantId: string, kind: BankAlertKind, change: string) {
    this.notifications?.notifySecurity(tenantId, (locale) => ({
      title: BANK_ALERT[locale][kind],
      body: `${change}. ${BANK_ALERT[locale].check}`,
      link: "/settings",
    }));
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
