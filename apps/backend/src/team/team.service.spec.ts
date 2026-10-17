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

function run(send: () => Promise<void>) {
  const email = { sendInvitationEmail: vi.fn(send) };
  const service = new TeamService({} as never, email as never);
  return { email, result: service.invite(fakeDb([[], [{ companyName: "Novák s.r.o." }]]) as never, user, dto) };
}

describe("TeamService.invite", () => {
  it("sends the invitation through the e-mail service and says so", async () => {
    const { email, result } = run(async () => undefined);
    const out = await result;
    expect(email.sendInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: "ucetni@example.cz", companyName: "Novák s.r.o.", role: "Účetní", acceptUrl: out.acceptUrl }),
    );
    expect(out.emailSent).toBe(true);
    expect(out.acceptUrl).toMatch(/\/invite\/[\w-]{20,}$/);
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
