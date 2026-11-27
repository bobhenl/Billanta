import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parsePasskeyPublicKey, verifyPasskeyAssertion, type PasskeyAssertion } from "./passkey-step-up";
import { VaultService } from "./vault.service";

const ORIGIN = "https://billanta.example";
const CHALLENGE = "c2luZ2xlLXVzZS1jaGFsbGVuZ2UtZm9yLXRoZS10ZXN0";
const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest();

const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const spki = (key: KeyObject) => key.export({ format: "der", type: "spki" }).toString("base64url");

interface Options {
  key?: KeyObject;
  type?: string;
  challenge?: string;
  origin?: string;
  rpId?: string;
  flags?: number;
  counter?: number;
  crossOrigin?: boolean;
}

/** What a browser would send back for `navigator.credentials.get`. */
function assertion(o: Options = {}): PasskeyAssertion {
  const clientData = Buffer.from(
    JSON.stringify({ type: o.type ?? "webauthn.get", challenge: o.challenge ?? CHALLENGE, origin: o.origin ?? ORIGIN, crossOrigin: o.crossOrigin ?? false }),
  );
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(o.counter ?? 0);
  const authData = Buffer.concat([sha256(o.rpId ?? "billanta.example"), Buffer.from([o.flags ?? 0x05]), counter]);
  const signature = sign("sha256", Buffer.concat([authData, sha256(clientData)]), o.key ?? ec.privateKey);
  return {
    credentialId: "Y3JlZGVudGlhbC1pZC0x",
    clientDataJSON: clientData.toString("base64url"),
    authenticatorData: authData.toString("base64url"),
    signature: signature.toString("base64url"),
  };
}

const es256 = { publicKey: spki(ec.publicKey), publicKeyAlg: -7, signCount: 0 };
const expected = { challenge: CHALLENGE, origin: ORIGIN };
const failed = { status: 403, message: "passkey_step_up_failed" };

describe("verifyPasskeyAssertion", () => {
  it("accepts an ES256 and an RS256 assertion over our challenge", () => {
    expect(verifyPasskeyAssertion(assertion(), es256, expected)).toEqual({ signCount: 0 });
    const rs256 = { publicKey: spki(rsa.publicKey), publicKeyAlg: -257, signCount: 0 };
    expect(verifyPasskeyAssertion(assertion({ key: rsa.privateKey }), rs256, expected)).toEqual({ signCount: 0 });
  });

  it("refuses a signature by another key", () => {
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
    expect(() => verifyPasskeyAssertion(assertion({ key: other.privateKey }), es256, expected)).toThrow(expect.objectContaining(failed));
  });

  it("refuses a different challenge", () => {
    expect(() => verifyPasskeyAssertion(assertion({ challenge: "b3RoZXI" }), es256, expected)).toThrow(expect.objectContaining(failed));
  });

  it("refuses another origin, and a cross-origin frame", () => {
    expect(() => verifyPasskeyAssertion(assertion({ origin: "https://billanta.example.evil" }), es256, expected)).toThrow(expect.objectContaining(failed));
    expect(() => verifyPasskeyAssertion(assertion({ crossOrigin: true }), es256, expected)).toThrow(expect.objectContaining(failed));
  });

  it("refuses a passkey made for another site (rpId hash)", () => {
    expect(() => verifyPasskeyAssertion(assertion({ rpId: "evil.example" }), es256, expected)).toThrow(expect.objectContaining(failed));
  });

  it("refuses a registration response instead of a sign-in", () => {
    expect(() => verifyPasskeyAssertion(assertion({ type: "webauthn.create" }), es256, expected)).toThrow(expect.objectContaining(failed));
  });

  it("needs user verification and presence", () => {
    expect(() => verifyPasskeyAssertion(assertion({ flags: 0x01 }), es256, expected)).toThrow(expect.objectContaining(failed));
    expect(() => verifyPasskeyAssertion(assertion({ flags: 0x04 }), es256, expected)).toThrow(expect.objectContaining(failed));
  });

  it("refuses a counter that does not grow, but takes synced passkeys that always say 0", () => {
    expect(verifyPasskeyAssertion(assertion({ counter: 8 }), { ...es256, signCount: 7 }, expected)).toEqual({ signCount: 8 });
    expect(() => verifyPasskeyAssertion(assertion({ counter: 7 }), { ...es256, signCount: 7 }, expected)).toThrow(expect.objectContaining(failed));
    expect(() => verifyPasskeyAssertion(assertion({ counter: 0 }), { ...es256, signCount: 7 }, expected)).toThrow(expect.objectContaining(failed));
  });
});

