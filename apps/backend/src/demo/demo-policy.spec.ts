import { describe, expect, it } from "vitest";
import { demoBlockFor } from "./demo-policy";

describe("demoBlockFor", () => {
  it.each([
    // Admin areas: reads and the two settings writes only.
    ["GET", "v1/tenants/me", null],
    ["HEAD", "v1/team", null],
    ["PATCH", "v1/tenants/me", null],
    ["PUT", "v1/tenants/me/number-formats", null],
    ["PUT", "v1/tenants/me/logo", "demo_disabled"],
    ["POST", "v1/tenants/me/bank-accounts", "demo_disabled"],
    ["POST", "v1/team/invitations", "demo_disabled"],
    ["POST", "v1/api-keys", "demo_disabled"],
    ["POST", "v1/billing/checkout", "demo_disabled"],
    ["POST", "v1/backup-destinations", "demo_disabled"],
    ["PUT", "v1/ai/settings", "demo_disabled"],
    ["POST", "v1/channel-links", "demo_disabled"],
    ["PUT", "v1/referrals/listing", "demo_disabled"],
    ["DELETE", "v1/tenants/me", "demo_disabled"],
    // E-mail actions.
    ["POST", "v1/invoices/abc/send", "demo_no_email"],
    ["POST", "v1/invoices/abc/remind", "demo_no_email"],
    ["POST", "v1/invoices/abc/buyer-details-request", "demo_no_email"],
    // Disabled features.
    ["POST", "v1/invoices/import", "demo_disabled"],
    ["POST", "v1/invoices/import/bitfaktura", "demo_disabled"],
    ["POST", "v1/invoices/import/fakturoid", "demo_disabled"],
    ["POST", "v1/invoices/abc/attachments", "demo_disabled"],
    ["GET", "v1/bank-reconciliation/connections", "demo_disabled"],
    ["POST", "v1/bank-reconciliation/connections/abc/sync", "demo_disabled"],
    ["PUT", "v1/integrations/webhooks", "demo_disabled"],
    ["POST", "v1/integrations/webhooks/abc/test", "demo_disabled"],
    ["GET", "v1/invoices/abc/isdoc", "demo_disabled"],
    ["GET", "v1/invoices/abc/ubl", "demo_disabled"],
    // Everyday work stays open.
    ["POST", "v1/invoices", null],
    ["POST", "v1/invoices/abc/mark-paid", null],
    ["POST", "v1/invoices/abc/convert", null],
    ["POST", "v1/bank-reconciliation/transactions/abc/match", null],
    ["GET", "v1/invoices/abc/pdf", null],
    ["GET", "v1/invoices/abc/ubl/check", null],
    ["GET", "v1/integrations/webhooks", null],
    ["GET", "v1/exports/pohoda", null],
  ])("%s %s -> %s", (method, path, expected) => {
    expect(demoBlockFor(method, path)).toBe(expected);
  });
});
