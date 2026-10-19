import { REFERRAL_CODE } from '@/lib/referral';
import { SITE_URL } from '@/lib/site';

/**
 * Badges and widgets other sites paste in (Settings → Invite for credits,
 * /for-partners, /for-accountants, the calculator pages).
 *
 * Every snippet carries a plain `<a>` in the host page's own HTML, never
 * only inside the iframe: a link inside our iframe is a link from our own
 * domain and passes nothing. It points straight at a real page on SITE_URL
 * (no counting redirect), tagged the same way as the invoice footer
 * (apps/backend/src/invoices/brand-credit.ts): `utm_source` is the surface,
 * `utm_medium` the kind of placement, `utm_content` the variant, and `ref`
 * the owner's invite code so the middleware credits them.
 */

export const EMBED_LANGS = ['cs', 'sk', 'en'] as const;
export type EmbedLang = (typeof EMBED_LANGS)[number];
export type EmbedTheme = 'light' | 'dark';
export type BadgeKind = 'customer' | 'partner';
export type EmbedVariant = BadgeKind | 'qr' | 'pay' | 'vat';

export function embedLang(value: string | null | undefined): EmbedLang {
  return (EMBED_LANGS as readonly string[]).includes(value ?? '') ? (value as EmbedLang) : 'cs';
}

const TARGETS: Record<EmbedVariant, { source: 'badge' | 'widget' | 'calculator'; path: string }> = {
  customer: { source: 'badge', path: '' },
  partner: { source: 'badge', path: '/for-partners' },
  qr: { source: 'widget', path: '/calculators/qr-payment' },
  pay: { source: 'widget', path: '/features/qr-payments' },
  vat: { source: 'calculator', path: '/calculators/vat' }
};

/** The followable link back to us that every snippet carries. */
export function backlinkUrl(variant: EmbedVariant, lang: EmbedLang, ref?: string | null, site = SITE_URL): string {
  const { source, path } = TARGETS[variant];
  const params = new URLSearchParams({ utm_source: source, utm_medium: 'embed', utm_content: variant });
  if (ref && REFERRAL_CODE.test(ref)) params.set('ref', ref);
  return `${site}/${lang}${path}?${params.toString()}`;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ */
/* Badges                                                              */
/* ------------------------------------------------------------------ */

const BADGE_HEIGHT = 40;
const BADGE_COLORS: Record<EmbedTheme, { bg: string; border: string; text: string }> = {
  light: { bg: '#ffffff', border: '#e0e7ff', text: '#1e1b4b' },
  dark: { bg: '#111827', border: '#374151', text: '#f9fafb' }
};
const FONT = 'system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif';

/**
 * Text width at 13px semibold, roughly. The SVG pins it with `textLength`,
 * so whatever font the visitor has, the label fills exactly this box.
 */
function labelWidth(label: string): number {
  return Math.ceil(label.length * 7.4);
}

export function badgeWidth(label: string): number {
  return 8 + 24 + 10 + labelWidth(label) + 14;
}

/** The brand mark from app/icon.svg, drawn in a 24px box. */
function markSvg(x: number, y: number): string {
  return (
    `<g transform="translate(${x} ${y}) scale(0.75)">` +
    '<rect width="32" height="32" rx="8" fill="#4f46e5"/>' +
    '<path d="M10.5 7.5h6.3a4.25 4.25 0 0 1 0 8.5H10.5zM10.5 16h7.4a4.5 4.5 0 0 1 0 9h-7.4z" fill="none" stroke="#fff" stroke-width="2.8" stroke-linejoin="round"/>' +
    '<circle cx="24.6" cy="8.4" r="2.6" fill="#4ade80"/></g>'
  );
}

/** A self-contained SVG badge (no fonts, scripts or external references). */
export function badgeSvg(label: string, theme: EmbedTheme): string {
  const c = BADGE_COLORS[theme];
  const width = badgeWidth(label);
  const text = escapeHtml(label);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BADGE_HEIGHT}" viewBox="0 0 ${width} ${BADGE_HEIGHT}" role="img" aria-label="${text}">` +
    `<title>${text}</title>` +
    `<rect x="0.5" y="0.5" width="${width - 1}" height="${BADGE_HEIGHT - 1}" rx="8" fill="${c.bg}" stroke="${c.border}"/>` +
    markSvg(8, 8) +
    `<text x="42" y="25" fill="${c.text}" font-family="${FONT}" font-size="13" font-weight="600" textLength="${labelWidth(label)}" lengthAdjust="spacingAndGlyphs">${text}</text>` +
    '</svg>'
  );
}

export function badgeImageUrl(kind: BadgeKind, lang: EmbedLang, theme: EmbedTheme, site = SITE_URL): string {
  return `${site}/badges/${kind}-${lang}${theme === 'dark' ? '-dark' : ''}.svg`;
}

/** `customer-cs.svg`, `partner-en-dark.svg`, … */
export function parseBadgeFile(file: string): { kind: BadgeKind; lang: EmbedLang; theme: EmbedTheme } | null {
  const m = file.match(/^(customer|partner)-(cs|sk|en)(-dark)?\.svg$/);
  if (!m) return null;
  return { kind: m[1] as BadgeKind, lang: m[2] as EmbedLang, theme: m[3] ? 'dark' : 'light' };
}