describe("parsePasskeyPublicKey", () => {
  it("takes a key only with its own algorithm", () => {
    expect(() => parsePasskeyPublicKey(spki(ec.publicKey), -7)).not.toThrow();
    expect(() => parsePasskeyPublicKey(spki(rsa.publicKey), -257)).not.toThrow();
    expect(() => parsePasskeyPublicKey(spki(ec.publicKey), -257)).toThrow(expect.objectContaining({ message: "passkey_public_key_invalid" }));
    expect(() => parsePasskeyPublicKey("bm90LWEta2V5", -7)).toThrow(expect.objectContaining({ message: "passkey_public_key_invalid" }));
  });
});

// ---- The service: single use, binding to the member, registration --------

const OWNER = "00000000-0000-4000-8000-000000000001";
const owner = { id: OWNER, tenantId: "t1", role: "owner", unlocked: true };
const stepped = { ...owner, stepUpAt: Date.now() - 60_000, stepUpMethod: "totp" as const };
const dialect = new PgDialect();

function fakeDb(selects: unknown[][], deletes: unknown[][] = []) {
  const writes: { op: string; value?: unknown; where?: string }[] = [];
  const chain = (result: () => unknown, op?: string) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "limit", "orderBy", "returning", "onConflictDoNothing"]) c[m] = () => c;
    c.where = (w: Parameters<typeof dialect.sqlToQuery>[0]) => {
      if (op) writes.push({ op, where: dialect.sqlToQuery(w).sql });
      return c;
    };
    c.set = (v: unknown) => {
      writes.push({ op: "update", value: v });
      return c;
    };
    c.values = (v: unknown) => {
      writes.push({ op: "insert", value: v });
      return c;
    };
    c.then = (ok: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise.resolve().then(result).then(ok, fail);
    return c;
  };
  return {
    writes,
    select: () => chain(() => selects.shift() ?? []),
    update: () => chain(() => []),
    insert: () => chain(() => []),
    delete: () => chain(() => deletes.shift() ?? [], "delete"),
  };
}

const wrap = { id: "w1", kind: "passkey", credentialId: "Y3JlZGVudGlhbC1pZC0x", publicKey: es256.publicKey, publicKeyAlg: -7, signCount: 0 };

describe("VaultService.passkeyStepUp", () => {
  beforeEach(() => vi.stubEnv("NEXT_PUBLIC_SITE_URL", `${ORIGIN}/`));
  afterEach(() => vi.unstubAllEnvs());

  it("burns the challenge for this member only while it is valid, then checks and stores the counter", async () => {
    const db = fakeDb([[wrap]], [[{ challenge: CHALLENGE }]]);
    await expect(new VaultService().passkeyStepUp(db as never, "t1", owner as never, assertion({ counter: 3 }))).resolves.toEqual({ ok: true, method: "passkey" });
    const burn = db.writes.find((w) => w.op === "delete")!.where!;
    expect(burn).toContain('"webauthn_challenges"."challenge" = $1');
    expect(burn).toContain('"webauthn_challenges"."user_id" = $2');
    expect(burn).toContain('"webauthn_challenges"."expires_at" > $3');
    expect(db.writes).toContainEqual({ op: "update", value: { signCount: 3 } });
  });

  it("works once: the same assertion again finds no challenge", async () => {
    const db = fakeDb([[wrap], [wrap]], [[{ challenge: CHALLENGE }], []]);
    const service = new VaultService();
    await service.passkeyStepUp(db as never, "t1", owner as never, assertion());
    await expect(service.passkeyStepUp(db as never, "t1", owner as never, assertion())).rejects.toMatchObject(failed);
  });

  it("refuses a passkey added before step-up existed (no public key)", async () => {
    const db = fakeDb([[{ ...wrap, publicKey: null, publicKeyAlg: null }]], [[{ challenge: CHALLENGE }]]);
    await expect(new VaultService().passkeyStepUp(db as never, "t1", owner as never, assertion())).rejects.toMatchObject(failed);
  });

  it("refuses a bad signature even with a valid challenge, and stores nothing", async () => {
    const other = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const db = fakeDb([[wrap]], [[{ challenge: CHALLENGE }]]);
    await expect(new VaultService().passkeyStepUp(db as never, "t1", owner as never, assertion({ key: other.privateKey }))).rejects.toMatchObject(failed);
    expect(db.writes.filter((w) => w.op === "update")).toHaveLength(0);
  });
});

