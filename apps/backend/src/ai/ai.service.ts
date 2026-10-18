import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Optional,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from "@nestjs/common";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { eq, ilike, or } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod/v4";
import * as schema from "../../drizzle/schema";
import { decryptSecret, encryptSecret } from "../backup-destinations/encryption.util";
import { ContactsService } from "../contacts/contacts.service";
import { DbService } from "../db/db.service";
import { demoConfig } from "../demo/demo-config";
import type { AresContactPrefill } from "../contacts/ares-mapper.util";
import type { DashboardRole } from "../tenancy/tenant-context.middleware";
import type { UpdateAiSettingsDto } from "./dto/update-ai-settings.dto";

type TenantDb = PostgresJsDatabase<typeof schema>;
type AiMode = (typeof schema.aiModeEnum.enumValues)[number];

/** Overridable per deployment; the default is Anthropic's recommended model. */
const MODEL = process.env.AI_MODEL ?? "claude-opus-5";
/** Fair-use cap for Billanta's own key, per tenant per UTC day. Own-key tenants are not capped. */
const PLATFORM_DAILY_LIMIT = Number(process.env.AI_PLATFORM_DAILY_LIMIT ?? 50);
const MAX_INPUT_CHARS = 4000;
const SETTINGS_ROLES: ReadonlyArray<DashboardRole | "service"> = ["owner", "admin"];

/**
 * What the model returns for "describe the invoice in your own words".
 * Nullable rather than optional fields: the model must say "unknown"
 * explicitly instead of inventing a value, and the form leaves those
 * fields for the person to fill.
 */
const InvoiceSuggestionSchema = z.object({
  customer: z.object({
    ico: z.string().nullable().describe("8-digit Czech/Slovak company ID (IČO) if the text states one, else null"),
    name: z.string().nullable().describe("Customer company or person name as written, else null"),
  }),
  items: z
    .array(
      z.object({
        description: z.string(),
        quantity: z.number(),
        unit_price: z.number().describe("Price per unit WITHOUT VAT, in the invoice currency"),
        vat_rate: z.number().nullable().describe("VAT percent (21, 12, 0) if stated or clearly implied, else null"),
      }),
    )
    .describe("Billable line items; empty if the text names none"),
  currency: z.enum(["CZK", "EUR", "USD", "GBP", "PLN"]),
  due_in_days: z.number().nullable().describe("Payment term in days if stated (e.g. 'splatnost 14 dní' -> 14), else null"),
  issue_date: z.string().nullable().describe("Issue date as YYYY-MM-DD if stated, else null"),
});
export type InvoiceSuggestion = z.infer<typeof InvoiceSuggestionSchema>;

export interface InvoiceSuggestionResult {
  suggestion: InvoiceSuggestion;
  /** An existing contact of this tenant that matches the suggested customer. */
  contact: typeof schema.contacts.$inferSelect | null;
  /** ARES record for the suggested IČO when no saved contact matched. */
  ares: AresContactPrefill | null;
}

const SYSTEM_PROMPT = `You turn a short, informal description of an invoice into structured fields for a Czech/Slovak invoicing app.
The user writes in Czech, Slovak or English, often tersely ("faktura pro 27604977, 3 hodiny konzultace po 1500, splatnost 14 dní").
Only extract what the text says or unambiguously implies. When a field is not given, return null for it; never invent customers, IDs, prices or dates.
Amounts: numbers only, no currency symbols; unit prices exclude VAT unless the text clearly says the amount includes VAT, in which case convert to the price without VAT.
Default currency is CZK unless the text indicates another (e.g. "€", "eur").
The person reviews every field before anything is saved, so leaving a field empty is always better than guessing.`;

