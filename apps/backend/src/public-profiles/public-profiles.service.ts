import { Injectable, NotFoundException } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { DbService } from "../db/db.service";
import { SERVICE_ID_PATTERN, SLUG_PATTERN } from "../tenants/public-profile";
import { orderCurrency } from "./profile-orders.util";

// `type`, not `interface` — see the note in public-invoices.service.ts.
type PublicProfileRow = {
  company_name: string;
  legal_name: string;
  ico: string | null;
  dic: string | null;
  address_street: string | null;
  address_city: string | null;
  address_postal_code: string | null;
  address_country: string;
  email: string | null;
  phone: string | null;
  website: string | null;
  registry_note: string | null;
  has_logo: boolean;
  profile: Record<string, unknown> | null;
};

export interface PublicProfileView {
  slug: string;
  companyName: string;
  legalName: string;
  ico: string | null;
  dic: string | null;
  address: { street: string | null; city: string | null; postalCode: string | null; country: string } | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  registryNote: string | null;
  hasLogo: boolean;
  tagline: string | null;
  about: string | null;
  services: { id: string | null; title: string; description: string | null; price: string | null; unitPrice: number | null; unit: string | null }[];
  contactCta: boolean;
  /** "Přijímat objednávky z profilu"; customItems = the visitor may add their own unpriced lines; prepay = payment details after ordering. */
  orders: { enabled: boolean; customItems: boolean; prepay: boolean; currency: "CZK" | "EUR" };
  /** "Kontaktovat": a message form whose messages land in the owner's notifications. */
  contactForm: boolean;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * Anonymous read of a published company profile. Never touches
 * `req.tenantDb` — everything goes through the `get_public_profile*`
 * SECURITY DEFINER functions, which return nothing for an unpublished
 * profile and already drop the fields the owner chose to hide.
 */
@Injectable()
export class PublicProfilesService {
  constructor(private readonly dbService: DbService) {}

  async findBySlug(raw: string): Promise<PublicProfileView> {
    const slug = raw.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) throw new NotFoundException("Profile not found");
    const rows = await this.dbService.db.execute<PublicProfileRow>(sql`SELECT * FROM get_public_profile(${slug})`);
    const row = [...rows][0];
    if (!row) throw new NotFoundException("Profile not found");
    const p = row.profile ?? {};
    const services = Array.isArray(p.services)
      ? p.services.flatMap((s) => {
          const o = (s ?? {}) as Record<string, unknown>;
          const title = str(o.title);
          const id = typeof o.id === "string" && SERVICE_ID_PATTERN.test(o.id) ? o.id : null;
          return title ? [{ id, title, description: str(o.description), price: str(o.price), unitPrice: num(o.unitPrice), unit: str(o.unit) }] : [];
        })
      : [];
    const orders = (p.orders ?? {}) as Record<string, unknown>;
    const ordersEnabled = orders.enabled === true && services.some((s) => s.id);
    const hasAddress = Boolean(row.address_street || row.address_city);
    return {
      slug,
      companyName: row.company_name,
      legalName: row.legal_name,
      ico: row.ico,
      dic: row.dic,
      address: hasAddress
        ? { street: row.address_street, city: row.address_city, postalCode: row.address_postal_code, country: row.address_country }
        : null,
      email: row.email,
      phone: row.phone,
      website: row.website,
      registryNote: row.registry_note,
      hasLogo: row.has_logo,
      tagline: str(p.tagline),
      about: str(p.about),
      services,
      contactCta: p.contactCta !== false && Boolean(row.email),
      orders: { enabled: ordersEnabled, customItems: ordersEnabled && orders.customItems === true, prepay: ordersEnabled && orders.prepay === true, currency: orderCurrency(row.address_country) },
      contactForm: p.contactForm === true,
    };
  }

  async logo(raw: string): Promise<{ data: Buffer; mime: string }> {
    const slug = raw.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) throw new NotFoundException("No logo");
    const rows = await this.dbService.db.execute<{ logo_data: string | null; logo_mime: string | null }>(
      sql`SELECT * FROM get_public_profile_logo(${slug})`,
    );
    const row = [...rows][0];
    if (!row?.logo_data || !row.logo_mime) throw new NotFoundException("No logo");
    return { data: Buffer.from(row.logo_data, "base64"), mime: row.logo_mime };
  }
}
