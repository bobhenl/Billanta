import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, count, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { MAX_ATTACHMENT_BYTES, storedFile } from "../invoices/invoice-attachments.service";
import type { UploadedFileLike } from "../vault/sealed-files";

type TenantDb = PostgresJsDatabase<typeof schema>;

export const MAX_ATTACHMENTS_PER_EXPENSE = 10;

const listColumns = {
  id: schema.expenseAttachments.id,
  filename: schema.expenseAttachments.filename,
  mime: schema.expenseAttachments.mime,
  sizeBytes: schema.expenseAttachments.sizeBytes,
  encMeta: schema.expenseAttachments.encMeta,
  createdAt: schema.expenseAttachments.createdAt,
};

/**
 * Receipts and supplier invoices kept with an expense. Until now an expense
 * only had a link (`receipt_file_url`); in "Důvěrný režim" the browser
 * uploads the file encrypted and the server stores bytes it cannot read.
 */
@Injectable()
export class ExpenseAttachmentsService {
  list(db: TenantDb, expenseId: string) {
    return db
      .select(listColumns)
      .from(schema.expenseAttachments)
      .where(eq(schema.expenseAttachments.expenseId, expenseId))
      .orderBy(asc(schema.expenseAttachments.createdAt));
  }

  async add(db: TenantDb, tenantId: string, expenseId: string, file: UploadedFileLike, encMeta?: unknown) {
    const [expense] = await db.select({ id: schema.expenses.id }).from(schema.expenses).where(eq(schema.expenses.id, expenseId)).limit(1);
    if (!expense) throw new NotFoundException(`Expense ${expenseId} not found`);
    const stored = await storedFile(db, tenantId, file, encMeta, MAX_ATTACHMENT_BYTES);
    const [{ n }] = await db.select({ n: count() }).from(schema.expenseAttachments).where(eq(schema.expenseAttachments.expenseId, expenseId));
    if (n >= MAX_ATTACHMENTS_PER_EXPENSE) throw new BadRequestException({ error: "too_many" });
    const [row] = await db.insert(schema.expenseAttachments).values({ tenantId, expenseId, ...stored }).returning(listColumns);
    return row;
  }

  async remove(db: TenantDb, expenseId: string, id: string) {
    const [row] = await db
      .delete(schema.expenseAttachments)
      .where(and(eq(schema.expenseAttachments.expenseId, expenseId), eq(schema.expenseAttachments.id, id)))
      .returning({ id: schema.expenseAttachments.id });
    if (!row) throw new NotFoundException("Attachment not found");
    return { deleted: true };
  }

  async download(db: TenantDb, expenseId: string, id: string) {
    const [row] = await db
      .select({ filename: schema.expenseAttachments.filename, mime: schema.expenseAttachments.mime, data: schema.expenseAttachments.data })
      .from(schema.expenseAttachments)
      .where(and(eq(schema.expenseAttachments.expenseId, expenseId), eq(schema.expenseAttachments.id, id)))
      .limit(1);
    if (!row) throw new NotFoundException("Attachment not found");
    return { filename: row.filename, mime: row.mime, content: Buffer.from(row.data, "base64") };
  }
}