/** What the model reads off a received invoice / receipt (photo or PDF). */
const ReceiptSchema = z.object({
  supplier: z.object({
    name: z.string().nullable().describe("Supplier (seller) company or person name, else null"),
    ico: z.string().nullable().describe("Supplier's 8-digit IČO if printed, else null"),
    dic: z.string().nullable().describe("Supplier's DIČ / VAT ID if printed (e.g. CZ12345678), else null"),
  }),
  document_number: z.string().nullable().describe("The supplier's invoice / receipt number, else null"),
  variable_symbol: z.string().nullable().describe("Variabilní symbol (digits only) if printed, else null"),
  issue_date: z.string().nullable().describe("Issue date or DUZP as YYYY-MM-DD, else null"),
  due_date: z.string().nullable().describe("Due date as YYYY-MM-DD if printed, else null"),
  total_amount: z.number().nullable().describe("Total amount to pay INCLUDING VAT, else null"),
  vat_rate: z
    .number()
    .nullable()
    .describe("The main VAT percent (21, 12, 0); when several rates appear, the one covering most of the total; else null"),
  currency: z.enum(["CZK", "EUR", "USD", "GBP", "PLN"]),
  description: z.string().nullable().describe("A short Czech description of what was bought (max ~80 chars)"),
  category: z
    .enum(["material", "services", "software", "travel", "fuel", "office", "telecom", "rent", "marketing", "other"])
    .nullable()
    .describe("Best-fitting expense category, else null"),
  already_paid: z.boolean().describe("True for a till receipt or a document marked as paid (\"uhrazeno\", card payment)"),
});
export type ReceiptSuggestion = z.infer<typeof ReceiptSchema>;

const RECEIPT_PROMPT = `You read a received invoice or receipt (Czech, Slovak or other) from a photo or PDF and extract fields for an expense record in a Czech/Slovak invoicing app.
The SUPPLIER is the business that issued the document (dodavatel / prodávající), not the customer (odběratel).
Only extract what is printed. When a field is missing or illegible, return null; never invent IDs, amounts or dates.
Amounts: numbers only, no currency symbols. The person reviews every field before anything is saved.`;

export const RECEIPT_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"] as const;
export type ReceiptMediaType = (typeof RECEIPT_MEDIA_TYPES)[number];

@Injectable()
export class AiService {
  private readonly usage = new Map<string, { day: string; count: number }>();

  constructor(
    private readonly contactsService: ContactsService,
    @Optional() private readonly dbService?: DbService,
  ) {}

  get platformAvailable(): boolean {
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  }

  async getSettings(db: TenantDb, tenantId: string) {
    const tenant = await this.loadTenant(db, tenantId);
    return {
      mode: tenant.aiMode,
      hasOwnKey: Boolean(tenant.aiApiKeyEncrypted),
      ownKeyLast4: tenant.aiApiKeyLast4,
      platformAvailable: this.platformAvailable,
      platformDailyLimit: PLATFORM_DAILY_LIMIT,
      model: MODEL,
    };
  }

  /**
   * Owner/admin only. A new own key is checked against the API before it is
   * stored, so a typo fails here rather than on the first suggestion.
   * `apiKey: null` removes the stored key.
   */
  async updateSettings(db: TenantDb, tenantId: string, role: DashboardRole | "service", dto: UpdateAiSettingsDto) {
    if (!SETTINGS_ROLES.includes(role)) {
      throw new ForbiddenException("Only an owner or admin can change AI settings");
    }
    const tenant = await this.loadTenant(db, tenantId);
    const patch: Partial<typeof schema.tenants.$inferInsert> = { updatedAt: new Date() };

    if (dto.apiKey === null) {
      patch.aiApiKeyEncrypted = null;
      patch.aiApiKeyLast4 = null;
    } else if (typeof dto.apiKey === "string") {
      const key = dto.apiKey.trim();
      await this.verifyKey(key);
      patch.aiApiKeyEncrypted = encryptSecret(key, encryptionKey());
      patch.aiApiKeyLast4 = key.slice(-4);
    }

    if (dto.mode) {
      const willHaveKey = patch.aiApiKeyEncrypted !== undefined ? Boolean(patch.aiApiKeyEncrypted) : Boolean(tenant.aiApiKeyEncrypted);
      if (dto.mode === "own" && !willHaveKey) {
        throw new BadRequestException({ error: "ai_key_missing", message: "Add your API key before switching to it" });
      }
      patch.aiMode = dto.mode;
    } else if (dto.apiKey === null && tenant.aiMode === "own") {
      patch.aiMode = "platform";
    }

    await db.update(schema.tenants).set(patch).where(eq(schema.tenants.id, tenantId));
    return this.getSettings(db, tenantId);
  }

