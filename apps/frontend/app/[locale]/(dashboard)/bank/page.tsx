import { getTranslations } from 'next-intl/server';
import { BankReconciliationPanel } from './bank-reconciliation-panel';

/**
 * `GET /bank` — bank statement reconciliation (CSV import + auto-match).
 *
 * The real backend module this page targets is
 * `apps/backend/src/bank-reconciliation/` (`POST /api/v1/bank-reconciliation/
 * import`, `GET .../transactions`, `POST .../transactions/:id/match`,
 * `POST .../transactions/:id/ignore` — see `apps/backend/README.md`'s "Bank
 * reconciliation" section for the exact CSV format and matching algorithm).
 * Like `expenses/page.tsx` and `contacts/page.tsx`, this page is not yet
 * wired to that backend — see `BankReconciliationPanel`'s doc comment for
 * exactly what's real (the upload/parse/match UI flow, driven entirely by
 * client-side state) vs. what still needs a real network call once a
 * dashboard-side backend-token-authenticated fetch helper exists (see
 * `apps/frontend/lib/backend-token.ts`).
 */
export default async function BankReconciliationPage() {
  const t = await getTranslations('bank');

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-1 text-muted-foreground">{t('description')}</p>
      </div>

      <BankReconciliationPanel />
    </div>
  );
}
