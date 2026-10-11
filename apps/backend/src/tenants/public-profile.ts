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
          title: z.string().trim().min(1).max(80),
          description: text(300),
          price: text(40),
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
