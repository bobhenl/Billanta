'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

/* Minimal typing of the Web Speech API (not in lib.dom for every TS version). */
interface SpeechResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

const LANGS: Record<string, string> = { cs: 'cs-CZ', sk: 'sk-SK', en: 'en-US' };

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser speech-to-text (Web Speech API — Chrome, Edge, Safari). While
 * listening, `onText` gets the running transcript (base text + what was said);
 * when the user stops talking, `onDone` gets the final text. Renders nothing
 * where the API is missing (Firefox), so the textarea stays the fallback.
 */
export function DictationButton({
  base = '',
  onText,
  onDone,
  autoStart = false,
  disabled,
  className
}: {
  base?: string;
  onText: (text: string) => void;
  onDone?: (text: string) => void;
  autoStart?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  const t = useTranslations('dictation');
  const locale = useLocale();
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef({ onText, onDone });
  cb.current = { onText, onDone };

  useEffect(() => setSupported(recognitionCtor() !== null), []);

  const start = () => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = LANGS[locale] ?? 'cs-CZ';
    r.continuous = false;
    r.interimResults = true;
    const prefix = base.trim() ? `${base.trim()} ` : '';
    let finalText = '';
    let latest = prefix;
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      latest = (prefix + finalText + interim).replace(/\s+/g, ' ');
      cb.current.onText(latest);
    };
    r.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? t('denied') : t('failed'));
    };
    r.onend = () => {
      rec.current = null;
      setListening(false);
      const text = latest.trim();
      if (text && text !== prefix.trim()) cb.current.onDone?.(text);
    };
    setError(null);
    try {
      r.start();
      rec.current = r;
      setListening(true);
    } catch {
      setError(t('failed'));
    }
  };

  const stop = () => rec.current?.stop();

  useEffect(() => {
    if (autoStart && supported) start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart, supported]);

  useEffect(() => () => rec.current?.abort(), []);

  if (!supported) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={listening ? stop : start}
        disabled={disabled && !listening}
        aria-pressed={listening}
        title={listening ? t('stop') : t('start')}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition-colors disabled:opacity-50',
          listening ? 'animate-pulse border-destructive bg-destructive/10 text-destructive' : 'border-primary/40 bg-background text-primary hover:bg-accent',
          className
        )}
      >
        {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        {listening ? t('listening') : t('start')}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
