'use client';

import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal, buttonClass } from '@/components/modal';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Shared across every mounted button: the browser fires the event once per page load.
let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
let wired = false;

function wire() {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  // Installability needs an active worker; registered unconditionally, it caches nothing.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    listeners.forEach((fn) => fn());
  });
}

// At import time, not on mount: the user-menu entry only mounts once the menu is opened.
wire();

function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.userAgent.includes('Mac') && 'ontouchend' in document);
}

/**
 * "Install app" entry (ported from VoxelRank's PWA flow): fires the browser's
 * native install prompt when one was captured, otherwise opens a short how-to
 * for iOS Safari or for the browser menu. Hidden when already running installed.
 */
export function InstallAppButton({ className, onDone }: { className?: string; onDone?: () => void }) {
  const t = useTranslations('common.installApp');
  const [visible, setVisible] = useState(false);
  const [tip, setTip] = useState<'ios' | 'manual' | null>(null);

  useEffect(() => {
    wire();
    const update = () => setVisible(!isStandalone());
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);

  if (!visible) return null;

  async function install() {
    if (deferredPrompt) {
      const prompt = deferredPrompt;
      deferredPrompt = null;
      await prompt.prompt().catch(() => {});
      prompt.userChoice.catch(() => {});
      onDone?.();
      return;
    }
    setTip(isIos() ? 'ios' : 'manual');
  }

  function close() {
    setTip(null);
    onDone?.();
  }

  return (
    <>
      <button type="button" onClick={install} className={className}>
        <Smartphone className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t('label')}
      </button>
      <Modal
        open={tip !== null}
        onClose={close}
        title={tip === 'ios' ? t('iosTitle') : t('manualTitle')}
        footer={
          <button type="button" onClick={close} className={buttonClass.primary}>
            {t('ok')}
          </button>
        }
      >
        <p className="text-muted-foreground">{tip === 'ios' ? t('iosBody') : t('manualBody')}</p>
      </Modal>
    </>
  );
}
