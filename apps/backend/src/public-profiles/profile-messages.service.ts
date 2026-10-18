import { BadRequestException, HttpException, HttpStatus, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { DbService } from "../db/db.service";
import { SlidingWindowLimiter } from "../guest-invoices/guest-limits";
import { NotificationsService } from "../notifications/notifications.service";
import { SERVICE_ID_PATTERN, SLUG_PATTERN } from "../tenants/public-profile";
import { PublicProfilesService } from "./public-profiles.service";

export const MAX_PROFILE_MESSAGE = 2000;
/** Messages one company accepts per day before the endpoint answers 429. */
export const DEFAULT_DAILY_MESSAGE_CAP = 30;

/** What the "Kontaktovat" form posts. Strict, every text capped. */
export const profileMessageSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().max(200).email(),
    message: z.string().trim().min(5).max(MAX_PROFILE_MESSAGE),
    // The service the visitor asked about, if they came from one; only used for the title.
    serviceId: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SERVICE_ID_PATTERN)
      .nullish()
      .transform((v) => v || null),
    // Honeypot, as on the order form.
    website: z.string().max(500).optional(),
  })
  .strict();

export type ProfileMessage = z.output<typeof profileMessageSchema>;

export type ParsedMessage =
  | { kind: "message"; message: ProfileMessage }
  | { kind: "bot" }
  | { kind: "invalid"; issues: { path: string; message: string }[] };

export function parseProfileMessage(body: unknown): ParsedMessage {
  const raw = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (typeof raw.website === "string" && raw.website.trim()) return { kind: "bot" };
  const parsed = profileMessageSchema.safeParse(body);
  if (!parsed.success) return { kind: "invalid", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) };
  return { kind: "message", message: parsed.data };
}

/** The notification the members get. Plain text; the app renders it escaped. */
export function messageNotification(message: ProfileMessage, serviceTitle: string | null) {
  return {
    title: `Zpráva z profilu: ${message.name}${serviceTitle ? ` (${serviceTitle})` : ""}`.slice(0, 200),
    body: `Od: ${message.name} <${message.email}>\n\n${message.message}`,
    link: null,
  };
}

/**
 * "Kontaktovat" on the public company profile: the visitor's message lands
 * in the members' notifications (the bell, plus e-mail only for members who
 * switched that on for this event). Nothing is stored elsewhere and nothing
 * is sent to the visitor. Off unless the owner switched the form on; the
 * slug is resolved by the `get_profile_message_target` SECURITY DEFINER
 * function and the notification is written under RLS by NotificationsService.
 */
@Injectable()
export class ProfileMessagesService {
  // In memory and per company: one VPS, and a restart only resets the cap early.
  private readonly perCompany = new SlidingWindowLimiter(24 * 60 * 60 * 1000, Number(process.env.PROFILE_MESSAGE_DAILY_LIMIT ?? DEFAULT_DAILY_MESSAGE_CAP));

  constructor(
    private readonly dbService: DbService,
    private readonly profiles: PublicProfilesService,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  async target(rawSlug: string): Promise<string | null> {
    const slug = rawSlug.trim().toLowerCase();
    if (!SLUG_PATTERN.test(slug)) return null;
    const rows = await this.dbService.db.execute<{ tenant_id: string | null }>(sql`SELECT get_profile_message_target(${slug}) AS tenant_id`);
    return [...rows][0]?.tenant_id ?? null;
  }

  /** 400 for invalid input, 404 when the form is off, 429 at the company's daily cap. A bot gets a quiet success. */
  async submit(slug: string, body: unknown): Promise<void> {
    const parsed = parseProfileMessage(body);
    if (parsed.kind === "invalid") throw new BadRequestException({ error: "invalid_input", issues: parsed.issues });
    const tenantId = await this.target(slug);
    if (!tenantId) throw new NotFoundException("Profile not found");
    if (parsed.kind === "bot") return;
    if (!this.perCompany.hit(tenantId)) throw new HttpException({ error: "daily_cap" }, HttpStatus.TOO_MANY_REQUESTS);

    let serviceTitle: string | null = null;
    if (parsed.message.serviceId) {
      const profile = await this.profiles.findBySlug(slug).catch(() => null);
      serviceTitle = profile?.services.find((s) => s.id === parsed.message.serviceId)?.title ?? null;
    }
    this.notifications?.notify(tenantId, "profile_message", messageNotification(parsed.message, serviceTitle));
  }
}
