import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z, type ZodTypeAny } from "zod";
import * as schema from "../../drizzle/schema";
import { apiKeyAllowsMethod } from "../api-keys/api-key.util";
import { assertSubscriptionActive } from "../billing/require-active-subscription.guard";
import type { BankReconciliationService } from "../bank-reconciliation/bank-reconciliation.service";
import { listBankTransactionsQuerySchema } from "../bank-reconciliation/dto/list-transactions-query.dto";
import type { ContactsService } from "../contacts/contacts.service";
import { aresLookupSchema } from "../contacts/dto/ares-lookup.dto";
import { createContactSchema } from "../contacts/dto/create-contact.dto";
import { updateContactSchema } from "../contacts/dto/update-contact.dto";
import type { DashboardService } from "../dashboard/dashboard.service";
import { createExpenseSchema } from "../expenses/dto/create-expense.dto";
import type { ExpensesService } from "../expenses/expenses.service";
import type { InvoiceTemplatesService } from "../invoice-templates/invoice-templates.service";
import { createInvoiceSchema, invoiceFieldsSchema, listInvoicesQuerySchema, updateInvoiceSchema } from "../invoices/dto/create-invoice.dto";
import { assertInvoiceOpen, maskLockedRow } from "../invoices/invoice-lock";
import type { InvoicesService } from "../invoices/invoices.service";
import { ISSUABLE_STATUSES } from "../invoices/invoices.service";
import { roleMayAccess } from "../tenancy/role-access.guard";
import type { AuthenticatedUser } from "../tenancy/tenant-context.middleware";
import { updateTenantSchema } from "../tenants/dto/update-tenant.dto";
import { invoiceFormPrefsSchema, reminderPrefsOf } from "../tenants/invoice-form-prefs";
import { numberFormatsInputSchema } from "../tenants/number-formats";
import type { TenantsService } from "../tenants/tenants.service";
import { toInputSchema } from "./mcp-json-schema";

type TenantDb = PostgresJsDatabase<typeof schema>;

export interface McpServices {
  tenants: TenantsService;
  invoices: InvoicesService;
  contacts: ContactsService;
  expenses: ExpensesService;
  bank: BankReconciliationService;
  templates: InvoiceTemplatesService;
  dashboard: DashboardService;
}

export interface McpContext {
  db: TenantDb;
  user: AuthenticatedUser;
  services: McpServices;
}

export interface McpTool {
  name: string;
  description: string;
  /** Needs a read+write key. Read-only keys don't see the tool in tools/list. */
  write: boolean;
  input: ZodTypeAny;
  /**
   * The REST route the tool stands in for. `roleMayAccess` checks it with
   * the same rules `RoleAccessGuard` applies to that route, so a tool never
   * lets a key do what the dashboard wouldn't let the same role do.
   */
  rest: { method: "GET" | "POST" | "PATCH" | "PUT"; path: string };
  /** Runs on the raw arguments before validation, for refusals that need a clearer error than "unknown field". */
  refuse?(args: unknown): void;
  run(ctx: McpContext, args: any): Promise<unknown>;
}

/**
 * Settings an AI assistant must not change, even with a read+write key: a
 * changed bank account (or the payment methods and instructions printed
 * next to it) redirects customers' money, and the company e-mail is the
 * reply-to and copy address of every invoice e-mail. Changing either is a
 * person's decision in the dashboard, where it also raises the bank-change
 * alert. API keys, team, billing and webhooks have no tool at all.
 */
export const DASHBOARD_ONLY_COMPANY_FIELDS = [
  "bank_account_number",
  "bank_account_bank_code",
  "bank_account_iban",
  "bank_account_swift",
  "email",
  "email_prefs",
  "payment_methods",
  "template_vars",
  "public_profile",
  "enabled_modules",
  "invoice_form_prefs",
] as const;

/** 403 `dashboard_only` naming the fields, before validation would only call them unknown. */
export function refuseDashboardOnly(args: unknown, fields: readonly string[], where: string) {
  if (!args || typeof args !== "object") return;
  const blocked = Object.keys(args).filter((k) => fields.includes(k));
  if (blocked.length === 0) return;
  throw new ForbiddenException({
    error: "dashboard_only",
    fields: blocked,
    message: `${blocked.join(", ")} can't be changed through an API key or an AI assistant. Change it in the Billanta dashboard (${where}).`,
  });
}

/** The tool's scope check: a read tool works like a GET, a write tool like a POST. */
export const mcpToolAllowed = (scopes: readonly string[] | undefined, tool: Pick<McpTool, "write">) =>
  apiKeyAllowsMethod(scopes ?? [], tool.write ? "POST" : "GET");

