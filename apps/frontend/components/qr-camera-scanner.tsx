'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal, buttonClass } from '@/components/modal';
import { scanVideoFrame, type ScannedInvoice } from '@/lib/qr-scan';

/**
 * Live camera scanning of a QR Platba / QR Faktura (back camera on phones).
 * Frames are decoded locally a few times a second; the first recognised code
 * closes the dialog and is handed to `onResult`.
 */
export function QrCameraScanner({ open, onClose, onResult }: { open: boolean; onClose: () => void; onResult: (scan: ScannedInvoice) => void }) {
  const t = useTranslations('qrScan');
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(true);
  const done = useRef(onResult);
  done.current = onResult;

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let alive = true;
    setError(null);
    setStarting(true);
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
        if (!alive) return;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play();
        setStarting(false);
        timer = setInterval(() => {
          const scan = scanVideoFrame(video);
          if (scan && alive) {
            alive = false;
            done.current(scan);
          }
        }, 250);
      } catch (e) {
        if (alive) setError(e instanceof Error && e.message === 'unsupported' ? t('unsupported') : t('denied'));
        setStarting(false);
      }
    })();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [open, t]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('title')}
      footer={
        <button type="button" className={buttonClass.secondary} onClick={onClose}>
          {t('close')}
        </button>
      }
    >
      <p className="mb-3 text-sm text-muted-foreground">{t('hint')}</p>
      {error ? (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-xl bg-black">
          <video ref={videoRef} muted playsInline className="aspect-[4/3] w-full object-cover" />
          <div className="pointer-events-none absolute inset-[18%] rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          {starting && (
            <div className="absolute inset-0 flex items-center justify-center text-white">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
