import { ForbiddenException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPlanSummary } from "../billing/plan.guard";
import type { EmailService } from "../email/email.service";
import { InvoiceTemplatesService } from "../invoice-templates/invoice-templates.service";
import type { InvoicePdfService } from "./invoice-pdf.service";
import { InvoicesService } from "./invoices.service";

// Saving ciphertext on a plan without confidential mode (vault/sealed.ts has the rule itself).
vi.mock("../billing/plan.guard", () => ({ loadPlanSummary: vi.fn() }));

const envelope = (n: number) => `enc:v1:AAAAAAAAAAAAAAAA:${"Q".repeat(n)}`;
const plan = vi.mocked(loadPlanSummary);
const onPlan = (p: "start" | "plus") => plan.mockResolvedValue({ plan: p, enforced: true } as never);

function chain<T>(result: T[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c: any = {};
  for (const m of ["from", "where", "orderBy", "set"]) c[m] = vi.fn(() => c);
  c.limit = vi.fn(() => Promise.resolve(result));
  c.returning = vi.fn(() => Promise.resolve(result));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  c.then = (resolve: any, reject?: any) => Promise.resolve(result).then(resolve, reject);
  return c;
}

const draft = { id: "inv-1", tenantId: "t1", invoiceNumber: null, documentType: "invoice", status: "draft", contactId: null, relatedInvoiceId: null, noteAbove: null, noteBelow: null, internalNote: null };

describe("invoice saves and confidential mode", () => {
  let service: InvoicesService;
  beforeEach(() => {
    plan.mockReset();
    service = new InvoicesService({} as EmailService, {} as InvoicePdfService);
  });

  const create = (dto: Record<string, unknown>) => {
    const insert = vi.fn(() => ({ values: vi.fn(() => chain([draft])) }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { insert, select: vi.fn(), update: vi.fn() } as any;
    const line_items = [{ description: "Kurz", quantity: 1, unit_price: 100 }];
    return { insert, run: service.create(db, "t1", { document_type: "invoice", currency: "CZK", line_items, ...dto } as never) };
  };

  it("refuses a new encrypted document below Plus", async () => {
    onPlan("start");
    const { insert, run } = create({ note_below: envelope(24) });
    await expect(run).rejects.toBeInstanceOf(ForbiddenException);
    expect(insert).not.toHaveBeenCalled();
  });

  it("checks encrypted item descriptions too", async () => {
    onPlan("start");
    await expect(create({ line_items: [{ description: envelope(24), quantity: 1, unit_price: 1 }] }).run).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("saves it on Plus", async () => {
    onPlan("plus");
    const { insert, run } = create({ note_below: envelope(24) });
    await run;
    expect(insert).toHaveBeenCalled();
  });

  const update = (invoice: Record<string, unknown>, items: { description: string }[], dto: Record<string, unknown>) => {
    const select = vi.fn(() => chain(items)).mockReturnValueOnce(chain([invoice]));
    const updateFn = vi.fn(() => chain([invoice]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select, update: updateFn, insert: vi.fn(() => ({ values: vi.fn() })) } as any;
    return { updateFn, run: service.update(db, "t1", "inv-1", dto as never) };
  };

  it("refuses encrypting a plain document after a downgrade", async () => {
    onPlan("start");
    const { updateFn, run } = update(draft, [{ description: "Kurz" }], { note_above: envelope(24) });
    await expect(run).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("keeps an encrypted document editable after a downgrade", async () => {
    onPlan("start");
    const { updateFn, run } = update(draft, [{ description: envelope(24) }], { note_above: envelope(28) });
    await run;
    expect(updateFn).toHaveBeenCalled();
  });

  it.each(["noteBelow", "internalNote"])("counts an encrypted %s as an encrypted document", async (field) => {
    onPlan("start");
    const { updateFn, run } = update({ ...draft, [field]: envelope(24) }, [{ description: "Kurz" }], { note_above: envelope(28) });
    await run;
    expect(updateFn).toHaveBeenCalled();
  });
});

describe("template saves and confidential mode", () => {
  const service = new InvoiceTemplatesService({} as never);
  beforeEach(() => plan.mockReset());

  it("refuses a new encrypted template below Plus", async () => {
    onPlan("start");
    const insert = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { insert } as any;
    await expect(service.create(db, "t1", { name: "Kurz", note_above: envelope(24), line_items: [] } as never)).rejects.toBeInstanceOf(ForbiddenException);
    expect(insert).not.toHaveBeenCalled();
  });

  it("lets an encrypted template stay encrypted after a downgrade", async () => {
    onPlan("start");
    const stored = { id: "tpl-1", noteAbove: null, noteBelow: null, lineItems: [{ description: envelope(24) }] };
    const updateFn = vi.fn(() => chain([stored]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { select: vi.fn(() => chain([stored])), update: updateFn } as any;
    await service.update(db, "t1", "tpl-1", { note_above: envelope(28) } as never);
    expect(updateFn).toHaveBeenCalled();
  });
});
