/** Shapes and helpers shared by the expense list, detail and form. */

/** A row of `GET /api/v1/expenses` / `GET /api/v1/expenses/:id` (Drizzle camelCase). */
export interface Expense {
  id: string;
  supplierContactId: string | null;
  supplierNameRaw: string | null;
  description: string;
  amount: string;
  vatRate: string;
  currency: string;
  expenseDate: string;
  category: string | null;
  receiptFileUrl: string | null;
  documentNumber: string | null;
  variableSymbol: string | null;
  supplierIco: string | null;
  supplierDic: string | null;
  reverseCharge: boolean;
  reverseChargeCode: string | null;
  dueDate: string | null;
  paidAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface ExpensePage {
  data: Expense[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

/** Same set the AI receipt reader picks from (`ReceiptSchema.category`). */
export const EXPENSE_CATEGORIES = [
  'material',
  'services',
  'software',
  'travel',
  'fuel',
  'office',
  'telecom',
  'rent',
  'marketing',
  'other'
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const isKnownCategory = (value: string | null): value is ExpenseCategory =>
  EXPENSE_CATEGORIES.includes(value as ExpenseCategory);

export type ExpenseState = 'paid' | 'unpaid' | 'overdue';

export function expenseState(expense: Pick<Expense, 'paidAt' | 'dueDate'>): ExpenseState {
  if (expense.paidAt) return 'paid';
  if (expense.dueDate && expense.dueDate.slice(0, 10) < new Date().toISOString().slice(0, 10)) return 'overdue';
  return 'unpaid';
}

export const EXPENSE_STATE_CLASSES: Record<ExpenseState, string> = {
  paid: 'bg-success/15 text-success',
  unpaid: 'bg-warning/15 text-warning',
  overdue: 'bg-destructive/15 text-destructive'
};

/** VAT part of a gross amount at the given rate (expenses are recorded incl. VAT). */
export function vatOfGross(amount: number, ratePercent: number): number {
  if (!ratePercent) return 0;
  return Math.round(((amount * ratePercent) / (100 + ratePercent)) * 100) / 100;
}