export interface BadgeSnippetInput {
  kind: BadgeKind;
  lang: EmbedLang;
  theme: EmbedTheme;
  label: string;
  ref?: string | null;
}

/** The badge as a linked image hosted by us. */
export function badgeImageSnippet({ kind, lang, theme, label, ref }: BadgeSnippetInput): string {
  const l = escapeHtml(label);
  return (
    `<a href="${escapeHtml(backlinkUrl(kind, lang, ref))}" title="${l}">` +
    `<img src="${escapeHtml(badgeImageUrl(kind, lang, theme))}" alt="${l}" width="${badgeWidth(label)}" height="${BADGE_HEIGHT}" style="border:0;vertical-align:middle">` +
    '</a>'
  );
}

/** The same badge in plain HTML, for sites that block outside images. */
export function badgeHtmlSnippet({ kind, lang, theme, label, ref }: BadgeSnippetInput): string {
  const c = BADGE_COLORS[theme];
  const mark = `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" style="flex:none">${markSvg(0, 0)}</svg>`;
  return (
    `<a href="${escapeHtml(backlinkUrl(kind, lang, ref))}" style="display:inline-flex;align-items:center;gap:10px;padding:7px 14px 7px 8px;border:1px solid ${c.border};border-radius:8px;background:${c.bg};color:${c.text};font:600 13px/1.2 ${FONT};text-decoration:none">` +
    `${mark}${escapeHtml(label)}</a>`
  );
}

/* ------------------------------------------------------------------ */
/* Widgets                                                             */
/* ------------------------------------------------------------------ */

function poweredBy(href: string, text: string): string {
  return `<p style="margin:6px 0 0;font:12px/1.4 ${FONT}"><a href="${escapeHtml(href)}">${escapeHtml(text)}</a></p>`;
}

export interface QrWidgetInput {
  lang: EmbedLang;
  theme: EmbedTheme;
  /** IBAN or a Czech "123456789/0800"; checked again when the widget renders. */
  account: string;
  amount?: number;
  currency: 'CZK' | 'EUR';
  vs?: string;
  message?: string;
  /** Payee name; PAY by square (Slovak banks) requires one. */
  name?: string;
  title: string;
  linkText: string;
  ref?: string | null;
}

export function qrWidgetSrc(input: Omit<QrWidgetInput, 'title' | 'linkText' | 'ref'>, site = SITE_URL): string {
  const params = new URLSearchParams({ lang: input.lang, acc: input.account.replace(/\s+/g, '') });
  if (input.amount && input.amount > 0) params.set('am', String(input.amount));
  params.set('cc', input.currency);
  if (input.vs) params.set('vs', input.vs);
  if (input.message) params.set('msg', input.message);
  if (input.name) params.set('name', input.name);
  if (input.theme === 'dark') params.set('theme', 'dark');
  return `${site}/embed/qr?${params.toString()}`;
}

export function qrWidgetSnippet(input: QrWidgetInput): string {
  return (
    `<iframe src="${escapeHtml(qrWidgetSrc(input))}" title="${escapeHtml(input.title)}" width="280" height="390" style="border:0;max-width:100%" loading="lazy"></iframe>\n` +
    poweredBy(backlinkUrl('qr', input.lang, input.ref), input.linkText)
  );
}

/**
 * Only our own public invoice links (`/i/<token>`, with or without a
 * locale), rebuilt on SITE_URL so a pasted link can't send the payer
 * anywhere else.
 */
export function publicInvoiceUrl(pasted: string, lang: EmbedLang): string | null {
  let url: URL;
  try {
    url = new URL(pasted.trim());
  } catch {
    return null;
  }
  const m = url.pathname.match(/^\/(?:(cs|sk|en)\/)?i\/([A-Za-z0-9_-]{6,160})\/?$/);
  return m ? `${SITE_URL}/${m[1] ?? lang}/i/${m[2]}` : null;
}

export interface PayButtonInput {
  lang: EmbedLang;
  invoiceUrl: string;
  label: string;
  linkText: string;
  ref?: string | null;
}

/** Plain HTML: no iframe or script, so it survives page builders that strip both. */
export function payButtonSnippet({ lang, invoiceUrl, label, linkText, ref }: PayButtonInput): string {
  // nofollow: the invoice page is private (noindex, disallowed in robots.txt).
  return (
    `<a href="${escapeHtml(invoiceUrl)}" rel="nofollow" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#4f46e5;color:#ffffff;font:600 15px/1.2 ${FONT};text-decoration:none">${escapeHtml(label)}</a>\n` +
    poweredBy(backlinkUrl('pay', lang, ref), linkText)
  );
}

export interface VatWidgetInput {
  lang: EmbedLang;
  theme: EmbedTheme;
  title: string;
  linkText: string;
  ref?: string | null;
}

export function vatWidgetSrc(lang: EmbedLang, theme: EmbedTheme, site = SITE_URL): string {
  return `${site}/embed/vat?lang=${lang}${theme === 'dark' ? '&theme=dark' : ''}`;
}

export function vatWidgetSnippet({ lang, theme, title, linkText, ref }: VatWidgetInput): string {
  return (
    `<iframe src="${escapeHtml(vatWidgetSrc(lang, theme))}" title="${escapeHtml(title)}" width="100%" height="680" style="border:0;max-width:480px" loading="lazy"></iframe>\n` +
    poweredBy(backlinkUrl('vat', lang, ref), linkText)
  );
}
