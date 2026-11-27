import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../../drizzle/schema";
import { InvoicesService } from "../invoices/invoices.service";
import { cardSealStep } from "./sealed-payments";

// A card payment of a document with sealed amounts waits with its plain amount
// until a browser with the key seals it (migration 0118).

const env = (key: string, ct = "QUJD") => `enc:v1:AAAAAAAAAAAAAAAA:${ct}:${key.repeat(16)}:${key.repeat(64)}`;
const INVOICE = "00000000-0000-4000-8000-0000000000a1";
const OTHER_INVOICE = "00000000-0000-4000-8000-0000000000a2";
const CARD = "00000000-0000-4000-8000-0000000000c1";

const dialect = new PgDialect();
/** The values a drizzle condition compares with, so the fake can tell which rows it selects. */
const paramsOf = (where: SQL | undefined) => (where ? dialect.sqlToQuery(where).params : []);

type Session = { id: string; invoiceId: string; status: string; sealState: "pending" | "sealed" | "dropped" | null; amount: string | null; fee: string | null; paidAt: Date; sealedPaymentId: string | null };

/**
 * One company's rows. A select or update hits the card payment only when its
 * condition names the payment's id, its document and (for the claim) the
 * state it expects, as Postgres would; `beforeClaim` lets a second tab win.
 */
function store(session: Session, invoice = { id: INVOICE, tenantId: "t1", invoiceNumber: "2026001", documentType: "invoice", status: "paid", variableSymbol: "2026001", encAmounts: env("A") }) {
  const payments: { id: string; [k: string]: unknown }[] = [];
  const hooks: { beforeClaim?: () => void } = {};
  // No document in the condition means any document, as in SQL.
  const namesDocument = (p: unknown[]) => p.includes(INVOICE) || p.includes(OTHER_INVOICE);
  const matchesSession = (p: unknown[]) => p.includes(session.id) && (!namesDocument(p) || p.includes(session.invoiceId));
  const chain = (run: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["limit", "orderBy", "innerJoin", "returning"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve().then(run).then(ok, fail);
    return c;
  };
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: (where: SQL) =>
          chain(() => {
            const p = paramsOf(where);
            if (table === schema.invoices) return p.includes(invoice.id) ? [invoice] : [];
            if (table === schema.cardPaymentSessions) return matchesSession(p) ? [{ ...session }] : [];
            if (table === schema.invoiceSealedPayments) return payments.filter((x) => p.includes(x.id));
            return [];
          }),
      }),
    }),
    update: (table: unknown) => ({
      set: (set: Partial<Session>) => ({
        where: (where: SQL) =>
          chain(() => {
            if (table !== schema.cardPaymentSessions) return [];
            const p = paramsOf(where);
            if (p.includes("pending")) hooks.beforeClaim?.();
            if (!matchesSession(p)) return [];
            if (p.includes("pending") && session.sealState !== "pending") return [];
            Object.assign(session, set);
            return [{ ...session }];
          }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          if (table !== schema.invoiceSealedPayments) return [];
          const row = { id: `p${payments.length + 1}`, ...values };
          payments.push(row);
          return [row];
        },
      }),
    }),
  };
  return { db, payments, session, hooks };
}

const pending = (over: Partial<Session> = {}): Session => ({
  id: CARD,
  invoiceId: INVOICE,
  status: "paid",
  sealState: "pending",
  amount: "1210.00",
  fee: "18.15",
  paidAt: new Date("2026-11-20T10:00:00Z"),
  sealedPaymentId: null,
  ...over,
});

const service = () => new InvoicesService({} as never, {} as never, undefined, undefined, undefined);
const seal = (s: ReturnType<typeof store>, invoiceId = INVOICE, encAmount = env("A", "WFla")) =>
  service().sealCardPayment(s.db as never, "t1", "u1", invoiceId, CARD, encAmount);

describe("cardSealStep", () => {
  it("seals a waiting card payment and answers a repeat with 'done'", () => {
    expect(cardSealStep({ sealState: "pending", status: "paid" })).toBe("seal");
    expect(cardSealStep({ sealState: "sealed", status: "paid" })).toBe("done");
  });

  it("refuses a payment it can't see (404) and one with nothing to seal (409 card_payment_not_pending)", () => {
    expect(() => cardSealStep(undefined)).toThrow(NotFoundException);
    for (const s of [{ sealState: "dropped" as const, status: "paid" }, { sealState: null, status: "paid" }, { sealState: "pending" as const, status: "open" }]) {
      expect(() => cardSealStep(s)).toThrow(ConflictException);
      expect(() => cardSealStep(s)).toThrow("card_payment_not_pending");
    }
  });
});

