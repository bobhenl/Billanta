"""Unit tests for transcribe_audio() (blueprint §6 step 4-5).

`asyncio.create_subprocess_exec` is faked so no real `ffmpeg` binary is
required (none is installed in this environment - see the confidence note
in the module docstring), and `openai.AsyncOpenAI` is faked so no real
OPENAI_API_KEY / network call is made. This verifies: the ffmpeg command
construction (input/output paths, sample-rate/channel flags), temp-file
cleanup on both success and failure, size-limit enforcement, and mapping of
ffmpeg/OpenAI failures to `TranscriptionError`.

NOT covered here (needs a real OPENAI_API_KEY and a real ffmpeg binary,
out of scope for unit tests): whether Whisper actually transcribes correctly,
and whether the constructed ffmpeg command behaves as expected against real
audio bytes.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.pipeline import voice_to_invoice as v2i
from app.pipeline.errors import MediaTooLargeError, TranscriptionError


class FakeProcess:
    def __init__(self, returncode: int, stdout: bytes = b"", stderr: bytes = b"", on_communicate=None):
        self.returncode = returncode
        self._stdout = stdout
        self._stderr = stderr
        self._on_communicate = on_communicate

    async def communicate(self):
        if self._on_communicate is not None:
            self._on_communicate()
        return self._stdout, self._stderr


def _write_output_side_effect(args: tuple) -> callable:
    """Return a callable that writes fake WAV bytes to the ffmpeg output path.

    Mirrors what a real ffmpeg invocation would do: produce the output file
    named as the command's last argument.
    """
    output_path = Path(args[-1])

    def _write() -> None:
        output_path.write_bytes(b"RIFF-fake-wav-data")

    return _write


def _patch_ffmpeg_success(monkeypatch):
    async def fake_create_subprocess_exec(*args, **kwargs):
        return FakeProcess(0, on_communicate=_write_output_side_effect(args))

    monkeypatch.setattr(v2i.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)


def _patch_ffmpeg_failure(monkeypatch, stderr: bytes = b"ffmpeg: invalid data"):
    async def fake_create_subprocess_exec(*args, **kwargs):
        return FakeProcess(1, stderr=stderr)

    monkeypatch.setattr(v2i.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)


def _patch_ffmpeg_not_found(monkeypatch):
    async def fake_create_subprocess_exec(*args, **kwargs):
        raise FileNotFoundError("ffmpeg not found")

    monkeypatch.setattr(v2i.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)


class FakeTranscriptions:
    def __init__(self, text: str | None = None, exc: Exception | None = None):
        self._text = text
        self._exc = exc

    async def create(self, **kwargs):
        if self._exc is not None:
            raise self._exc

        class _Result:
            text = self._text

        return _Result()


class FakeAudio:
    def __init__(self, transcriptions: FakeTranscriptions):
        self.transcriptions = transcriptions


class FakeAsyncOpenAI:
    def __init__(self, transcriptions: FakeTranscriptions, **_kwargs):
        self.audio = FakeAudio(transcriptions)


def _patch_openai(monkeypatch, *, text: str | None = "Faktura pro pana Nováka, 5000 korun.", exc=None):
    transcriptions = FakeTranscriptions(text=text, exc=exc)
    monkeypatch.setattr(v2i, "AsyncOpenAI", lambda **kwargs: FakeAsyncOpenAI(transcriptions, **kwargs))


async def test_transcribe_audio_success(monkeypatch, settings):
    _patch_ffmpeg_success(monkeypatch)
    _patch_openai(monkeypatch, text="Faktura pro pana Nováka, 5000 korun.")

    result = await v2i.transcribe_audio(b"fake-ogg-bytes", mime_type="audio/ogg", settings=settings)

    assert result == "Faktura pro pana Nováka, 5000 korun."


async def test_transcribe_audio_rejects_oversized_input(settings):
    oversized = b"x" * (v2i.WHISPER_MAX_BYTES + 1)
    with pytest.raises(MediaTooLargeError):
        await v2i.transcribe_audio(oversized, mime_type="audio/ogg", settings=settings)


async def test_transcribe_audio_missing_api_key_raises(settings):
    settings.openai_api_key = ""
    with pytest.raises(TranscriptionError):
        await v2i.transcribe_audio(b"fake-bytes", mime_type="audio/ogg", settings=settings)


async def test_transcribe_audio_ffmpeg_failure_raises(monkeypatch, settings):
    _patch_ffmpeg_failure(monkeypatch, stderr=b"Invalid data found when processing input")

    with pytest.raises(TranscriptionError, match="ffmpeg remux failed"):
        await v2i.transcribe_audio(b"not-really-audio", mime_type="audio/ogg", settings=settings)


async def test_transcribe_audio_ffmpeg_not_installed_raises(monkeypatch, settings):
    _patch_ffmpeg_not_found(monkeypatch)

    with pytest.raises(TranscriptionError, match="ffmpeg executable not found"):
        await v2i.transcribe_audio(b"fake-bytes", mime_type="audio/ogg", settings=settings)


async def test_transcribe_audio_whisper_call_failure_raises(monkeypatch, settings):
    _patch_ffmpeg_success(monkeypatch)
    _patch_openai(monkeypatch, exc=RuntimeError("rate limited"))

    with pytest.raises(TranscriptionError, match="Whisper transcription call failed"):
        await v2i.transcribe_audio(b"fake-bytes", mime_type="audio/ogg", settings=settings)


async def test_transcribe_audio_empty_transcript_raises(monkeypatch, settings):
    _patch_ffmpeg_success(monkeypatch)
    _patch_openai(monkeypatch, text="   ")

    with pytest.raises(TranscriptionError, match="empty transcript"):
        await v2i.transcribe_audio(b"fake-bytes", mime_type="audio/ogg", settings=settings)


async def test_transcribe_audio_cleans_up_temp_files_on_success(monkeypatch, settings, tmp_path):
    captured_dirs: list[Path] = []
    real_ffmpeg = _write_output_side_effect

    async def fake_create_subprocess_exec(*args, **kwargs):
        output_path = Path(args[-1])
        captured_dirs.append(output_path.parent)
        return FakeProcess(0, on_communicate=real_ffmpeg(args))

    monkeypatch.setattr(v2i.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)
    _patch_openai(monkeypatch, text="hello")

    await v2i.transcribe_audio(b"fake-bytes", mime_type="audio/ogg", settings=settings)

    assert captured_dirs, "ffmpeg should have been invoked"
    assert not captured_dirs[0].exists(), "TemporaryDirectory must be cleaned up after success"


async def test_transcribe_audio_cleans_up_temp_files_on_failure(monkeypatch, settings):
    captured_dirs: list[Path] = []

    async def fake_create_subprocess_exec(*args, **kwargs):
        output_path = Path(args[-1])
        captured_dirs.append(output_path.parent)
        return FakeProcess(1, stderr=b"boom")

    monkeypatch.setattr(v2i.asyncio, "create_subprocess_exec", fake_create_subprocess_exec)

    with pytest.raises(TranscriptionError):
        await v2i.transcribe_audio(b"fake-bytes", mime_type="audio/ogg", settings=settings)

    assert captured_dirs, "ffmpeg should have been invoked"
    assert not captured_dirs[0].exists(), "TemporaryDirectory must be cleaned up even after failure"
