'use client';

import { useEffect, useState } from 'react';
import { Copy, Download } from 'lucide-react';
import { useTranslations } from 'next-intl';
import QRCode from 'qrcode';
import { toast } from '@/components/toaster';
import { SITE_URL } from '@/lib/site';

/**
 * The code's join link for posters and slides, with a QR code to download.
 * No locale in the URL on purpose: the join page picks the code's language
 * for visitors who haven't chosen one.
 */
export function JoinLink({ code }: { code: string }) {
  const t = useTranslations('adminPromoCodes');
  const url = `${SITE_URL}/join/${code}`;
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Large enough to print on an A4 poster without blurring.
    QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 2, width: 1024 })
      .then((data) => live && setQr(data))
      .catch(() => live && setQr(null));
    return () => {
      live = false;
    };
  }, [url]);

  const copy = () =>
    navigator.clipboard.writeText(url).then(
      () => toast({ text: t('copied'), tone: 'ok' }),
      () => toast({ text: t('failed'), tone: 'err' })
    );

  return (
    <div className="mt-2 flex items-center gap-3">
      {qr && <img src={qr} alt="" width={56} height={56} className="h-14 w-14 shrink-0 rounded border border-border bg-white" />}
      <div className="min-w-0">
        <p className="truncate font-mono text-xs">{url.replace(/^https?:\/\//, '')}</p>
        <div className="mt-1 flex flex-wrap gap-3 text-xs font-semibold text-primary">
          <button type="button" onClick={copy} className="inline-flex items-center gap-1 hover:underline">
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            {t('copyLink')}
          </button>
          {qr && (
            <a href={qr} download={`join-${code.toLowerCase()}.png`} className="inline-flex items-center gap-1 hover:underline">
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
              {t('downloadQr')}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
