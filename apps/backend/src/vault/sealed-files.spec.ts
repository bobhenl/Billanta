import { ConflictException, ForbiddenException } from "@nestjs/common";
import { ENCRYPTED_FILE_MAGIC } from "@faktur/cz-compliance";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPlanSummary } from "../billing/plan.guard";
import { InvoiceAttachmentsService, passThroughFiles, storedFile } from "../invoices/invoice-attachments.service";
import { assertPlainFile, classifyUpload, ENCRYPTED_FILENAME } from "./sealed-files";

vi.mock("../billing/plan.guard", () => ({ loadPlanSummary: vi.fn() }));

const envelope = `enc:v1:AAAAAAAAAAAAAAAA:${"Q".repeat(40)}`;
// What the browser uploads: magic, IV, ciphertext and tag.
const cipherBody = Buffer.concat([Buffer.from(ENCRYPTED_FILE_MAGIC), Buffer.alloc(12 + 16 + 100, 7)]);
const upload = (buffer: Buffer, mimetype = "application/pdf", originalname = "smlouva.pdf") => ({ buffer, size: buffer.length, mimetype, originalname });

/** Answers each `.limit()` / awaited query in turn with the next rows. */
function fakeDb(...answers: unknown[][]) {
  const wheres: SQL[] = [];
  const inserted: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const next = () => Promise.resolve(answers.shift() ?? []);
  for (const m of ["select", "from", "innerJoin", "orderBy", "update", "set", "delete"]) chain[m] = () => chain;
  chain.where = (w: SQL) => {
    wheres.push(w);
    return chain;
  };
  chain.limit = next;
  chain.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => next().then(resolve, reject);
  chain.insert = () => chain;
  chain.values = (v: unknown) => {
    inserted.push(v);
    return chain;
  };
  chain.returning = next;
  return { db: chain as never, wheres, inserted };
}

describe("assertPlainFile", () => {
  it("refuses ciphertext with 409 encrypted_file and lets a real file through", () => {
    const error = (() => {
      try {
        assertPlainFile(cipherBody);
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).message).toBe("encrypted_file");
    expect(() => assertPlainFile(Buffer.from("%PDF-1.7 ..."))).not.toThrow();
  });
});

describe("classifyUpload", () => {
  it("refuses ciphertext sent as a plain file, so it is never stored as readable", () => {
    expect(() => classifyUpload(upload(cipherBody), undefined, 5_000_000)).toThrow(ConflictException);
  });

  it("refuses enc_meta with a body that is not ours", () => {
    expect(() => classifyUpload(upload(Buffer.from("%PDF-1.7")), envelope, 5_000_000)).toThrow(/Bad Request/);
  });

  it("refuses enc_meta that is not an envelope", () => {
    expect(() => classifyUpload(upload(cipherBody), "smlouva.pdf", 5_000_000)).toThrow(/Bad Request/);
  });

  it("returns the envelope for an encrypted upload and null for a plain one", () => {
    expect(classifyUpload(upload(cipherBody), envelope, 5_000_000)).toBe(envelope);
    expect(classifyUpload(upload(Buffer.from("%PDF-1.7")), "", 5_000_000)).toBeNull();
  });
});

describe("storing an encrypted file", () => {
  const plan = vi.mocked(loadPlanSummary);
  beforeEach(() => plan.mockReset());

  it("is refused without the plan (403 plan_required) before anything is stored", async () => {
    plan.mockResolvedValue({ plan: "start", enforced: true } as never);
    const { db, inserted } = fakeDb([{ categories: ["texts", "attachments"] }]);
    const error = await storedFile(db, "t1", upload(cipherBody), envelope, 5_000_000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({ error: "plan_required", feature: "confidential_mode" });
    expect(inserted).toHaveLength(0);
  });

  it("is refused when the company did not switch on the attachments category", async () => {
    plan.mockResolvedValue({ plan: "plus", enforced: true } as never);
    const { db } = fakeDb([{ categories: ["texts"] }]);
    await expect(storedFile(db, "t1", upload(cipherBody), envelope, 5_000_000)).rejects.toThrow("vault_category_off");
  });

  it("keeps only placeholders for the name and type", async () => {
    plan.mockResolvedValue({ plan: "plus", enforced: true } as never);
    const { db } = fakeDb([{ categories: ["texts", "attachments"] }]);
    const stored = await storedFile(db, "t1", upload(cipherBody, "application/octet-stream", "smlouva-s-klientem.pdf"), envelope, 5_000_000);
    expect(stored).toMatchObject({ filename: ENCRYPTED_FILENAME, mime: "application/octet-stream", encMeta: envelope });
    expect(JSON.stringify(stored)).not.toContain("smlouva");
  });

  it("forces the portal off for an encrypted invoice attachment", async () => {
    plan.mockResolvedValue({ plan: "plus", enforced: true } as never);
    const { db, inserted } = fakeDb([{ id: "inv" }], [{ categories: ["attachments"] }], [{ n: 0 }], [{ id: "a1" }]);
    await new InvoiceAttachmentsService().add(db, "t1", "inv", upload(cipherBody), envelope);
    expect(inserted[0]).toMatchObject({ showInPortal: false, encMeta: envelope });
  });
});

describe("e-mail attachments", () => {
  it("never puts an encrypted attachment into the stored e-mail", async () => {
    const { db, wheres } = fakeDb([]);
    await new InvoiceAttachmentsService().forEmail(db, "inv");
    const sql = new PgDialect().sqlToQuery(wheres[0]).sql;
    expect(sql).toContain('"enc_meta" is null');
  });

  it("refuses ciphertext passed through as a decrypted file", () => {
    expect(() => passThroughFiles([upload(cipherBody)])).toThrow(ConflictException);
    expect(passThroughFiles([upload(Buffer.from("%PDF-1.7"))])[0]).toMatchObject({ filename: "smlouva.pdf", contentType: "application/pdf" });
  });

  it("refuses to show an encrypted attachment in the client portal", async () => {
    const { db } = fakeDb([{ encMeta: envelope }]);
    await expect(new InvoiceAttachmentsService().update(db, "inv", "a1", { showInPortal: true })).rejects.toThrow("confidential_content");
  });
});
