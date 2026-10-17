/**
 * Shared-schema, multi-tenant Postgres schema (blueprint §4).
 *
 * Every tenant-owned table carries a `tenantId` column and is protected by a
 * Postgres Row-Level Security policy (see `rls-policies.sql`) rather than
 * relying on application code to always remember `WHERE tenant_id = ...`.
 * A handful of tables are deliberately NOT tenant-scoped — they're global
 * catalog/reference data (see the comment on each) — and have no RLS policy.
 *
 * This file is the source of truth for `drizzle-kit generate`/`migrate`.
 * RLS policies themselves live in `rls-policies.sql`, applied separately
 * (Drizzle Kit has no first-class RLS DSL in the version pinned here).
 */
import { sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
  numeric,
  type AnyPgColumn,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const tenantRoleEnum = pgEnum("tenant_role", [
  "owner",
  "admin",
  "accountant",
  "viewer",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "pending_review",
  "issued",
  "paid",
  "cancelled",
]);

// NOTE: the already-built `apps/ai-service` (see its `app/pipeline/schemas.py`
// `Channel` enum) only knows about bare "telegram" / "whatsapp" as a
// messaging channel identifier, not "ai_telegram" / "ai_whatsapp". The
// mapping from one to the other happens in `InvoicesService.createDraft`
// (backend-side), not here — see the comment there. Keeping the blueprint's
// original `ai_telegram` / `ai_whatsapp` values in the DB enum so
// `source` unambiguously distinguishes an AI-originated invoice from a
// manually created or API-created one at the storage layer.
// `"recurring"` added by the recurring-invoice-templates generation job
// (src/recurring-invoices/recurring-invoice-generation.service.ts): the
// daily `@Cron` scan materializes a real `invoices` row from a due
// `recurring_invoice_templates` row, and that row's origin needs its own
// `source` value distinct from `manual`/`api`/AI-originated — reusing e.g.
// `api` would misrepresent an unattended scheduled job as an authenticated
// API-key caller. NOTE for whichever task owns this schema file: this value
// was added by the recurring-invoices build, not the original
// schema-extension pass — flagging it explicitly per that task's brief.
export const invoiceSourceEnum = pgEnum("invoice_source", [
  "manual",
  "ai_telegram",
  "ai_whatsapp",
  "api",
  "recurring",
  // Historical documents brought over from another invoicing system (CSV
  // import, src/invoices/invoice-import.util.ts). Never emailed or reminded.
  "import",
]);

// What kind of document an `invoices` row is. Quotes and proformas are not
// tax documents; a credit note ("opravný daňový doklad") always points at
// the invoice it corrects via `relatedInvoiceId`.
export const documentTypeEnum = pgEnum("document_type", ["invoice", "proforma", "credit_note", "quote"]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "bank_transfer",
  "cash",
  "card",
  "cash_on_delivery",
  "other",
]);

export const channelTypeEnum = pgEnum("channel_type", ["telegram", "whatsapp"]);

// How a tenant's AI features (invoice pre-fill from text) are powered:
// `platform` = Billanta's own Anthropic key, `own` = the tenant's own key
// (stored encrypted, see src/ai/), `off` = no AI calls at all.
export const aiModeEnum = pgEnum("ai_mode", ["off", "platform", "own"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
]);

export const billingProviderEnum = pgEnum("billing_provider", ["stripe", "gopay"]);

