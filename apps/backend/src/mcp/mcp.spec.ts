import { NotFoundException } from "@nestjs/common";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EmailService } from "../email/email.service";
import type { InvoicePdfService } from "../invoices/invoice-pdf.service";
import { InvoicesService } from "../invoices/invoices.service";
import { handleMessage, MCP_LATEST_VERSION } from "./mcp-protocol";
import { MCP_TOOLS, type McpContext } from "./mcp-tools";
import { McpController } from "./mcp.controller";

const CONTACT_ID = "11111111-1111-4111-8111-111111111111";
const INVOICE_ID = "22222222-2222-4222-8222-222222222222";

/** A Drizzle select chain that resolves to `rows` however it is ended. */
function selectChain(rows: unknown[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  for (const m of ["from", "where", "orderBy", "innerJoin", "leftJoin"]) chain[m] = vi.fn(() => chain);
  chain.limit = vi.fn(async () => rows);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  chain.then = (resolve: any, reject?: any) => Promise.resolve(rows).then(resolve, reject);
  return chain;
}

function setup(scopes: string[] = [], selectRows: unknown[] = [{ status: "active" }]) {
  const services = {
    tenants: {
      findById: vi.fn(async () => [{ companyName: "Firma s.r.o.", invoiceFormPrefs: null, eetCertificateEncrypted: "secret", webhooks: [{ url: "x" }] }]),
      update: vi.fn(async () => ({})),
      getNumberFormats: vi.fn(async () => []),
      updateNumberFormats: vi.fn(),
      listBankAccounts: vi.fn(async () => []),
    },
    invoices: {
      create: vi.fn(async () => ({ id: INVOICE_ID })),
      update: vi.fn(async () => ({})),
      detail: vi.fn(async () => ({ id: INVOICE_ID, status: "pending_review", publicToken: "tok", partnerShares: [{ a: 1 }] })),
      list: vi.fn(async () => []),
    },
    contacts: { list: vi.fn(async () => []), findOne: vi.fn(), create: vi.fn(async () => ({})), update: vi.fn(), lookupById: vi.fn() },
    expenses: { list: vi.fn(), findOne: vi.fn(), create: vi.fn(async () => ({ id: "exp-1" })) },
    bank: { list: vi.fn(async () => []) },
    templates: { list: vi.fn(async () => []) },
    dashboard: { summary: vi.fn(async () => ({})) },
  };
  const execute = vi.fn(async () => []);
  const select = vi.fn(() => selectChain(selectRows));
  const ctx = {
    db: { execute, select },
    user: { id: "key-1", email: "", tenantId: "tenant-1", role: "service", apiKey: true, apiKeyScopes: scopes },
    services,
  } as unknown as McpContext;
  return { ctx, services, execute };
}

const rpc = (method: string, params?: unknown, id: number | null = 1) => ({ jsonrpc: "2.0", ...(id !== null && { id }), method, params });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const call = async (ctx: McpContext, name: string, args: unknown): Promise<any> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await handleMessage(ctx, rpc("tools/call", { name, arguments: args }));
  return { ...res.result, body: res.result ? JSON.parse(res.result.content[0].text) : undefined, error: res.error };
};

const draft = { contact_id: CONTACT_ID, line_items: [{ description: "Konzultace", quantity: 2, unit_price: 1500, vat_rate: 21 }] };

