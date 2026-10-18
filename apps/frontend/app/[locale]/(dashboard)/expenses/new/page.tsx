import { apiFetch } from '@/lib/api-client';
import type { Expense } from '@/lib/expense-ui';
import { ExpenseForm, type SupplierOption } from '../expense-form';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `?from=<id>` duplicates an existing expense (new date, unpaid);
 * `?description=…&amount=…` prefills a blank one (the dashboard's "book as expense" on an SK insurance deadline).
 */
export default async function NewExpensePage(props: { searchParams: Promise<{ from?: string; scan?: string; description?: string; amount?: string }> }) {
  const searchParams = await props.searchParams;
  const [suppliers, source] = await Promise.all([
    apiFetch<SupplierOption[]>('/api/v1/contacts').catch(() => []),
    searchParams.from && UUID.test(searchParams.from)
      ? apiFetch<Expense>(`/api/v1/expenses/${searchParams.from}`).catch(() => null)
      : Promise.resolve(null)
  ]);
  const initial = source
    ? { ...source, expenseDate: new Date().toISOString(), dueDate: null, paidAt: null, documentNumber: null, variableSymbol: null }
    : searchParams.description
      ? prefill(searchParams.description, searchParams.amount)
      : undefined;
  return <ExpenseForm autoScan={searchParams.scan === '1'} initial={initial} suppliers={suppliers.map(({ id, legalName, ico }) => ({ id, legalName, ico }))} />;
}

function prefill(description: string, amount?: string): Expense {
  const value = Number(amount);
  return {
    id: '',
    supplierContactId: null,
    supplierNameRaw: null,
    description: description.slice(0, 200),
    amount: Number.isFinite(value) && value > 0 ? String(value) : '',
    vatRate: '0',
    reverseCharge: false,
    reverseChargeCode: null,
    currency: 'EUR',
    expenseDate: new Date().toISOString(),
    category: 'other',
    receiptFileUrl: null,
    documentNumber: null,
    variableSymbol: null,
    supplierIco: null,
    supplierDic: null,
    dueDate: null,
    paidAt: null,
    note: null,
    createdAt: ''
  };
}
