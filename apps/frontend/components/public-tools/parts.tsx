import { ArrowRight, ExternalLink, Info, type LucideIcon } from 'lucide-react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { CreateInvoiceLink } from '@/components/marketing-account-links';
import { CALCULATORS, GUIDES, isPublishedIn } from '@/lib/public-tools';

/**
 * Building blocks shared by the public calculators (/calculators/…) and
 * guides (/guides/…), so every page carries the same disclaimer, the same
 * sign-up CTA and the same related links.
 */

/**
 * Visible breadcrumb (hub / page) plus the heading. It has two rungs, so the
 * pages deliberately emit no BreadcrumbList: a two-rung trail shows only
 * the domain in results, which the result prints anyway. If a third level
 * is ever added here, add the BreadcrumbList in the page at the same time.
 */
export function ToolHeader({
  hubHref,
  hubLabel,
  name,
  title,
  lead,
  icon: Icon
}: {
  hubHref: string;
  hubLabel: string;
  name: string;
  title: string;
  lead: React.ReactNode;
  icon: LucideIcon;
}) {
  return (
    <>
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link href={hubHref} className="hover:text-foreground">
          {hubLabel}
        </Link>
        <span className="mx-2">/</span>
        <span className="text-foreground">{name}</span>
      </nav>
      <div className="mt-4 flex items-start gap-4">
        <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary sm:flex">
          <Icon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div>
          <h1 className="max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
          <p className="mt-4 max-w-2xl text-lg text-muted-foreground">{lead}</p>
        </div>
      </div>
    </>
  );
}

/** "Orientační výpočet" box with the year the constants apply to; `text` replaces the generic caveat. */
export async function ToolDisclaimer({ validity, text }: { validity?: string; text?: string }) {
  const t = await getTranslations('tools.common');
  return (
    <aside className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div>
        <p className="font-semibold">{t('disclaimerTitle')}</p>
        {validity && <p className="mt-1 font-medium">{validity}</p>}
        <p className="mt-1 leading-relaxed text-muted-foreground">
          {text ?? t('disclaimer')} {t('noLiability')}
        </p>
      </div>
    </aside>
  );
}

/** One-line caveat for tools that compute nothing tax-related (QR, IBAN, due date, company lookup). */
export async function ToolNote() {
  const t = await getTranslations('tools.common');
  return (
    <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {t('noWarranty')}
    </p>
  );
}

/** Guide footer: what the info is based on, when it was last checked, and the official source. */
export async function GuideSources({
  checked,
  officialUrl,
  extra,
  officialLabel,
  disclaimer
}: {
  checked: string;
  officialUrl: string;
  extra?: string;
  /** Replace the Czech wording ("Finanční správa") for a guide about other rules. */
  officialLabel?: string;
  disclaimer?: string;
}) {
  const t = await getTranslations('tools.common');
  const format = await getFormatter();
  const date = format.dateTime(new Date(`${checked}T12:00:00Z`), { dateStyle: 'long', timeZone: 'Europe/Prague' });
  return (
    <aside className="flex gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <div className="space-y-1">
        <p className="font-semibold">{t('lastChecked', { date })}</p>
        {extra && <p className="text-muted-foreground">{extra}</p>}
        <p className="leading-relaxed text-muted-foreground">{disclaimer ?? t('guideDisclaimer')}</p>
        <p>
          <a href={officialUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline">
            {officialLabel ?? t('officialSource')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </p>
      </div>
    </aside>
  );
}

export async function SignupCta() {
  const t = await getTranslations('tools.common');
  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
      <h2 className="text-lg font-semibold">{t('ctaTitle')}</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('ctaText')}</p>
      <Link
        href="/signup"
        className="mt-4 inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90"
      >
        {t('ctaButton')}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Link>
      <p className="mt-2 text-xs text-muted-foreground">{t('ctaNote')}</p>
    </div>
  );
}

/** CTA of the invoice tools: the guest invoice, then the account as the second step. */
export async function InvoiceCta() {
  const t = await getTranslations('tools.common');
  return (
    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6">
      <h2 className="text-lg font-semibold">{t('invoiceCtaTitle')}</h2>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('invoiceCtaText')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <CreateInvoiceLink className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:opacity-90">
          {t('invoiceCtaButton')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </CreateInvoiceLink>
        <Link href="/signup" className="text-sm font-semibold text-primary hover:underline">
          {t('ctaButton')}
        </Link>
      </div>
    </div>
  );
}

/** Links to the other calculators and guides published in this language. */
export async function RelatedTools({ current }: { current: string }) {
  const t = await getTranslations('tools');
  const locale = await getLocale();
  const calculators = CALCULATORS.filter((c) => c.slug !== current && isPublishedIn(c, locale));
  const guides = GUIDES.filter((g) => g.slug !== current && isPublishedIn(g, locale));
  const pill = 'inline-flex rounded-full border border-border bg-card px-4 py-2 text-sm font-medium hover:border-primary/40 hover:text-primary';
  return (
    <nav aria-label={t('common.related')} className="border-t border-border pt-8">
      <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('common.related')}</h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {calculators.map((c) => (
          <li key={c.slug}>
            <Link href={`/calculators/${c.slug}`} className={pill}>
              {t(`calculators.items.${c.key}.name`)}
            </Link>
          </li>
        ))}
        <li>
          <Link href="/calculators" className="inline-flex px-4 py-2 text-sm font-medium text-primary hover:underline">
            {t('common.allCalculators')} →
          </Link>
        </li>
      </ul>
      {guides.length > 0 && (
        <>
          <h2 className="mt-6 text-xs font-bold uppercase tracking-wider text-muted-foreground">{t('common.relatedGuides')}</h2>
          <ul className="mt-4 flex flex-wrap gap-2">
            {guides.map((g) => (
              <li key={g.slug}>
                <Link href={`/guides/${g.slug}`} className={pill}>
                  {t(`guides.items.${g.key}.name`)}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </nav>
  );
}

/** Ordered "how it is calculated" list; `link` marks up glossary terms (see glossaryLinker). */
export function HowList({ title, items, link }: { title: string; items: string[]; link?: (text: string) => React.ReactNode }) {
  return (
    <div>
      <h2 className="text-xl font-semibold">{title}</h2>
      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-relaxed">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            <span>{link ? link(item) : item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What the sk URL of a Czech-rules page shows instead of a Slovak
 * translation (the page itself is noindex,follow, see toolPageMetadata).
 */
/**
 * `skAlternative` is a page about the same thing under Slovak rules: then
 * the notice says so and links there as well.
 */
export async function CzOnlyNotice({ name, path, skAlternative }: { name: string; path: string; skAlternative?: { href: string; name: string } }) {
  const t = await getTranslations('tools.common');
  return (
    <section className="container max-w-2xl py-16">
      <div className="rounded-2xl border border-border bg-card p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{t('czOnlyTitle')}</h1>
        <p className="mt-3 text-muted-foreground">{t(skAlternative ? 'czOnlyTextAlt' : 'czOnlyText', { name })}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href={path}
            locale="cs"
            hrefLang="cs"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            {t('czOnlyCs')}
          </Link>
          {skAlternative && (
            <Link
              href={skAlternative.href}
              className="inline-flex items-center gap-2 rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:border-primary/40 hover:text-primary"
            >
              {skAlternative.name}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
          <a
            href="https://www.financnasprava.sk/"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:border-primary/40 hover:text-primary"
          >
            {t('czOnlySk')}
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </div>
      </div>
    </section>
  );
}
