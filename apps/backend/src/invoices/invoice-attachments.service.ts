import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { CONFIDENTIAL_CONTENT } from "../vault/sealed";
import { assertFileSealingAllowed, assertPlainFile, classifyUpload, ENCRYPTED_FILENAME, ENCRYPTED_MIME, type UploadedFileLike } from "../vault/sealed-files";

type TenantDb = PostgresJsDatabase<typeof schema>;

export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_INVOICE = 10;
/** Documents and images a customer can open; no executables or archives. */
export const ATTACHMENT_MIMES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/csv",
  "application/xml",
  "text/xml",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

const listColumns = {
  id: schema.invoiceAttachments.id,
  filename: schema.invoiceAttachments.filename,
  mime: schema.invoiceAttachments.mime,
  sizeBytes: schema.invoiceAttachments.sizeBytes,
  encMeta: schema.invoiceAttachments.encMeta,
  sendWithEmail: schema.invoiceAttachments.sendWithEmail,
  showInPortal: schema.invoiceAttachments.showInPortal,
  createdAt: schema.invoiceAttachments.createdAt,
};

/** Keeps letters (incl. diacritics), digits, dot, dash, underscore, space. */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(-200);
  return cleaned || "priloha";
}

/** Multer hands over the name as latin1; browsers send UTF-8. */
export const uploadedName = (file: { originalname: string }) => safeFilename(Buffer.from(file.originalname, "latin1").toString("utf8"));

/**
 * The stored columns for an upload: a plain file as before, or ciphertext
 * with placeholders for the name and type (the real ones are in `encMeta`).
 */
export async function storedFile(db: TenantDb, tenantId: string, file: UploadedFileLike, encMeta: unknown, maxBytes: number) {
  const sealed = classifyUpload(file, encMeta, maxBytes);
  if (sealed) {
    await assertFileSealingAllowed(db, tenantId, sealed);
    return { filename: ENCRYPTED_FILENAME, mime: ENCRYPTED_MIME, sizeBytes: file.size, data: file.buffer.toString("base64"), encMeta: sealed };
  }
  if (!(ATTACHMENT_MIMES as readonly string[]).includes(file.mimetype)) throw new BadRequestException({ error: "bad_type" });
  if (file.size > maxBytes) throw new BadRequestException({ error: "too_big" });
  return { filename: uploadedName(file), mime: file.mimetype, sizeBytes: file.size, data: file.buffer.toString("base64"), encMeta: null };
}

/**
 * Files the browser decrypted for one e-mail. Same rules as a plain
 * upload, and never ciphertext: an encrypted body would reach the customer
 * as an unreadable file.
 */
export function passThroughFiles(files: UploadedFileLike[]) {
  if (files.length > MAX_ATTACHMENTS_PER_INVOICE) throw new BadRequestException({ error: "too_many" });
  return files.map((file) => {
    assertPlainFile(file.buffer);
    if (!(ATTACHMENT_MIMES as readonly string[]).includes(file.mimetype)) throw new BadRequestException({ error: "bad_type" });
    if (file.size > MAX_ATTACHMENT_BYTES) throw new BadRequestException({ error: "too_big" });
    return { filename: uploadedName(file), contentType: file.mimetype, content: file.buffer };
  });
}

/**
 * Files attached to an invoice — a timesheet, contract or delivery note sent
 * with the invoice email and/or offered for download in the client portal
 * (idea from Invoice Ninja's / Fakturoid's invoice attachments). In
 * "Důvěrný režim" the browser may upload them encrypted; the server then
 * can't attach them to e-mails or show them in the portal.
 */
@Injectable()
export class InvoiceAttachmentsService {
  async list(db: TenantDb, invoiceId: string) {
    return db
      .select(listColumns)
      .from(schema.invoiceAttachments)
      .where(eq(schema.invoiceAttachments.invoiceId, invoiceId))
      .orderBy(asc(schema.invoiceAttachments.createdAt));
  }

