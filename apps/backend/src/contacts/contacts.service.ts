import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  checkVatPayer,
  isEuCountry,
  type VatPayerCheck,
  getRpoSubjectByIco,
  getSubjectByIco,
  lookupPoland,
  lookupVies,
  parseVatId,
  searchAddresses,
  searchCompaniesHouse,
  searchFrance,
  searchGleif,
  searchNorway,
  searchFinland,
  searchDenmark,
  searchSwitzerland,
  searchRpoSubjects,
  searchSubjectsTypeahead,
  searchWorldAddresses,
  type AresPoolCache,
  type AresSubject,
  type RegistryHit,
} from "@faktur/cz-compliance";
import { and, asc, desc, eq, ilike, inArray, like, or, sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { AuditService } from "../audit/audit.service";
import { DbService } from "../db/db.service";
import { summarizeContactInvoices, type ContactSummaryBucket } from "./contact-summary.util";
import { contactsToCsv, decodeCsvBuffer, mapContactRows, parseCsv, type CsvContact, type CsvSkip } from "./contacts-csv.util";
import { mapAresSubjectToContactPrefill, mapRegistryHitToContactPrefill, mapRpoSubjectToContactPrefill, type AresContactPrefill } from "./ares-mapper.util";
import type { CreateContactDto } from "./dto/create-contact.dto";
import type { UpdateContactDto } from "./dto/update-contact.dto";

/**
 * Which company register the typeahead asks: "auto" = CZ + SK (plus VIES for
 * prefixed VAT numbers), "none" = own contacts only (the instant first pass),
 * "WORLD" = the global LEI index. DE/AT/IT/US … go to GLEIF filtered by country.
 */
export const COMPANY_REGISTRIES = ["auto", "none", "CZ", "SK", "FR", "NO", "PL", "GB", "FI", "DK", "CH", "DE", "AT", "IT", "US", "EU", "WORLD"] as const;
/** Registers answered by the GLEIF LEI index filtered to that country. */
const GLEIF_COUNTRIES = new Set(["DE", "AT", "IT", "US"]);
export type CompanyRegistry = (typeof COMPANY_REGISTRIES)[number];

/**
 * Which half of a register search to run. A name search in "auto" (and in
 * "EU", which has no name search of its own) asks ARES and the Slovak RPO,
 * and RPO takes several seconds where ARES takes a fraction of one. So the
 * typeahead asks for the halves separately and shows the ARES hits at once:
 * "fast" is everything but that RPO name search, "slow" is only it, "all" both.
 */
export const REGISTRY_PARTS = ["all", "fast", "slow"] as const;
export type RegistryPart = (typeof REGISTRY_PARTS)[number];

export function registryPartOf(raw: string | undefined): RegistryPart {
  return (REGISTRY_PARTS as readonly string[]).includes(raw ?? "") ? (raw as RegistryPart) : "all";
}

/**
 * Whether a search has a "slow" half at all, so a caller can answer an empty
 * one without spending a rate-limit token. Mirrors the branches of
 * `registrySearch`: IČOs, foreign registers and prefixed VAT numbers (VIES)
 * never ask RPO by name.
 */
export function hasSlowPart(rawQuery: string, registry: CompanyRegistry): boolean {
  const q = rawQuery.trim().slice(0, 120);
  if ((registry !== "auto" && registry !== "EU") || q.length < 3 || /^\d+$/.test(q)) return false;
  const vat = parseVatId(q);
  return !vat || (registry === "auto" && (vat.country === "CZ" || vat.country === "SK"));
}

type TenantDb = PostgresJsDatabase<typeof schema>;

/**
 * ARES has no documented rate limit (blueprint §1 "Known gaps"), so callers
 * must defensively cache — a 24h freshness window is a reasonable default
 * for public registry data that changes rarely (company name/address/VAT
 * status don't change day-to-day), while still keeping a stale row from
 * living forever.
 */
const ARES_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const MAX_IMPORT_ROWS = 5000;

const REGISTRY_SEARCH_TTL_MS = 60 * 60 * 1000;
const REGISTRY_SEARCH_MAX = 2000;
/**
 * RPO answers the production VPS in 6.6-8.7 s, by IČO as well as by name, so
 * anything shorter means Slovak companies are never found. Only the "slow"
 * half of a typeahead and SK lookups wait for it.
 */
const RPO_TIMEOUT_MS = 12_000;
/** RPO by IČO: a found company for as long as ARES rows (24 h), "unknown" for 10 min. */
const RPO_MISS_TTL_MS = 10 * 60 * 1000;
/** ARES "finished words" pools (up to 1000 subjects each, see searchSubjectsTypeahead): a few, briefly. */
const ARES_POOL_TTL_MS = 10 * 60 * 1000;
const ARES_POOL_MAX = 20;
const VAT_CHECK_TTL_MS = 6 * 60 * 60 * 1000;
const VAT_CHECK_RETRY_MS = 10 * 60 * 1000;

/**
 * Which register a country's companies are looked up in. CZ (the default
 * country of every form) stays "auto" so a Slovak company typed into a
 * fresh form is still found; unknown or blank countries search everything.
 */
export function registryForCountry(country: string | null | undefined): CompanyRegistry {
  const c = (country ?? "").trim().toUpperCase();
  if (!c || c === "CZ") return "auto";
  if ((COMPANY_REGISTRIES as readonly string[]).includes(c)) return c as CompanyRegistry;
  return isEuCountry(c) ? "EU" : "auto";
}

@Injectable()
export class ContactsService {
  // `ares_cache` is a GLOBAL table (no tenant_id, no RLS — see
  // `drizzle/rls-policies.sql`'s "Deliberately EXCLUDED" section and the
  // doc comment on `aresCache` in `drizzle/schema.ts`), so it's read/written
  // through the shared pool (`DbService.db`), never a tenant-scoped
  // `req.tenantDb` — there is no tenant context to set for it in the first
  // place, and RLS wouldn't apply to it even if one were set.
  constructor(
    private readonly dbService: DbService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  /**
   * Registry answers to typeahead queries, kept in memory for an hour: the
   * typeahead re-asks the same prefixes as people type and delete, and the
   * public registers answer in 0.3-3 s. Registry data is public, so the
   * cache is shared across tenants; per-tenant contacts are never cached.
   */
  private readonly registryHits = new Map<string, { at: number; hits: AresContactPrefill[] }>();
  private readonly vatChecks = new Map<string, { at: number; check: VatPayerCheck | null }>();
  private readonly rpoByIco = new Map<string, { at: number; hit: AresContactPrefill | null }>();
  private readonly aresPools = new Map<string, { at: number; subjects: AresSubject[] }>();
  private readonly aresPool: AresPoolCache = {
    get: (words) => {
      const entry = this.aresPools.get(words);
      return entry && entry.at > Date.now() - ARES_POOL_TTL_MS ? entry.subjects : undefined;
    },
    set: (words, subjects) => {
      if (this.aresPools.size >= ARES_POOL_MAX) {
        const oldest = this.aresPools.keys().next().value;
        if (oldest !== undefined) this.aresPools.delete(oldest);
      }
      // Only what the prefill reads: the raw subjects carry ~4 kB of registration blocks each.
      const slim = subjects.map(({ ico, dic, obchodniJmeno, sidlo, platceDph }) => ({ ico, dic, obchodniJmeno, sidlo, platceDph }));
      this.aresPools.set(words, { at: Date.now(), subjects: slim });
    },
  };

  private rememberRegistryHits(key: string, hits: AresContactPrefill[]) {
    if (this.registryHits.size >= REGISTRY_SEARCH_MAX) {
      // Map keeps insertion order, so the first key is the oldest.
      const oldest = this.registryHits.keys().next().value;
      if (oldest !== undefined) this.registryHits.delete(oldest);
    }
    this.registryHits.set(key, { at: Date.now(), hits });
  }

  list(db: TenantDb) {
    // RLS on `contacts` already restricts this to the current tenant.
    // Starred customers first, then alphabetical.
    return db
      .select()
      .from(schema.contacts)
      .orderBy(desc(schema.contacts.isStarred), asc(schema.contacts.legalName));
  }

  /** Quick picks for a new invoice: the tenant's starred customers. */
  starred(db: TenantDb) {
    return db
      .select()
      .from(schema.contacts)
      .where(eq(schema.contacts.isStarred, true))
      .orderBy(asc(schema.contacts.legalName))
      .limit(8);
  }

  async setStarred(db: TenantDb, id: string, starred: boolean) {
    const [row] = await db
      .update(schema.contacts)
      .set({ isStarred: starred, updatedAt: new Date() })
      .where(eq(schema.contacts.id, id))
      .returning();
    if (!row) throw new NotFoundException("Contact not found");
    return row;
  }

  findOne(db: TenantDb, id: string) {
    return db.select().from(schema.contacts).where(eq(schema.contacts.id, id)).limit(1);
  }

  /**
   * Hover card on the invoice list: contact basics plus invoice aggregates.
   * One aggregate query (line items summed per invoice and VAT rate, served
   * by the contact/invoice indexes); the tenant filter repeats what RLS
   * already enforces. Returns aggregates only, never the invoices.
   */
  async summary(db: TenantDb, tenantId: string, id: string) {
    const [contact] = await db
      .select({
        id: schema.contacts.id,
        legalName: schema.contacts.legalName,
        email: schema.contacts.email,
        ico: schema.contacts.ico,
        country: schema.contacts.addressCountry,
      })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.tenantId, tenantId), eq(schema.contacts.id, id)))
      .limit(1);
    if (!contact) throw new NotFoundException("Contact not found");

    const inv = schema.invoices;
    const li = schema.invoiceLineItems;
    const buckets: ContactSummaryBucket[] = await db
      .select({
        invoiceId: inv.id,
        currency: inv.currency,
        status: inv.status,
        documentType: inv.documentType,
        dueDate: inv.dueDate,
        issueDate: inv.issueDate,
        amountPaid: inv.amountPaid,
        reverseCharge: inv.reverseCharge,
        vatRate: li.vatRate,
        base: sql<string | null>`sum(${li.quantity} * ${li.unitPrice} * (1 - ${li.discountPercent} / 100))`,
      })
      .from(inv)
      .leftJoin(li, eq(li.invoiceId, inv.id))
      .where(
        and(
          eq(inv.tenantId, tenantId),
          eq(inv.contactId, id),
          inArray(inv.documentType, ["invoice", "credit_note"]),
          inArray(inv.status, ["issued", "paid"]),
        ),
      )
      .groupBy(inv.id, li.vatRate);

    return { ...contact, ...summarizeContactInvoices(buckets) };
  }

  /** Turns the customer's portal link on (or issues a new one, revoking the old), or off with `enabled: false`. */
  async setPortal(db: TenantDb, id: string, enabled: boolean) {
    const [row] = await db
      .update(schema.contacts)
      .set({ portalToken: enabled ? randomUUID() : null, updatedAt: new Date() })
      .where(eq(schema.contacts.id, id))
      .returning({ portalToken: schema.contacts.portalToken });
    if (!row) throw new NotFoundException("Contact not found");
    return row;
  }

  async create(db: TenantDb, tenantId: string, dto: CreateContactDto) {
    // tenantId is taken from the verified request context (req.user.tenantId
    // via the controller), never from client-supplied input — the DTO
    // deliberately has no tenantId field.
    //
    // One contact per IČO per tenant: creating a company that is already
    // saved (e.g. picking the same ARES hit twice) returns the existing row.
    if (dto.ico) {
      const existing = await db.select().from(schema.contacts).where(eq(schema.contacts.ico, dto.ico)).limit(1);
      if (existing.length > 0) return existing;
    }
    return db
      .insert(schema.contacts)
      .values({
        tenantId,
        legalName: dto.legalName,
        ico: dto.ico,
        dic: dto.dic,
        email: dto.email,
        phone: dto.phone || null,
        addressStreet: dto.addressStreet ?? null,
        addressCity: dto.addressCity ?? null,
        addressPostalCode: dto.addressPostalCode ?? null,
        addressCountry: dto.addressCountry ?? "CZ",
        isVatPayer: dto.isVatPayer ?? null,
        isPerson: dto.isPerson ?? false,
        color: dto.color ?? null,
        internalNote: dto.internalNote || null,
        aresVerifiedAt: dto.aresVerified ? new Date() : null,
      })
      .returning();
  }

  async exportCsv(db: TenantDb): Promise<string> {
    return contactsToCsv(await this.list(db));
  }

  /**
   * CSV import (see `contacts-csv.util.ts`). A row updates an existing
   * contact with the same IČO, or — for rows without an IČO — one with the
   * same name (case-insensitive); otherwise it creates a new contact. An
   * update only fills in the columns the file actually has, so importing a
   * sparse spreadsheet never blanks out data already on the contact.
   */
  async importCsv(db: TenantDb, tenantId: string, buffer: Buffer): Promise<{ created: number; updated: number; skipped: CsvSkip[] }> {
    let mapped: ReturnType<typeof mapContactRows>;
    try {
      mapped = mapContactRows(parseCsv(decodeCsvBuffer(buffer)));
    } catch {
      throw new BadRequestException({ error: "unknown_columns" });
    }
    if (mapped.contacts.length + mapped.skipped.length > MAX_IMPORT_ROWS) throw new BadRequestException({ error: "too_many_rows" });

    const existing = await db.select({ id: schema.contacts.id, ico: schema.contacts.ico, legalName: schema.contacts.legalName }).from(schema.contacts);
    const byIco = new Map(existing.filter((c) => c.ico).map((c) => [c.ico!, c.id]));
    const byName = new Map(existing.map((c) => [c.legalName.trim().toLowerCase(), c.id]));

    let created = 0;
    let updated = 0;
    const touched = new Set<string>();
    for (const { contact } of mapped.contacts) {
      const id = contact.ico ? byIco.get(contact.ico) : byName.get(contact.legalName.toLowerCase());
      if (id) {
        const set = Object.fromEntries(Object.entries(contact).filter(([, v]) => v !== null)) as Partial<CsvContact>;
        await db.update(schema.contacts).set({ ...set, updatedAt: new Date() }).where(eq(schema.contacts.id, id));
        if (!touched.has(id)) updated++;
        touched.add(id);
        continue;
      }
      const [row] = await db.insert(schema.contacts).values({ tenantId, ...contact }).returning({ id: schema.contacts.id });
      created++;
      touched.add(row.id);
      if (contact.ico) byIco.set(contact.ico, row.id);
      byName.set(contact.legalName.toLowerCase(), row.id);
    }
    if (created + updated > 0) {
      const changes = [
        { field: "importedContacts", from: null, to: created },
        { field: "updatedContacts", from: null, to: updated },
        { field: "skippedRows", from: null, to: mapped.skipped.length },
      ].filter((c) => c.to > 0);
      await this.audit?.record(db, tenantId, { entityType: "import", action: "contacts_csv", changes });
    }
    return { created, updated, skipped: mapped.skipped };
  }

  /**
   * Customer typeahead for the invoice form: the tenant's own contacts
   * first (name contains / IČO starts with), then ARES — an exact IČO
   * lookup (cached, via `aresLookup`) when the query is 8 digits, otherwise
   * a name search once the query is long enough to be meaningful. ARES
   * subjects already saved as contacts are dropped from the ARES half, so
   * the same company never appears twice. An ARES outage degrades to
   * "contacts only" rather than failing the whole typeahead.
   */
  async search(
    db: TenantDb,
    rawQuery: string,
    registry: CompanyRegistry = "auto",
    part: RegistryPart = "all",
  ): Promise<{ contacts: (typeof schema.contacts.$inferSelect)[]; ares: AresContactPrefill[] }> {
    const q = rawQuery.trim().slice(0, 120);
    if (q.length < 2) {
      return { contacts: [], ares: [] };
    }
    // LIKE wildcards in user input are matched literally.
    const escaped = q.replace(/[\\%_]/g, (c) => `\\${c}`);

    const contacts = await db
      .select()
      .from(schema.contacts)
      .where(
        or(
          ilike(schema.contacts.legalName, `%${escaped}%`),
          like(schema.contacts.ico, `${escaped}%`),
          ilike(schema.contacts.dic, `${escaped.replace(/\s/g, "")}%`),
        ),
      )
      .orderBy(desc(schema.contacts.isStarred), asc(schema.contacts.legalName))
      .limit(8);

    const ares = registry === "none" ? [] : await this.registrySearch(q, registry, part);

    const known = new Set(contacts.flatMap((c) => [c.ico, c.dic]).filter(Boolean));
    return { contacts, ares: ares.filter((a) => !known.has(a.ico || a.dic)) };
  }

  /**
   * Company registers only (no contacts), cached for an hour and shared
   * across tenants because the data is public. Never throws: an outage
   * means no hits. Also behind the public company lookup
   * (`v1/public/company-lookup`), so keep it free of tenant data.
   * `part` splits off the slow RPO name search (see `RegistryPart`).
   */
  async registrySearch(rawQuery: string, registry: CompanyRegistry = "auto", part: RegistryPart = "all"): Promise<AresContactPrefill[]> {
    const q = rawQuery.trim().slice(0, 120);
    if (q.length < 2 || registry === "none") return [];
    if (part === "all") {
      const [fast, slow] = await Promise.all([this.registrySearch(q, registry, "fast"), this.registrySearch(q, registry, "slow")]);
      return [...fast, ...slow];
    }
    if (part === "slow" && !hasSlowPart(q, registry)) return [];
    const cacheKey = `${part}:${registry}:${q.toLowerCase()}`;
    const cached = this.registryHits.get(cacheKey);
    if (cached && cached.at > Date.now() - REGISTRY_SEARCH_TTL_MS) return cached.hits;
    try {
      const hits =
        part === "slow"
          ? (await searchRpoSubjects(q, { limit: 3, timeoutMs: RPO_TIMEOUT_MS })).map(mapRpoSubjectToContactPrefill)
          : await this.fastRegistrySearch(q, registry);
      // A timeout or outage throws past this line, so it is never cached as "no hits".
      this.rememberRegistryHits(cacheKey, hits);
      return hits;
    } catch {
      return [];
    }
  }

  private async fastRegistrySearch(q: string, registry: CompanyRegistry): Promise<AresContactPrefill[]> {
    const foreign = await this.foreignLookup(q, registry);
    if (foreign) return foreign;
    if (/^\d{8}$/.test(q) || (registry === "SK" && /^\d{6,8}$/.test(q))) {
      const hit = await this.findByIco(q.padStart(8, "0"), registry === "SK" ? "SK" : "CZ");
      return hit ? [hit] : [];
    }
    if (registry === "SK") return (await searchRpoSubjects(q, { limit: 6, timeoutMs: RPO_TIMEOUT_MS })).map(mapRpoSubjectToContactPrefill);
    // "auto", "CZ" and a name typed into "EU" (VIES has no name search) ask ARES here; RPO is the slow half.
    if (q.length >= 3 && !/^\d+$/.test(q)) {
      return (await searchSubjectsTypeahead(q, { limit: 6, pool: this.aresPool })).map(mapAresSubjectToContactPrefill);
    }
    return [];
  }

  /**
   * One IČO in the home registers. CZ and SK IČOs share the format, so the
   * other register is the fallback, asked only when the first one does not
   * know the number (or is down). ARES answers in a fraction of a second and
   * RPO in several, so a Czech company never waits for RPO.
   */
  private async findByIco(ico: string, first: "CZ" | "SK"): Promise<AresContactPrefill | null> {
    const cz = () => this.aresSubject(ico).then((s) => (s ? mapAresSubjectToContactPrefill(s) : null), () => null);
    const sk = () => this.rpoLookup(ico).catch(() => null);
    return first === "SK" ? ((await sk()) ?? (await cz())) : ((await cz()) ?? (await sk()));
  }

  /**
   * VAT registration of a DIČ / EU VAT number: the CZ register of VAT
   * payers (ADIS) for CZ, VIES elsewhere. Cached in memory (6 h for an
   * answer, 10 min for "unknown" so an outage is retried soon). Never throws.
   */
  async vatCheck(rawVatId: string): Promise<VatPayerCheck | null> {
    const key = rawVatId.replace(/[\s.-]/g, "").toUpperCase().slice(0, 20);
    if (!key) return null;
    const cached = this.vatChecks.get(key);
    const ttl = cached?.check?.state === "unknown" ? VAT_CHECK_RETRY_MS : VAT_CHECK_TTL_MS;
    if (cached && cached.at > Date.now() - ttl) return cached.check;
    const check = await checkVatPayer(key, { timeoutMs: 6000 }).catch(() => null);
    if (this.vatChecks.size >= REGISTRY_SEARCH_MAX) {
      const oldest = this.vatChecks.keys().next().value;
      if (oldest !== undefined) this.vatChecks.delete(oldest);
    }
    this.vatChecks.set(key, { at: Date.now(), check });
    return check;
  }

  /**
   * "Načíst z registru" for one IČO: the register of the given country
   * first (RPO for SK, ARES otherwise; the other one as a fallback, since
   * CZ and SK IČOs share the format). 404 when neither knows it.
   */
  async lookupById(ico: string, country?: string | null): Promise<AresContactPrefill> {
    if ((country ?? "").toUpperCase() !== "SK") return this.aresLookup(ico);
    const sk = await this.rpoLookup(ico).catch(() => null);
    if (sk) return sk;
    // ARES only: aresLookup's own RPO fallback would ask RPO a second time.
    const cz = await this.aresSubject(ico);
    if (cz) return mapAresSubjectToContactPrefill(cz);
    throw new NotFoundException(`No ARES/RPO subject found for IČO "${ico}"`);
  }

  /**
   * Registers outside CZ/SK. A VAT number with a country prefix
   * ("IT00488410010", "DE…") always goes to VIES; otherwise the picked
   * register decides. Returns null when the CZ/SK path should handle it.
   */
  private async foreignLookup(q: string, registry: CompanyRegistry): Promise<AresContactPrefill[] | null> {
    const vat = parseVatId(q);
    const czSkVat = vat && (vat.country === "CZ" || vat.country === "SK");
    let hits: RegistryHit[] | null = null;
    if (vat && !czSkVat && (registry === "auto" || registry === "EU" || registry === vat.country)) {
      hits = vat.country === "PL" ? await lookupPoland(vat.number) : await lookupVies(q);
    } else if (registry === "EU" && vat) {
      hits = await lookupVies(q);
    } else if (registry === "FR") {
      hits = q.length >= 3 ? await searchFrance(q) : [];
    } else if (registry === "NO") {
      hits = q.length >= 3 ? await searchNorway(q) : [];
    } else if (registry === "PL") {
      hits = await lookupPoland(q);
    } else if (registry === "FI") {
      hits = q.length >= 3 ? await searchFinland(q) : [];
    } else if (registry === "DK") {
      hits = q.length >= 3 ? await searchDenmark(q) : [];
    } else if (registry === "CH") {
      hits = q.length >= 3 ? await searchSwitzerland(q) : [];
    } else if (registry === "GB") {
      hits = q.length >= 2 ? ((await searchCompaniesHouse(q, process.env.COMPANIES_HOUSE_API_KEY)) ?? (await searchGleif(q, "GB"))) : [];
    } else if (GLEIF_COUNTRIES.has(registry)) {
      hits = q.length >= 3 ? await searchGleif(q, registry) : [];
    } else if (registry === "WORLD") {
      hits = q.length >= 3 ? await searchGleif(q) : [];
    }
    return hits ? hits.map(mapRegistryHitToContactPrefill) : null;
  }

  /**
   * Street / city / PSČ suggestions: the Czech address register (RÚIAN via
   * ARES) for CZ, OpenStreetMap (Photon) elsewhere. Failures mean no suggestions.
   */
  async searchAddresses(rawQuery: string, rawCountry = "CZ"): Promise<{ street: string; city: string; postalCode: string; label: string }[]> {
    const q = rawQuery.trim().slice(0, 120);
    const country = /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry.toUpperCase() : "CZ";
    if (q.length < 3 || /^\d+$/.test(q)) return [];
    try {
      return country === "CZ" ? await searchAddresses(q, { limit: 8 }) : await searchWorldAddresses(q, country, 8);
    } catch {
      return [];
    }
  }

  async update(db: TenantDb, id: string, dto: UpdateContactDto) {
    const { aresVerified, ...fields } = dto;
    if (fields.ico) {
      // Keep "one contact per IČO per tenant" when the IČO is edited.
      const [clash] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.ico, fields.ico)).limit(1);
      if (clash && clash.id !== id) throw new ConflictException({ error: "ico_taken", contactId: clash.id });
    }
    const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const [before] = await db.select().from(schema.contacts).where(eq(schema.contacts.id, id)).limit(1);
    const [row] = await db
      .update(schema.contacts)
      .set({
        ...set,
        ...(aresVerified !== undefined && { aresVerifiedAt: aresVerified ? new Date() : null }),
        updatedAt: new Date(),
      })
      .where(eq(schema.contacts.id, id))
      .returning();
    if (!row) throw new NotFoundException(`Contact ${id} not found`);
    const changes = before ? (this.audit?.diff(before as Record<string, unknown>, set) ?? []) : [];
    if (changes.length > 0) {
      await this.audit?.record(db, row.tenantId, { entityType: "contact", entityId: id, entityLabel: row.legalName, action: "updated", changes });
    }
    return row;
  }

  /**
   * Invoices and recurring schedules reference contacts with ON DELETE
   * RESTRICT (documents must keep their customer), so a contact with any
   * document can't be deleted — that surfaces as 409 `contact_in_use`.
   */
  async remove(db: TenantDb, id: string): Promise<void> {
    try {
      const deleted = await db
        .delete(schema.contacts)
        .where(eq(schema.contacts.id, id))
        .returning({ id: schema.contacts.id, tenantId: schema.contacts.tenantId, name: schema.contacts.legalName });
      if (deleted.length === 0) throw new NotFoundException(`Contact ${id} not found`);
      await this.audit?.record(db, deleted[0].tenantId, { entityType: "contact", entityId: id, entityLabel: deleted[0].name, action: "deleted" });
    } catch (error) {
      const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
      if (code === "23503") throw new ConflictException({ error: "contact_in_use" });
      throw error;
    }
  }

  /**
   * `POST /api/v1/contacts/ares-lookup` — `apps/ai-service`'s
   * `enrich_with_ares()` (app/pipeline/voice_to_invoice.py) already calls
   * this exact path via httpx expecting it to resolve a counterparty
   * against the ARES registry (blueprint §6 step 7) and return something
   * mappable to its `AresEnrichment` model; the dashboard's own
   * "create contact from IČO" flow is the other caller.
   *
   * Cache-first: checks `ares_cache` (global, no RLS — see constructor's
   * doc comment) for a row fresher than `ARES_CACHE_TTL_MS`; on a miss (or
   * stale hit) calls ARES for real via `@faktur/cz-compliance`'s
   * `getSubjectByIco` and upserts the cache before returning. Returns
   * `null` for an unknown IČO (ARES 404) — the controller turns that into a
   * 404 response — rather than throwing, so a "not found" is
   * distinguishable from a real ARES outage (`AresApiError` propagates
   * as-is and becomes a 500, which is the honest outcome: we don't know
   * whether the IČO exists or not).
   */
  async aresLookup(ico: string): Promise<AresContactPrefill> {
    const subject = await this.aresSubject(ico);
    if (!subject) {
      // Not a Czech company – maybe a Slovak one (RPO). An RPO outage still reads as "not found".
      const sk = await this.rpoLookup(ico).catch(() => null);
      if (sk) return sk;
      throw new NotFoundException(`No ARES subject found for IČO "${ico}"`);
    }
    return mapAresSubjectToContactPrefill(subject);
  }

  /** ARES by IČO through `ares_cache` (see `aresLookup`); null when ARES does not know it. */
  private async aresSubject(ico: string): Promise<AresSubject | null> {
    const cached = await this.dbService.db
      .select()
      .from(schema.aresCache)
      .where(eq(schema.aresCache.ico, ico))
      .limit(1);

    const cachedRow = cached[0];
    const isFresh = cachedRow != null && Date.now() - cachedRow.fetchedAt.getTime() < ARES_CACHE_TTL_MS;

    let subject: AresSubject | null;
    if (isFresh) {
      subject = cachedRow.responsePayload as AresSubject;
    } else {
      subject = await getSubjectByIco(ico);

      if (subject) {
        // Upsert: a stale row gets refreshed in place; a first-ever lookup
        // inserts. `ico` is the table's primary key (drizzle/schema.ts), so
        // `onConflictDoUpdate` targeting it is race-safe against two
        // concurrent lookups for the same never-before-cached IČO.
        await this.dbService.db
          .insert(schema.aresCache)
          .values({ ico, responsePayload: subject as object, fetchedAt: new Date() })
          .onConflictDoUpdate({
            target: schema.aresCache.ico,
            set: { responsePayload: subject as object, fetchedAt: new Date() },
          });
      }
    }

    return subject;
  }

  /**
   * Slovak register (RPO) by IČO; null when unknown or the company no longer
   * exists. Kept in memory like ARES rows are in `ares_cache`, since every
   * RPO call costs seconds; an outage throws and is not remembered.
   */
  private async rpoLookup(ico: string): Promise<AresContactPrefill | null> {
    const cached = this.rpoByIco.get(ico);
    if (cached && cached.at > Date.now() - (cached.hit ? ARES_CACHE_TTL_MS : RPO_MISS_TTL_MS)) return cached.hit;
    const subject = await getRpoSubjectByIco(ico, { timeoutMs: RPO_TIMEOUT_MS });
    const hit = subject && !subject.terminatedAt ? mapRpoSubjectToContactPrefill(subject) : null;
    if (this.rpoByIco.size >= REGISTRY_SEARCH_MAX) {
      const oldest = this.rpoByIco.keys().next().value;
      if (oldest !== undefined) this.rpoByIco.delete(oldest);
    }
    this.rpoByIco.set(ico, { at: Date.now(), hit });
    return hit;
  }
}
