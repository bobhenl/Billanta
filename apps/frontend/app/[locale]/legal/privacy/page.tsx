import { AlertTriangle } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

/**
 * Placeholder Privacy Policy (GDPR) page — blueprint §8 (Security & GDPR)
 * and §9 (Legal & Liability).
 *
 * Deliberately NOT real legal text, for the same reason as
 * `legal/terms/page.tsx`: GDPR wording needs to be drafted and periodically
 * reviewed by an attorney with data-protection experience, and fabricating
 * it here would be actively harmful. Each section below is a one-sentence
 * plain-language summary of what the *final* policy will cover, plus a
 * "pending legal review" callout — never the binding text itself.
 *
 * Section topics come straight from blueprint §8: what's collected
 * (account/tenant/contact data, invoice content), why (service delivery,
 * ~10-year statutory invoice retention), who it's shared with (Stripe/GoPay
 * for billing, OpenAI for voice transcription when the AI feature is used,
 * ARES as a public registry lookup), user rights (access/export/deletion,
 * subject to the legal-retention carve-out), and data residency (EU-region
 * hosting).
 */
const SECTION_KEYS = ['dataCollected', 'purpose', 'sharing', 'rights', 'dataResidency'] as const;

export default async function PrivacyPolicyPage() {
  const t = await getTranslations('legal.privacy');
  const tLegal = await getTranslations('legal');

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="mt-3 text-sm text-muted-foreground">{t('intro')}</p>

      <div className="mt-8 space-y-6">
        {SECTION_KEYS.map((key, index) => (
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