export const recurringFrequencyEnum = pgEnum("recurring_frequency", [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);

export const bankStatementSourceEnum = pgEnum("bank_statement_source", ["csv", "mt940", "fio", "psd2", "paypal"]);

export const bankTransactionStatusEnum = pgEnum("bank_transaction_status", [
  "unmatched",
  "matched",
  "ignored",
]);

// Per-tenant backup/export destinations (NOT the platform-wide `apps/backup`
// pg_dump-to-founder's-Drive sidecar — see the "Per-tenant backup
// destinations" section of README.md for the distinction between the two
// "backup" features living in this codebase). A tenant OWNER can point their
// own application-level data export at either their own Google Drive or a
// webhook URL they control.
// "local" added for the on-demand SQLite-file download destination
// (`sqlite-export.service.ts`) — no OAuth token, no webhook URL, nothing to
// authenticate against: the "destination" is just the tenant's own browser
// download, so `configEncrypted`/`webhookUrl`/`googleDriveFolderId` are all
// left null for a `local` row. Its `schedule` is constrained to `manual`
// only — enforced at the DTO/service validation layer (see
// `create-backup-destination.dto.ts` and
// `BackupDestinationsService.update`), NOT here, since there's no clean way
// to express "this enum value implies that other column can only hold one
// value" as a column-level Postgres CHECK without a trigger.
export const backupDestinationTypeEnum = pgEnum("backup_destination_type", [
  "google_drive",
  "webhook",
  "local",
  // The company's own server over SFTP (SQLite file per run, see `sftp.client.ts`).
  "sftp",
]);

export const backupScheduleEnum = pgEnum("backup_schedule", ["daily", "weekly", "manual"]);

// ---------------------------------------------------------------------------
// tenants — the tenant root row itself. Not "tenant-scoped" in the tenant_id
// sense (it IS the tenant); see rls-policies.sql for how it's still RLS'd
// via its own `id`, and the bootstrap caveat noted there.
// ---------------------------------------------------------------------------
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyName: text("company_name").notNull(),
  legalName: text("legal_name").notNull(),
  ico: varchar("ico", { length: 8 }),
  dic: varchar("dic", { length: 14 }),
  dicVatPayer: boolean("dic_vat_payer").notNull().default(false),
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressPostalCode: varchar("address_postal_code", { length: 10 }),
  addressCountry: varchar("address_country", { length: 2 }).notNull().default("CZ"),
  bankAccountNumber: text("bank_account_number"),
  bankAccountBankCode: varchar("bank_account_bank_code", { length: 4 }),
  bankAccountIban: text("bank_account_iban"),
  defaultLocale: varchar("default_locale", { length: 5 }).notNull().default("cs"),
  // FK declared with a lazy () => ... reference because subscriptionPlans is
  // defined further down this file (Drizzle resolves these at query-build
  // time, not at module-evaluation time, so forward references are fine).
  subscriptionPlanId: uuid("subscription_plan_id").references(() => subscriptionPlans.id),
  subscriptionStatus: subscriptionStatusEnum("subscription_status")
    .notNull()
    .default("trialing"),
  stripeCustomerId: text("stripe_customer_id"),
  gopayPayerId: text("gopay_payer_id"),
  aiMode: aiModeEnum("ai_mode").notNull().default("platform"),
  // AES-256-GCM `<iv>:<tag>:<ciphertext>` (backup-destinations/encryption.util);
  // never returned by any endpoint — only `aiApiKeyLast4` is.
  aiApiKeyEncrypted: text("ai_api_key_encrypted"),
  aiApiKeyLast4: varchar("ai_api_key_last4", { length: 4 }),
  // The company's OWN Stripe secret/restricted key for card payments from the
  // invoice link (`card-payments` module), AES-256-GCM like the AI key; never returned.
  stripeSecretKeyEncrypted: text("stripe_secret_key_encrypted"),
  stripeAccountName: text("stripe_account_name"),
  cardPaymentsEnabled: boolean("card_payments_enabled").notNull().default(false),
  // --- Company profile & invoice defaults (Settings -> Company) ---
  email: text("email"),
  phone: varchar("phone", { length: 32 }),
  website: text("website"),
  // e.g. "Fyzická osoba zapsaná v živnostenském rejstříku" / "C 1234 vedená u MS v Praze".
  registryNote: text("registry_note"),
  bankAccountSwift: varchar("bank_account_swift", { length: 11 }),
  defaultDueDays: integer("default_due_days").notNull().default(14),
  defaultPaymentMethod: paymentMethodEnum("default_payment_method").notNull().default("bank_transfer"),
  defaultNoteBelow: text("default_note_below"),
  /** Company logo printed on documents: base64 PNG/JPEG (≤ 512 kB), never returned by GET /tenants/me. */
  logoData: text("logo_data"),
  logoMime: varchar("logo_mime", { length: 32 }),
  // Which optional invoice-form fields start expanded, preset custom-field
  // labels, default "issued by"/place — see `tenants/invoice-form-prefs.ts`.
  invoiceFormPrefs: jsonb("invoice_form_prefs").notNull().default({}),
  // Emails to customers: subject/text templates, sender name, reply-to,
  // what to attach — see `tenants/email-prefs.ts`.
  emailPrefs: jsonb("email_prefs").notNull().default({}),
  // The company's own `{placeholders}` for emails and document notes — see `tenants/template-vars.ts`.
  templateVars: jsonb("template_vars").notNull().default([]),
  // Custom payment methods ({id,label,instructions}[]) offered in the invoice form.
  paymentMethods: jsonb("payment_methods").notNull().default([]),
  // Public business-card page at /p/<slug> — see `tenants/public-profile.ts`.
  publicProfile: jsonb("public_profile").notNull().default({}),
  // Dashboard sections the company switched off (`tenants/modules.ts`); missing = on.
  enabledModules: jsonb("enabled_modules").notNull().default({}),
  // Outgoing webhooks (Discord, Slack, or plain JSON) fired on the same events
  // as member notifications — see `integrations/webhooks.ts`.
  webhooks: jsonb("webhooks").notNull().default([]),
  // Own number pattern per document type ({"invoice": "{N}/{MM}/{YYYY}"});
  // null or a missing type = built-in `{series}{YYYY}-{NNNN}` (`tenants/number-formats.ts`).
  numberFormats: jsonb("number_formats"),
  // Abuse protection (`abuse/sending-guard.ts`): a suspended company can't send
  // and its share links show a notice; paused only blocks outgoing e-mail
  // (set automatically after repeated recipient reports, cleared by the operator).
  suspendedAt: timestamp("suspended_at", { withTimezone: true }),
  suspensionReason: text("suspension_reason"),
  emailPausedAt: timestamp("email_paused_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// users — NOT tenant-scoped (no tenant_id): a user can belong to multiple
// tenants via `tenant_memberships`. Auth.js/NextAuth (blueprint §2) owns the
// session/credential flow; this table is just the identity record.
//
// `name`/`emailVerified`/`image` are the columns `@auth/drizzle-adapter`'s
// standard Postgres adapter expects on the users table it manages (it reads
// `emailVerified`, not `email_verified`, at the JS/TS property level — the
// snake_case DB column name below is fine, Drizzle handles the mapping).
// `passwordHash` stays: the adapter itself never reads or writes it — it's
// only consulted by this app's own Credentials-provider logic — so it
// coexists with the adapter-managed columns without conflict.
// ---------------------------------------------------------------------------
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: varchar("email", { length: 320 }).notNull(),
    // Nullable: a user who only ever signs in via Google OAuth has no
    // local password hash.
    passwordHash: text("password_hash"),
    name: text("name"),
    emailVerified: timestamp("email_verified", { withTimezone: true }),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    emailUnique: uniqueIndex("users_email_unique").on(table.email),
  }),
);

// ---------------------------------------------------------------------------
// accounts / sessions / verification_tokens — Auth.js (`@auth/drizzle-
// adapter`) tables, standard Postgres adapter shape. Like `users` above,
// these are user-level identity data, NOT tenant-owned business data: a
// single user's OAuth accounts/sessions aren't scoped to any one tenant (the
// same user can hold memberships in several tenants via
// `tenant_memberships`, which IS tenant-scoped and RLS'd). None of these
// four tables carries a `tenant_id` column, and none has an RLS policy in
// `rls-policies.sql` — same category of exemption as `users` itself
// (identity-only, no tenant concept applies), NOT the same category as the
// `channel_links` exemption (which does have a `tenant_id` but is exempted
// for a chicken-and-egg bootstrap reason — see rls-policies.sql). See
// rls-policies.sql's "Deliberately EXCLUDED" section for the matching note.
// ---------------------------------------------------------------------------
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
  },
  (table) => ({
    providerAccountUnique: uniqueIndex("accounts_provider_provider_account_id_unique").on(
      table.provider,
      table.providerAccountId,
    ),
  }),
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (table) => ({
    compositePk: primaryKey({ columns: [table.identifier, table.token] }),
  }),
);

