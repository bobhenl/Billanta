import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { NOTIFICATION_EVENTS, type NotificationEvent } from "../notifications/notification-prefs";
import { publicUrlProblem } from "./public-url";

/**
 * Outgoing webhooks (Settings → Integrace), stored as `tenants.webhooks`
 * jsonb. They fire on the same events as member notifications (invoice paid,
 * viewed, overdue…). Three body shapes:
 *   - discord: an embed (Discord "Incoming Webhook" URL),
 *   - slack:   `{ text }` (Slack/Mattermost/Google Chat incoming webhooks),
 *   - json:    `{ event, title, body, url, company, sentAt }` signed with
 *              `X-Billanta-Signature: sha256=<hmac of the raw body>`.
 * Delivery is best-effort (5 s timeout, no retries) and never breaks the
 * action that triggered it.
 */
export const WEBHOOK_KINDS = ["discord", "slack", "json"] as const;
export type WebhookKind = (typeof WEBHOOK_KINDS)[number];
export const MAX_WEBHOOKS = 10;

export interface Webhook {
  id: string;
  name: string;
  url: string;
  kind: WebhookKind;
  events: NotificationEvent[];
  enabled: boolean;
  /** HMAC secret for `json` hooks (generated, shown to admins to verify signatures). */
  secret?: string;
}

export interface WebhookPayload {
  title: string;
  body?: string | null;
  /** App path without locale, e.g. `/invoices/<id>`. */
  link?: string | null;
}

const PRIVATE_HOST =
  /^(localhost|.*\.localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|169\.254\.\d+\.\d+|\[.*\])$/i;

/**
 * Only public https endpoints in production: the URL is tenant-supplied and
 * fetched from inside our network, so internal hosts (other containers,
 * cloud metadata, private ranges, bare single-label names) are refused.
 */
export function webhookUrlProblem(raw: string, production = process.env.NODE_ENV === "production"): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "invalid_url";
  }
  const host = url.hostname.toLowerCase();
  const local = PRIVATE_HOST.test(host) || !host.includes(".");
  if (!production && local && (url.protocol === "http:" || url.protocol === "https:")) return null;
  if (url.protocol !== "https:") return "https_only";
  if (local) return "private_host";
  if (url.username || url.password) return "invalid_url";
  return null;
}

export function detectWebhookKind(url: string): WebhookKind {
  if (/^https:\/\/(\w+\.)?discord(app)?\.com\/api\/webhooks\//i.test(url)) return "discord";
  if (/^https:\/\/hooks\.slack\.com\//i.test(url)) return "slack";
  return "json";
}

export const webhookInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().max(60).default(""),
  url: z.string().trim().min(8).max(500),
  kind: z.enum(WEBHOOK_KINDS).optional(),
  events: z.array(z.enum(NOTIFICATION_EVENTS)).max(NOTIFICATION_EVENTS.length),
  enabled: z.boolean().default(true),
});
export type WebhookInput = z.infer<typeof webhookInputSchema>;

const storedSchema = z.array(
  z.object({
    id: z.string(),
    name: z.string().default(""),
    url: z.string(),
    kind: z.enum(WEBHOOK_KINDS),
    events: z.array(z.string()),
    enabled: z.boolean(),
    secret: z.string().optional(),
  }),
);

export function webhooksOf(stored: unknown): Webhook[] {
  const parsed = storedSchema.safeParse(stored ?? []);
  if (!parsed.success) return [];
  return parsed.data.map((h) => ({
    ...h,
    events: h.events.filter((e): e is NotificationEvent => (NOTIFICATION_EVENTS as readonly string[]).includes(e)),
  }));
}

/** Validated next list; keeps each existing hook's secret, mints one for new `json` hooks. */
export function mergeWebhooks(current: Webhook[], input: WebhookInput[]): { webhooks: Webhook[] } | { error: string; index: number } {
  if (input.length > MAX_WEBHOOKS) return { error: "too_many", index: MAX_WEBHOOKS };
  const out: Webhook[] = [];
  for (const [index, h] of input.entries()) {
    const problem = webhookUrlProblem(h.url);
    if (problem) return { error: problem, index };
    const prev = h.id ? current.find((c) => c.id === h.id) : undefined;
    const kind = h.kind ?? detectWebhookKind(h.url);
    out.push({
      id: prev?.id ?? randomUUID(),
      name: h.name,
      url: h.url,
      kind,
      events: [...new Set(h.events)],
      enabled: h.enabled,
      ...(kind === "json" ? { secret: prev?.secret ?? randomBytes(24).toString("hex") } : {}),
    });
  }
  return { webhooks: out };
}

export interface WebhookContext {
  company: string;
  siteUrl: string;
}

const EVENT_COLORS: Partial<Record<NotificationEvent | "test", number>> = {
  invoice_paid: 0x16a34a,
  invoice_overdue: 0xdc2626,
  reminder_sent: 0xf59e0b,
};

export function webhookBody(kind: WebhookKind, event: NotificationEvent | "test", payload: WebhookPayload, ctx: WebhookContext, now = new Date()): string {
  const url = payload.link ? `${ctx.siteUrl}${payload.link}` : null;
  if (kind === "discord") {
    return JSON.stringify({
      username: "Billanta",
      embeds: [
        {
          title: payload.title.slice(0, 256),
          description: (payload.body ?? "").slice(0, 2000) || undefined,
          url: url ?? undefined,
          color: EVENT_COLORS[event] ?? 0x4f46e5,
          footer: { text: ctx.company.slice(0, 100) },
          timestamp: now.toISOString(),
        },
      ],
    });
  }
  if (kind === "slack") {
    const lines = [`*${payload.title}*`, payload.body, url ? `<${url}|Otevřít v Billantě>` : null].filter(Boolean);
    return JSON.stringify({ text: lines.join("\n") });
  }
  return JSON.stringify({ event, title: payload.title, body: payload.body ?? null, url, company: ctx.company, sentAt: now.toISOString() });
}

export function signWebhookBody(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** One POST; resolves with the HTTP status (0 = network error / timeout). Never throws. */
export async function sendWebhook(hook: Webhook, event: NotificationEvent | "test", payload: WebhookPayload, ctx: WebhookContext): Promise<number> {
  if (await publicUrlProblem(hook.url)) return 0;
  const body = webhookBody(hook.kind, event, payload, ctx);
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "Billanta-Webhooks/1.0" };
  if (hook.kind === "json") {
    headers["x-billanta-event"] = event;
    if (hook.secret) headers["x-billanta-signature"] = signWebhookBody(hook.secret, body);
  }
  try {
    const res = await fetch(hook.url, { method: "POST", headers, body, redirect: "manual", signal: AbortSignal.timeout(5000) });
    return res.status;
  } catch {
    return 0;
  }
}

/** Fires every enabled hook subscribed to `event`; returns how many answered 2xx. */
export async function dispatchWebhooks(stored: unknown, event: NotificationEvent, payload: WebhookPayload, ctx: WebhookContext): Promise<number> {
  const hooks = webhooksOf(stored).filter((h) => h.enabled && h.events.includes(event));
  const statuses = await Promise.all(hooks.map((h) => sendWebhook(h, event, payload, ctx)));
  return statuses.filter((s) => s >= 200 && s < 300).length;
}
