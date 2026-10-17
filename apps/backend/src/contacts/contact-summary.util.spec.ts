import { NotFoundException } from "@nestjs/common";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import type { DbService } from "../db/db.service";
import { summarizeContactInvoices, type ContactSummaryBucket } from "./contact-summary.util";
import { ContactsService } from "./contacts.service";

vi.mock("@faktur/cz-compliance", () => ({}));

const TODAY = new Date("2026-10-17T12:00:00");

function bucket(over: Partial<ContactSummaryBucket>): ContactSummaryBucket {
  return {
    invoiceId: "i1",
    currency: "CZK",
    status: "issued",
    documentType: "invoice",
    dueDate: "2026-11-01",
    issueDate: "2026-10-01",
    amountPaid: "0",
    reverseCharge: false,
    vatRate: "21",
    base: "1000",
    ...over,
  };
}

describe("summarizeContactInvoices", () => {
  it("sums per currency with VAT per rate bucket and splits unpaid from overdue", () => {
    const s = summarizeContactInvoices(
      [
        // i1: CZK, two rate buckets 1000 @21 % + 200 @12 % = 1210 + 224 = 1434, not due yet
        bucket({ invoiceId: "i1", vatRate: "21", base: "1000" }),
        bucket({ invoiceId: "i1", vatRate: "12", base: "200" }),
        // i2: CZK paid 500 @0 %, nothing open
        bucket({ invoiceId: "i2", status: "paid", vatRate: "0", base: "500", amountPaid: "500", issueDate: "2026-09-01" }),
        // i3: EUR 100 @21 % = 121, 21 paid, overdue 100
        bucket({ invoiceId: "i3", currency: "EUR", vatRate: "21", base: "100", amountPaid: "21", dueDate: "2026-10-10", issueDate: "2026-10-05" }),
        // i4: EUR reverse charge 300, overdue in full
        bucket({ invoiceId: "i4", currency: "EUR", vatRate: "21", base: "300", reverseCharge: true, dueDate: "2026-10-16", issueDate: "2026-08-01" }),
      ],
      TODAY,
    );
    expect(s.invoiceCount).toBe(4);
    expect(s.overdueCount).toBe(2);
    expect(s.lastInvoiceDate).toBe("2026-10-05");
    expect(s.byCurrency).toEqual([
      { currency: "CZK", invoiceCount: 2, invoiced: 1934, unpaid: 1434, overdue: 0 },
      { currency: "EUR", invoiceCount: 2, invoiced: 421, unpaid: 400, overdue: 400 },
    ]);
  });

  it("does not count an invoice due today as overdue, a paid one as unpaid, and counts an empty invoice once", () => {
    const s = summarizeContactInvoices(
      [
        bucket({ invoiceId: "a", dueDate: new Date(2026, 9, 17) }),
        bucket({ invoiceId: "b", vatRate: null, base: null }),
        // marked paid without a recorded amount: still nothing open
        bucket({ invoiceId: "c", status: "paid", amountPaid: "0", dueDate: "2026-01-01" }),
      ],
      TODAY,
    );
    expect(s.invoiceCount).toBe(3);
    expect(s.overdueCount).toBe(0);
    expect(s.byCurrency[0]).toMatchObject({ invoiceCount: 3, invoiced: 2420, unpaid: 1210, overdue: 0 });
  });
});

describe("ContactsService.summary", () => {
  const dialect = new PgDialect();
  const render = (where: SQL) => dialect.sqlToQuery(where);

  function makeDb(contactRows: unknown[], buckets: ContactSummaryBucket[]) {
    const wheres: SQL[] = [];
    const contactChain = {
      from: vi.fn(() => contactChain),
      where: vi.fn((w: SQL) => (wheres.push(w), contactChain)),
      limit: vi.fn(() => Promise.resolve(contactRows)),
    };
    const bucketChain = {
      from: vi.fn(() => bucketChain),
      leftJoin: vi.fn(() => bucketChain),
      where: vi.fn((w: SQL) => (wheres.push(w), bucketChain)),
      groupBy: vi.fn(() => Promise.resolve(buckets)),
    };
    const select = vi.fn().mockReturnValueOnce(contactChain).mockReturnValueOnce(bucketChain);
    return { db: { select } as never, select, wheres, bucketChain };
  }

  const service = new ContactsService({ db: {} } as unknown as DbService);

  it("filters both queries by the caller's tenant and the contact", async () => {
    const { db, wheres, bucketChain } = makeDb(
      [{ id: "c1", legalName: "Novák s.r.o.", email: "a@b.cz", ico: "12345678", country: "CZ" }],
      [bucket({})],
    );
    const result = await service.summary(db, "tenant-A", "c1");

    expect(wheres).toHaveLength(2);
    const [contactWhere, invoiceWhere] = wheres.map(render);
    expect(contactWhere.sql).toContain('"contacts"."tenant_id" = $1');
    expect(contactWhere.params).toEqual(["tenant-A", "c1"]);
    expect(invoiceWhere.sql).toContain('"invoices"."tenant_id" = $1');
    expect(invoiceWhere.sql).toContain('"invoices"."contact_id" = $2');
    expect(invoiceWhere.params.slice(0, 2)).toEqual(["tenant-A", "c1"]);
    expect(invoiceWhere.params).toEqual(expect.arrayContaining(["invoice", "credit_note", "issued", "paid"]));
    expect(invoiceWhere.params).not.toContain("draft");
    expect(invoiceWhere.params).not.toContain("quote");
    expect(bucketChain.groupBy).toHaveBeenCalled();
    expect(result).toMatchObject({ legalName: "Novák s.r.o.", invoiceCount: 1, byCurrency: [{ currency: "CZK", invoiced: 1210 }] });
  });

  it("404s for a contact outside the tenant without running the aggregate", async () => {
    const { db, select } = makeDb([], []);
    await expect(service.summary(db, "tenant-B", "c1")).rejects.toBeInstanceOf(NotFoundException);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
