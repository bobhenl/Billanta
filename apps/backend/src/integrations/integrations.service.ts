import { effectivePermissions, type Permissions } from "../tenancy/permissions";
import { publicUrlProblem } from "./public-url";
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, isNull, ne, notInArray, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  TAX_DEADLINE_KINDS,
  advanceForDeadline,
  defaultTaxDeadlineKinds,
  isLegalEntityName,
  isTaxAdvanceKind,
  normalizeTaxAdvances,
  taxDeadlinesFor,
  type TaxAdvancePeriod,
  type TaxDeadlineKind,
  type TaxProfile,
} from "@faktur/cz-compliance";
import * as schema from "../../drizzle/schema";
import { DbService } from "../db/db.service";
import { drizzleTx } from "../db/drizzle-tx";
import { upcomingTaxEvents } from "../dashboard/tax-calendar";
import { computeVatBreakdown, formatInvoiceAmount } from "../invoices/invoice-total.util";
import { buildIcs, type IcsEvent } from "./ics";
import { mergeWebhooks, sendWebhook, webhooksOf, type WebhookInput } from "./webhooks";

type Db = PostgresJsDatabase<typeof schema>;
type Lang = "cs" | "sk" | "en";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100").replace(/\/$/, "");
/**
 * Calendar title of a tax deadline; an OSVČ advance gets the amount set in
 * Settings for the month that payment covers (the 20 January social payment
 * still shows December's amount).
 */
export function taxEventSummary(label: string, kind: TaxDeadlineKind, dueDate: Date, advances: TaxAdvancePeriod[], country: string): string {
  const amount = isTaxAdvanceKind(kind) ? advanceForDeadline(advances, kind, dueDate) : undefined;
  return amount == null ? label : `${label} · ${formatInvoiceAmount(amount, country.toUpperCase() === "SK" ? "EUR" : "CZK")}`;
}

