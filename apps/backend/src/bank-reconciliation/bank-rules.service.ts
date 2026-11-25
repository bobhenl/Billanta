import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { asc, desc, eq, max } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "../../drizzle/schema";
import { BankReconciliationService, paymentForRules, type StoredRule } from "./bank-reconciliation.service";
import { ruleBodySchema, ruleHits, validateRule, type RuleBody } from "./bank-rules";

type TenantDb = PostgresJsDatabase<typeof schema>;

/** One "Použít na existující" run handles at most this many payments; drafts are one invoice or expense each. */
export const APPLY_LIMIT = 200;
const PREVIEW_SAMPLE = 10;

/** CRUD, preview and "apply now" for bank rules. Running them after an import lives in BankReconciliationService. */
@Injectable()
export class BankRulesService {
  constructor(private readonly reconciliation: BankReconciliationService) {}

  async list(db: TenantDb) {
    return (await db
      .select()
      .from(schema.bankRules)
      .orderBy(asc(schema.bankRules.position), asc(schema.bankRules.createdAt))) as StoredRule[];
  }

  private async find(db: TenantDb, id: string): Promise<StoredRule> {
    const [rule] = await db.select().from(schema.bankRules).where(eq(schema.bankRules.id, id)).limit(1);
    if (!rule) throw new NotFoundException("bank_rule_not_found");
    return rule as StoredRule;
  }

  /** Stable codes for what zod cannot check; fields the action does not use are dropped. */
  private async checked(db: TenantDb, body: RuleBody): Promise<RuleBody> {
    const problem = validateRule(body);
    if (problem) throw new BadRequestException(problem);
    const contactId = body.action === "draft_invoice" ? (body.contactId ?? null) : null;
    if (contactId) {
      const [contact] = await db.select({ id: schema.contacts.id }).from(schema.contacts).where(eq(schema.contacts.id, contactId)).limit(1);
      if (!contact) throw new BadRequestException("contact_not_found");
    }
    return {
      ...body,
      contactId,
      expenseCategory: body.action === "draft_expense" ? (body.expenseCategory ?? null) : null,
    };
  }

  async create(db: TenantDb, tenantId: string, input: RuleBody) {
    const body = await this.checked(db, input);
    const [{ last }] = await db.select({ last: max(schema.bankRules.position) }).from(schema.bankRules);
    const [rule] = await db
      .insert(schema.bankRules)
      .values({ tenantId, ...body, position: (last ?? -1) + 1 })
      .returning();
    return rule;
  }

  async update(db: TenantDb, id: string, patch: Partial<RuleBody>) {
    const current = await this.find(db, id);
    const merged = ruleBodySchema.parse({
      name: current.name,
      enabled: current.enabled,
      conditions: current.conditions,
      action: current.action,
      expenseCategory: current.expenseCategory,
      contactId: current.contactId,
      ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
    });
    const body = await this.checked(db, merged);
    const [rule] = await db
      .update(schema.bankRules)
      .set({ ...body, updatedAt: new Date() })
      .where(eq(schema.bankRules.id, id))
      .returning();
    return rule;
  }

  async remove(db: TenantDb, id: string) {
    await this.find(db, id);
    await db.delete(schema.bankRules).where(eq(schema.bankRules.id, id));
  }

  /** New order from the list's up/down buttons: `ids` first to last. Ids of other tenants match nothing (RLS). */
  async reorder(db: TenantDb, ids: string[]) {
    for (const [position, id] of ids.entries()) {
      await db.update(schema.bankRules).set({ position }).where(eq(schema.bankRules.id, id));
    }
    return this.list(db);
  }

  /** Unmatched payments a rule (saved or still in the form) would act on now. Writes nothing. */
  async preview(db: TenantDb, rule: Pick<RuleBody, "action" | "conditions">) {
    const problem = validateRule(rule);
    if (problem) throw new BadRequestException(problem);
    const unmatched = await this.unmatched(db);
    const hits = ruleHits(rule, unmatched.map((tx) => ({ ...paymentForRules(tx), status: tx.status, tx })));
    return {
      count: hits.length,
      transactions: hits.slice(0, PREVIEW_SAMPLE).map(({ tx }) => ({
        id: tx.id,
        transactionDate: tx.transactionDate,
        amount: tx.amount,
        currency: tx.currency,
        counterpartyName: tx.counterpartyName,
        counterpartyAccount: tx.counterpartyAccount,
        variableSymbol: tx.variableSymbol,
        message: tx.message,
      })),
    };
  }

  async previewSaved(db: TenantDb, id: string) {
    return this.preview(db, await this.find(db, id));
  }

  /**
   * "Použít na existující": the rule acts on payments that are unmatched now.
   * Auto-match runs first, so a payment an invoice issued since then can
   * settle is matched, not ignored or drafted.
   */
  async apply(db: TenantDb, tenantId: string, id: string) {
    const rule = await this.find(db, id);
    const problem = validateRule(rule);
    if (problem) throw new BadRequestException(problem);
    const rematch = await this.reconciliation.rematchUnmatched(db, tenantId);
    const unmatched = await this.unmatched(db);
    const hits = ruleHits(rule, unmatched.map((tx) => ({ ...paymentForRules(tx), status: tx.status, tx })));
    const batch = hits.slice(0, APPLY_LIMIT);
    for (const { tx } of batch) await this.reconciliation.applyRuleAction(db, tenantId, tx, rule);
    return { applied: batch.length, remaining: hits.length - batch.length, rematched: rematch.matched + rematch.linked };
  }

  private unmatched(db: TenantDb) {
    return db
      .select()
      .from(schema.bankTransactions)
      .where(eq(schema.bankTransactions.status, "unmatched"))
      .orderBy(desc(schema.bankTransactions.transactionDate), desc(schema.bankTransactions.createdAt));
  }
}
