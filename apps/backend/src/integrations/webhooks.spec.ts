import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { detectWebhookKind, mergeWebhooks, signWebhookBody, webhookBody, webhookUrlProblem, webhooksOf } from "./webhooks";
import { buildIcs } from "./ics";

describe("webhookUrlProblem", () => {
  it("allows public https in production", () => {
    expect(webhookUrlProblem("https://discord.com/api/webhooks/1/abc", true)).toBeNull();
  });
  it("refuses http, private hosts and credentials in production", () => {
    expect(webhookUrlProblem("http://example.com/hook", true)).toBe("https_only");
    expect(webhookUrlProblem("https://10.0.0.5/hook", true)).toBe("private_host");
    expect(webhookUrlProblem("https://169.254.169.254/latest", true)).toBe("private_host");
    expect(webhookUrlProblem("https://backend:3000/x", true)).toBe("private_host");
    expect(webhookUrlProblem("https://[::1]/x", true)).toBe("private_host");
    expect(webhookUrlProblem("https://u:p@example.com/x", true)).toBe("invalid_url");
    expect(webhookUrlProblem("nope", true)).toBe("invalid_url");
  });
  it("allows localhost outside production", () => {
    expect(webhookUrlProblem("http://localhost:4000/hook", false)).toBeNull();
  });
});

describe("webhooks", () => {
  it("detects the kind from the URL", () => {
    expect(detectWebhookKind("https://discord.com/api/webhooks/1/x")).toBe("discord");
    expect(detectWebhookKind("https://hooks.slack.com/services/x")).toBe("slack");
    expect(detectWebhookKind("https://example.com/x")).toBe("json");
  });

  it("keeps secrets on save and mints one for new json hooks", () => {
    const first = mergeWebhooks([], [{ name: "ERP", url: "https://example.com/x", events: ["invoice_paid"], enabled: true }]);
    if ("error" in first) throw new Error(first.error);
    const hook = first.webhooks[0]!;
    expect(hook.kind).toBe("json");
    expect(hook.secret).toMatch(/^[0-9a-f]{48}$/);
    const second = mergeWebhooks(first.webhooks, [{ id: hook.id, name: "ERP 2", url: hook.url, events: [], enabled: false }]);
    if ("error" in second) throw new Error(second.error);
    expect(second.webhooks[0]).toMatchObject({ id: hook.id, secret: hook.secret, name: "ERP 2", enabled: false });
  });

  it("reports the failing index", () => {
    const r = mergeWebhooks([], [{ name: "", url: "https://example.com", events: [], enabled: true }, { name: "", url: "ftp://x", events: [], enabled: true }]);
    expect(r).toMatchObject({ index: 1 });
  });

  it("ignores malformed stored data", () => {
    expect(webhooksOf({ nope: 1 })).toEqual([]);
    expect(webhooksOf([{ id: "a", name: "", url: "https://x.cz", kind: "slack", events: ["invoice_paid", "gone"], enabled: true }])[0]!.events).toEqual([
      "invoice_paid",
    ]);
  });

  it("builds bodies per kind", () => {
    const ctx = { company: "ACME", siteUrl: "https://app.billanta.cz" };
    const p = { title: "Zaplaceno", body: "FV 1", link: "/invoices/1" };
    const discord = JSON.parse(webhookBody("discord", "invoice_paid", p, ctx));
    expect(discord.embeds[0]).toMatchObject({ title: "Zaplaceno", url: "https://app.billanta.cz/invoices/1", color: 0x16a34a });
    expect(JSON.parse(webhookBody("slack", "invoice_paid", p, ctx)).text).toContain("*Zaplaceno*");
    expect(JSON.parse(webhookBody("json", "invoice_paid", p, ctx))).toMatchObject({ event: "invoice_paid", company: "ACME" });
  });

  it("signs with HMAC-SHA256", () => {
    expect(signWebhookBody("s", "{}")).toBe(`sha256=${createHmac("sha256", "s").update("{}").digest("hex")}`);
  });
});

describe("buildIcs", () => {
  it("writes all-day events with escaping and folding", () => {
    const ics = buildIcs("Termíny", [
      { uid: "a@x", date: "2026-12-31", summary: "DPH; kontrolní, hlášení", description: "řádek\ndruhý ".repeat(10) },
    ]);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261231");
    expect(ics).toContain("DTEND;VALUE=DATE:20270101");
    expect(ics).toContain(String.raw`SUMMARY:DPH\; kontrolní\, hlášení`);
    for (const line of ics.split("\r\n")) expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});
