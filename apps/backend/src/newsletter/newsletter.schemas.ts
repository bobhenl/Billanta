import { createZodDto } from "nestjs-zod";
import { z } from "zod";
import { NEWSLETTER_TOPICS } from "../../drizzle/schema";

export const NEWSLETTER_LOCALES = ["cs", "sk", "en"] as const;
export const NEWSLETTER_COUNTRIES = ["CZ", "SK"] as const;
export const NEWSLETTER_SOURCES = ["blog", "guides", "calculators", "sk_einvoicing", "settings", "other"] as const;

const topics = z
  .array(z.enum(NEWSLETTER_TOPICS))
  .min(1)
  .max(NEWSLETTER_TOPICS.length)
  .transform((t) => [...new Set(t)]);

/**
 * The wording shown next to the form, sent by the frontend's server (from
 * its own messages, never from the browser) and stored as the consent
 * evidence.
 */
const consentText = z.string().trim().min(20).max(2000);

export const subscribeSchema = z.object({
  email: z.string().trim().toLowerCase().max(320).email(),
  locale: z.enum(NEWSLETTER_LOCALES),
  country: z.enum(NEWSLETTER_COUNTRIES),
  topics,
  source: z.enum(NEWSLETTER_SOURCES).catch("other"),
  consentText,
  /** Honeypot: a hidden field people never fill. */
  website: z.string().max(200).optional(),
});
export type SubscribeInput = z.infer<typeof subscribeSchema>;
export class SubscribeDto extends createZodDto(subscribeSchema) {}

export const meNewsletterSchema = z.object({
  subscribed: z.boolean(),
  locale: z.enum(NEWSLETTER_LOCALES),
  country: z.enum(NEWSLETTER_COUNTRIES).optional(),
  topics: topics.optional(),
  consentText: consentText.optional(),
});
export type MeNewsletterInput = z.infer<typeof meNewsletterSchema>;
export class MeNewsletterDto extends createZodDto(meNewsletterSchema) {}

export const issueSchema = z.object({
  locale: z.enum(NEWSLETTER_LOCALES),
  country: z.enum(NEWSLETTER_COUNTRIES).nullable(),
  topics,
  subject: z.string().trim().min(3).max(200),
  body: z.string().trim().min(10).max(50_000),
});
export type IssueInput = z.infer<typeof issueSchema>;
export class CreateIssueDto extends createZodDto(issueSchema) {}
export class UpdateIssueDto extends createZodDto(issueSchema.partial()) {}

export class DraftIssueDto extends createZodDto(
  z.object({ locale: z.enum(NEWSLETTER_LOCALES), country: z.enum(NEWSLETTER_COUNTRIES).nullable().default(null) }),
) {}