  async add(db: TenantDb, tenantId: string, invoiceId: string, file: UploadedFileLike, encMeta?: unknown) {
    const [invoice] = await db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId))
      .limit(1);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);
    const stored = await storedFile(db, tenantId, file, encMeta, MAX_ATTACHMENT_BYTES);
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.invoiceAttachments)
      .where(eq(schema.invoiceAttachments.invoiceId, invoiceId));
    if (n >= MAX_ATTACHMENTS_PER_INVOICE) throw new BadRequestException({ error: "too_many" });

    const [row] = await db
      .insert(schema.invoiceAttachments)
      .values({ tenantId, invoiceId, ...stored, ...(stored.encMeta ? { showInPortal: false } : {}) })
      .returning(listColumns);
    return row;
  }

  async update(db: TenantDb, invoiceId: string, id: string, patch: { sendWithEmail?: boolean; showInPortal?: boolean }) {
    const values: Partial<typeof schema.invoiceAttachments.$inferInsert> = {};
    if (typeof patch.sendWithEmail === "boolean") values.sendWithEmail = patch.sendWithEmail;
    if (typeof patch.showInPortal === "boolean") values.showInPortal = patch.showInPortal;
    if (Object.keys(values).length === 0) throw new BadRequestException("Nothing to change");
    const where = and(eq(schema.invoiceAttachments.invoiceId, invoiceId), eq(schema.invoiceAttachments.id, id));
    if (values.showInPortal) {
      // The client has no key: an encrypted file in the portal would be noise.
      const [row] = await db.select({ encMeta: schema.invoiceAttachments.encMeta }).from(schema.invoiceAttachments).where(where).limit(1);
      if (row?.encMeta) throw new ConflictException(CONFIDENTIAL_CONTENT);
    }
    const [row] = await db.update(schema.invoiceAttachments).set(values).where(where).returning(listColumns);
    if (!row) throw new NotFoundException("Attachment not found");
    return row;
  }

  async remove(db: TenantDb, invoiceId: string, id: string) {
    const [row] = await db
      .delete(schema.invoiceAttachments)
      .where(and(eq(schema.invoiceAttachments.invoiceId, invoiceId), eq(schema.invoiceAttachments.id, id)))
      .returning({ id: schema.invoiceAttachments.id });
    if (!row) throw new NotFoundException("Attachment not found");
    return { deleted: true };
  }

  /** The stored bytes; for an encrypted file that is the ciphertext, which only the browser opens. */
  async download(db: TenantDb, invoiceId: string, id: string) {
    const [row] = await db
      .select({ filename: schema.invoiceAttachments.filename, mime: schema.invoiceAttachments.mime, data: schema.invoiceAttachments.data })
      .from(schema.invoiceAttachments)
      .where(and(eq(schema.invoiceAttachments.invoiceId, invoiceId), eq(schema.invoiceAttachments.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException("Attachment not found");
    return { filename: row.filename, mime: row.mime, content: Buffer.from(row.data, "base64") };
  }

  /**
   * Attachments marked "send with email", ready for `EmailService`. Encrypted
   * ones are left out: the browser passes them through once when a member
   * sends from the dashboard (`InvoicesService.sendInvoice` extra files).
   */
  async forEmail(db: TenantDb, invoiceId: string) {
    const rows = await db
      .select({ filename: schema.invoiceAttachments.filename, mime: schema.invoiceAttachments.mime, data: schema.invoiceAttachments.data })
      .from(schema.invoiceAttachments)
      .where(
        and(
          eq(schema.invoiceAttachments.invoiceId, invoiceId),
          eq(schema.invoiceAttachments.sendWithEmail, true),
          isNull(schema.invoiceAttachments.encMeta),
        ),
      )
      .orderBy(asc(schema.invoiceAttachments.createdAt));
    return rows.map((r) => ({ filename: r.filename, contentType: r.mime, content: Buffer.from(r.data, "base64") }));
  }
}