const iso = (d: Date) =>`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const TAX_LABELS: Record<Lang, Record<TaxDeadlineKind, string>> = {
  cs: {
    vat_monthly: "DPH a kontrolní hlášení",
    vat_quarterly: "DPH a kontrolní hlášení (čtvrtletí)",
    vat_other: "DPH: OSS, CESOP a další hlášení",
    vat_identified: "Přiznání k DPH (identifikovaná osoba)",
    ec_sales_list: "Souhrnné hlášení",
    health: "Záloha na zdravotní pojištění OSVČ",
    social: "Záloha na sociální pojištění OSVČ",
    income_tax: "Daňové přiznání DPFO/DPPO",
    flat_tax: "Záloha v paušálním režimu",
    overviews: "Přehledy OSVČ pro ČSSZ a pojišťovnu",
    payroll: "Odvody daně za zaměstnance",
    road_tax: "Silniční daň",
    property_tax: "Daň z nemovitých věcí",
  },
  sk: {
    vat_monthly: "DPH a kontrolný výkaz",
    vat_quarterly: "DPH a kontrolný výkaz (štvrťrok)",
    vat_other: "DPH: OSS, CESOP a ďalšie hlásenia",
    vat_identified: "Daňové priznanie k DPH (registrovaný podľa §7a)",
    ec_sales_list: "Súhrnný výkaz",
    health: "Preddavok na zdravotné poistenie SZČO",
    social: "Preddavok na sociálne poistenie SZČO",
    income_tax: "Daňové priznanie FO/PO",
    flat_tax: "Preddavok v paušálnom režime",
    overviews: "Prehľady SZČO pre ČSSZ a poisťovňu",
    payroll: "Odvody dane za zamestnancov",
    road_tax: "Cestná daň",
    property_tax: "Daň z nehnuteľností",
  },
  en: {
    vat_monthly: "VAT return & control statement",
    vat_quarterly: "VAT return & control statement (quarter)",
    vat_other: "VAT: OSS, CESOP and other reports",
    vat_identified: "VAT return (identified person)",
    ec_sales_list: "EC sales list",
    health: "Self-employed health insurance advance",
    social: "Self-employed social insurance advance",
    income_tax: "Income tax return",
    flat_tax: "Flat-rate tax advance",
    overviews: "Annual overviews for social & health insurance",
    payroll: "Employee tax withholding",
    road_tax: "Road tax",
    property_tax: "Property tax",
  },
};

const TEXT: Record<Lang, Record<string, string>> = {
  cs: {
    calendar: "Billanta – termíny",
    due: "Splatnost",
    received: "Zaplatit",
    rss: "Billanta – faktury",
    rssDesc: "Vystavené doklady a jejich stav",
    issued: "vystavena",
    paid: "zaplacena",
    cancelled: "stornována",
    overdue: "po splatnosti",
    taxes: "Daně a pojištění",
    onlyIf_vat_identified: "Jen pokud jste v předchozím měsíci nakoupili služby ze zahraničí (např. reklamy).",
    onlyIf_ec_sales_list: "Jen pokud jste v předchozím měsíci fakturovali služby firmám v jiném státě EU.",
    invoices: "Faktury",
    expenses: "Výdaje",
  },
  sk: {
    calendar: "Billanta – termíny",
    due: "Splatnosť",
    received: "Zaplatiť",
    rss: "Billanta – faktúry",
    rssDesc: "Vystavené doklady a ich stav",
    issued: "vystavená",
    paid: "zaplatená",
    cancelled: "stornovaná",
    overdue: "po splatnosti",
    taxes: "Dane a poistenie",
    onlyIf_vat_identified: "Len ak ste v predchádzajúcom mesiaci nakúpili služby zo zahraničia (napr. reklamu).",
    onlyIf_ec_sales_list: "Len ak ste v predchádzajúcom mesiaci fakturovali služby firmám v inom štáte EÚ.",
    invoices: "Faktúry",
    expenses: "Výdavky",
  },
  en: {
    calendar: "Billanta – deadlines",
    due: "Due",
    received: "Pay",
    rss: "Billanta – invoices",
    rssDesc: "Issued documents and their status",
    issued: "issued",
    paid: "paid",
    cancelled: "cancelled",
    overdue: "overdue",
    taxes: "Taxes & insurance",
    onlyIf_vat_identified: "Only if you bought services from abroad (e.g. ads) in the previous month.",
    onlyIf_ec_sales_list: "Only if you invoiced services to businesses in another EU country in the previous month.",
    invoices: "Invoices",
    expenses: "Expenses",
  },
};

const xml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Settings → Integrace: per-member calendar/RSS feed secret, company-wide
 * webhooks, and the public feed renderers (resolved by `find_feed_owner`,
 * then read inside an RLS-scoped transaction for that tenant).
 */
interface FeedOwner {
  tenantId: string;
  userId: string;
  access: Permissions;
}

@Injectable()
export class IntegrationsService {
  constructor(private readonly dbService: DbService) {}

  async get(db: Db, tenantId: string, userId: string, role: string) {
    const [m] = await db
      .select({ feedToken: schema.tenantMemberships.feedToken })
      .from(schema.tenantMemberships)
      .where(and(eq(schema.tenantMemberships.tenantId, tenantId), eq(schema.tenantMemberships.userId, userId)));
    const admin = role === "owner" || role === "admin";
    const [t] = await db.select({ webhooks: schema.tenants.webhooks }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    return { feedToken: m?.feedToken ?? null, canManageWebhooks: admin, webhooks: admin ? webhooksOf(t?.webhooks) : [] };
  }

  /** New secret (the old URLs stop working) or `null` to switch the feeds off. */
  async setFeed(db: Db, tenantId: string, userId: string, on: boolean) {
    const feedToken = on ? randomUUID() : null;
    await db
      .update(schema.tenantMemberships)
      .set({ feedToken })
      .where(and(eq(schema.tenantMemberships.tenantId, tenantId), eq(schema.tenantMemberships.userId, userId)));
    return { feedToken };
  }

  async saveWebhooks(db: Db, tenantId: string, role: string, input: WebhookInput[]) {
    this.assertAdmin(role);
    const [t] = await db.select({ webhooks: schema.tenants.webhooks }).from(schema.tenants).where(eq(schema.tenants.id, tenantId));
    for (const [index, h] of input.entries()) {
      const problem = await publicUrlProblem(h.url);
      if (problem) throw new BadRequestException({ error: problem, index });
    }
    const merged = mergeWebhooks(webhooksOf(t?.webhooks), input);
    if ("error" in merged) throw new BadRequestException({ error: merged.error, index: merged.index });
    await db.update(schema.tenants).set({ webhooks: merged.webhooks, updatedAt: new Date() }).where(eq(schema.tenants.id, tenantId));
    return { webhooks: merged.webhooks };
  }

  async testWebhook(db: Db, tenantId: string, role: string, id: string) {
    this.assertAdmin(role);
    const [t] = await db
      .select({ webhooks: schema.tenants.webhooks, company: schema.tenants.companyName })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    const hook = webhooksOf(t?.webhooks).find((h) => h.id === id);
    if (!hook) throw new NotFoundException("Webhook not found");
    const status = await sendWebhook(
      hook,
      "test",
      { title: "Billanta: zkušební zpráva", body: "Webhook je správně nastavený. Sem budou chodit vybrané události.", link: "/settings/integrations" },
      { company: t!.company, siteUrl: siteUrl() },
    );
    return { ok: status >= 200 && status < 300, status };
  }

  private assertAdmin(role: string) {
    if (role !== "owner" && role !== "admin") throw new ForbiddenException("Only an owner or admin can change webhooks");
  }

  // ------------------------------------------------------------ public feeds

  /** Runs `fn` as the feed's owner inside an RLS-scoped transaction; 404 for an unknown/disabled token. */
  private async asFeedOwner<T>(token: string, fn: (db: Db, owner: FeedOwner) => Promise<T>): Promise<T> {
    if (!UUID.test(token)) throw new NotFoundException();
    const rows = await this.dbService.db.execute<{ tenant_id: string; user_id: string }>(sql`SELECT * FROM find_feed_owner(${token})`);
    const owner = rows[0];
    if (!owner) throw new NotFoundException();
    let result!: T;
    await this.dbService.sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_tenant_id', ${owner.tenant_id}, true)`;
      const db = drizzleTx(tx, schema);
      // The feed shows only what the member may see in the app right now
      // (role and per-area overrides can change after the URL was copied).
      const [m] = await db
        .select({ role: schema.tenantMemberships.role, permissions: schema.tenantMemberships.permissions })
        .from(schema.tenantMemberships)
        .where(and(eq(schema.tenantMemberships.tenantId, owner.tenant_id), eq(schema.tenantMemberships.userId, owner.user_id)));
      if (!m) throw new NotFoundException();
      const access = effectivePermissions(m.role, m.permissions);
      result = await fn(db, { tenantId: owner.tenant_id, userId: owner.user_id, access });
    });
    return result;
  }

  private async tenantOf(db: Db, tenantId: string) {
    const [t] = await db
      .select({
        company: schema.tenants.companyName,
        legalName: schema.tenants.legalName,
        locale: schema.tenants.defaultLocale,
        vatPayer: schema.tenants.dicVatPayer,
        vatStatus: schema.tenants.vatStatus,
        country: schema.tenants.addressCountry,
        taxAdvances: schema.tenants.taxAdvances,
      })
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tenantId));
    const lang: Lang = t?.locale === "sk" || t?.locale === "en" ? t.locale : "cs";
    const profile: TaxProfile = { country: t?.country ?? "CZ", vatStatus: t?.vatStatus ?? "non_payer", legalEntity: isLegalEntityName(t?.legalName) };
    return { company: t?.company ?? "Billanta", lang, vatPayer: Boolean(t?.vatPayer), profile, advances: normalizeTaxAdvances(t?.taxAdvances) };
  }

  /**
   * Calendar feed: the member's chosen tax/insurance deadlines (same set and
   * sources as the dashboard reminder, a year ahead), due dates of issued
   * unpaid invoices and of unpaid received invoices.
   */
  async calendar(token: string, now = new Date()): Promise<string> {
    const official = await upcomingTaxEvents(366, now).catch(() => null);
    return this.asFeedOwner(token, async (db, owner) => {
      const { company, lang, profile, advances } = await this.tenantOf(db, owner.tenantId);
      const t = TEXT[lang];
      const [m] = await db
        .select({ config: schema.tenantMemberships.dashboardTiles })
        .from(schema.tenantMemberships)
        .where(and(eq(schema.tenantMemberships.tenantId, owner.tenantId), eq(schema.tenantMemberships.userId, owner.userId)));
      const chosen = (m?.config && typeof m.config === "object" && !Array.isArray(m.config) ? (m.config as { taxDeadlines?: unknown }).taxDeadlines : null) as
        | string[]
        | null
        | undefined;
      const kinds = Array.isArray(chosen)
        ? chosen.filter((k): k is TaxDeadlineKind => (TAX_DEADLINE_KINDS as readonly string[]).includes(k))
        : defaultTaxDeadlineKinds(profile.vatStatus);

      const events: IcsEvent[] = [];
      // No activity here (unknown months ahead): conditional rows come flagged "only if …".
      for (const d of taxDeadlinesFor(kinds, profile, official, now, 366)) {
        const date = iso(d.date);
        events.push({
          uid: `tax-${d.kind}-${date}@billanta`,
          date,
          summary: taxEventSummary(TAX_LABELS[lang][d.kind], d.kind, d.date, advances, profile.country),
          description: [d.conditional ? t[`onlyIf_${d.kind}`] : null, ...(d.details ?? [])].filter(Boolean).join("\n") || undefined,
          categories: [t.taxes!],
        });
      }

      const open = owner.access.invoices === "none" ? [] : await db
        .select({ invoice: schema.invoices, contactName: schema.contacts.legalName })
        .from(schema.invoices)
        .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
        .where(
          and(
            eq(schema.invoices.status, "issued"),
            isNotNull(schema.invoices.dueDate),
            notInArray(schema.invoices.documentType, ["quote", "credit_note"]),
          ),
        );
      const items = open.length
        ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, open.map((r) => r.invoice.id)))
        : [];
      for (const { invoice, contactName } of open) {
        const total = computeVatBreakdown(
          items.filter((i) => i.invoiceId === invoice.id),
          { reverseCharge: invoice.reverseCharge },
        ).totalWithVat;
        events.push({
          uid: `invoice-${invoice.id}@billanta`,
          date: iso(invoice.dueDate!),
          summary: `${t.due} ${invoice.invoiceNumber ?? ""} · ${contactName ?? ""} · ${formatInvoiceAmount(total, invoice.currency)}`.replace(/\s+·\s+·/, " ·"),
          url: `${siteUrl()}/${lang}/invoices/${invoice.id}`,
          categories: [t.invoices!],
        });
      }

      const bills = owner.access.expenses === "none" ? [] : await db
        .select()
        .from(schema.expenses)
        .where(and(isNotNull(schema.expenses.dueDate), isNull(schema.expenses.paidAt)));
      for (const e of bills) {
        events.push({
          uid: `expense-${e.id}@billanta`,
          date: iso(e.dueDate!),
          summary: `${t.received}: ${e.supplierNameRaw ?? e.description} · ${formatInvoiceAmount(Number(e.amount), e.currency)}`,
          description: [e.documentNumber, e.variableSymbol ? `VS ${e.variableSymbol}` : null].filter(Boolean).join(" · ") || undefined,
          url: `${siteUrl()}/${lang}/expenses/${e.id}`,
          categories: [t.expenses!],
        });
      }
      events.sort((a, b) => a.date.localeCompare(b.date));
      return buildIcs(`${t.calendar} (${company})`, events, now);
    });
  }

  /** RSS 2.0 of the latest 50 issued documents with their current status. */
  async rss(token: string, now = new Date()): Promise<string> {
    return this.asFeedOwner(token, async (db, owner) => {
      if (owner.access.invoices === "none") throw new NotFoundException();
      const { company, lang } = await this.tenantOf(db, owner.tenantId);
      const t = TEXT[lang];
      const rows = await db
        .select({ invoice: schema.invoices, contactName: schema.contacts.legalName })
        .from(schema.invoices)
        .leftJoin(schema.contacts, eq(schema.contacts.id, schema.invoices.contactId))
        .where(and(ne(schema.invoices.status, "draft"), ne(schema.invoices.status, "pending_review")))
        .orderBy(desc(schema.invoices.updatedAt))
        .limit(50);
      const items = rows.length
        ? await db.select().from(schema.invoiceLineItems).where(inArray(schema.invoiceLineItems.invoiceId, rows.map((r) => r.invoice.id)))
        : [];
      const site = siteUrl();
      const entries = rows.map(({ invoice, contactName }) => {
        const total = computeVatBreakdown(
          items.filter((i) => i.invoiceId === invoice.id),
          { reverseCharge: invoice.reverseCharge },
        ).totalWithVat;
        const overdue = invoice.status === "issued" && invoice.dueDate && invoice.dueDate < new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const state = overdue ? t.overdue : (t[invoice.status] ?? invoice.status);
        const title = `${invoice.invoiceNumber ?? ""} · ${contactName ?? ""} · ${formatInvoiceAmount(total, invoice.currency)} · ${state}`;
        const link = `${site}/${lang}/invoices/${invoice.id}`;
        const when = invoice.paidAt ?? invoice.cancelledAt ?? invoice.issuedAt ?? invoice.updatedAt;
        return [
          "<item>",
          `<title>${xml(title)}</title>`,
          `<link>${xml(link)}</link>`,
          // Changes with the status, so readers show a paid invoice as a new item.
          `<guid isPermaLink="false">${invoice.id}-${invoice.status}</guid>`,
          `<pubDate>${when.toUTCString()}</pubDate>`,
          `<category>${xml(state!)}</category>`,
          "</item>",
        ].join("");
      });
      return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<rss version="2.0">',
        "<channel>",
        `<title>${xml(`${t.rss} (${company})`)}</title>`,
        `<link>${xml(`${site}/${lang}/invoices`)}</link>`,
        `<description>${xml(t.rssDesc!)}</description>`,
        `<language>${lang}</language>`,
        `<lastBuildDate>${now.toUTCString()}</lastBuildDate>`,
        "<ttl>60</ttl>",
        ...entries,
        "</channel>",
        "</rss>",
      ].join("\n");
    });
  }
}
