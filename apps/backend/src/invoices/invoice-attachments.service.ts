import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";

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
  sendWithEmail: schema.invoiceAttachments.sendWithEmail,
  showInPortal: schema.invoiceAttachments.showInPortal,
  createdAt: schema.invoiceAttachments.createdAt,
};

/** Keeps letters (incl. diacritics), digits, dot, dash, underscore, space. */
function safeFilename(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(-200);
  return cleaned || "priloha";
}

/**
 * Files attached to an invoice — a timesheet, contract or delivery note sent
 * with the invoice email and/or offered for download in the client portal
 * (idea from Invoice Ninja's / Fakturoid's invoice attachments).
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

  async add(
    db: TenantDb,
    tenantId: string,
    invoiceId: string,
    file: { buffer: Buffer; size: number; mimetype: string; originalname: string },
  ) {
    const [invoice] = await db
      .select({ id: schema.invoices.id })
      .from(schema.invoices)
      .where(eq(schema.invoices.id, invoiceId))
      .limit(1);
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);
    if (!(ATTACHMENT_MIMES as readonly string[]).includes(file.mimetype)) {
      throw new BadRequestException({ error: "bad_type" });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) throw new BadRequestException({ error: "too_big" });
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.invoiceAttachments)
      .where(eq(schema.invoiceAttachments.invoiceId, invoiceId));
    if (n >= MAX_ATTACHMENTS_PER_INVOICE) throw new BadRequestException({ error: "too_many" });

    // Multer hands over the name as latin1; browsers send UTF-8.
    const filename = safeFilename(Buffer.from(file.originalname, "latin1").toString("utf8"));
    const [row] = await db
      .insert(schema.invoiceAttachments)
      .values({
        tenantId,
        invoiceId,
        filename,
        mime: file.mimetype,
        sizeBytes: file.size,
        data: file.buffer.toString("base64"),
      })
      .returning(listColumns);
    return row;
  }

  async update(db: TenantDb, invoiceId: string, id: string, patch: { sendWithEmail?: boolean; showInPortal?: boolean }) {
    const values: Partial<typeof schema.invoiceAttachments.$inferInsert> = {};
    if (typeof patch.sendWithEmail === "boolean") values.sendWithEmail = patch.sendWithEmail;
    if (typeof patch.showInPortal === "boolean") values.showInPortal = patch.showInPortal;
    if (Object.keys(values).length === 0) throw new BadRequestException("Nothing to change");
    const [row] = await db
      .update(schema.invoiceAttachments)
      .set(values)
      .where(and(eq(schema.invoiceAttachments.invoiceId, invoiceId), eq(schema.invoiceAttachments.id, id)))
      .returning(listColumns);
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

  async download(db: TenantDb, invoiceId: string, id: string) {
    const [row] = await db
      .select({ filename: schema.invoiceAttachments.filename, mime: schema.invoiceAttachments.mime, data: schema.invoiceAttachments.data })
      .from(schema.invoiceAttachments)
      .where(and(eq(schema.invoiceAttachments.invoiceId, invoiceId), eq(schema.invoiceAttachments.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException("Attachment not found");
    return { filename: row.filename, mime: row.mime, content: Buffer.from(row.data, "base64") };
  }

  /** Attachments marked "send with email", ready for `EmailService`. */
  async forEmail(db: TenantDb, invoiceId: string) {
    const rows = await db
      .select({ filename: schema.invoiceAttachments.filename, mime: schema.invoiceAttachments.mime, data: schema.invoiceAttachments.data })
      .from(schema.invoiceAttachments)
      .where(and(eq(schema.invoiceAttachments.invoiceId, invoiceId), eq(schema.invoiceAttachments.sendWithEmail, true)))
      .orderBy(asc(schema.invoiceAttachments.createdAt));
    return rows.map((r) => ({ filename: r.filename, contentType: r.mime, content: Buffer.from(r.data, "base64") }));
  }
}
