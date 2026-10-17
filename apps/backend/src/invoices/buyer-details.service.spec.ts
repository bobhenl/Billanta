import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuyerDetailsService } from "./buyer-details.service";
import type { BuyerContact } from "./buyer-details.util";

const TOKEN = "3f2b8c1e-9a4d-4c2e-8b7a-1d2e3f4a5b6c";

const body = {
  name: "Nová firma s.r.o.",
  email: "fakturace@firma.cz",
  street: "Dlouhá 1",
  city: "Praha",
  postalCode: "11000",
  country: "CZ",
  ico: "12345678",
  dic: "CZ12345678",
};

const contact = (over: Partial<BuyerContact> = {}): BuyerContact => ({
  id: "c-attached",
  legalName: "Nová firma s.r.o.",
  isPerson: false,
  email: null,
  ico: null,
  dic: null,
  addressStreet: null,
  addressCity: null,
  addressPostalCode: null,
  addressCountry: "CZ",
  ...over,
});

type Inv = Record<string, unknown>;

function setup(opts: { invoice?: Inv | null; attached?: BuyerContact | null; match?: BuyerContact | null; target?: boolean } = {}) {
  const invoice: Inv | null =
    opts.invoice === null
      ? null
      : {
          id: "inv-1",
          status: "draft",
          documentType: "invoice",
          invoiceNumber: null,
          contactId: "c-attached",
          buyerDetailsToken: TOKEN,
          buyerDetailsSubmittedAt: null,
          buyerDetailsAutoIssue: false,
          buyerDetailsRequestedBy: "user-1",
          ...opts.invoice,
        };
  const invoiceUpdates: Record<string, unknown>[] = [];
  const db = {
    update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void invoiceUpdates.push(v) }) }),
  };
  const invoices = { issue: vi.fn(async () => ({})), sendInvoice: vi.fn(async () => ({})) };
  const notifications = { notify: vi.fn() };
  const audit = { record: vi.fn(async () => undefined), diff: vi.fn(() => []) };
  const svc = new BuyerDetailsService({} as never, invoices as never, {} as never, notifications as never, audit as never);
  const target = vi.spyOn(svc, "target").mockResolvedValue(opts.target === false ? null : { tenant_id: "t-1", invoice_id: "inv-1" });
  vi.spyOn(svc, "inTenant").mockImplementation((async (_t: string, _a: string, fn: (db: never) => Promise<unknown>) => fn(db as never)) as never);
  vi.spyOn(svc, "lockInvoice").mockResolvedValue(invoice as never);
  vi.spyOn(svc, "loadInvoice").mockResolvedValue(invoice as never);
  vi.spyOn(svc, "loadContact").mockResolvedValue(opts.attached === undefined ? contact() : opts.attached);
  vi.spyOn(svc, "findByIdentifier").mockResolvedValue(opts.match ?? null);
  const insertContact = vi.spyOn(svc, "insertContact").mockResolvedValue("c-new");
  const updateContact = vi.spyOn(svc, "updateContact").mockResolvedValue();
  return { svc, invoices, notifications, audit, target, insertContact, updateContact, invoiceUpdates };
}

