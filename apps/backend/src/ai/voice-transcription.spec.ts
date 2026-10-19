import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribeVoiceNote, voiceNoteType } from "./voice-transcription";

describe("voiceNoteType", () => {
  it("drops the codec parameter that MediaRecorder adds", () => {
    expect(voiceNoteType("audio/webm;codecs=opus")).toBe("audio/webm");
    expect(voiceNoteType("Audio/MP4")).toBe("audio/mp4");
  });

  it("rejects anything that is not an accepted voice format", () => {
    expect(voiceNoteType("video/webm")).toBeNull();
    expect(voiceNoteType("application/octet-stream")).toBeNull();
    expect(voiceNoteType("")).toBeNull();
  });
});

describe("transcribeVoiceNote", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  function configure() {
    process.env.AI_SERVICE_URL = "http://ai.test/";
    process.env.AI_SERVICE_INTERNAL_TOKEN = "t";
  }

  function stubFetch(status: number, body: unknown) {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetch);
    return fetch;
  }

  it("is a visible 422 when the AI service is not configured", async () => {
    delete process.env.AI_SERVICE_URL;
    await expect(transcribeVoiceNote(Buffer.from("a"), "audio/webm", null)).rejects.toMatchObject({ status: 422 });
  });

  it("sends the audio with the token and language", async () => {
    configure();
    const fetch = stubFetch(200, { transcript: "  faktura pro Alzu  " });
    await expect(transcribeVoiceNote(Buffer.from("a"), "audio/webm", "cs")).resolves.toBe("faktura pro Alzu");
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("http://ai.test/internal/transcribe?language=cs");
    expect(init.headers).toMatchObject({ "Content-Type": "audio/webm", "X-Internal-Token": "t" });
  });

  it.each([
    [413, 413],
    [422, 422],
    [502, 503],
  ])("maps ai-service %i to %i", async (upstream, status) => {
    configure();
    stubFetch(upstream, { detail: "x" });
    await expect(transcribeVoiceNote(Buffer.from("a"), "audio/webm", null)).rejects.toMatchObject({ status });
  });

  it("is retryable (503) when the service cannot be reached", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(transcribeVoiceNote(Buffer.from("a"), "audio/webm", null)).rejects.toMatchObject({ status: 503 });
  });
});