describe("MCP handshake", () => {
  it("answers initialize with the client's version when supported, else the latest", async () => {
    const { ctx } = setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const older: any = await handleMessage(ctx, rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
    expect(older.result.protocolVersion).toBe("2025-03-26");
    expect(older.result.capabilities).toEqual({ tools: { listChanged: false } });
    expect(older.result.serverInfo.name).toBe("billanta");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unknown: any = await handleMessage(ctx, rpc("initialize", { protocolVersion: "2099-01-01" }));
    expect(unknown.result.protocolVersion).toBe(MCP_LATEST_VERSION);
    expect(MCP_LATEST_VERSION).toBe("2025-06-18");
  });

  it("answers ping, rejects unknown methods and malformed messages", async () => {
    const { ctx } = setup();
    expect(await handleMessage(ctx, rpc("ping"))).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
    expect(await handleMessage(ctx, rpc("resources/list"))).toMatchObject({ error: { code: -32601 } });
    expect(await handleMessage(ctx, { id: 1, method: "ping" })).toMatchObject({ id: 1, error: { code: -32600 } });
  });

  it("answers notifications/initialized with 202 and no body", async () => {
    const { ctx } = setup();
    expect(await handleMessage(ctx, rpc("notifications/initialized", undefined, null))).toBeNull();
    const controller = new McpController(...(Object.values(ctx.services) as never as ConstructorParameters<typeof McpController>));
    const res = { status: vi.fn(() => res), end: vi.fn(), json: vi.fn(), set: vi.fn(() => res) };
    const req = { user: ctx.user, tenantDb: ctx.db };
    await controller.post(req as never, res as never, rpc("notifications/initialized", undefined, null), "2025-06-18");
    expect(res.status).toHaveBeenCalledWith(202);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("refuses a dashboard session and an unsupported protocol header", async () => {
    const { ctx } = setup();
    const controller = new McpController(...(Object.values(ctx.services) as never as ConstructorParameters<typeof McpController>));
    const res = () => {
      const r = { status: vi.fn(() => r), end: vi.fn(), json: vi.fn(), set: vi.fn(() => r) };
      return r;
    };
    const jwt = res();
    await controller.post({ user: { ...ctx.user, apiKey: undefined }, tenantDb: ctx.db } as never, jwt as never, rpc("ping"));
    expect(jwt.status).toHaveBeenCalledWith(401);
    const old = res();
    await controller.post({ user: ctx.user, tenantDb: ctx.db } as never, old as never, rpc("ping"), "2024-11-05");
    expect(old.status).toHaveBeenCalledWith(400);
  });
});

describe("MCP tools/list", () => {
  const names = async (scopes: string[]) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await handleMessage(setup(scopes).ctx, rpc("tools/list"));
    return (res.result.tools as { name: string; inputSchema: { type: string } }[]).map((t) => t.name);
  };

  it("shows a read-only key only the read tools", async () => {
    const read = await names(["read"]);
    expect(read).toContain("list_invoices");
    expect(read).not.toContain("create_invoice_draft");
    expect(read).not.toContain("update_company_settings");
    expect(read).toEqual(MCP_TOOLS.filter((t) => !t.write).map((t) => t.name));
  });

  it("shows a read+write key every tool, with an object input schema", async () => {
    expect(await names(["read", "write"])).toEqual(MCP_TOOLS.map((t) => t.name));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await handleMessage(setup(["write"]).ctx, rpc("tools/list"));
    for (const tool of res.result.tools) expect(tool.inputSchema.type).toBe("object");
    const draftTool = res.result.tools.find((t: { name: string }) => t.name === "create_invoice_draft");
    expect(draftTool.inputSchema.required).toContain("line_items");
    expect(JSON.stringify(draftTool.inputSchema)).not.toContain('"nullable"');
  });

  it("has no tool that issues, sends, pays, cancels or deletes", () => {
    for (const tool of MCP_TOOLS) expect(tool.name).not.toMatch(/issue|send|mark|paid|pay|cancel|delete|remove|void|email|api_key|team|billing|webhook/);
    expect(MCP_TOOLS.filter((t) => t.write).map((t) => t.name).sort()).toEqual(
      [
        "create_contact",
        "create_expense",
        "create_invoice_draft",
        "update_company_settings",
        "update_contact",
        "update_invoice_draft",
        "update_invoice_settings",
        "update_number_formats",
      ].sort(),
    );
  });
});

describe("MCP tools/call", () => {
  it("refuses a write tool for a read-only key even when called without listing", async () => {
    const { ctx, services, execute } = setup(["read"]);
    const res = await call(ctx, "create_invoice_draft", draft);
    expect(res.isError).toBe(true);
    expect(res.body).toMatchObject({ error: "api_key_read_only", status: 403 });
    expect(services.invoices.create).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("lets a read-only key read", async () => {
    const { ctx } = setup(["read"]);
    const res = await call(ctx, "get_company_settings", {});
    expect(res.isError).toBeUndefined();
    expect(res.body.companyName).toBe("Firma s.r.o.");
    // A whitelist, not the whole tenant row.
    expect(res.body).not.toHaveProperty("eetCertificateEncrypted");
    expect(res.body).not.toHaveProperty("webhooks");
  });

  it.each([
    [{ bank_account_iban: "CZ6508000000192000145399" }],
    [{ bank_account_number: "19-2000145399", company_name: "Nová" }],
    [{ bank_account_swift: "GIBACZPX" }],
    [{ email: "jiny@example.com" }],
    [{ payment_methods: [] }],
  ])("refuses to change bank or e-mail settings: %j", async (args) => {
    const { ctx, services } = setup(["write"]);
    const res = await call(ctx, "update_company_settings", args);
    expect(res.isError).toBe(true);
    expect(res.body.error).toBe("dashboard_only");
    expect(res.body.message).toMatch(/dashboard/);
    expect(services.tenants.update).not.toHaveBeenCalled();
  });

  it("has no bank or e-mail field in the company settings schema either", () => {
    const input = MCP_TOOLS.find((t) => t.name === "update_company_settings")!.input;
    for (const field of ["bank_account_number", "bank_account_iban", "bank_account_swift", "bank_account_bank_code", "email", "payment_methods"]) {
      expect(input.safeParse({ [field]: null }).success).toBe(false);
    }
  });

  it("saves the allowed company fields through TenantsService.update with the key as actor", async () => {
    const { ctx, services } = setup(["write"]);
    const res = await call(ctx, "update_company_settings", { company_name: "Nová firma", phone: "+420 777 000 000" });
    expect(res.isError).toBeUndefined();
    expect(services.tenants.update).toHaveBeenCalledWith(ctx.db, "tenant-1", ctx.user, { company_name: "Nová firma", phone: "+420 777 000 000" });
  });

  it("merges reminder settings onto the stored invoice prefs", async () => {
    const { ctx, services } = setup(["write"]);
    services.tenants.findById.mockResolvedValue([{ invoiceFormPrefs: { pdfAccent: "#16a34a", remindersEnabled: true, reminderMax: 3 } }] as never);
    await call(ctx, "update_invoice_settings", { reminder_max: 5 });
    const patch = (services.tenants.update.mock.calls[0] as unknown[])[3] as { invoice_form_prefs: Record<string, unknown> };
    expect(patch.invoice_form_prefs).toEqual({ pdfAccent: "#16a34a", remindersEnabled: true, reminderMax: 5 });
  });

  it("creates invoice drafts for review, never as a plain draft", async () => {
    const { ctx, services } = setup(["write"]);
    const res = await call(ctx, "create_invoice_draft", draft);
    expect(res.isError).toBeUndefined();
    expect(services.invoices.create).toHaveBeenCalledWith(ctx.db, "tenant-1", expect.objectContaining({ contact_id: CONTACT_ID }), "api", null, {
      review: "mcp",
    });
    expect(res.body).not.toHaveProperty("publicToken");
    expect(res.body.partnerShares).toBeNull();
  });

  it("refuses a status or 'already paid' on a draft", async () => {
    const { ctx, services } = setup(["write"]);
    for (const extra of [{ status: "issued" }, { amount_paid: 3000 }, { enc_amounts: "enc:v1:x" }]) {
      const res = await call(ctx, "create_invoice_draft", { ...draft, ...extra });
      expect(res.body.error).toBe("validation_failed");
    }
    expect(services.invoices.create).not.toHaveBeenCalled();
  });

  it("creates no draft for a tenant without an active subscription", async () => {
    const { ctx, services } = setup(["write"], [{ status: "canceled" }]);
    const res = await call(ctx, "create_invoice_draft", draft);
    expect(res.body).toMatchObject({ status: 403 });
    expect(services.invoices.create).not.toHaveBeenCalled();
  });

  it("edits only documents that are not issued", async () => {
    const issued = setup(["write"], [{ status: "issued" }]);
    const res = await call(issued.ctx, "update_invoice_draft", { id: INVOICE_ID, note_below: "Díky" });
    expect(res.body).toMatchObject({ error: "invoice_not_draft", status: 403 });
    expect(issued.services.invoices.update).not.toHaveBeenCalled();
    expect((await call(issued.ctx, "update_invoice_draft", { id: INVOICE_ID, edit_reason: "typo" })).body.error).toBe("validation_failed");

    const pending = setup(["write"], [{ status: "pending_review", lockedAt: null }]);
    expect((await call(pending.ctx, "update_invoice_draft", { id: INVOICE_ID, note_below: "Díky" })).isError).toBeUndefined();
    expect(pending.services.invoices.update).toHaveBeenCalled();
  });

  it("saves expenses as needing review and unpaid", async () => {
    const { ctx, services } = setup(["write"]);
    const expense = { description: "Hosting", amount: 500, vatRate: 21, expenseDate: "2026-11-01" };
    expect((await call(ctx, "create_expense", { ...expense, paidAt: "2026-11-02" })).body.error).toBe("validation_failed");
    await call(ctx, "create_expense", expense);
    expect(services.expenses.create).toHaveBeenCalledWith(ctx.db, "tenant-1", expect.objectContaining({ description: "Hosting" }), { needsReview: true });
  });

  it("runs each call in a savepoint and rolls it back on an error, keeping the backend's code", async () => {
    const { ctx, services, execute } = setup(["write"]);
    services.contacts.findOne.mockRejectedValue(new NotFoundException("contact_not_found"));
    const res = await call(ctx, "get_contact", { id: CONTACT_ID });
    expect(res.body).toEqual({ error: "contact_not_found", status: 404 });
    const statements = execute.mock.calls.map((c) => JSON.stringify(c));
    expect(statements[0]).toContain("SAVEPOINT mcp_call_");
    expect(statements[1]).toContain("ROLLBACK TO SAVEPOINT mcp_call_");
  });

  it("answers an unknown tool with a JSON-RPC error", async () => {
    const res = await call(setup().ctx, "issue_invoice", { id: INVOICE_ID });
    expect(res.error).toMatchObject({ code: -32602 });
  });
});

describe("InvoicesService.create for MCP drafts", () => {
  let service: InvoicesService;
  beforeEach(() => {
    service = new InvoicesService({ sendInvoiceEmail: vi.fn() } as unknown as EmailService, { generate: vi.fn() } as unknown as InvoicePdfService);
  });

  const created = async (opts?: { review?: "mcp" }) => {
    const values = vi.fn(() => ({ returning: vi.fn(async () => [{ id: INVOICE_ID, tenantId: "tenant-1", invoiceNumber: null, documentType: "invoice" }]) }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = { insert: vi.fn(() => ({ values })), select: vi.fn(), update: vi.fn() } as any;
    const dto = { document_type: "invoice", contact_id: null, currency: "CZK", line_items: [{ description: "Kurz", quantity: 1, unit_price: 100, vat_rate: null }] };
    await service.create(db, "tenant-1", dto as never, "api", null, opts);
    return (values.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
  };

  it("lands in pending_review, marked like an AI draft", async () => {
    expect(await created({ review: "mcp" })).toMatchObject({ status: "pending_review", source: "api", rawAiPayload: { prefilledByAi: true, channel: "mcp" } });
  });

  it("stays a plain draft for the REST API", async () => {
    expect(await created()).toMatchObject({ status: "draft", rawAiPayload: null });
  });
});