describe("BuyerDetailsService.submit", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("rejects invalid details with 400 before touching the database", async () => {
    const t = setup();
    await expect(t.svc.submit(TOKEN, { ...body, ico: "" })).rejects.toBeInstanceOf(BadRequestException);
    expect(t.target).not.toHaveBeenCalled();
  });

  it("is 404 for a malformed or unknown token", async () => {
    await expect(setup().svc.submit("nope", body)).rejects.toBeInstanceOf(NotFoundException);
    await expect(setup({ target: false }).svc.submit(TOKEN, body)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("is 409 once submitted and never touches the contact again", async () => {
    const t = setup({ invoice: { buyerDetailsSubmittedAt: new Date() } });
    await expect(t.svc.submit(TOKEN, body)).rejects.toBeInstanceOf(ConflictException);
    expect(t.updateContact).not.toHaveBeenCalled();
    expect(t.insertContact).not.toHaveBeenCalled();
    expect(t.invoiceUpdates).toEqual([]);
  });

  it("never changes an issued invoice", async () => {
    const t = setup({ invoice: { status: "issued", buyerDetailsAutoIssue: true } });
    await expect(t.svc.submit(TOKEN, body)).rejects.toBeInstanceOf(ConflictException);
    expect(t.invoiceUpdates).toEqual([]);
    expect(t.invoices.issue).not.toHaveBeenCalled();
  });

  it("completes the draft's contact, attaches it, audits and notifies, without issuing by default", async () => {
    const t = setup();
    await t.svc.submit(TOKEN, body);
    expect(t.updateContact).toHaveBeenCalledWith(expect.anything(), "c-attached", expect.objectContaining({ ico: "12345678", email: "fakturace@firma.cz" }));
    expect(t.invoiceUpdates[0]).toMatchObject({ contactId: "c-attached", buyerDetailsOutcome: { mode: "filled", autoIssue: null } });
    expect(t.invoiceUpdates[0]!.buyerDetailsSubmittedAt).toBeInstanceOf(Date);
    expect(t.audit.record).toHaveBeenCalledWith(expect.anything(), "t-1", expect.objectContaining({ action: "buyer_details_submitted", entityId: "inv-1" }));
    expect(t.notifications.notify).toHaveBeenCalledWith("t-1", "buyer_details", expect.objectContaining({ link: "/invoices/inv-1" }));
    expect(t.invoices.issue).not.toHaveBeenCalled();
  });

  it("creates a new contact instead of overwriting a different one on the draft", async () => {
    const t = setup({ attached: contact({ legalName: "Jan Novák", email: "jan@novak.cz" }) });
    await t.svc.submit(TOKEN, body);
    expect(t.updateContact).not.toHaveBeenCalled();
    expect(t.insertContact).toHaveBeenCalledWith(expect.anything(), "t-1", expect.objectContaining({ legalName: "Nová firma s.r.o." }));
    expect(t.invoiceUpdates[0]).toMatchObject({ contactId: "c-new", buyerDetailsOutcome: { mode: "created" } });
  });

  it("auto-issues and sends through InvoicesService when asked and nothing conflicts", async () => {
    const t = setup({ invoice: { buyerDetailsAutoIssue: true } });
    await t.svc.submit(TOKEN, body);
    expect(t.invoices.issue).toHaveBeenCalledWith(expect.anything(), "t-1", "inv-1", "user-1");
    expect(t.invoices.sendInvoice).toHaveBeenCalledWith(expect.anything(), "inv-1", "t-1");
    expect(t.invoiceUpdates.at(-1)).toMatchObject({ buyerDetailsOutcome: { autoIssue: "sent" } });
  });

  it("records an issued-but-not-sent outcome when the e-mail fails", async () => {
    const t = setup({ invoice: { buyerDetailsAutoIssue: true } });
    t.invoices.sendInvoice.mockRejectedValueOnce(new Error("no e-mail"));
    await t.svc.submit(TOKEN, body);
    expect(t.invoiceUpdates.at(-1)).toMatchObject({ buyerDetailsOutcome: { autoIssue: "issued", autoIssueError: "no e-mail" } });
  });

  it("does not auto-issue when a value conflicts", async () => {
    const t = setup({ invoice: { buyerDetailsAutoIssue: true }, attached: contact({ email: "jina@firma.cz" }) });
    await t.svc.submit(TOKEN, body);
    expect(t.invoices.issue).not.toHaveBeenCalled();
    expect(t.invoiceUpdates[0]).toMatchObject({ buyerDetailsOutcome: { autoIssue: "skipped" } });
  });

  it("does not auto-issue to another saved company found by IČO, and leaves that company untouched", async () => {
    const other = contact({ id: "c-other", ico: "12345678", dic: "CZ12345678", email: "fakturace@firma.cz", addressStreet: "Dlouhá 1", addressCity: "Praha", addressPostalCode: "11000" });
    const t = setup({ invoice: { buyerDetailsAutoIssue: true }, match: other });
    await t.svc.submit(TOKEN, body);
    expect(t.invoices.issue).not.toHaveBeenCalled();
    expect(t.updateContact).not.toHaveBeenCalled();
    expect(t.invoiceUpdates[0]).toMatchObject({ contactId: "c-other", buyerDetailsOutcome: { mode: "existing", autoIssue: "skipped" } });
  });
});

describe("BuyerDetailsService.submit on a draft without a customer", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("creates a new contact from the details, attaches it and auto-issues when asked", async () => {
    const t = setup({ invoice: { contactId: null, buyerDetailsAutoIssue: true }, attached: null });
    await t.svc.submit(TOKEN, body);
    expect(t.insertContact).toHaveBeenCalledWith(expect.anything(), "t-1", expect.objectContaining({ legalName: "Nová firma s.r.o.", ico: "12345678" }));
    expect(t.updateContact).not.toHaveBeenCalled();
    expect(t.invoiceUpdates[0]).toMatchObject({ contactId: "c-new", buyerDetailsOutcome: { mode: "created", conflicts: [] } });
    expect(t.audit.record).toHaveBeenCalledWith(
      expect.anything(),
      "t-1",
      expect.objectContaining({ action: "buyer_details_submitted", changes: expect.arrayContaining([{ field: "contactId", from: null, to: "c-new" }]) }),
    );
    expect(t.invoices.issue).toHaveBeenCalledWith(expect.anything(), "t-1", "inv-1", "user-1");
  });

  it("uses a saved contact with the same IČO but never writes to it, lists the differences and skips auto-issue", async () => {
    const saved = contact({ id: "c-saved", ico: "12345678", dic: null, email: "jina@firma.cz", addressStreet: "Krátká 2", addressCity: "Brno", addressPostalCode: "60200" });
    const t = setup({ invoice: { contactId: null, buyerDetailsAutoIssue: true }, attached: null, match: saved });
    await t.svc.submit(TOKEN, body);
    expect(t.updateContact).not.toHaveBeenCalled();
    expect(t.insertContact).not.toHaveBeenCalled();
    const outcome = t.invoiceUpdates[0]!.buyerDetailsOutcome as { mode: string; conflicts: { field: string }[]; autoIssue: string | null };
    expect(t.invoiceUpdates[0]).toMatchObject({ contactId: "c-saved" });
    expect(outcome.mode).toBe("existing");
    expect(outcome.conflicts.map((c) => c.field)).toEqual(expect.arrayContaining(["email", "dic"]));
    expect(outcome.autoIssue).toBe("skipped");
    expect(t.invoices.issue).not.toHaveBeenCalled();
  });

  it("skips auto-issue for a matched saved contact even when nothing differs", async () => {
    const same = contact({ id: "c-saved", ico: "12345678", dic: "CZ12345678", email: "fakturace@firma.cz", addressStreet: "Dlouhá 1", addressCity: "Praha", addressPostalCode: "11000" });
    const t = setup({ invoice: { contactId: null, buyerDetailsAutoIssue: true }, attached: null, match: same });
    await t.svc.submit(TOKEN, body);
    expect(t.updateContact).not.toHaveBeenCalled();
    expect(t.invoices.issue).not.toHaveBeenCalled();
    expect(t.invoiceUpdates[0]).toMatchObject({ contactId: "c-saved", buyerDetailsOutcome: { mode: "existing", conflicts: [], autoIssue: "skipped" } });
  });
});
