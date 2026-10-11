import { Plus } from 'lucide-react';
import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';

interface ExpenseListItem {
  id: string;
  supplierName: string;
  description: string;
  amountMinor: number;
  currency: 'CZK' | 'EUR';
  vatRate: number;
  expenseDate: string;
  category: string | null;
}

/**
 * PLACEHOLDER DATA — TODO: replace this in-file array with a real fetch to
 * the backend's `GET /api/v1/expenses` REST endpoint (see
 * `apps/backend/src/expenses/expenses.controller.ts`) once Auth.js sessions
 * and tenant context exist on the frontend, mirroring how `invoices/page.tsx`
 * is annotated. Field shapes follow the `expenses` table in
 * `apps/backend/drizzle/schema.ts`. Supplier names below are fictional,
 * plausibly-shaped examples only — not real businesses.
 */
const MOCK_EXPENSES: ExpenseListItem[] = [
  {
    id: '1',
    supplierName: 'CEZ Prodej s.r.o.',
    description: 'Elektřina — kancelář, srpen 2026',
    amountMinor: 320000,
    currency: 'CZK',
    vatRate: 21,
    expenseDate: '2026-08-05',
    category: 'Energie'
  },
  {
    id: '2',
    supplierName: 'Alza.cz a.s.',
    description: 'Monitor a příslušenství',
    amountMinor: 899000,
    currency: 'CZK',
    vatRate: 21,
    expenseDate: '2026-08-12',
    category: 'Vybavení'
  },
  {
    id: '3',
    supplierName: 'T-Mobile Czech Republic a.s.',
    description: 'Mobilní tarif, srpen 2026',
    amountMinor: 59900,
    currency: 'CZK',
    vatRate: 21,
    expenseDate: '2026-08-15',
    category: 'Telekomunikace'
  },
  {
    id: '4',
    supplierName: 'Pošta Novák s.r.o.',
    description: 'Poštovné a balné',
    amountMinor: 24500,
    currency: 'CZK',
    vatRate: 21,
    expenseDate: '2026-09-01',
    category: null
  },
  {
    id: '5',
    supplierName: 'WeWork Praha',
    description: 'Coworking — pronájem sálu na workshop',
    amountMinor: 450000,
    currency: 'CZK',
    vatRate: 21,
    expenseDate: '2026-09-03',
    category: 'Nájem'
  }
];

export default async function ExpensesPage() {
  const t = await getTranslations('expenses');
  const locale = await getLocale();

  const currencyFormatters = new Map<string, Intl.NumberFormat>();
  const formatAmount = (amountMinor: number, currency: string) => {
    let formatter = currencyFormatters.get(currency);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { style: 'currency', currency });
      currencyFormatters.set(currency, formatter);
    }
    return formatter.format(amountMinor / 100);
  };

  const dateFormatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const percentFormatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-muted-foreground">{t('description')}</p>
        </div>

        <Link
          href="/expenses/new"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {t('newExpense')}
        </Link>
      </div>

      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
              <th className="px-4 py-3 font-medium">{t('columns.date')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.supplier')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.description')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.amount')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.vatRate')}</th>
              <th className="px-4 py-3 font-medium">{t('columns.category')}</th>
            </tr>
          </thead>
          <tbody>
            {MOCK_EXPENSES.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  {t('empty')}
                </td>
              </tr>
            )}

            {MOCK_EXPENSES.map((expense) => (
              <tr key={expense.id} className="border-b border-border last:border-b-0">
                <td className="px-4 py-3 tabular-nums text-muted-foreground">
                  {dateFormatter.format(new Date(expense.expenseDate))}
                </td>
                <td className="px-4 py-3 font-medium">{expense.supplierName}</td>
                <td className="px-4 py-3 text-muted-foreground">{expense.description}</td>
                <td className="px-4 py-3 tabular-nums">
                  {formatAmount(expense.amountMinor, expense.currency)}
                </td>
                <td className="px-4 py-3 tabular-nums text-muted-foreground">
                  {percentFormatter.format(expense.vatRate)} %
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {expense.category ?? t('uncategorized')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
