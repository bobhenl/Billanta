import { AlertTriangle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Placeholder Terms of Service (VOP) page — blueprint §9.
 *
 * This is deliberately NOT real legal text. Per the blueprint, the actual
 * VOP wording (as-is disclaimer, "no tax/legal advice", user responsibility
 * for invoice content, AI-output disclaimer, ARES/registry data disclaimer,
 * limitation of liability, governing law) must be drafted and periodically
 * reviewed by a Czech attorney (ideally with e-commerce/SaaS experience) —
 * fabricating that text here would be actively harmful. This route exists
 * purely so the signup page's required ToS checkbox has something real to
 * link to; swap the placeholder body for the attorney-drafted VOP before
 * launch.
 *
 * Each clause below is rendered as its own section with a one-sentence
 * plain-language summary of what the *final* clause will cover, plus a
 * "pending legal review" callout — never the binding clause text itself.
 * The clause order mirrors blueprint §9's numbered list exactly.
 */
const CLAUSE_KEYS = [
  'asIs',
  'noAdvice',
  'userResponsibility',
  'aiDisclaimer',
  'aresDisclaimer',
  'liability',
  'governingLaw'
] as const;

export default async function TermsOfServicePage() {
  const t = await getTranslations('legal.terms');
  const tLegal = await getTranslations('legal');

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t('intro')}</p>

      <div className="mt-8 space-y-6">
        {CLAUSE_KEYS.map((key, index) => (
          <section key={key} className="rounded-lg border border-dashed border-border p-5">
            <h2 className="text-base font-semibold">
              <span className="text-muted-foreground">{index + 1}.</span> {t(`sections.${key}.title`)}
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">{t(`sections.${key}.summary`)}</p>
            <div className="mt-4 flex items-center gap-2 rounded-md bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{tLegal('pendingReviewLabel')}</span>
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
