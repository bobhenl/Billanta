import { notFound } from 'next/navigation';
import { fetchHomeCurrency } from '@/lib/tenant';
import { apiFetch, ApiError } from '@/lib/api-client';
import type { Expense } from '@/lib/expense-ui';
import { ExpenseForm, type SupplierOption } from '../../expense-form';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditExpensePage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  if (!UUID.test(params.id)) notFound();
  const [expense, suppliers] = await Promise.all([
    apiFetch<Expense>(`/api/v1/expenses/${params.id}`).catch((err) => {
      if (err instanceof ApiError && err.status === 404) notFound();
      throw err;
    }),
    apiFetch<SupplierOption[]>('/api/v1/contacts').catch(() => [])
  ]);
  return <ExpenseForm expense={expense} suppliers={suppliers.map(({ id, legalName, ico }) => ({ id, legalName, ico }))} home={await fetchHomeCurrency()} />;
}