// ---------------------------------------------------------------------------
// tenant_memberships — join table binding users to tenants with a role.
// Tenant-scoped: RLS'd.
// ---------------------------------------------------------------------------
export const tenantMemberships = pgTable(
  "tenant_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: tenantRoleEnum("role").notNull().default("viewer"),
    // Per-area access overriding the role's defaults (null = role defaults),
    // see src/tenancy/permissions.ts.
    permissions: jsonb("permissions"),
    // This person's own quick-action tiles on the dashboard (null = defaults),
    // see src/dashboard/dashboard-tiles.ts for the shape.
    dashboardTiles: jsonb("dashboard_tiles"),
    // Which events reach this person and how (in-app/browser, email) —
    // see src/notifications/notification-prefs.ts.
    notificationPrefs: jsonb("notification_prefs").notNull().default({}),
    // Secret of this person's read-only calendar (iCal) and RSS feeds
    // (Settings → Integrace); null = feeds off. Resolved without a session
    // through `find_feed_owner` in drizzle/rls-policies.sql.
    feedToken: uuid("feed_token"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantUserUnique: uniqueIndex("tenant_memberships_tenant_user_unique").on(
      table.tenantId,
      table.userId,
    ),
    feedTokenUnique: uniqueIndex("tenant_memberships_feed_token_unique").on(table.feedToken),
  }),
);

