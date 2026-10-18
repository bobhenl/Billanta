import { ADMIN_PREFIXES, under } from "../tenancy/role-access.guard";

export type DemoBlockCode = "demo_disabled" | "demo_no_email";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Company administration a demo may still change; the triggers lock the identity fields inside. */
const ADMIN_WRITES_ALLOWED = [
  ["PATCH", "v1/tenants/me"],
  ["PUT", "v1/tenants/me/number-formats"],
] as const;

/** Invoice actions that would e-mail someone. */
const EMAIL_ACTION = /^v1\/invoices\/[^/]+\/(send|remind|buyer-details-request)$/;

const DISABLED: Array<{ method: string | null; pattern: RegExp }> = [
  // Imports pull in real data from elsewhere.
  { method: "POST", pattern: /^v1\/invoices\/import(\/(bitfaktura|fakturoid))?$/ },
  { method: "POST", pattern: /^v1\/invoices\/[^/]+\/attachments$/ },
  // Real bank logins.
  { method: null, pattern: /^v1\/bank-reconciliation\/connections(\/.*)?$/ },
  // Webhooks call out to the internet.
  { method: "PUT", pattern: /^v1\/integrations\/webhooks$/ },
  { method: "POST", pattern: /^v1\/integrations\/webhooks\/[^/]+\/test$/ },
  // Sendable e-invoices would carry no watermark.
  { method: "GET", pattern: /^v1\/invoices\/[^/]+\/(isdoc|ubl)$/ },
];

/**
 * Whether a demo company may send `method` to `path` (normalised by
 * `guardPath`). Admin areas are closed by default, so a new admin route is
 * safe without touching this file. Accounting exports stay open: the data is
 * fictional and they show the product well.
 */
export function demoBlockFor(method: string, path: string): DemoBlockCode | null {
  const m = method.toUpperCase();
  if (ADMIN_PREFIXES.some((p) => under(path, p))) {
    if (SAFE_METHODS.has(m)) return null;
    return ADMIN_WRITES_ALLOWED.some(([am, ap]) => am === m && ap === path) ? null : "demo_disabled";
  }
  if (m === "POST" && EMAIL_ACTION.test(path)) return "demo_no_email";
  if (DISABLED.some((r) => (r.method === null || r.method === m) && r.pattern.test(path))) return "demo_disabled";
  return null;
}
