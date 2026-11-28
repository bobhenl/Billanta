import { ForbiddenException } from "@nestjs/common";
import { lastValueFrom, of } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { ApiKeySecretsInterceptor, refuseApiKey, withoutSecrets } from "./api-key-limits";
import { InvoicesController } from "./invoices.controller";

const KEY = { id: "key-1", email: "", tenantId: "t-1", role: "service", apiKey: true };
const AI_SERVICE: { role: string; apiKey?: boolean } = { role: "service" };
const OWNER: { id: string; tenantId: string; role: string; apiKey?: boolean } = { id: "u-1", tenantId: "t-1", role: "owner" };
const ID = "11111111-1111-4111-8111-111111111111";

function controller() {
  const svc = {
    remove: vi.fn(async () => ({ ok: true })),
    cancel: vi.fn(async () => ({ ok: true })),
    update: vi.fn(async () => ({ ok: true })),
    rotatePublicToken: vi.fn(async () => ({ ok: true })),
    setPublicSlug: vi.fn(async () => ({ ok: true })),
    refreshPartySnapshot: vi.fn(async () => ({ ok: true })),
  };
  // assertInvoiceOpen reads lockedAt; nothing is locked here.
  const db = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) };
  const c = new InvoicesController(svc as never, {} as never, {} as never, {} as never);
  const req = (user: object) => ({ user, tenantDb: db }) as never;
  return { c, svc, req };
}

const refused = (call: () => unknown) =>
  expect(Promise.resolve().then(call)).rejects.toMatchObject({ response: { error: "not_available_via_api_key" } });

describe("refuseApiKey", () => {
  it("refuses API keys but not the AI service JWT or members", () => {
    expect(() => refuseApiKey(KEY)).toThrow(ForbiddenException);
    expect(() => refuseApiKey(AI_SERVICE)).not.toThrow();
    expect(() => refuseApiKey(OWNER)).not.toThrow();
  });
});

describe("invoice routes on an API key", () => {
  it("cannot delete, cancel, refresh parties or touch the client link", async () => {
    const { c, svc, req } = controller();
    await refused(() => c.remove(req(KEY), ID));
    await refused(() => c.cancel(req(KEY), ID));
    await refused(() => c.refreshParties(req(KEY), ID, { party: "buyer", reason: "x" } as never));
    await refused(() => c.rotatePublicLink(req(KEY), ID));
    await refused(() => c.setPublicSlug(req(KEY), ID, { slug: "abc" } as never));
    for (const fn of Object.values(svc)) expect(fn).not.toHaveBeenCalled();

    await c.remove(req(OWNER), ID);
    await c.cancel(req(OWNER), ID);
    expect(svc.remove).toHaveBeenCalled();
    expect(svc.cancel).toHaveBeenCalled();
  });

  it("edits drafts only: an edit_reason (the issued-document path) is refused", async () => {
    const { c, svc, req } = controller();
    await refused(() => c.update(req(KEY), ID, { edit_reason: "typo" } as never));
    expect(svc.update).not.toHaveBeenCalled();
    await c.update(req(KEY), ID, { note_above: "x", edit_reason: " " } as never);
    expect(svc.update).toHaveBeenCalledTimes(1);
    await c.update(req(OWNER), ID, { edit_reason: "typo" } as never);
    expect(svc.update).toHaveBeenCalledTimes(2);
  });
});

describe("ApiKeySecretsInterceptor", () => {
  const body = {
    invoice: { id: ID, number: "2026-001", publicToken: "tok", publicKey: "k", publicSlug: "s", issueDate: new Date(0) },
    links: { public: "/i/s-k" },
    rows: [{ id: ID, publicToken: "tok", portalToken: "p", noteEncrypted: "x", total: "100.00" }],
    pdf: Buffer.from("x"),
  };
  const run = (user: object | undefined) =>
    lastValueFrom(
      new ApiKeySecretsInterceptor().intercept(
        { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as never,
        { handle: () => of(body) },
      ),
    );

  it("strips client links and sealed columns for a key", async () => {
    const out = (await run(KEY)) as typeof body;
    expect(out.invoice).toEqual({ id: ID, number: "2026-001", issueDate: new Date(0) });
    expect(out).not.toHaveProperty("links");
    expect(out.rows).toEqual([{ id: ID, total: "100.00" }]);
    expect(Buffer.isBuffer(out.pdf)).toBe(true);
  });

  it("leaves members and the AI service untouched", async () => {
    expect(await run(OWNER)).toBe(body);
    expect(await run(AI_SERVICE)).toBe(body);
    expect(await run(undefined)).toBe(body);
  });

  it("withoutSecrets keeps primitives as they are", () => {
    expect(withoutSecrets(null)).toBeNull();
    expect(withoutSecrets("x")).toBe("x");
  });
});