// ---------------------------------------------------------------------------
// contacts — tenant-scoped counterparties (customers/suppliers).
// ---------------------------------------------------------------------------
export const contacts = pgTable("contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  ico: varchar("ico", { length: 8 }),
  dic: varchar("dic", { length: 14 }),
  legalName: text("legal_name").notNull(),
  // Added for the invoice-emailing / overdue-payment-reminder feature: both
  // `EmailService.sendInvoiceEmail`/`sendPaymentReminderEmail` need a real
  // recipient address, and neither the blueprint §4 representative schema
  // nor the original `contacts` table had one. Nullable — a contact created
  // without an email (e.g. from an AI voice draft, ARES lookup, or manual
  // entry before the email is known) simply can't be emailed yet;
  // `InvoicesService.sendInvoice`/`InvoiceRemindersCron` both check for this
  // explicitly rather than assuming it's always set.
  email: text("email"),
  addressStreet: text("address_street"),
  addressCity: text("address_city"),
  addressPostalCode: varchar("address_postal_code", { length: 10 }),
  addressCountry: varchar("address_country", { length: 2 }).notNull().default("CZ"),
  aresVerifiedAt: timestamp("ares_verified_at", { withTimezone: true }),
  // Nullable tri-state on purpose: null = "unknown/unverified", never
  // defaulted to false — surfacing a confirmed false as unverified data
  // would be worse than surfacing "needs verification" (blueprint §6 step 7,
  // §1 ARES/ADISREG gap).
  isVatPayer: boolean("is_vat_payer"),
  // Starred customers are listed first in the contacts list and offered as
  // one-tap picks on a new invoice.
  isStarred: boolean("is_starred").notNull().default(false),
  // A private individual (no IČO/DIČ): the editor hides the company fields
  // and the invoice never prints them for this customer.
  isPerson: boolean("is_person").notNull().default(false),
  // Colour label shown as a dot next to the customer everywhere (CONTACT_COLORS); null = none.
  color: varchar("color", { length: 16 }),
  // Private note about the customer (payment habits, contact person …); never printed or sent.
  internalNote: text("internal_note"),
  // Client portal link (/c/:portalToken) listing every issued document for this customer;
  // null = no portal. Unique index in migration 0030.
  portalToken: uuid("portal_token"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// invoices — tenant-scoped. Carries the liability audit-trail fields from
// §9 (issuedByUserId/issuedAt/aiDraftReviewedAt) plus a few fields beyond the
// §4 "representative schema" list that are needed to actually implement §6
// step 8 ("storing raw transcript + extracted JSON + ARES match
// confidence") and step 10 (needs_attention flag) — called out inline.
// ---------------------------------------------------------------------------
/**
 * Extra bank accounts besides the primary one on `tenants` (e.g. an EUR
 * account for foreign invoices). Idea from faktorio (MIT, © Jiri Spac).
 */
export const tenantBankAccounts = pgTable("tenant_bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "restrict" }),
  label: text("label").notNull(),
  accountNumber: text("account_number"),
  bankCode: varchar("bank_code", { length: 4 }),
  iban: text("iban"),
  swift: varchar("swift", { length: 11 }),
  /** When set, invoices in this currency use this account automatically. */
  currency: varchar("currency", { length: 3 }),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // onDelete: "restrict" (not "cascade") deliberately — §8 notes CZ/SK tax
    // law requires ~10-year invoice retention; a tenant row must never be
    // deletable in a way that silently cascades away financial records.
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "restrict" }),
    // Nullable: a draft (status = pending_review) has no number yet — CZ/SK
    // law requires immutable sequential numbering allocated only at issue
    // time (blueprint §6 step 8).
    invoiceNumber: varchar("invoice_number", { length: 32 }),
    variableSymbol: varchar("variable_symbol", { length: 10 }),
    issueDate: timestamp("issue_date", { withTimezone: true, mode: "date" }),
    dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
    currency: varchar("currency", { length: 3 }).notNull().default("CZK"),
    status: invoiceStatusEnum("status").notNull().default("draft"),
    source: invoiceSourceEnum("source").notNull().default("manual"),
    aiConfidenceScore: numeric("ai_confidence_score", { precision: 4, scale: 3 }),
    // --- Liability audit trail (blueprint §9) ---
    // The "Issue" button click is the legally significant moment a human
    // takes responsibility for the invoice content — tracked independently
    // from whenever an AI draft was originally produced.
    issuedByUserId: uuid("issued_by_user_id").references(() => users.id),
    issuedAt: timestamp("issued_at", { withTimezone: true }),
    aiDraftReviewedAt: timestamp("ai_draft_reviewed_at", { withTimezone: true }),
    // --- Additions beyond the §4 list, needed for §6 step 8/10 ---
    // True if ARES lookup failed or extraction confidence was low; the
    // draft is still created (never silently dropped), just flagged for a
    // human to look at more carefully during review.
    needsAttention: boolean("needs_attention").notNull().default(false),
    // Verbatim { rawTranscript, extractedData, aresEnrichment } payload as
    // received from the AI microservice, kept for audit purposes alongside
    // the liability trail above — see InvoicesService.createDraft.
    rawAiPayload: jsonb("raw_ai_payload"),
    // --- Client-portal + email-reminder additions ---
    // Shareable, unguessable id for the no-auth client-portal view (a client
    // opens `/portal/invoices/:publicToken` without ever authenticating).
    // Deliberately a SEPARATE random value from `id`, not `id` itself: `id`s
    // are sequentially-ish generated uuids used internally in URLs/logs/FKs
    // throughout the app, so treating `id` as the public secret would mean
    // every internal reference doubles as a bearer credential. Looking an
    // invoice up by this column requires bypassing RLS via a narrow
    // SECURITY DEFINER function (see `get_public_invoice_view` in
    // rls-policies.sql) since no tenant context exists yet at that point —
    // same pattern as `find_tenant_id_by_stripe_customer_id`.
    publicToken: uuid("public_token").notNull().defaultRandom(),
    // Set when the invoice is actually emailed/delivered to the contact;
    // null means "never sent" (e.g. still a draft, or issued but not yet
    // dispatched). Distinct from `issuedAt` — an invoice can be issued
    // (numbered, legally final) before it's sent.
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastReminderSentAt: timestamp("last_reminder_sent_at", { withTimezone: true }),
    reminderCount: integer("reminder_count").notNull().default(0),
    // Client-portal link analytics (bumped by `record_public_invoice_view`).
    publicViewCount: integer("public_view_count").notNull().default(0),
    publicFirstViewedAt: timestamp("public_first_viewed_at", { withTimezone: true }),
    publicLastViewedAt: timestamp("public_last_viewed_at", { withTimezone: true }),
    // --- Document details (what competitors' invoice forms carry) ---
    documentType: documentTypeEnum("document_type").notNull().default("invoice"),
    // Credit note -> corrected invoice; invoice -> the proforma/quote it came from.
    relatedInvoiceId: uuid("related_invoice_id").references((): AnyPgColumn => invoices.id, {
      onDelete: "restrict",
    }),
    // DUZP (datum uskutečnění zdanitelného plnění). Null = same as issue date.
    taxableSupplyDate: timestamp("taxable_supply_date", { withTimezone: true, mode: "date" }),
    paymentMethod: paymentMethodEnum("payment_method").notNull().default("bank_transfer"),
    // Custom method name / payment instructions printed instead of the built-in label.
    paymentMethodLabel: text("payment_method_label"),
    paymentInstructions: text("payment_instructions"),
    constantSymbol: varchar("constant_symbol", { length: 4 }),
    specificSymbol: varchar("specific_symbol", { length: 10 }),
    orderNumber: varchar("order_number", { length: 64 }),
    // Printed above / below the items; the internal note is never printed.
    noteAbove: text("note_above"),
    noteBelow: text("note_below"),
    internalNote: text("internal_note"),
    language: varchar("language", { length: 2 }).notNull().default("cs"),
    // Přenesená daňová povinnost (§92a ZDPH): VAT is not charged on the invoice.
    reverseCharge: boolean("reverse_charge").notNull().default(false),
    /** CZK per 1 unit of `currency` (ČNB rate on the taxable supply date), set at issue; null for CZK. */
    exchangeRate: numeric("exchange_rate", { precision: 14, scale: 6 }),
    /** Account printed for payment; null = auto (matching currency, else the company's primary account). */
    bankAccountId: uuid("bank_account_id").references(() => tenantBankAccounts.id, { onDelete: "set null" }),
    // "Místo vystavení" and "Vystavil" (person) as printed on the document.
    issuePlace: text("issue_place"),
    issuedByName: text("issued_by_name"),
    // Free label/value pairs printed in the document header (Invoice Ninja's
    // custom fields): [{ label, value }].
    customFields: jsonb("custom_fields").$type<{ label: string; value: string; kind?: "text" | "amount" | "percent" | "formula"; internal?: boolean }[]>().notNull().default([]),
    // Quote accepted/rejected by the client from the portal link (Invoice
    // Ninja's "approve quote"): 'accepted' | 'rejected', null = no answer yet.
    clientResponse: varchar("client_response", { length: 16 }).$type<"accepted" | "rejected">(),
    clientRespondedAt: timestamp("client_responded_at", { withTimezone: true }),
    clientResponseName: text("client_response_name"),
    clientResponseNote: text("client_response_note"),
    // "Odběratel si doplní údaje sám" (migration 0042): a draft sent to the
    // customer to fill in their own billing details at /d/:buyerDetailsToken.
    // The token is a separate secret from `publicToken` and only works while
    // the document is a draft and nothing has been submitted yet; null = no
    // request open. `buyerDetailsOutcome` says what happened to the contact.
    buyerDetailsToken: uuid("buyer_details_token"),
    buyerDetailsRequestedAt: timestamp("buyer_details_requested_at", { withTimezone: true }),
    buyerDetailsRequestedBy: uuid("buyer_details_requested_by").references(() => users.id, { onDelete: "set null" }),
    buyerDetailsEmail: text("buyer_details_email"),
    buyerDetailsAutoIssue: boolean("buyer_details_auto_issue").notNull().default(false),
    buyerDetailsSubmittedAt: timestamp("buyer_details_submitted_at", { withTimezone: true }),
    buyerDetailsOutcome: jsonb("buyer_details_outcome").$type<BuyerDetailsOutcome>(),
    // Sum received so far (partial payments); the status flips to "paid" once it reaches the total.
    amountPaid: numeric("amount_paid", { precision: 14, scale: 2 }).notNull().default("0"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    // Kept by the payment provider (PayPal, Stripe, Wise…), in the invoice currency.
    paymentFees: numeric("payment_fees", { precision: 14, scale: 2 }).notNull().default("0"),
    // What actually landed on the account, in CZK; null = not recorded.
    receivedCzk: numeric("received_czk", { precision: 14, scale: 2 }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    // Supplier / buyer as printed on the document on its issue date (§29, §34–35
    // ZDPH): captured when the document leaves the draft stage, or taken from
    // the source document on import. Null = a draft, or issued before migration
    // 0040: renderers then read the live tenant / contact. See `invoices/party-snapshot.ts`.
    sellerSnapshot: jsonb("seller_snapshot"),
    buyerSnapshot: jsonb("buyer_snapshot"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // A given invoice number must be unique per tenant per (implied) year —
    // enforced together with invoice_number_sequences at issuance time; this
    // index guards against two concurrent issuances colliding.
    tenantInvoiceNumberUnique: uniqueIndex("invoices_tenant_invoice_number_unique").on(
      table.tenantId,
      table.invoiceNumber,
    ),
    publicTokenUnique: uniqueIndex("invoices_public_token_unique").on(table.publicToken),
    buyerDetailsTokenUnique: uniqueIndex("invoices_buyer_details_token_unique").on(table.buyerDetailsToken),
  }),
);

/**
 * What a customer's own billing details did to the address book
 * (`invoices.buyerDetailsOutcome`): `existing` = matched a saved contact by
 * IČO/DIČ, `filled` = completed the contact already on the draft, `created` =
 * a new contact. `filled` lists the fields that were empty and got a value;
 * `conflicts` the ones that differ and were left unchanged.
 */
export type BuyerDetailsOutcome = {
  mode: "existing" | "filled" | "created";
  contactId: string;
  filled: string[];
  conflicts: { field: string; saved: string | null; submitted: string | null }[];
  autoIssue: "issued" | "sent" | "skipped" | "failed" | null;
  autoIssueError?: string | null;
};

// ---------------------------------------------------------------------------
// invoice_line_items — tenant-scoped.
// ---------------------------------------------------------------------------
/**
 * Files attached to an invoice (timesheet, contract, delivery note…), sent
 * along with the invoice email and/or listed in the client portal. Stored
 * base64 in the row like the logo — small files, no object store yet.
 */
export const invoiceAttachments = pgTable("invoice_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  filename: varchar("filename", { length: 200 }).notNull(),
  mime: varchar("mime", { length: 100 }).notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  data: text("data").notNull(),
  sendWithEmail: boolean("send_with_email").notNull().default(true),
  showInPortal: boolean("show_in_portal").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** In-app notification feed per member ("Faktura 2026-0004 byla zaplacena"). */
export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 40 }).notNull(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body"),
  link: varchar("link", { length: 300 }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const invoiceLineItems = pgTable("invoice_line_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  quantity: numeric("quantity", { precision: 12, scale: 3 }).notNull().default("1"),
  // 4 decimals: a net price derived from a gross one ("prices incl. VAT")
  // must sum back to the exact gross total.
  unitPrice: numeric("unit_price", { precision: 14, scale: 4 }).notNull(),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }),
  // "ks", "hod", "m²"… free text, printed next to the quantity.
  unit: varchar("unit", { length: 16 }),
  // Item / product code (SKU, EAN, catalogue number), printed as its own column.
  code: varchar("code", { length: 32 }),
  discountPercent: numeric("discount_percent", { precision: 5, scale: 2 }).notNull().default("0"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// invoice_number_sequences — tenant-scoped. One row per (tenant, year);
// legally required sequential numbering (blueprint §4, §6 step 8/9).
// ---------------------------------------------------------------------------
export const invoiceNumberSequences = pgTable(
  "invoice_number_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "restrict" }),
    // One counter per document series: "" invoices, "ZF" proformas,
    // "OD" credit notes, "NA" quotes (see invoice-numbering.util.ts).
    series: varchar("series", { length: 8 }).notNull().default(""),
    year: integer("year").notNull(),
    // 1–12 for a monthly counter (a pattern with {MM}), 0 for the yearly one.
    month: integer("month").notNull().default(0),
    lastNumber: integer("last_number").notNull().default(0),
  },
  (table) => ({
    tenantSeriesYearMonthUnique: uniqueIndex("invoice_number_sequences_tenant_series_year_month_unique").on(
      table.tenantId,
      table.series,
      table.year,
      table.month,
    ),
  }),
);

// ---------------------------------------------------------------------------
// subscription_plans — GLOBAL catalog table, not tenant-scoped, no RLS.
// Prices stored as integer minor units (halere/cents) to avoid float
// rounding issues.
// ---------------------------------------------------------------------------
export const subscriptionPlans = pgTable("subscription_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  priceCzkMinor: integer("price_czk_minor").notNull(),
  priceEurMinor: integer("price_eur_minor").notNull(),
  // null = unlimited.
  invoiceLimit: integer("invoice_limit"),
  features: jsonb("features").notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// subscription_events — tenant-scoped. Webhook idempotency log (blueprint
// §5): every Stripe/GoPay event lands here, keyed by (provider,
// provider_event_id), BEFORE any side effect is processed.
// ---------------------------------------------------------------------------
export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    provider: billingProviderEnum("provider").notNull(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    rawPayload: jsonb("raw_payload").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    providerEventUnique: uniqueIndex("subscription_events_provider_event_unique").on(
      table.provider,
      table.providerEventId,
    ),
  }),
);