  /**
   * Free text -> invoice form fields. Never saves anything: the result only
   * pre-fills the dashboard form, which the person reviews and submits
   * (same human-in-the-loop rule as the voice pipeline, blueprint §6/§9).
   */
  async suggestInvoice(db: TenantDb, tenantId: string, text: string): Promise<InvoiceSuggestionResult> {
    const input = text.trim().slice(0, MAX_INPUT_CHARS);
    if (!input) {
      throw new BadRequestException({ error: "empty_input" });
    }
    const tenant = await this.loadTenant(db, tenantId);
    const client = this.clientFor(tenant.id, tenant.aiMode, tenant.aiApiKeyEncrypted);
    if (tenant.isDemo) await this.consumeDemoQuota(tenant.id);

    const today = new Date().toISOString().slice(0, 10);
    const context = `Today is ${today}. The issuing business is ${tenant.dicVatPayer ? "a VAT payer" : "NOT a VAT payer, so vat_rate must be null"}.`;

    let parsed: InvoiceSuggestion | null;
    try {
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(InvoiceSuggestionSchema) },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `${context}\n\n<invoice_description>\n${input}\n</invoice_description>` }],
      });
      if (response.stop_reason === "refusal") {
        throw new UnprocessableEntityException({ error: "ai_refused" });
      }
      parsed = response.parsed_output;
    } catch (error) {
      throw mapAnthropicError(error, tenant.aiMode);
    }
    if (!parsed) {
      throw new UnprocessableEntityException({ error: "ai_unparseable" });
    }

    const { contact, ares } = await this.matchCustomer(db, parsed.customer);
    return { suggestion: parsed, contact, ares };
  }

  /**
   * Same as suggestInvoice, for the public "invoice without an account"
   * page: no tenant, always Billanta's key, no saved contacts to match —
   * only an ARES prefill for a stated IČO. The caller (guest controller)
   * enforces the per-visitor and global caps.
   */
  async suggestGuestInvoice(text: string, vatPayer: boolean): Promise<Omit<InvoiceSuggestionResult, "contact">> {
    const input = text.trim().slice(0, 1500);
    if (!input) throw new BadRequestException({ error: "empty_input" });
    if (!this.platformAvailable) throw new ServiceUnavailableException({ error: "ai_platform_unavailable" });
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const today = new Date().toISOString().slice(0, 10);
    const context = `Today is ${today}. The issuing business is ${vatPayer ? "a VAT payer" : "NOT a VAT payer, so vat_rate must be null"}.`;
    let parsed: InvoiceSuggestion | null;
    try {
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(InvoiceSuggestionSchema) },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `${context}\n\n<invoice_description>\n${input}\n</invoice_description>` }],
      });
      if (response.stop_reason === "refusal") throw new UnprocessableEntityException({ error: "ai_refused" });
      parsed = response.parsed_output;
    } catch (error) {
      throw mapAnthropicError(error, "platform");
    }
    if (!parsed) throw new UnprocessableEntityException({ error: "ai_unparseable" });
    const ico = parsed.customer.ico?.replace(/\s+/g, "") ?? null;
    let ares: AresContactPrefill | null = null;
    if (ico && /^\d{8}$/.test(ico)) {
      try {
        ares = await this.contactsService.aresLookup(ico);
      } catch {
        // Unknown IČO: the name from the text is used instead.
      }
    }
    return { suggestion: parsed, ares };
  }

  /**
   * Photo/PDF of a received invoice -> expense form fields. Like
   * suggestInvoice, nothing is saved; the expense form is pre-filled.
   */
  async readReceipt(db: TenantDb, tenantId: string, file: { buffer: Buffer; mediaType: ReceiptMediaType }) {
    const tenant = await this.loadTenant(db, tenantId);
    const client = this.clientFor(tenant.id, tenant.aiMode, tenant.aiApiKeyEncrypted);
    if (tenant.isDemo) await this.consumeDemoQuota(tenant.id);
    const data = file.buffer.toString("base64");
    const source =
      file.mediaType === "application/pdf"
        ? ({ type: "document", source: { type: "base64", media_type: "application/pdf", data } } as const)
        : ({ type: "image", source: { type: "base64", media_type: file.mediaType, data } } as const);

    let parsed: ReceiptSuggestion | null;
    try {
      const response = await client.beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "low", format: betaZodOutputFormat(ReceiptSchema) },
        system: RECEIPT_PROMPT,
        messages: [
          {
            role: "user",
            content: [source, { type: "text", text: `Today is ${new Date().toISOString().slice(0, 10)}. Extract the expense fields.` }],
          },
        ],
      });
      if (response.stop_reason === "refusal") {
        throw new UnprocessableEntityException({ error: "ai_refused" });
      }
      parsed = response.parsed_output;
    } catch (error) {
      throw mapAnthropicError(error, tenant.aiMode);
    }
    if (!parsed) {
      throw new UnprocessableEntityException({ error: "ai_unparseable" });
    }
    const { contact } = await this.matchCustomer(db, { ico: parsed.supplier.ico, name: parsed.supplier.name });
    return { suggestion: parsed, contact };
  }

  private async matchCustomer(db: TenantDb, customer: InvoiceSuggestion["customer"]) {
    const ico = customer.ico?.replace(/\s+/g, "") ?? null;
    const validIco = ico && /^\d{8}$/.test(ico) ? ico : null;
    const conditions = [
      validIco ? eq(schema.contacts.ico, validIco) : undefined,
      customer.name ? ilike(schema.contacts.legalName, customer.name.replace(/[\\%_]/g, (c) => `\\${c}`)) : undefined,
    ].filter((c) => c !== undefined);

    if (conditions.length > 0) {
      const [contact] = await db.select().from(schema.contacts).where(or(...conditions)).limit(1);
      if (contact) return { contact, ares: null };
    }
    if (validIco) {
      try {
        return { contact: null, ares: await this.contactsService.aresLookup(validIco) };
      } catch {
        // Unknown IČO or ARES outage: the form simply shows the name instead.
      }
    }
    return { contact: null, ares: null };
  }

  private clientFor(tenantId: string, mode: AiMode, encrypted: string | null): Anthropic {
    if (mode === "off") {
      throw new ForbiddenException({ error: "ai_disabled" });
    }
    if (mode === "own") {
      if (!encrypted) throw new BadRequestException({ error: "ai_key_missing" });
      return new Anthropic({ apiKey: decryptSecret(encrypted, encryptionKey()) });
    }
    if (!this.platformAvailable) {
      throw new ServiceUnavailableException({ error: "ai_platform_unavailable" });
    }
    this.countPlatformUse(tenantId);
    return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }

  /** In-memory, per process: enough for the single-VPS deployment; move to Redis if the backend scales out. */
  private countPlatformUse(tenantId: string) {
    const day = new Date().toISOString().slice(0, 10);
    const entry = this.usage.get(tenantId);
    const count = entry?.day === day ? entry.count : 0;
    if (count >= PLATFORM_DAILY_LIMIT) {
      throw new HttpException({ error: "ai_daily_limit", limit: PLATFORM_DAILY_LIMIT }, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.usage.set(tenantId, { day, count: count + 1 });
  }

  private async verifyKey(key: string) {
    if (!/^sk-ant-/.test(key)) {
      throw new BadRequestException({ error: "ai_key_invalid" });
    }
    try {
      await new Anthropic({ apiKey: key, maxRetries: 0 }).models.retrieve(MODEL);
    } catch (error) {
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new BadRequestException({ error: "ai_key_invalid" });
      }
      if (error instanceof Anthropic.NotFoundError) {
        throw new BadRequestException({ error: "ai_key_no_model_access", model: MODEL });
      }
      throw new ServiceUnavailableException({ error: "ai_provider_unavailable" });
    }
  }

  /**
   * One AI call off a demo's allowance (per session and per visitor IP). Runs
   * on the pool, not the request tx, so the count sticks even when the
   * request later fails and rolls back.
   */
  private async consumeDemoQuota(tenantId: string) {
    const cfg = demoConfig();
    const [row] = await this.dbService!.sql<{ left: number }[]>`
      SELECT consume_demo_ai_call(${tenantId}, ${cfg.aiPerSession}, ${cfg.aiPerIpDaily}) AS left`;
    if (!row || row.left < 0) throw new HttpException("demo_ai_quota", HttpStatus.TOO_MANY_REQUESTS);
  }

  private async loadTenant(db: TenantDb, tenantId: string) {
    const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!tenant) throw new ForbiddenException();
    return tenant;
  }
}

function encryptionKey(): string | undefined {
  return process.env.AI_KEY_ENCRYPTION_KEY ?? process.env.BACKUP_CONFIG_ENCRYPTION_KEY;
}

function mapAnthropicError(error: unknown, mode: AiMode): Error {
  if (error instanceof HttpException) return error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    // A broken own key is the tenant's to fix; a broken platform key is ours.
    return mode === "own"
      ? new BadRequestException({ error: "ai_key_invalid" })
      : new ServiceUnavailableException({ error: "ai_platform_unavailable" });
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new HttpException({ error: "ai_rate_limited" }, HttpStatus.TOO_MANY_REQUESTS);
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new UnprocessableEntityException({ error: "ai_bad_request" });
  }
  return new ServiceUnavailableException({ error: "ai_provider_unavailable" });
}