describe("InvoicesService.sealCardPayment", () => {
  it("stores the envelope as a payment of the document and forgets the plain amount and fee", async () => {
    const s = store(pending());
    const result = await seal(s);
    expect(result.sealed).toBe(true);
    expect(s.payments).toEqual([
      expect.objectContaining({ tenantId: "t1", invoiceId: INVOICE, paidAt: "2026-11-20", variableSymbol: "2026001", encAmount: env("A", "WFla"), createdBy: "u1" }),
    ]);
    expect(s.session).toMatchObject({ sealState: "sealed", amount: null, fee: null, sealedPaymentId: "p1" });
  });

  it("answers a retry with the payment sealed the first time, without a second one", async () => {
    const s = store(pending());
    await seal(s);
    const again = await seal(s);
    expect(again).toEqual({ sealed: false, payment: expect.objectContaining({ id: "p1" }) });
    expect(s.payments).toHaveLength(1);
  });

  it("lets only one of two racing tabs seal it", async () => {
    const s = store(pending());
    // The other tab sealed it between this request's read and its claim.
    s.hooks.beforeClaim = () => {
      s.hooks.beforeClaim = undefined;
      s.payments.push({ id: "p-other" });
      Object.assign(s.session, { sealState: "sealed", amount: null, fee: null, sealedPaymentId: "p-other" });
    };
    const result = await seal(s);
    expect(result).toEqual({ sealed: false, payment: { id: "p-other" } });
    expect(s.payments).toHaveLength(1);
  });

  it("refuses an envelope under another document's key (400 document_key_mismatch) and keeps the payment waiting", async () => {
    const s = store(pending());
    await expect(seal(s, INVOICE, env("B"))).rejects.toThrow("document_key_mismatch");
    expect(s.payments).toHaveLength(0);
    expect(s.session).toMatchObject({ sealState: "pending", amount: "1210.00" });
  });

  it("finds the card payment only under its own document", async () => {
    // A card payment of another document (or company: RLS hides it the same way) is not found through this one.
    const s = store(pending({ invoiceId: OTHER_INVOICE }));
    await expect(seal(s)).rejects.toThrow(NotFoundException);
    expect(s.payments).toHaveLength(0);
    expect(s.session.sealState).toBe("pending");
  });

  it("refuses a card payment dropped by mark-unpaid", async () => {
    const s = store(pending({ sealState: "dropped", amount: null, fee: null }));
    await expect(seal(s)).rejects.toThrow("card_payment_not_pending");
    expect(s.payments).toHaveLength(0);
  });

  it("refuses a document whose amounts the server can read (409 amounts_plain)", async () => {
    const s = store(pending(), { id: INVOICE, tenantId: "t1", invoiceNumber: "1", documentType: "invoice", status: "paid", variableSymbol: "1", encAmounts: null as never });
    await expect(seal(s)).rejects.toThrow("amounts_plain");
  });
});

describe("mark-unpaid of a sealed document", () => {
  it("drops a card payment nobody sealed yet, with its plain numbers", async () => {
    const invoice = { id: INVOICE, tenantId: "t1", invoiceNumber: "1", documentType: "invoice", status: "paid", encAmounts: env("A") };
    const updates: { table: unknown; set: Record<string, unknown>; params: unknown[] }[] = [];
    const thenable = (value: unknown) => {
      const c: Record<string, unknown> = { limit: () => c, returning: () => c };
      c.then = (ok: (v: unknown) => unknown) => Promise.resolve(value).then(ok);
      return c;
    };
    const db = {
      select: () => ({ from: () => ({ where: () => thenable([invoice]) }) }),
      delete: () => ({ where: () => thenable(undefined) }),
      update: (table: unknown) => ({
        set: (set: Record<string, unknown>) => ({
          where: (where: SQL) => {
            updates.push({ table, set, params: paramsOf(where) });
            return thenable([{ ...invoice, status: "issued" }]);
          },
        }),
      }),
    };
    await service().markUnpaid(db as never, INVOICE);
    const card = updates.find((u) => u.table === schema.cardPaymentSessions);
    expect(card?.set).toEqual({ sealState: "dropped", amount: null, fee: null });
    expect(card?.params).toEqual(expect.arrayContaining([INVOICE, "pending"]));
  });
});

describe("migration 0118 and rls-policies.sql", () => {
  const read = (p: string) => readFileSync(join(__dirname, "../../drizzle", p), "utf8").replace(/\r\n/g, "\n");
  const migration = read("migrations/0118_vault_card_payments.sql");
  const policies = read("rls-policies.sql");
  const memberVisibility = /CREATE POLICY member_visibility ON "?card_payment_sessions"? AS RESTRICTIVE\n\s+USING \(CASE \(SELECT app_view_mode\(\)\)\n\s+WHEN 'full' THEN true\n\s+ELSE EXISTS \(SELECT 1 FROM invoices i WHERE i\.id = card_payment_sessions\.invoice_id\)\n\s+END\);/;

  it("hides a private invoice's card payments like its sealed payments, in both files", () => {
    expect(migration).toMatch(memberVisibility);
    expect(policies).toMatch(memberVisibility);
  });

  it("keeps the tenant policy on card_payment_sessions", () => {
    expect(policies).toMatch(/ALTER TABLE card_payment_sessions FORCE ROW LEVEL SECURITY;/);
    expect(policies).toMatch(/CREATE POLICY tenant_isolation ON card_payment_sessions\n\s+USING \(tenant_id = current_setting\('app\.current_tenant_id', true\)::uuid\)\n\s+WITH CHECK/);
  });

  it("lets a card payment lose its amount only once it is sealed or dropped", () => {
    expect(migration).toContain(`CHECK ("amount" IS NOT NULL OR "seal_state" IN ('sealed', 'dropped'))`);
    expect(migration).toContain(`("seal_state" = 'pending' AND "status" = 'paid' AND "amount" IS NOT NULL)`);
  });
});