/** Same check as RoleAccessGuard on the tool's REST route (see `McpTool.rest`). */
export const mcpRoleAllowed = (user: AuthenticatedUser, tool: McpTool, args: unknown) =>
  roleMayAccess(user.role, tool.rest.method, tool.rest.path, user.permissions, tool.rest.path === "v1/tenants/me" ? args : undefined);

/** Customer links and other secrets that the assistant has no use for. */
const SECRET_KEYS = new Set(["publicToken", "publicKey", "portalToken", "buyerDetailsToken", "feedToken"]);

export function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [key, v] of Object.entries(value)) {
    if (SECRET_KEYS.has(key) || key.endsWith("Encrypted")) continue;
    // The partner split is "Po zdanění" data, owner/admin only (withoutSplit in invoices.controller.ts).
    out[key] = key === "partnerShares" ? null : scrub(v);
  }
  return out;
}

const uuid = z.string().uuid();
const idInput = z.object({ id: uuid }).strict();
const page = { limit: z.number().int().min(1).max(200).default(50), offset: z.number().int().min(0).default(0) };

const COMPANY_FIELDS = [
  "companyName",
  "legalName",
  "ico",
  "dic",
  "country",
  "homeCurrency",
  "vatStatus",
  "taxAdvances",
  "flatTaxRegime",
  "activityKind",
  "secondaryActivityFrom",
  "secondaryActivityTo",
  "addressStreet",
  "addressCity",
  "addressPostalCode",
  "addressCountry",
  "bankAccountNumber",
  "bankAccountBankCode",
  "bankAccountIban",
  "bankAccountSwift",
  "email",
  "phone",
  "website",
  "registryNote",
  "dataBoxId",
  "taxOffice",
  "taxWorkplace",
  "healthInsurer",
  "socialOffice",
  "residenceStreet",
  "residenceCity",
  "residencePostalCode",
  "filingEmail",
  "filingPhone",
  "defaultLocale",
  "defaultDueDays",
  "defaultPaymentMethod",
  "defaultNoteBelow",
  "buyerDetailsRequired",
  "subscriptionStatus",
  "countryLocked",
  "hasLogo",
] as const;

async function companySettings(ctx: McpContext) {
  const [tenant] = await ctx.services.tenants.findById(ctx.db, ctx.user.tenantId);
  if (!tenant) throw new NotFoundException("tenant_not_found");
  const row = tenant as Record<string, unknown>;
  return Object.fromEntries(COMPANY_FIELDS.map((k) => [k, row[k] ?? null]));
}

// dic_vat_payer is the legacy twin of vat_status.
const companyUpdateSchema = updateTenantSchema
  .omit({
    ...(Object.fromEntries(DASHBOARD_ONLY_COMPANY_FIELDS.map((k) => [k, true])) as Record<(typeof DASHBOARD_ONLY_COMPANY_FIELDS)[number], true>),
    dic_vat_payer: true,
  })
  .strict();

/** Fields of Settings → Invoices an assistant may set; the rest (links, branding, exchange rates, default ids) stay in the dashboard. */
const invoicePrefsInput = invoiceFormPrefsSchema
  .innerType()
  .pick({
    reminders_enabled: true,
    reminder_interval_days: true,
    reminder_max: true,
    pdf_accent: true,
    pdf_second_language: true,
    pdf_qr: true,
    pdf_qr_due_date: true,
    default_issue_place: true,
    default_issued_by: true,
    default_currency: true,
    default_note_above: true,
    prices_include_vat: true,
  })
  .partial();
const PREF_KEYS: Record<keyof z.infer<typeof invoicePrefsInput>, string> = {
  reminders_enabled: "remindersEnabled",
  reminder_interval_days: "reminderIntervalDays",
  reminder_max: "reminderMax",
  pdf_accent: "pdfAccent",
  pdf_second_language: "pdfSecondLanguage",
  pdf_qr: "pdfQr",
  pdf_qr_due_date: "pdfQrDueDate",
  default_issue_place: "defaultIssuePlace",
  default_issued_by: "defaultIssuedBy",
  default_currency: "defaultCurrency",
  default_note_above: "defaultNoteAbove",
  prices_include_vat: "pricesIncludeVat",
};
const invoiceSettingsInput = invoicePrefsInput
  .extend(updateTenantSchema.pick({ default_due_days: true, default_payment_method: true, default_note_below: true, default_locale: true }).shape)
  .strict();

