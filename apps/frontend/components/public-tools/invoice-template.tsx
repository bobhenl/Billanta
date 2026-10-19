import type { Metadata } from 'next';
import { ExternalLink } from 'lucide-react';
import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { lawUrl } from '@faktur/cz-compliance';
import { Link } from '@/i18n/navigation';
import { ToolTabsStrip } from '@/components/public-tools/tool-tabs-strip';
import { getTemplate, isPublishedIn, TEMPLATES, type InvoiceTemplate } from '@/lib/public-tools';
import { toolPageMetadata } from '@/lib/public-tool-meta';
import { cn } from '@/lib/utils';

/**
 * Pieces of the public invoice templates (`/invoice-templates/<slug>`): the
 * rendered sample invoice, the law reference links and the tab row.
 *
 * The texts and the sample data (parties, items, amounts, notes) live in
 * `invoiceTemplates` in the message files, so each language carries the
 * rules it follows: cs and en Czech law in CZK, sk Slovak law in EUR. Only
 * the shape of each sample (which parties, how VAT is shown) is here.
 */

type PartyKey = 'nonPayer' | 'payer' | 'identified' | 'contractor' | 'domestic' | 'developer' | 'eu';
type Party = { name: string; lines: string[]; ids: string[] };
type Line = { d: string; q: number; u: string; p: number; r: number };
/** standard: base + VAT per rate; none: no VAT at all; reverse: base per rate, the customer accounts for the VAT. */
type VatMode = 'standard' | 'none' | 'reverse';

const SAMPLES: Record<InvoiceTemplate['key'], { supplier: PartyKey; customer: PartyKey; vat: VatMode; duzp: boolean }> = {
  nonPayer: { supplier: 'nonPayer', customer: 'domestic', vat: 'none', duzp: false },
  vatPayer: { supplier: 'payer', customer: 'domestic', vat: 'standard', duzp: true },
  proforma: { supplier: 'payer', customer: 'domestic', vat: 'standard', duzp: false },
  creditNote: { supplier: 'payer', customer: 'domestic', vat: 'standard', duzp: false },
  reverseCharge: { supplier: 'contractor', customer: 'developer', vat: 'reverse', duzp: true },
  identified: { supplier: 'identified', customer: 'eu', vat: 'none', duzp: true }
};

// Fixed dates, so the sample (and the static page) never changes by itself.
const ISSUE = '2026-10-05';
const SUPPLY = '2026-10-02';
const DUE = '2026-10-19';

export function templateMetadata(slug: string, locale: string): Promise<Metadata> {
  const tpl = getTemplate(slug)!;
  return toolPageMetadata({
    locale,
    path: `/invoice-templates/${slug}`,
    tool: tpl,
    titleKey: `invoiceTemplates.items.${tpl.key}.title`,
    descriptionKey: `invoiceTemplates.items.${tpl.key}.description`
  });
}

