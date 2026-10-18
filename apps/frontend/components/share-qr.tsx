'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { Copy, Download, QrCode, Share2 } from 'lucide-react';
import { Modal } from '@/components/modal';
import { toast } from '@/components/toaster';
import { usePathname } from '@/i18n/navigation';
import { buttonClass, inputClass } from '@/lib/ui-classes';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import { cn } from '@/lib/utils';

/** What a group code may look like in the link; anything else is dropped as it is typed. */
const CODE_CHARS = /[^A-Z0-9-]/g;
const CODE_MAX = 32;

/**
 * "Share / QR code" for a public page: the page's canonical URL (SITE_URL,
 * not the host the visitor happens to be on, so a QR printed from a preview
 * still leads to the live site) in the visitor's language. With a group code
 * typed in (an event, a coworking, a creator) the QR leads to `/join/CODE`
 * instead, which applies the code and then sends the visitor on.
 */
export function ShareQr({ className }: { className?: string }) {
  const t = useTranslations('shareQr');
  const locale = useLocale();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');

  const url = code ? `${SITE_URL}/${locale}/join/${encodeURIComponent(code)}` : `${SITE_URL}/${locale}${pathname === '/' ? '' : pathname}`;
  const slug = code ? `join-${code.toLowerCase()}` : pathname.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'home';

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonClass.secondary, className)}>
        <QrCode className="h-4 w-4" aria-hidden="true" />
        {t('button')}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('title')}>
        <p className="text-muted-foreground">{t('lead')}</p>
        {open && (
          <QrLinkPanel url={url} fileSlug={slug}>
            <label className="mt-4 block">
              <span className="text-sm font-semibold">{t('promoLabel')}</span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(CODE_CHARS, '').slice(0, CODE_MAX))}
                placeholder={t('promoPlaceholder')}
                autoComplete="off"
                spellCheck={false}
                className={cn(inputClass, 'mt-1 font-mono uppercase')}
              />
              <span className="mt-1 block text-xs text-muted-foreground">{t('promoHint')}</span>
            </label>
          </QrLinkPanel>
        )}
      </Modal>
    </>
  );
}

/**
 * A QR of `url` with copy, PNG (slides, chats) and SVG (print, any size)
 * downloads. Drawn in the browser by the same `qrcode` package the payment
 * QR uses. `children` go between the QR and the buttons.
 */
export function QrLinkPanel({ url, fileSlug, className, children }: { url: string; fileSlug: string; className?: string; children?: ReactNode }) {
  const t = useTranslations('shareQr');
  const [svg, setSvg] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => setCanShare(typeof navigator.share === 'function'), []);

  useEffect(() => {
    let live = true;
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 })
      .then((s) => live && setSvg(s))
      .catch(() => live && setSvg(null));
    return () => {
      live = false;
    };
  }, [url]);

  const save = (href: string, ext: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = `${SITE_NAME.toLowerCase()}-${fileSlug}.${ext}`;
    a.click();
  };

  const downloadPng = async () => {
    try {
      save(await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 1024 }), 'png');
    } catch {
      toast({ text: t('failed'), tone: 'err' });
    }
  };

  const downloadSvg = () => {
    if (!svg) return;
    const href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    save(href, 'svg');
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ text: t('copied'), tone: 'ok' });
    } catch {
      toast({ text: t('failed'), tone: 'err' });
    }
  };

  const share = () => {
    navigator.share({ url }).catch(() => undefined);
  };

  return (
    <div className={className}>
      {/* The SVG carries its own light quiet zone, so it scans in dark mode too. */}
      <div className="mx-auto mt-4 w-full max-w-[15rem] overflow-hidden rounded-xl border border-border">
        {svg ? (
          // eslint-disable-next-line @next/next/no-img-element -- a data URI drawn in the browser, nothing for next/image to optimise
          <img src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} alt={t('alt', { url })} className="aspect-square w-full" />
        ) : (
          <div className="aspect-square w-full" />
        )}
      </div>
      <p className="mt-3 break-all text-center text-xs text-muted-foreground">{url}</p>

      {children}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={copy} className={cn(buttonClass.primary, 'col-span-2')}>
          <Copy className="h-4 w-4" aria-hidden="true" />
          {t('copy')}
        </button>
        <button type="button" onClick={downloadPng} className={buttonClass.secondary}>
          <Download className="h-4 w-4" aria-hidden="true" />
          PNG
        </button>
        <button type="button" onClick={downloadSvg} disabled={!svg} className={buttonClass.secondary}>
          <Download className="h-4 w-4" aria-hidden="true" />
          SVG
        </button>
        {canShare && (
          <button type="button" onClick={share} className={cn(buttonClass.ghost, 'col-span-2')}>
            <Share2 className="h-4 w-4" aria-hidden="true" />
            {t('share')}
          </button>
        )}
      </div>
    </div>
  );
}
