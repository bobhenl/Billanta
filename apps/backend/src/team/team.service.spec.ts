import { describe, expect, it, vi } from "vitest";
import { TeamService } from "./team.service";

vi.mock("../abuse/sending-guard", () => ({
  assertCanSendEmail: vi.fn(async () => undefined),
  recordEmailSent: vi.fn(async () => undefined),
}));

/** A drizzle stand-in: every chain resolves to the next queued result for its kind. */
function fakeDb(selects: unknown[][]) {
  const chain = (result: unknown) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "innerJoin", "where", "limit", "values", "returning"]) c[m] = () => c;
    c.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve(result).then(ok, fail);
    return c;
  };
  return {
    select: () => chain(selects.shift() ?? []),
    delete: () => chain(undefined),
    insert: () => chain([{ id: "inv-1", email: "ucetni@example.cz", role: "accountant" }]),
  };
}

const user = { id: "u1", tenantId: "t1", role: "owner" } as never;
const dto = { email: "ucetni@example.cz", role: "accountant" } as never;

function run(send: () => Promise<void>, tenant: Record<string, unknown> = { companyName: "Novák s.r.o." }) {
  const email = { sendInvitationEmail: vi.fn(send), isConfigured: () => true };
  const service = new TeamService({} as never, email as never);
  return { email, result: service.invite(fakeDb([[], [tenant]]) as never, user, dto) };
}

describe("TeamService.invite", () => {
  it("sends the invitation through the e-mail service and says so", async () => {
    const { email, result } = run(async () => undefined);
    const out = await result;
    expect(email.sendInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ucetni@example.cz", companyName: "Novák s.r.o.", role: "accountant", locale: "cs", acceptUrl: out.acceptUrl }),
      expect.objectContaining({ tenantId: "t1" }),
    );
    expect(out.emailSent).toBe(true);
    expect(out.acceptUrl).toMatch(/\/cs\/invite\/[\w-]{20,}$/);
  });

  it("writes the invitation and its link in the company's language", async () => {
    const sk = run(async () => undefined, { companyName: "Novák s.r.o.", locale: "sk" });
    expect((await sk.result).acceptUrl).toMatch(/\/sk\/invite\/[\w-]{20,}$/);
    expect(sk.email.sendInvitationEmail).toHaveBeenCalledWith(expect.objectContaining({ locale: "sk" }), expect.anything());
    const de = run(async () => undefined, { companyName: "Novák s.r.o.", locale: "de" });
    expect((await de.result).acceptUrl).toMatch(/\/en\/invite\/[\w-]{20,}$/);
  });

  it("still creates the invitation and returns the link when sending fails", async () => {
    const { result } = run(async () => {
      throw new Error("Resend send failed (validation_error): domain not verified");
    });
    const out = await result;
    expect(out.emailSent).toBe(false);
    expect(out.id).toBe("inv-1");
    expect(out.acceptUrl).toMatch(/\/invite\/[\w-]{20,}$/);
  });
});
