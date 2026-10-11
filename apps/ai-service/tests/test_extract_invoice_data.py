"""Unit tests for extract_invoice_data() (blueprint §6 step 6).

`openai.AsyncOpenAI` is faked so no real OPENAI_API_KEY / network call is
made. This verifies: successful parsing into `ExtractedInvoiceDraft`, the
one-retry-on-validation-failure behavior (both the "eventually succeeds" and
"still fails after the retry" paths), and mapping a hard API-call failure to
`ExtractionError` without consuming the retry budget.

NOT covered here (needs a real OPENAI_API_KEY, out of scope for unit tests):
whether GPT-4o actually extracts correct/reasonable invoice data from a real
Czech/Slovak transcript, or whether `strict: true` json_schema mode behaves
exactly as documented for this schema in production.
"""

from __future__ import annotations

import json

import pytest

from app.pipeline import voice_to_invoice as v2i
from app.pipeline.errors import ExtractionError
from app.pipeline.schemas import ExtractedInvoiceDraft

VALID_PAYLOAD = {
    "counterparty_name_raw": "Jan Novák",
    "counterparty_ico": "12345678",
    "line_items": [
        {"description": "Webové stránky", "quantity": 1, "unit_price": 15000, "vat_rate": 21}
    ],
    "currency": "CZK",
    "due_date_hint": "do 14 dnů",
    "notes": None,
}


class _Message:
    def __init__(self, content: str):
        self.content = content


class _Choice:
    def __init__(self, content: str):
        self.message = _Message(content)


class _ChatResponse:
    def __init__(self, content: str):
        self.choices = [_Choice(content)]


class FakeCompletions:
    def __init__(self, contents: list[str] | None = None, exc: Exception | None = None):
        self._contents = list(contents or [])
        self._exc = exc
        self.calls: list[dict] = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        if self._exc is not None:
            raise self._exc
        content = self._contents.pop(0)
        return _ChatResponse(content)


class FakeChat:
    def __init__(self, completions: FakeCompletions):
        self.completions = completions


class FakeAsyncOpenAI:
    def __init__(self, completions: FakeCompletions, **_kwargs):
        self.chat = FakeChat(completions)


def _patch_openai(monkeypatch, *, contents: list[str] | None = None, exc: Exception | None = None):
    completions = FakeCompletions(contents=contents, exc=exc)
    monkeypatch.setattr(v2i, "AsyncOpenAI", lambda **kwargs: FakeAsyncOpenAI(completions, **kwargs))
    return completions


async def test_extract_invoice_data_success_first_attempt(monkeypatch, settings):
    completions = _patch_openai(monkeypatch, contents=[json.dumps(VALID_PAYLOAD)])

    result = await v2i.extract_invoice_data("some transcript", settings=settings)

    assert isinstance(result, ExtractedInvoiceDraft)
    assert result.counterparty_name_raw == "Jan Novák"
    assert result.counterparty_ico == "12345678"
    assert len(result.line_items) == 1
    assert result.line_items[0].description == "Webové stránky"
    assert len(completions.calls) == 1
    # strict json_schema structured output must be requested
    response_format = completions.calls[0]["response_format"]
    assert response_format["type"] == "json_schema"
    assert response_format["json_schema"]["strict"] is True


async def test_extract_invoice_data_retries_once_on_invalid_json(monkeypatch, settings):
    completions = _patch_openai(
        monkeypatch,
        contents=["not valid json {{{", json.dumps(VALID_PAYLOAD)],
    )

    result = await v2i.extract_invoice_data("some transcript", settings=settings)

    assert isinstance(result, ExtractedInvoiceDraft)
    assert len(completions.calls) == 2
    # the retry call should include the original bad output + a correction
    # instruction, on top of the original system+user messages.
    second_call_messages = completions.calls[1]["messages"]
    assert len(second_call_messages) == 4


async def test_extract_invoice_data_retries_once_on_schema_violation(monkeypatch, settings):
    invalid_payload = dict(VALID_PAYLOAD)
    invalid_payload.pop("counterparty_name_raw")  # required field missing
    completions = _patch_openai(
        monkeypatch,
        contents=[json.dumps(invalid_payload), json.dumps(VALID_PAYLOAD)],
    )

    result = await v2i.extract_invoice_data("some transcript", settings=settings)

    assert result.counterparty_name_raw == "Jan Novák"
    assert len(completions.calls) == 2


async def test_extract_invoice_data_fails_after_exhausting_retry(monkeypatch, settings):
    _patch_openai(monkeypatch, contents=["still not json", "still not json either"])

    with pytest.raises(ExtractionError, match="after 2 attempts"):
        await v2i.extract_invoice_data("some transcript", settings=settings)


async def test_extract_invoice_data_api_failure_raises_without_retry(monkeypatch, settings):
    completions = _patch_openai(monkeypatch, exc=RuntimeError("service unavailable"))

    with pytest.raises(ExtractionError, match="GPT-4o extraction call failed"):
        await v2i.extract_invoice_data("some transcript", settings=settings)

    assert len(completions.calls) == 1


async def test_extract_invoice_data_missing_api_key_raises(settings):
    settings.openai_api_key = ""
    with pytest.raises(ExtractionError):
        await v2i.extract_invoice_data("some transcript", settings=settings)
