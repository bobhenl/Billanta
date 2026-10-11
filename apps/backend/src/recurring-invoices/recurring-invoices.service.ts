import { Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import type { CreateRecurringInvoiceDto } from "./dto/create-recurring-invoice.dto";
import type { UpdateRecurringInvoiceDto } from "./dto/update-recurring-invoice.dto";

type TenantDb = PostgresJsDatabase<typeof schema>;

/** Shape stored in `recurringInvoiceTemplates.lineItemsSnapshot` (jsonb). */
type LineItemSnapshot = {
  description: string;
  quantity: number;
  unitPrice: number;
  vatRate?: number | null;
};

@Injectable()
export class RecurringInvoicesService {
  list(db: TenantDb) {
    // RLS on `recurring_invoice_templates` already restricts this to the
    // current tenant — no manual `WHERE tenant_id = ...` needed.
    return db.select().from(schema.recurringInvoiceTemplates);
  }

  findOne(db: TenantDb, id: string) {
    return db
      .select()
      .from(schema.recurringInvoiceTemplates)
      .where(eq(schema.recurringInvoiceTemplates.id, id))
      .limit(1);
  }

  async create(db: TenantDb, tenantId: string, dto: CreateRecurringInvoiceDto) {
    const lineItemsSnapshot: LineItemSnapshot[] = dto.lineItems.map((item) => ({
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      vatRate: item.vatRate ?? null,
    }));

    const [template] = await db
      .insert(schema.recurringInvoiceTemplates)
      .values({
        tenantId,
        contactId: dto.contactId,
        frequency: dto.frequency,
        intervalCount: dto.intervalCount,
        // Default to "today" (UTC) when the caller doesn't supply a first
        // run date — see the DTO's doc comment.
        nextRunDate: dto.nextRunDate ?? new Date(),
        currency: dto.currency,
        lineItemsSnapshot,
      })
      .returning();

    return template;
  }

  async update(db: TenantDb, id: string, dto: UpdateRecurringInvoiceDto) {
    const patch: Partial<typeof schema.recurringInvoiceTemplates.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (dto.contactId !== undefined) patch.contactId = dto.contactId;
    if (dto.frequency !== undefined) patch.frequency = dto.frequency;
    if (dto.intervalCount !== undefined) patch.intervalCount = dto.intervalCount;
    if (dto.nextRunDate !== undefined) patch.nextRunDate = dto.nextRunDate;
    if (dto.currency !== undefined) patch.currency = dto.currency;
    if (dto.lineItems !== undefined) {
      patch.lineItemsSnapshot = dto.lineItems.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        vatRate: item.vatRate ?? null,
      }));
    }

    const [template] = await db
      .update(schema.recurringInvoiceTemplates)
      .set(patch)
      .where(eq(schema.recurringInvoiceTemplates.id, id))
      .returning();

    return template;
  }

  /**
   * Soft delete: sets `is_active = false`, never hard-deletes. Past
   * invoices generated from this template still reference it in spirit
   * (via `invoices.source = 'recurring'`), and a template being retired
   * shouldn't rewrite that history — same "never hard-delete a financial
   * document's provenance" instinct as `invoices`/`expenses`'s `onDelete:
   * "restrict"` tenant FK.
   */
  async deactivate(db: TenantDb, id: string) {
    const [template] = await db
      .update(schema.recurringInvoiceTemplates)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(schema.recurringInvoiceTemplates.id, id))
      .returning();

    return template;
  }
}