// Drafts over MCP: no sealed (Důvěrný režim) envelopes, no "already paid", no printed payment instructions.
const mcpLineItem = invoiceFieldsSchema.shape.line_items.element.omit({ enc_amounts: true });
const draftFields = invoiceFieldsSchema.omit({ enc_amounts: true, amount_paid: true, payment_instructions: true }).extend({
  line_items: z.array(mcpLineItem).min(1).max(200),
});
const createDraftInput = draftFields.strict();
const updateDraftInput = draftFields.partial().extend({ id: uuid }).strict();

const listInvoicesInput = listInvoicesQuerySchema
  .pick({ type: true, status: true, contact_id: true, q: true, date_field: true, from: true, to: true, paid_state: true, overdue_days: true, currency: true })
  .extend(page)
  .strict();

const expenseInput = createExpenseSchema.omit({ paidAt: true, receiptFileUrl: true }).strict();

export const MCP_TOOLS: McpTool[] = [
  // --- Company and invoice settings ------------------------------------------------
  {
    name: "get_company_settings",
    description: "The company's details printed on invoices: name, IČO/DIČ, VAT status, address, bank account, tax office, invoice defaults.",
    write: false,
    input: z.object({}).strict(),
    rest: { method: "GET", path: "v1/tenants/me" },
    run: (ctx) => companySettings(ctx),
  },
  {
    name: "update_company_settings",
    description:
      "Change company details (snake_case fields, only the ones sent change). Bank account, company e-mail, payment methods and the public profile can only be changed in the dashboard.",
    write: true,
    input: companyUpdateSchema,
    rest: { method: "PATCH", path: "v1/tenants/me" },
    refuse: (args) => refuseDashboardOnly(args, DASHBOARD_ONLY_COMPANY_FIELDS, "Settings → Company"),
    async run(ctx, args) {
      // The role check is TenantsService.update's own, the one Settings → Company goes through.
      await ctx.services.tenants.update(ctx.db, ctx.user.tenantId, ctx.user, args);
      return companySettings(ctx);
    },
  },
  {
    name: "list_bank_accounts",
    description: "The company's extra bank accounts (the main one is in get_company_settings). Read-only.",
    write: false,
    input: z.object({}).strict(),
    rest: { method: "GET", path: "v1/tenants/me/bank-accounts" },
    run: (ctx) => ctx.services.tenants.listBankAccounts(ctx.db, ctx.user.tenantId),
  },
  {
    name: "get_invoice_settings",
    description: "Invoice numbering formats and next numbers, reminder settings, PDF options and defaults for new invoices.",
    write: false,
    input: z.object({}).strict(),
    rest: { method: "GET", path: "v1/tenants/me/number-formats" },
    async run(ctx) {
      const [tenant] = await ctx.services.tenants.findById(ctx.db, ctx.user.tenantId);
      if (!tenant) throw new NotFoundException("tenant_not_found");
      const prefs = (tenant.invoiceFormPrefs ?? {}) as Record<string, unknown>;
      const reminders = reminderPrefsOf(prefs);
      return {
        numberFormats: await ctx.services.tenants.getNumberFormats(ctx.db, ctx.user.tenantId, ctx.user),
        reminders_enabled: reminders.enabled,
        reminder_interval_days: reminders.intervalDays,
        reminder_max: reminders.max,
        ...Object.fromEntries(
          Object.entries(PREF_KEYS)
            .filter(([snake]) => !snake.startsWith("reminder"))
            .map(([snake, camel]) => [snake, prefs[camel] ?? null]),
        ),
        default_due_days: tenant.defaultDueDays,
        default_payment_method: tenant.defaultPaymentMethod,
        default_note_below: tenant.defaultNoteBelow,
        default_locale: tenant.defaultLocale,
      };
    },
  },
  {
    name: "update_invoice_settings",
    description:
      "Change reminder settings (reminders_enabled, reminder_interval_days, reminder_max), PDF options and defaults for new invoices. Only the fields sent change.",
    write: true,
    input: invoiceSettingsInput,
    rest: { method: "PATCH", path: "v1/tenants/me" },
    async run(ctx, args: z.infer<typeof invoiceSettingsInput>) {
      const { default_due_days, default_payment_method, default_note_below, default_locale, ...prefInput } = args;
      const patch: Record<string, unknown> = { default_due_days, default_payment_method, default_note_below, default_locale };
      const sent = Object.keys(prefInput).filter((k) => (prefInput as Record<string, unknown>)[k] !== undefined) as (keyof typeof PREF_KEYS)[];
      if (sent.length > 0) {
        // invoice_form_prefs is saved as a whole object: merge the sent fields onto the stored one.
        const [tenant] = await ctx.services.tenants.findById(ctx.db, ctx.user.tenantId);
        const stored = (tenant?.invoiceFormPrefs as Record<string, unknown> | null) ?? invoiceFormPrefsSchema.parse({});
        const parsed = invoiceFormPrefsSchema.parse(prefInput) as Record<string, unknown>;
        patch.invoice_form_prefs = { ...stored, ...Object.fromEntries(sent.map((k) => [PREF_KEYS[k], parsed[PREF_KEYS[k]]])) };
      }
      await ctx.services.tenants.update(ctx.db, ctx.user.tenantId, ctx.user, patch as never);
      return MCP_TOOLS.find((t) => t.name === "get_invoice_settings")!.run(ctx, {});
    },
  },
  {
    name: "update_number_formats",
    description:
      "Set invoice numbering per document type (invoice, proforma, credit_note, quote): formats {type: pattern or null for the built-in one}, nextNumbers {type: number}.",
    write: true,
    input: numberFormatsInputSchema.strict(),
    rest: { method: "PUT", path: "v1/tenants/me/number-formats" },
    run: (ctx, args) => ctx.services.tenants.updateNumberFormats(ctx.db, ctx.user.tenantId, ctx.user, args),
  },
  {
    name: "list_invoice_templates",
    description: "Saved invoice templates (customer, items and terms to start a draft from).",
    write: false,
    input: z.object({}).strict(),
    rest: { method: "GET", path: "v1/invoice-templates" },
    run: (ctx) => ctx.services.templates.list(ctx.db),
  },

  // --- Contacts --------------------------------------------------------------------
  {
    name: "list_contacts",
    description: "Customers and suppliers. q filters by name, IČO, DIČ or e-mail.",
    write: false,
    input: z.object({ q: z.string().trim().max(100).optional(), ...page }).strict(),
    rest: { method: "GET", path: "v1/contacts" },
    async run(ctx, args: { q?: string; limit: number; offset: number }) {
      const q = args.q?.toLowerCase();
      const rows = (await ctx.services.contacts.list(ctx.db)).filter(
        (c) => !q || [c.legalName, c.ico, c.dic, c.email].some((v) => typeof v === "string" && v.toLowerCase().includes(q)),
      );
      return { total: rows.length, contacts: scrub(rows.slice(args.offset, args.offset + args.limit)) };
    },
  },
  {
    name: "get_contact",
    description: "One contact by id.",
    write: false,
    input: idInput,
    rest: { method: "GET", path: "v1/contacts/id" },
    run: async (ctx, args) => scrub(await ctx.services.contacts.findOne(ctx.db, args.id)),
  },
  {
    name: "lookup_company",
    description: "Look up a company by IČO in the business register (ARES for CZ, RPO for SK). Returns the details to create a contact with.",
    write: false,
    input: aresLookupSchema.omit({ transient: true }).strict(),
    rest: { method: "GET", path: "v1/contacts/search" },
    run: (ctx, args) => ctx.services.contacts.lookupById(args.ico, args.country),
  },
  {
    name: "create_contact",
    description: "Create a contact (camelCase fields, legalName required). An IČO that is already saved returns the existing contact.",
    write: true,
    input: createContactSchema.strict(),
    rest: { method: "POST", path: "v1/contacts" },
    run: async (ctx, args) => scrub(await ctx.services.contacts.create(ctx.db, ctx.user.tenantId, args)),
  },
  {
    name: "update_contact",
    description: "Change a contact; only the fields sent change, null clears an optional one.",
    write: true,
    input: updateContactSchema.extend({ id: uuid }).strict(),
    rest: { method: "PATCH", path: "v1/contacts/id" },
    async run(ctx, { id, ...dto }) {
      return scrub(await ctx.services.contacts.update(ctx.db, id, dto));
    },
  },

  // --- Invoices: drafts only ----------------------------------------------------------
  {
    name: "list_invoices",
    description: "Invoices, proformas, credit notes and quotes, newest first. Dates are YYYY-MM-DD.",
    write: false,
    input: listInvoicesInput,
    rest: { method: "GET", path: "v1/invoices" },
    async run(ctx, { limit, offset, ...query }) {
      const rows = await ctx.services.invoices.list(ctx.db, query, ctx.user.tenantId);
      return { total: rows.length, invoices: scrub(rows.slice(offset, offset + limit).map((r) => maskLockedRow(r, ctx.user))) };
    },
  },
  {
    name: "get_invoice",
    description: "One document with customer, line items, VAT summary and linked documents.",
    write: false,
    input: idInput,
    rest: { method: "GET", path: "v1/invoices/id/detail" },
    async run(ctx, args) {
      await assertInvoiceOpen(ctx.db, args.id, ctx.user);
      return scrub(await ctx.services.invoices.detail(ctx.db, args.id));
    },
  },
  {
    name: "create_invoice_draft",
    description:
      "Create a draft for review (status pending_review, no number). It is not issued or sent: a person checks and issues it in the Billanta dashboard. issue_date and due_date are YYYY-MM-DD.",
    write: true,
    input: createDraftInput,
    rest: { method: "POST", path: "v1/invoices" },
    async run(ctx, args) {
      // Same gate as POST /v1/invoices (RequireActiveSubscription).
      await assertSubscriptionActive(ctx.db, ctx.user.tenantId);
      const dto = createInvoiceSchema.parse(args);
      const invoice = await ctx.services.invoices.create(ctx.db, ctx.user.tenantId, dto, "api", null, { review: "mcp" });
      return scrub(await ctx.services.invoices.detail(ctx.db, invoice.id));
    },
  },
  {
    name: "update_invoice_draft",
    description: "Change a draft that is not issued yet; line_items, when sent, replaces all items. Issued documents can't be changed here.",
    write: true,
    input: updateDraftInput,
    rest: { method: "PATCH", path: "v1/invoices/id" },
    async run(ctx, { id, ...fields }) {
      const [row] = await ctx.db.select({ status: schema.invoices.status }).from(schema.invoices).where(eq(schema.invoices.id, id)).limit(1);
      if (!row) throw new NotFoundException("invoice_not_found");
      if (!ISSUABLE_STATUSES.includes(row.status)) throw new ForbiddenException("invoice_not_draft");
      await assertInvoiceOpen(ctx.db, id, ctx.user);
      await ctx.services.invoices.update(ctx.db, ctx.user.tenantId, id, updateInvoiceSchema.parse(fields));
      return scrub(await ctx.services.invoices.detail(ctx.db, id));
    },
  },

  // --- Expenses, bank, reports -------------------------------------------------------
  {
    name: "list_expenses",
    description: "Expenses (received invoices and costs), newest first. page is 1-based.",
    write: false,
    input: z.object({ page: z.number().int().positive().default(1), limit: z.number().int().positive().max(100).default(20) }).strict(),
    rest: { method: "GET", path: "v1/expenses" },
    run: (ctx, args) => ctx.services.expenses.list(ctx.db, args),
  },
  {
    name: "get_expense",
    description: "One expense by id.",
    write: false,
    input: idInput,
    rest: { method: "GET", path: "v1/expenses/id" },
    run: (ctx, args) => ctx.services.expenses.findOne(ctx.db, args.id),
  },
  {
    name: "create_expense",
    description:
      "Record an expense (camelCase fields; expenseDate and dueDate are YYYY-MM-DD). It is saved as needing review and unpaid; a person confirms it in the dashboard.",
    write: true,
    input: expenseInput,
    rest: { method: "POST", path: "v1/expenses" },
    run: (ctx, args) => ctx.services.expenses.create(ctx.db, ctx.user.tenantId, createExpenseSchema.parse(args), { needsReview: true }),
  },
  {
    name: "list_bank_transactions",
    description: "Bank transactions from connected accounts. status: unmatched, matched or ignored. Read-only.",
    write: false,
    input: listBankTransactionsQuerySchema.extend(page).strict(),
    rest: { method: "GET", path: "v1/bank-reconciliation/transactions" },
    async run(ctx, { status, invoiceId, limit, offset }) {
      const rows = await ctx.services.bank.list(ctx.db, status, invoiceId);
      return { total: rows.length, transactions: scrub(rows.slice(offset, offset + limit)) };
    },
  },
  {
    name: "get_dashboard_summary",
    description: "Overview: revenue, unpaid and overdue totals, documents due soon and recent activity.",
    write: false,
    input: z.object({}).strict(),
    rest: { method: "GET", path: "v1/dashboard/summary" },
    run: async (ctx) => scrub(await ctx.services.dashboard.summary(ctx.db, ctx.user.tenantId)),
  },
];

export const mcpToolByName = (name: string) => MCP_TOOLS.find((t) => t.name === name);

/** tools/list entries, without the tools this key's scope can't call. */
export function listMcpTools(scopes: readonly string[] | undefined) {
  return MCP_TOOLS.filter((t) => mcpToolAllowed(scopes, t)).map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: toInputSchema(t.input),
    annotations: { readOnlyHint: !t.write, destructiveHint: false },
  }));
}