// ---------------------------------------------------------------------------
// channel_links — tenant-scoped. Binds a Telegram/WhatsApp external user id
// to a tenant (blueprint §6 step 2).
// ---------------------------------------------------------------------------
export const channelLinks = pgTable(
  "channel_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    channel: channelTypeEnum("channel").notNull(),
    externalUserId: text("external_user_id"),
    // Shown in Settings → Kanály ("@username"), captured at activation.
    externalDisplayName: text("external_display_name"),
    linkingToken: text("linking_token"),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    channelExternalUserUnique: uniqueIndex(
      "channel_links_channel_external_user_unique",
    ).on(table.channel, table.externalUserId),
    linkingTokenUnique: uniqueIndex("channel_links_linking_token_unique").on(
      table.linkingToken,
    ),
  }),
);

// ---------------------------------------------------------------------------
// ares_cache — GLOBAL, not tenant-scoped, no RLS. ARES registry data is
// public and identical regardless of which tenant looked it up; caching it
// per-tenant would just multiply redundant calls against ARES's undocumented
// rate limit (blueprint §1 known gap, §6 step 7).
// ---------------------------------------------------------------------------
export const aresCache = pgTable("ares_cache", {
  ico: varchar("ico", { length: 8 }).primaryKey(),
  responsePayload: jsonb("response_payload").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// tos_versions — GLOBAL, not tenant-scoped, no RLS. One row per published
// VOP/ToS version (blueprint §9).
// ---------------------------------------------------------------------------
export const tosVersions = pgTable(
  "tos_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    version: varchar("version", { length: 32 }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    contentHash: text("content_hash").notNull(),
  },
  (table) => ({
    versionUnique: uniqueIndex("tos_versions_version_unique").on(table.version),
  }),
);

// ---------------------------------------------------------------------------
// tos_acceptances — tenant-scoped. Liability evidence trail (blueprint §9):
// every signup and every material VOP update requires a fresh, timestamped,
// logged acceptance.
// ---------------------------------------------------------------------------
export const tosAcceptances = pgTable("tos_acceptances", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  tosVersionId: uuid("tos_version_id")
    .notNull()
    .references(() => tosVersions.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  // Stored as text rather than the Postgres-native `inet` type for
  // portability across Drizzle versions in this scaffold — swap to a native
  // `inet` column later if IP-range querying is ever needed.
  ipAddress: varchar("ip_address", { length: 45 }),
});

// ---------------------------------------------------------------------------
// recurring_invoice_templates — tenant-scoped. A saved "issue an invoice
// like this every N weeks/months/quarters/years" template; a scheduler job
// (not implemented here) reads `is_active` templates whose `next_run_date`
// has arrived and creates a real draft invoice from the snapshot.
// ---------------------------------------------------------------------------
export const recurringInvoiceTemplates = pgTable("recurring_invoice_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  // Restrict, not cascade: a contact with an active recurring template
  // shouldn't be silently deletable out from under a standing billing
  // arrangement — same reasoning as `invoices.contactId`, just without the
  // 10-year legal-retention angle (this is a template, not an issued
  // document).
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "restrict" }),
  frequency: recurringFrequencyEnum("frequency").notNull(),
  // e.g. frequency=monthly, intervalCount=2 => every 2 months.
  intervalCount: integer("interval_count").notNull().default(1),
  nextRunDate: timestamp("next_run_date", { withTimezone: true, mode: "date" }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("CZK"),
  // Deliberate simplification vs. real relational `invoice_line_items`:
  // templates aren't real invoices yet (no invoice_id to hang line items
  // off), so the line-item shape is snapshotted as jsonb instead:
  // Array<{ description, quantity, unitPrice, vatRate }>. The scheduler job
  // that materializes a real invoice from this template is responsible for
  // copying these into proper `invoice_line_items` rows.
  lineItemsSnapshot: jsonb("line_items_snapshot").notNull().default(sql`'[]'::jsonb`),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// expenses — tenant-scoped incoming invoices / cost records. Like
// `invoices`, these are real accounting documents subject to CZ/SK
// retention requirements (blueprint §8), so `tenantId` uses `onDelete:
// "restrict"` rather than "cascade" for the same reason `invoices` does.
// ---------------------------------------------------------------------------
export const expenses = pgTable("expenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "restrict" }),
  // Nullable + "set null" on delete: not every expense has a matched
  // contact record (e.g. a one-off receipt from a supplier never entered as
  // a contact), and losing the contact match later shouldn't take the
  // expense record down with it — `supplierNameRaw` is the fallback.
  supplierContactId: uuid("supplier_contact_id").references(() => contacts.id, {
    onDelete: "set null",
  }),
  supplierNameRaw: text("supplier_name_raw"),
  description: text("description").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("CZK"),
  expenseDate: timestamp("expense_date", { withTimezone: true, mode: "date" }).notNull(),
  category: text("category"),
  receiptFileUrl: text("receipt_file_url"),
  // The supplier's own document number and payment details as printed on
  // the received invoice (typed in, or read by AI from a photo/PDF).
  documentNumber: varchar("document_number", { length: 64 }),
  variableSymbol: varchar("variable_symbol", { length: 10 }),
  supplierIco: varchar("supplier_ico", { length: 8 }),
  /** Supplier's DIČ — the VAT control statement (KH, B.2) lists received documents by it. */
  supplierDic: varchar("supplier_dic", { length: 14 }),
  /** CZK per 1 unit of `currency`; null for CZK (looked up from ČNB when missing). */
  exchangeRate: numeric("exchange_rate", { precision: 14, scale: 6 }),
  dueDate: timestamp("due_date", { withTimezone: true, mode: "date" }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// api_keys — tenant-scoped credentials for the public API (blueprint-
// adjacent, new surface). Only `key_prefix` (for UI identification, e.g.
// "fk_live_ab12...") and a `key_hash` are ever stored — the plaintext key is
// shown to the user exactly once at creation time and never persisted.
// ---------------------------------------------------------------------------
export const apiKeys = pgTable(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyPrefix: text("key_prefix").notNull(),
    keyHash: text("key_hash").notNull(),
    // e.g. ['invoices:write', 'invoices:read'].
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    // Soft-revocation: keys are marked revoked, never deleted, so a leaked/
    // rotated key's audit trail (name, prefix, last use) survives revocation.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => ({
    keyHashUnique: uniqueIndex("api_keys_key_hash_unique").on(table.keyHash),
  }),
);

// ---------------------------------------------------------------------------
// bank_statement_imports — tenant-scoped. One row per uploaded CSV/MT940
// bank-statement file; `bank_transactions` rows below hang off it.
// ---------------------------------------------------------------------------
export const bankStatementImports = pgTable("bank_statement_imports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  source: bankStatementSourceEnum("source").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// bank_transactions — tenant-scoped. Individual statement lines, optionally
// reconciled against an issued invoice (`matchedInvoiceId`) for automated
// payment tracking.
// ---------------------------------------------------------------------------
export const bankTransactions = pgTable("bank_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  importId: uuid("import_id")
    .notNull()
    .references(() => bankStatementImports.id, { onDelete: "cascade" }),
  transactionDate: timestamp("transaction_date", {
    withTimezone: true,
    mode: "date",
  }).notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull().default("CZK"),
  variableSymbol: text("variable_symbol"),
  counterpartyAccount: text("counterparty_account"),
  counterpartyName: text("counterparty_name"),
  // Nullable + "set null": an invoice being deleted/renumbered shouldn't
  // take the underlying bank-statement row down with it — the transaction
  // itself is a fact about the tenant's real bank account regardless of
  // reconciliation state.
  matchedInvoiceId: uuid("matched_invoice_id").references(() => invoices.id, {
    onDelete: "set null",
  }),
  status: bankTransactionStatusEnum("status").notNull().default("unmatched"),
  // Bank-side movement id (e.g. Fio "ID pohybu") for synced rows; unique per
  // tenant so a re-sync of an overlapping period inserts nothing twice.
  // Null for CSV imports.
  externalId: text("external_id"),
  /** Fee kept by the payment provider (PayPal), in `currency`. Null for bank rows. */
  fee: numeric("fee", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// bank_connections — tenant-scoped. Read-only bank API tokens (Fio for now)
// that the hourly sync uses to pull incoming payments automatically. The
// token is stored encrypted and never returned by the API.
// ---------------------------------------------------------------------------
export const bankConnections = pgTable("bank_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  provider: text("provider").$type<"fio" | "enable_banking" | "paypal">().notNull().default("fio"),
  label: text("label"),
  /** Fio API token, or PayPal `{clientId, secret, sandbox}` JSON (encrypted). Null for PSD2 connections. */
  tokenEncrypted: text("token_encrypted"),
  /** PSD2: `pending` until the bank redirects back, `expired` once consent runs out. */
  status: text("status").$type<"pending" | "active" | "expired">().notNull().default("active"),
  bankName: text("bank_name"),
  bankCountry: varchar("bank_country", { length: 2 }),
  /** PSD2: random value sent through the bank redirect, cleared once used. */
  authState: text("auth_state"),
  externalSessionId: text("external_session_id"),
  externalAccountId: text("external_account_id"),
  consentExpiresAt: timestamp("consent_expires_at", { withTimezone: true }),
  accountNumber: text("account_number"),
  enabled: boolean("enabled").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// backup_destinations — tenant-scoped, tenant-configurable APPLICATION-LEVEL
// export destinations (`src/backup-destinations/`). NOT the platform-wide
// `apps/backup` pg_dump-to-founder's-Drive sidecar (whole-database, admin-
// only, ops/disaster-recovery) — see README.md's "Per-tenant backup
// destinations" section for the full distinction between the two features.
// Each row is one destination a tenant OWNER connected for THEIR OWN data
// (queried through the normal RLS-scoped path, never a raw DB dump) to be
// periodically exported to.
// ---------------------------------------------------------------------------
export const backupDestinations = pgTable("backup_destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  type: backupDestinationTypeEnum("type").notNull(),
  schedule: backupScheduleEnum("schedule").notNull().default("weekly"),
  isActive: boolean("is_active").notNull().default(true),
  // Holds EITHER the Google Drive OAuth refresh token (type = google_drive)
  // OR the webhook HMAC secret (type = webhook) — AES-256-GCM ciphertext
  // (IV + auth tag + ciphertext, see `encryption.util.ts`), NEVER plaintext.
  // Unlike `api_keys.key_hash` (one-way — only ever needs to be *verified*),
  // this needs to be DECRYPTABLE later (a refresh token must be presented to
  // Google again; a webhook secret must be used to compute an HMAC), so a
  // one-way hash cannot substitute for encryption here — see that file's
  // doc comment for the full reasoning and `BACKUP_CONFIG_ENCRYPTION_KEY`.
  configEncrypted: text("config_encrypted"),
  // NOT secret — the destination URL itself, only used when type = webhook.
  webhookUrl: text("webhook_url"),
  // NOT secret — only used when type = google_drive.
  googleDriveFolderId: text("google_drive_folder_id"),
  // type = sftp: where to upload. Auth is the generated key in
  // `config_encrypted` (its public half below, to paste into authorized_keys)
  // or a password stored there instead. The host key fingerprint is pinned on
  // the first successful connection, later mismatches fail the run.
  sftpHost: text("sftp_host"),
  sftpPort: integer("sftp_port"),
  sftpUsername: text("sftp_username"),
  sftpPath: text("sftp_path"),
  sftpPublicKey: text("sftp_public_key"),
  sftpHostFingerprint: text("sftp_host_fingerprint"),
  // Optional age encryption of uploaded files: a public key (`age1…`, only the
  // company can decrypt) or a passphrase (AES-GCM encrypted like the secrets).
  encryptionRecipient: text("encryption_recipient"),
  encryptionPassphraseEncrypted: text("encryption_passphrase_encrypted"),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  // e.g. "success", or an error message string when the last run failed —
  // see `backup_runs` below for the full per-run history/audit trail this
  // single column can't hold on its own.
  lastRunStatus: text("last_run_status"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// backup_runs — tenant-scoped history log, one row per export attempt
// (scheduled or manual "run now"), so a tenant can see their own export
// history/troubleshoot a failure rather than only ever seeing the single
// latest status on `backup_destinations.last_run_status`.
// ---------------------------------------------------------------------------
export const backupRuns = pgTable("backup_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  destinationId: uuid("destination_id")
    .notNull()
    .references(() => backupDestinations.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
  // How many invoices/contacts/etc. rows were included in the export bundle
  // — for the tenant's own visibility, not enforced/validated against
  // anything.
  recordCount: integer("record_count"),
});

// ---------------------------------------------------------------------------
// invoice_templates — tenant-scoped reusable invoice blueprints ("Monthly
// retainer", "Website maintenance"…). Optional default customer; line items
// snapshotted as jsonb like recurring_invoice_templates. Used from the
// template gallery, dashboard tiles, `?template=` on the form, and bulk
// invoicing (one draft per chosen customer).
// ---------------------------------------------------------------------------
export const invoiceTemplates = pgTable("invoice_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  // An emoji shown on the gallery card.
  icon: varchar("icon", { length: 16 }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  documentType: documentTypeEnum("document_type").notNull().default("invoice"),
  currency: varchar("currency", { length: 3 }).notNull().default("CZK"),
  dueInDays: integer("due_in_days"),
  paymentMethod: paymentMethodEnum("payment_method").notNull().default("bank_transfer"),
  noteAbove: text("note_above"),
  noteBelow: text("note_below"),
  // Array<{ description, quantity, unit, unitPrice, vatRate, discountPercent }>
  lineItems: jsonb("line_items").notNull().default(sql`'[]'::jsonb`),
  usageCount: integer("usage_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// tenant_invitations — tenant-scoped. An owner/admin invites someone (e.g.
// their accountant) by email; only a sha256 of the emailed token is stored.
// Accepting happens before the invitee has any membership, so it goes
// through the SECURITY DEFINER `accept_tenant_invitation` (rls-policies.sql).
// ---------------------------------------------------------------------------
export const tenantInvitations = pgTable(
  "tenant_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: tenantRoleEnum("role").notNull().default("accountant"),
    // Copied onto the membership when accepted.
    permissions: jsonb("permissions"),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenHashUnique: uniqueIndex("tenant_invitations_token_hash_unique").on(table.tokenHash),
  }),
);

// ---------------------------------------------------------------------------
// outbound_emails — one row per e-mail sent to a customer (invoice, reminder),
// counted for the daily sending caps in `abuse/sending-guard.ts`. Tenant-scoped.
// ---------------------------------------------------------------------------
export const outboundEmails = pgTable("outbound_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  recipient: text("recipient").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// abuse_reports — recipients flagging a document as fraudulent/unexpected via
// the client portal. No app-role policy: written only by the SECURITY DEFINER
// `report_invoice_abuse()`, reviewed by the operator.
// ---------------------------------------------------------------------------
export const abuseReports = pgTable("abuse_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  reason: text("reason").notNull(),
  message: text("message"),
  reporterEmail: text("reporter_email"),
  reporterBucket: text("reporter_bucket").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

// ---------------------------------------------------------------------------
// projects / time_entries — time tracking (Invoice Ninja's projects and
// tasks, Fakturoid's timer). Tenant-scoped. A running timer is an entry
// without `endedAt`; billed entries point at the invoice they went on.
// ---------------------------------------------------------------------------
export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  hourlyRate: numeric("hourly_rate", { precision: 14, scale: 2 }),
  currency: varchar("currency", { length: 3 }).notNull().default("CZK"),
  color: varchar("color", { length: 16 }),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One Stripe Checkout attempt from the invoice link (`card-payments` module). */
export const cardPaymentSessions = pgTable("card_payment_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 16 }).notNull().default("stripe"),
  sessionId: text("session_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  status: varchar("status", { length: 16 }).$type<"open" | "paid" | "expired">().notNull().default("open"),
  /** Kept by Stripe, in the invoice currency (null when unknown). */
  fee: numeric("fee", { precision: 14, scale: 2 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export const timeEntries = pgTable("time_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  description: text("description").notNull().default(""),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  endedAt: timestamp("ended_at", { withTimezone: true }),
  minutes: integer("minutes").notNull().default(0),
  // Overrides the project's rate; null = the project's.
  hourlyRate: numeric("hourly_rate", { precision: 14, scale: 2 }),
  billable: boolean("billable").notNull().default(true),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One audited change; see migrations/0038_audit_log.sql (append-only, actor from the request). */
export type AuditChange = { field: string; from: unknown; to: unknown };

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    // Filled by the column default from `app.current_user_id`; never set by the app.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    actor: varchar("actor", { length: 40 }).notNull().default(sql`coalesce(nullif(current_setting('app.current_actor', true), ''), 'system')`),
    entityType: varchar("entity_type", { length: 40 }).notNull(),
    entityId: uuid("entity_id"),
    entityLabel: text("entity_label"),
    action: varchar("action", { length: 40 }).notNull(),
    changes: jsonb("changes").$type<AuditChange[]>().notNull().default([]),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Indexes (tenant + time, tenant + entity) live in the migration.
);