describe("VaultService.passkeyChallenge", () => {
  it("hands out a random challenge valid for two minutes, after clearing the member's older ones", async () => {
    const db = fakeDb([[{ tenantId: "t1" }], [{ credentialId: wrap.credentialId }]]);
    const before = Date.now();
    const { challenge, credentialIds } = await new VaultService().passkeyChallenge(db as never, "t1", owner as never);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(credentialIds).toEqual([wrap.credentialId]);
    const insert = db.writes.find((w) => w.op === "insert")!.value as { challenge: string; userId: string; expiresAt: Date };
    expect(insert).toMatchObject({ challenge, userId: OWNER, tenantId: "t1" });
    expect(insert.expiresAt.getTime() - before).toBeGreaterThan(110_000);
    expect(insert.expiresAt.getTime() - before).toBeLessThanOrEqual(121_000);
    expect(db.writes.find((w) => w.op === "delete")!.where).toContain('"webauthn_challenges"."user_id" = $1');
  });

  it("is refused when no passkey of the member can confirm anything", async () => {
    const db = fakeDb([[{ tenantId: "t1" }], []]);
    await expect(new VaultService().passkeyChallenge(db as never, "t1", owner as never)).rejects.toMatchObject({ status: 404, message: "passkey_step_up_unavailable" });
    expect(db.writes).toHaveLength(0);
  });
});

describe("registering a passkey that can confirm step-ups", () => {
  const passkey = { kind: "passkey" as const, kdf: "hkdf-sha256" as const, salt: "c2FsdA==", iv: "aXY=", wrappedKey: "a2V5", credentialId: wrap.credentialId };
  const audit = () => ({ record: vi.fn(async () => undefined) });

  it("needs a step-up itself, since it is a new way past them", async () => {
    const db = fakeDb([[{ tenantId: "t1" }], []]);
    await expect(
      new VaultService(audit() as never).addWrap(db as never, "t1", owner as never, { ...passkey, publicKey: es256.publicKey, publicKeyAlg: -7 }),
    ).rejects.toMatchObject({ status: 403, message: "step_up_required" });
    expect(db.writes).toHaveLength(0);
  });

  it("goes through with one, storing the key, and is audited", async () => {
    const log = audit();
    const db = fakeDb([[{ tenantId: "t1" }], [], []]);
    await new VaultService(log as never).addWrap(db as never, "t1", stepped as never, { ...passkey, publicKey: es256.publicKey, publicKeyAlg: -7 });
    expect(db.writes[0]).toMatchObject({ op: "insert", value: { publicKey: es256.publicKey, publicKeyAlg: -7 } });
    expect(log.record).toHaveBeenCalledWith(db, "t1", expect.objectContaining({ action: "vault_passkey_added", changes: expect.arrayContaining([{ field: "stepUp", from: null, to: "totp" }]) }));
  });

  it("refuses a key that does not match its algorithm", async () => {
    const db = fakeDb([[{ tenantId: "t1" }], []]);
    await expect(
      new VaultService().addWrap(db as never, "t1", stepped as never, { ...passkey, publicKey: es256.publicKey, publicKeyAlg: -257 }),
    ).rejects.toMatchObject({ status: 400, message: "passkey_public_key_invalid" });
  });

  it("keeps an unlock-only passkey free of a step-up, as before", async () => {
    const db = fakeDb([[{ tenantId: "t1" }], [], []]);
    await new VaultService().addWrap(db as never, "t1", owner as never, passkey);
    expect(db.writes[0]).toMatchObject({ op: "insert", value: { publicKey: null, publicKeyAlg: null } });
  });
});
