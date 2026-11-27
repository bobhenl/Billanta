import { describe, expect, it, vi } from "vitest";
import { InvoicesService } from "../invoices/invoices.service";
import { EInvoicingService } from "./einvoicing.service";

// Důvěrný režim: a document with text encrypted in the browser never goes
// over Peppol, because the law wants the sent XML archived readable.

const SEALED = "enc:v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBBBB";

function fakeDb(selects: unknown[][]) {
  const inserts: unknown[] = [];
  const chain = (result: () => unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "limit", "orderBy", "returning"]) c[m] = () => c;
    c.values = (v: unknown) => {
      inserts.push(v);
      return c;
    };
    c.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve().then(result).then(ok, fail);
    return c;
  };
  return { inserts, select: () => chain(() => selects.shift() ?? []), insert: () => chain(() => [{ id: "o1" }]) };
}

const participant = { id: "p1", participantId: "0245:2020000000", status: "registered" };
const invoice = {
  id: "i1",
  tenantId: "t1",
  contactId: "c1",
  invoiceNumber: "2026001",
  documentType: "invoice",
  noteAbove: null,
  noteBelow: null,
  buyerSnapshot: null,
  sellerSnapshot: null,
  buyerContactPerson: null,
  reverseCharge: false,
};
const contact = { id: "c1", legalName: "Odberateľ s.r.o.", addressCountry: "SK", isPerson: false, ico: "12345678", dic: "2020000000", contactPerson: null };
const items = (description: string) => [{ id: "l1", description, quantity: "1" }];

function setup(lines: { description: string }[], buyer: object = contact) {
  const invoices = Object.create(InvoicesService.prototype) as InvoicesService;
  const checkUbl = vi.spyOn(invoices, "checkInvoiceUbl").mockResolvedValue({ issues: [{ rule: "BR-01", field: "document", code: "x", severity: "error" }] });
  const provider = { key: "fake", sendDocument: vi.fn() };
  const service = new EInvoicingService(provider as never, {} as never, invoices, {} as never);
  const db = fakeDb([[participant], [invoice], [buyer], lines]);
  return { service, db, checkUbl, provider };
}

describe("sending a sealed document over Peppol", () => {
  it("is refused with einvoice_sealed_document before any XML is built or stored", async () => {
    const { service, db, checkUbl, provider } = setup(items(SEALED));
    await expect(service.sendInvoice(db as never, "t1", "i1")).rejects.toMatchObject({ status: 409, message: "einvoice_sealed_document" });
    expect(checkUbl).not.toHaveBeenCalled();
    expect(db.inserts).toHaveLength(0);
    expect(provider.sendDocument).not.toHaveBeenCalled();
  });

  it("is refused for a sealed buyer too", async () => {
    const { service, db } = setup(items("Práce"), { ...contact, legalName: SEALED });
    await expect(service.sendInvoice(db as never, "t1", "i1")).rejects.toMatchObject({ status: 409, message: "einvoice_sealed_document" });
  });

  it("lets a plain document through to the usual UBL check", async () => {
    const { service, db, checkUbl } = setup(items("Práce"));
    await expect(service.sendInvoice(db as never, "t1", "i1")).rejects.toMatchObject({ status: 400 });
    expect(checkUbl).toHaveBeenCalled();
  });
});

describe("the Peppol check of a sealed document", () => {
  const tenant = { id: "t1", legalName: "Dodávateľ s.r.o.", addressCountry: "SK", ico: "87654321", dic: "2021111111", vatStatus: "non_payer" };

  it("says only that it can't go over Peppol, without running the UBL rules", async () => {
    const invoices = Object.create(InvoicesService.prototype) as InvoicesService;
    const checkUbl = vi.spyOn(invoices, "checkInvoiceUbl");
    const db = fakeDb([[invoice], [tenant], [contact], items(SEALED)]);
    const { issues } = await invoices.checkInvoice(db as never, "t1", "i1");
    expect(issues.filter((i) => i.scheme === "peppol")).toEqual([{ rule: "", field: "document", code: "sealed", severity: "error", scheme: "peppol" }]);
    expect(checkUbl).not.toHaveBeenCalled();
  });

  it("runs the UBL rules as before for a plain document", async () => {
    const invoices = Object.create(InvoicesService.prototype) as InvoicesService;
    const checkUbl = vi.spyOn(invoices, "checkInvoiceUbl").mockResolvedValue({ issues: [] });
    const db = fakeDb([[invoice], [tenant], [contact], items("Práce")]);
    await invoices.checkInvoice(db as never, "t1", "i1");
    expect(checkUbl).toHaveBeenCalled();
  });
});
