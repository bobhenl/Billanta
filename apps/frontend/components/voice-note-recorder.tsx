'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Square } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from '@/components/toaster';
import { useOffline } from '@/components/offline-sync';
import { queueOffline } from '@/lib/offline-outbox';
import { cn } from '@/lib/utils';

/** Long enough to dictate one invoice, short enough to stay far below the backend's 5 MB cap at 32 kbit/s. */
const MAX_MS = 120_000;
const MIN_MS = 1_000;
const MAX_BYTES = 5 * 1024 * 1024;
/** Whisper takes all of these; Safari only records mp4. */
const TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];

function supportedType() {
  if (typeof MediaRecorder === 'undefined') return null;
  return TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

function clock(ms: number) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Records a voice note while offline and puts it into the outbox. Once the
 * device is online again the backend transcribes it and creates a draft for
 * review (`kind: 'voice'` in lib/offline-outbox.ts); nothing is filled into
 * this form.
 */
export function VoiceNoteRecorder({ className }: { className?: string }) {
  const t = useTranslations('offline');
  const locale = useLocale();
  const offline = useOffline();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      // Leaving the page mid-recording drops it rather than queueing half a sentence.
      const active = recorder.current;
      if (active) {
        active.ondataavailable = null;
        active.onstop = null;
        if (active.state !== 'inactive') active.stop();
        active.stream.getTracks().forEach((track) => track.stop());
      }
      if (timer.current) clearInterval(timer.current);
    },
    []
  );

  async function start() {
    setError(null);
    const mimeType = supportedType();
    if (!mimeType || !navigator.mediaDevices?.getUserMedia) return setError(t('voiceUnsupported'));
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError(t('voiceMicDenied'));
    }
    const media = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    media.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      if (timer.current) clearInterval(timer.current);
      recorder.current = null;
      setRecording(false);
      void save(new Blob(chunks, { type: media.mimeType || mimeType }), Date.now() - startedAt);
    };
    recorder.current = media;
    media.start(1000);
    setElapsed(0);
    setRecording(true);
    timer.current = setInterval(() => {
      const ms = Date.now() - startedAt;
      setElapsed(ms);
      if (ms >= MAX_MS) stop();
    }, 250);
  }

  function stop() {
    if (recorder.current?.state === 'recording') recorder.current.stop();
  }

  async function save(audio: Blob, durationMs: number) {
    if (durationMs < MIN_MS || audio.size === 0) return setError(t('voiceTooShort'));
    if (audio.size > MAX_BYTES) return setError(t('voiceTooLong'));
    if (!offline.scope) return setError(t('voiceUnsupported'));
    try {
      await queueOffline({
        kind: 'voice',
        scope: offline.scope,
        label: t('voiceLabel', { duration: clock(durationMs) }),
        payload: { audio, mimeType: audio.type, durationMs, locale }
      });
    } catch {
      return setError(t('voiceNotSaved'));
    }
    toast({ text: t('voiceQueued'), tone: 'ok' });
    offline.sync();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={recording ? stop : start}
        aria-pressed={recording}
        className={cn(
          'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition-colors',
          recording ? 'animate-pulse border-destructive bg-destructive/10 text-destructive' : 'border-primary/40 bg-background text-primary hover:bg-accent',
          className
        )}
      >
        {recording ? <Square className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        {recording ? t('voiceStop', { time: clock(elapsed), max: clock(MAX_MS) }) : t('voiceRecord')}
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  );
}
