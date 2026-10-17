import { randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Settings → Veřejný profil (`tenants.public_profile`, jsonb): a small
 * public business-card page at `/p/<slug>` — or `<slug>.<profile domain>`
 * when the frontend runs with `PUBLIC_PROFILE_DOMAIN` and a wildcard DNS
 * record. Idea from Invoice Ninja's client-portal subdomains and
 * Fakturoid's public profile. Read anonymously only through the
 * `get_public_profile` SECURITY DEFINER function (drizzle/rls-policies.sql),
 * which honours the `show` flags below and never returns bank details.
 */
export const RESERVED_PROFILE_SLUGS = [
  "www", "app", "api", "admin", "mail", "smtp", "static", "assets", "cdn", "docs", "help", "status",
  "blog", "login", "signup", "billanta", "faktura", "faktury", "invoice", "p", "i", "demo", "test",
];
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
export const MAX_PROFILE_SERVICES = 12;
/** A service's stable id: the per-service order link (`?service=<id>`) keeps working when services are reordered or renamed. */
export const SERVICE_ID_PATTERN = /^[a-z0-9]{6,24}$/;
/** Highest unit price a service may carry (per unit, in the profile's currency). */
export const MAX_SERVICE_PRICE = 10_000_000;

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

export const publicProfileSchema = z
  .object({
    enabled: z.boolean().default(false),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SLUG_PATTERN)
      .refine((s) => !RESERVED_PROFILE_SLUGS.includes(s), "reserved slug")
      .nullish()
      .transform((v) => v || null),
    tagline: text(120),
    about: text(2000),
    services: z
      .array(
        z.object({
          id: z
            .string()
            .trim()
            .toLowerCase()
            .regex(SERVICE_ID_PATTERN)
            .nullish()
            .transform((v) => v || null),
          title: z.string().trim().min(1).max(80),
          description: text(300),
          // Free display text ("od 500 Kč/hod"); an order uses unitPrice + unit below.
          price: text(40),
          unitPrice: z
            .number()
            .min(0)
            .max(MAX_SERVICE_PRICE)
            .nullish()
            .transform((v) => (v == null ? null : Math.round(v * 100) / 100)),
          unit: text(16),
        }),
      )
      .max(MAX_PROFILE_SERVICES)
      .default([]),
    show: z
      .object({
        email: z.boolean().default(true),
        phone: z.boolean().default(false),
        website: z.boolean().default(true),
        address: z.boolean().default(true),
        ico: z.boolean().default(true),
        logo: z.boolean().default(true),
      })
      .default({}),
    // Lets visitors request a quote by email (a prefilled mailto:, nothing is stored).
    contactCta: z.boolean().default(true),
    // "Přijímat objednávky z profilu": visitors can order a service, which
    // becomes a draft for review (public-profiles/profile-orders.service.ts).
    // customItems lets them add their own unpriced lines too. prepay ("Platba
    // předem") shows payment details with a QR code after the order, with a
    // variable symbol stored on the draft for bank matching. All off by default.
    orders: z
      .object({
        enabled: z.boolean().default(false),
        customItems: z.boolean().default(false),
        prepay: z.boolean().default(false),
      })
      .default({}),
    // "Kontaktovat": a message form on the profile that lands in the owner's
    // in-app notifications (public-profiles/profile-messages.service.ts). Off by default.
    contactForm: z.boolean().default(false),
  })
  .refine((p) => !p.enabled || p.slug, { message: "slug is required to publish", path: ["slug"] });

export type PublicProfile = z.output<typeof publicProfileSchema>;

/** Stored profile, tolerant of an empty `{}` or hand-edited shape. */
export function publicProfileOf(stored: unknown): PublicProfile {
  const parsed = publicProfileSchema.safeParse(stored && typeof stored === "object" ? stored : {});
  if (parsed.success) return parsed.data;
  const fallback = publicProfileSchema.safeParse({});
  return { ...(fallback.success ? fallback.data : ({} as PublicProfile)), enabled: false };
}

/** Gives every service a unique id (new ones, and duplicates from a copy-paste), keeping the ids already there. */
export function withServiceIds(profile: PublicProfile, newId: () => string = () => randomBytes(6).toString("hex")): PublicProfile {
  const seen = new Set<string>();
  const services = profile.services.map((s) => {
    let id = s.id && !seen.has(s.id) ? s.id : null;
    while (!id || seen.has(id)) id = newId();
    seen.add(id);
    return { ...s, id };
  });
  return { ...profile, services };
}
