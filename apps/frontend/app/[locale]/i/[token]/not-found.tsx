import { getTranslations } from 'next-intl/server';

/**
 * Scoped `not-found` boundary for the client-portal route
 * (`app/[locale]/i/[token]/page.tsx`) — reached via `notFound()` when
 * `getPublicInvoice` returns `null` (unmatched or malformed `public_token`;
 * see `apps/backend/src/public-invoices/public-invoices.service.ts`, which
 * deliberately returns the same 404 for both cases). Kept minimal and on
 * brand rather than falling back to Next's generic default 404 page, since
 * an external client (not a signed-in dashboard user) is the one seeing it.
 */
export default async function PublicInvoiceNotFound() {
  const t = await getTranslations('publicInvoice');

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{t('notFoundTitle')}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t('notFoundBody')}</p>
    </div>
  );
}