/** "§29/1 ZDPH" → "§ 29 odst. 1 zákona o DPH" linked to the law text; plain text when the rule has no link. */
export async function LawLink({ rule }: { rule: string }) {
  const t = await getTranslations('invoiceTemplates');
  const m = /^§\s*(\d+[a-z]?)(?:\/(\d+))?\s+(\w+)$/.exec(rule);
  const label = m
    ? m[2]
      ? t('common.lawRef', { p: m[1]!, o: m[2], law: t(`laws.${m[3]}` as 'laws.ZDPH') })
      : t('common.lawRefShort', { p: m[1]!, law: t(`laws.${m[3]}` as 'laws.ZDPH') })
    : rule;
  const href = lawUrl(rule);
  if (!href) return <span>{label}</span>;
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
      {label}
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

/** Row of all templates published in this language; scrolls sideways inside its own box on a phone. */
export async function TemplateTabs({ current }: { current?: string }) {
  const t = await getTranslations('invoiceTemplates');
  const locale = await getLocale();
  const tabs = [
    { href: '/invoice-templates', label: t('indexName'), active: !current },
    ...TEMPLATES.filter((x) => isPublishedIn(x, locale)).map((x) => ({
      href: `/invoice-templates/${x.slug}`,
      label: t(`items.${x.key}.name`),
      active: x.slug === current
    }))
  ];
  return (
    <ToolTabsStrip storageKey="invoice-templates" label={t('menu')} className="mb-8 max-w-full overflow-x-auto overscroll-x-contain [scrollbar-width:thin]">
      <ul className="flex w-max gap-1 rounded-xl border border-border bg-card p-1">
        {tabs.map((tab) => (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={tab.active ? 'page' : undefined}
              className={cn(
                'block whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                tab.active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </ToolTabsStrip>
  );
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The sample document, drawn like a sheet of paper in the theme colours.
 * Items are a stacked list rather than a table, so nothing overflows at
 * 375px; totals and the VAT summary are computed from the message data.
 */
export async function InvoiceTemplateSample({ tpl }: { tpl: InvoiceTemplate }) {
  const t = await getTranslations('invoiceTemplates');
  const format = await getFormatter();
  const shape = SAMPLES[tpl.key];
  const k = `items.${tpl.key}` as const;
  const currency = t('currency');
  const lines = t.raw(`${k}.lines`) as Line[];
  const notes = t.raw(`${k}.notes`) as string[];
  const supplier = t.raw(`parties.${shape.supplier}`) as Party;
  const customer = t.raw(`parties.${shape.customer}`) as Party;
  const related = tpl.key === 'creditNote' ? t(`items.creditNote.related`) : null;
  const reason = tpl.key === 'creditNote' ? t(`items.creditNote.reason`) : null;
  const number = t(`${k}.number`);
  const bank = t.raw('bank') as { account: string; iban: string };

  const money = (n: number) => format.number(n, { style: 'currency', currency });
  const date = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { dateStyle: 'medium', timeZone: 'Europe/Prague' });

  const byRate = new Map<number, number>();
  for (const l of lines) byRate.set(l.r, round2((byRate.get(l.r) ?? 0) + l.q * l.p));
  const recap = [...byRate].map(([rate, base]) => ({ rate, base, vat: shape.vat === 'standard' ? round2((base * rate) / 100) : 0 }));
  const total = recap.reduce((s, r) => s + r.base + r.vat, 0);

  const meta: [string, string][] = [
    [t('doc.issueDate'), date(ISSUE)],
    ...(shape.duzp ? ([[t('doc.duzp'), date(SUPPLY)]] as [string, string][]) : []),
    [t('doc.dueDate'), date(DUE)],
    ...(related ? ([[t('doc.related'), related]] as [string, string][]) : [])
  ];

  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card text-sm shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-secondary/60 px-4 py-2 text-xs text-muted-foreground">
        <span className="font-bold uppercase tracking-wider">{t('common.sample')}</span>
        <span>{t('common.fictional')}</span>
      </div>
      <div className="space-y-5 p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <p className="text-lg font-bold sm:text-xl">{t(`${k}.docTitle`)}</p>
          <p className="text-muted-foreground">
            {t('doc.number')}: <span className="font-semibold text-foreground">{number}</span>
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              [t('doc.supplier'), supplier],
              [t('doc.customer'), customer]
            ] as const
          ).map(([label, party]) => (
            <div key={label} className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
              <p className="mt-1 font-semibold">{party.name}</p>
              {party.lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
              {party.ids.map((l) => (
                <p key={l} className="break-words text-muted-foreground">
                  {l}
                </p>
              ))}
            </div>
          ))}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-secondary/50 p-3 sm:grid-cols-4">
          {meta.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-[11px] text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
          {reason && (
            <div className="col-span-2 sm:col-span-4">
              <dt className="text-[11px] text-muted-foreground">{t('doc.reason')}</dt>
              <dd className="font-medium">{reason}</dd>
            </div>
          )}
        </dl>

        <ul className="divide-y divide-border border-y border-border">
          {lines.map((l) => (
            <li key={l.d} className="flex items-start justify-between gap-3 py-2.5">
              <span className="min-w-0">
                <span className="block">{l.d}</span>
                <span className="block text-xs text-muted-foreground">
                  {format.number(l.q)} {l.u} × {money(l.p)}
                  {shape.vat !== 'none' && ` · ${t('doc.rate')} ${l.r} %`}
                </span>
              </span>
              <span className="shrink-0 whitespace-nowrap font-medium tabular-nums">{money(round2(l.q * l.p))}</span>
            </li>
          ))}
        </ul>

        <div className="ml-auto max-w-xs space-y-1">
          {shape.vat === 'standard' && (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t('doc.recap')}</p>
              {recap.map((r) => (
                <div key={r.rate} className="flex justify-between gap-3 text-xs tabular-nums">
                  <span className="text-muted-foreground">
                    {t('doc.base')} {r.rate} % {money(r.base)}
                  </span>
                  <span>
                    {t('doc.vat')} {money(r.vat)}
                  </span>
                </div>
              ))}
            </>
          )}
          {shape.vat === 'reverse' &&
            recap.map((r) => (
              <div key={r.rate} className="flex justify-between gap-3 text-xs tabular-nums">
                <span className="text-muted-foreground">
                  {t('doc.reverseBase')} {r.rate} %
                </span>
                <span>{money(r.base)}</span>
              </div>
            ))}
          <div className="flex justify-between gap-3 border-t border-border pt-2 text-base font-bold tabular-nums">
            <span>{t('doc.totalDue')}</span>
            <span className="whitespace-nowrap">{money(round2(total))}</span>
          </div>
        </div>

        {tpl.key !== 'creditNote' && (
          <dl className="grid gap-x-4 gap-y-1 text-xs sm:grid-cols-[auto_1fr]">
            <dt className="text-muted-foreground">{t('doc.payment')}</dt>
            <dd className="break-words">
              {t('doc.bankTransfer')} {bank.account}
              {bank.iban !== bank.account && <span className="block text-muted-foreground">IBAN {bank.iban}</span>}
            </dd>
            <dt className="text-muted-foreground">{t('doc.vs')}</dt>
            <dd>{number.replace(/\D/g, '')}</dd>
          </dl>
        )}

        {notes.length > 0 && (
          <div className="space-y-1 border-t border-border pt-3 text-xs italic">
            {notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
