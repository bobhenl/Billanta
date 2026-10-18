import { Scissors } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import QRCode from 'qrcode';
import { displayUrl, joinUrl, POSTER_SIZES, posterUrl, type PosterOptions, type PosterSize } from '@/lib/posters';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { cn } from '@/lib/utils';
import { PosterFit } from './poster-fit';
import s from './poster-sheet.module.css';

interface PosterCopy {
  brand: string;
  eyebrow: string;
  eventLine: string | null;
  headline: string;
  lead: string;
  benefits: { title: string; text: string }[];
  scan: string;
  codeLabel: string;
  foot: string;
  tabTitle: string;
}

interface SheetProps {
  copy: PosterCopy;
  size: PosterSize;
  /** `qrcode`'s SVG markup, drawn on the server. */
  qrSvg: string;
  url: string;
  host: string;
  promo: string;
  tabs: boolean;
}

/**
 * The Billanta mark without its gradient and "paid" dot: a flat indigo tile
 * survives a black-and-white printer and keeps the poster to one accent.
 */
function FlatMark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={s.mark}>
      <rect width="32" height="32" rx="7" fill="#4f46e5" />
      <path
        d="M10.5 7.5h6.3a4.25 4.25 0 0 1 0 8.5H10.5zM10.5 16h7.4a4.5 4.5 0 0 1 0 9h-7.4z"
        fill="none"
        stroke="#fff"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Qr({ svg, className }: { svg: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: svg }} />;
}

/**
 * The code is a passphrase people copy by hand, so it stays as large as its
 * column allows: about 23 em of mono at ~0.66 em per character, capped at 2.5 em.
 */
function codeEm(code: string): string {
  return `${Math.min(2.5, 23 / (code.length * 0.66)).toFixed(2)}em`;
}

function Sheet({ copy, size, qrSvg, url, host, promo, tabs }: SheetProps) {
  const dims = POSTER_SIZES[size];
  return (
    <article
      data-poster-sheet=""
      data-font-mm={dims.fontMm}
      className={cn(s.sheet, tabs && s.withTabs)}
      style={{ width: `${dims.widthMm}mm`, height: `${dims.heightMm}mm`, fontSize: `${dims.fontMm}mm` }}
    >
      <div className={s.body}>
        <header className={s.top}>
          <span className={s.brand}>
            <FlatMark />
            {copy.brand}
          </span>
          <span className={s.eyebrow}>{copy.eyebrow}</span>
        </header>

        {copy.eventLine && <p className={s.event}>{copy.eventLine}</p>}
        <h1 className={s.headline}>{copy.headline}</h1>
        <p className={s.lead}>{copy.lead}</p>

        <ol className={s.benefits}>
          {copy.benefits.map((b, i) => (
            <li key={i} className={s.benefit}>
              <span className={s.num}>{String(i + 1).padStart(2, '0')}</span>
              <span>
                <strong className={s.benefitTitle}>{b.title}</strong>
                <span className={s.benefitText}>{b.text}</span>
              </span>
            </li>
          ))}
        </ol>

        <section className={s.cta}>
          <Qr svg={qrSvg} className={s.qr} />
          <div className={s.ctaText}>
            <div>
              <p className={s.scan}>{copy.scan}</p>
              <p className={s.url}>{url}</p>
            </div>
            {promo && (
              <div className={s.code}>
                <span className={s.codeLabel}>{copy.codeLabel}</span>
                <span className={s.codeValue} style={{ fontSize: codeEm(promo) }}>
                  {promo}
                </span>
              </div>
            )}
          </div>
        </section>
        <p className={s.foot}>{copy.foot}</p>
      </div>

      {tabs && (
        <div className={s.tabs}>
          <Scissors className={s.scissors} strokeWidth={1.75} aria-hidden="true" />
          {Array.from({ length: dims.tabs }, (_, i) => (
            <div key={i} className={s.tab}>
              <Qr svg={qrSvg} className={cn(s.qr, s.tabQr)} />
              <span className={s.tabTitle}>{copy.tabTitle}</span>
              <span className={s.tabHost}>{host}</span>
              {promo && <span className={s.tabCode}>{promo}</span>}
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

/**
 * One printable page in the poster's own language, which need not be the
 * dashboard's. `a6x4` repeats the A6 flyer four times on an A4 sheet;
 * `.poster-print` is what the page's print stylesheet keeps.
 */
export async function PosterSheet({ options: o }: { options: PosterOptions }) {
  const p = await getTranslations({ locale: o.lang, namespace: 'posters' });
  const tpl = `templates.${o.template}` as const;
  const props: SheetProps = {
    copy: {
      brand: SITE_NAME,
      eyebrow: p(`${tpl}.eyebrow`),
      eventLine: o.event ? p('eventLine', { event: o.event }) : null,
      headline: p(`${tpl}.headline`),
      lead: p(`${tpl}.lead`),
      benefits: p.raw(`${tpl}.benefits`) as PosterCopy['benefits'],
      scan: p(o.promo ? 'scanOrType' : 'scan'),
      codeLabel: p('codeLabel'),
      foot: p('foot'),
      tabTitle: p('tabTitle')
    },
    size: o.size,
    qrSvg: await QRCode.toString(posterUrl(o), { type: 'svg', errorCorrectionLevel: 'M', margin: 0 }),
    // With a code, the printed address is where people type it by hand.
    url: displayUrl(o.promo ? joinUrl() : posterUrl(o)),
    host: displayUrl(o.promo ? joinUrl() : SITE_URL),
    promo: o.promo,
    tabs: o.tabs
  };
  if (o.size === 'a6x4') {
    return (
      <div className={cn('poster-print', s.fourUp)}>
        {[0, 1, 2, 3].map((i) => (
          <Sheet key={i} {...props} />
        ))}
        <PosterFit />
      </div>
    );
  }
  return (
    <div className="poster-print">
      <Sheet {...props} />
      <PosterFit />
    </div>
  );
}
