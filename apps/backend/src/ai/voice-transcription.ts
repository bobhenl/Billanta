import { HttpException, HttpStatus, ServiceUnavailableException, UnprocessableEntityException } from "@nestjs/common";

/** Same cap as the dashboard recorder enforces; Whisper itself takes up to 25 MB. */
export const MAX_VOICE_NOTE_BYTES = 5 * 1024 * 1024;
export const VOICE_NOTE_TYPES = ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/x-wav"] as const;
const TIMEOUT_MS = 90_000;

/** `audio/webm;codecs=opus` -> `audio/webm`; null for anything that is not a voice note we accept. */
export function voiceNoteType(mimetype: string): string | null {
  const base = mimetype.split(";")[0]!.trim().toLowerCase();
  return (VOICE_NOTE_TYPES as readonly string[]).includes(base) ? base : null;
}

/**
 * Speech to text through apps/ai-service (`POST /internal/transcribe`), the
 * same ffmpeg + Whisper step the Telegram and WhatsApp voice notes go
 * through. The audio is sent as the raw body; `AI_SERVICE_INTERNAL_TOKEN`
 * is shared by both services.
 *
 * A deployment without the AI service answers 422 `voice_unavailable`, so
 * an offline-queued note fails visibly instead of being retried forever; a
 * timeout or an unreachable service is 503, which the dashboard retries.
 */
export async function transcribeVoiceNote(audio: Buffer, mimeType: string, language: string | null): Promise<string> {
  const base = process.env.AI_SERVICE_URL?.trim().replace(/\/$/, "");
  const token = process.env.AI_SERVICE_INTERNAL_TOKEN?.trim();
  if (!base || !token) throw new UnprocessableEntityException({ error: "voice_unavailable" });

  const url = `${base}/internal/transcribe${language ? `?language=${encodeURIComponent(language)}` : ""}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": mimeType, "X-Internal-Token": token },
      body: new Uint8Array(audio),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ServiceUnavailableException({ error: "voice_service_unreachable" });
  }
  const body = (await res.json().catch(() => ({}))) as { transcript?: unknown; error?: unknown };
  if (res.ok && typeof body.transcript === "string" && body.transcript.trim()) return body.transcript.trim();
  if (res.status === 413) throw new HttpException({ error: "voice_too_large" }, HttpStatus.PAYLOAD_TOO_LARGE);
  if (res.status === 422) throw new UnprocessableEntityException({ error: "voice_empty" });
  throw new ServiceUnavailableException({ error: "voice_transcription_failed" });
}
