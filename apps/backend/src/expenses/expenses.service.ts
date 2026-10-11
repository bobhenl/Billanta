import { Injectable, NotFoundException } from "@nestjs/common";
import { count, desc, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import type { CreateExpenseDto } from "./dto/create-expense.dto";
import type { ListExpensesQueryDto } from "./dto/list-expenses-query.dto";
import type { UpdateExpenseDto } from "./dto/update-expense.dto";

type TenantDb = PostgresJsDatabase<typeof schema>;

@Injectable()
export class ExpensesService {
  async list(db: TenantDb, query: ListExpensesQueryDto) {
    // RLS on `expenses` already restricts this to the current tenant — no
    // manual `WHERE tenant_id = ...` needed (same pattern as
    // ContactsService.list / InvoicesService.list).
    const offset = (query.page - 1) * query.limit;

    const [rows, [{ value: total }]] = await Promise.all([
      db
        .select()
        .from(schema.expenses)
        .orderBy(desc(schema.expenses.expenseDate))
        .limit(query.limit)
        .offset(offset),
      db.select({ value: count() }).from(schema.expenses),
    ]);

    return {
      data: rows,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(db: TenantDb, id: string) {
    const [expense] = await db
      .select()
      .from(schema.expenses)
      .where(eq(schema.expenses.id, id))
      .limit(1);

    if (!expense) {
      throw new NotFoundException(`Expense ${id} not found`);
    }

    return expense;
  }

  create(db: TenantDb, tenantId: string, dto: CreateExpenseDto) {
    // tenantId is taken from the verified request context (req.user.tenantId
    // via the controller), never from client-supplied input — the DTO
    // deliberately has no tenantId field (same pattern as
    // ContactsService.create).
    return db
      .insert(schema.expenses)
      .values({
        tenantId,
        supplierContactId: dto.supplierContactId ?? null,
        supplierNameRaw: dto.supplierNameRaw ?? null,
        description: dto.description,
        amount: dto.amount.toString(),
        vatRate: dto.vatRate.toString(),
        currency: dto.currency,
        expenseDate: dto.expenseDate,
        category: dto.category ?? null,
        receiptFileUrl: dto.receiptFileUrl ?? null,
        documentNumber: dto.documentNumber ?? null,
        variableSymbol: dto.variableSymbol ?? null,
        supplierIco: dto.supplierIco ?? null,
        supplierDic: dto.supplierDic ?? null,
        dueDate: dto.dueDate ?? null,
        paidAt: dto.paidAt ?? null,
        note: dto.note ?? null,
      })
      .returning()
      .then(([expense]) => expense);
  }

  async update(db: TenantDb, id: string, dto: UpdateExpenseDto) {
    // Ensure the row exists (and belongs to this tenant, via RLS) before
    // attempting the update, so a missing/foreign id 404s instead of the
    // update silently affecting zero rows.
    await this.findOne(db, id);

    const [expense] = await db
      .update(schema.expenses)
      .set({
        ...(dto.supplierContactId !== undefined && { supplierContactId: dto.supplierContactId }),
        ...(dto.supplierNameRaw !== undefined && { supplierNameRaw: dto.supplierNameRaw }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.amount !== undefined && { amount: dto.amount.toString() }),
        ...(dto.vatRate !== undefined && { vatRate: dto.vatRate.toString() }),
        ...(dto.currency !== undefined && { currency: dto.currency }),
        ...(dto.expenseDate !== undefined && { expenseDate: dto.expenseDate }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.receiptFileUrl !== undefined && { receiptFileUrl: dto.receiptFileUrl }),
        ...(dto.documentNumber !== undefined && { documentNumber: dto.documentNumber }),
        ...(dto.variableSymbol !== undefined && { variableSymbol: dto.variableSymbol }),
        ...(dto.supplierIco !== undefined && { supplierIco: dto.supplierIco }),
        ...(dto.supplierDic !== undefined && { supplierDic: dto.supplierDic }),
        ...(dto.dueDate !== undefined && { dueDate: dto.dueDate }),
        ...(dto.paidAt !== undefined && { paidAt: dto.paidAt }),
        ...(dto.note !== undefined && { note: dto.note }),
      })
      .where(eq(schema.expenses.id, id))
      .returning();

    return expense;
  }

  async remove(db: TenantDb, id: string): Promise<void> {
    await this.findOne(db, id);
    await db.delete(schema.expenses).where(eq(schema.expenses.id, id));
  }
}
