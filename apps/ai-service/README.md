# apps/ai-service

Python/FastAPI voice-to-invoice microservice: Telegram/WhatsApp webhooks, Whisper transcription, GPT-4o structured extraction, and ARES-enriched draft creation via the backend REST API. Full spec: [`docs/CZ-SK-Invoicing-SaaS-Blueprint.md`](../../docs/CZ-SK-Invoicing-SaaS-Blueprint.md) §6 (pipeline) and §9 (legal/liability).

## Non-negotiable rule

**This service must NEVER call an "issue"/"finalize" invoice endpoint — only `POST /api/v1/invoices/drafts`.** Every AI-produced invoice is created with `status = pending_review` and no invoice number allocated. Reviewer confirmation ("Issue" button) always happens in the dashboard, driven by a human, against the backend directly. This is both an architectural decision (blueprint §6 step 8/9) and a liability boundary (blueprint §9): the moment a human clicks "Issue" is the legal point at which they assume responsibility for the invoice content, regardless of how the draft was generated. Do not add any code path from this service that bypasses that boundary.

## Running locally

```bash
# from apps/ai-service, with a Python 3.11+ env active
pip install -e .
cp .env.example .env   # fill in secrets
uvicorn app.main:app --reload
```

`GET /health` confirms the service is up. Webhook routes are `POST /webhook/telegram` and `GET|POST /webhook/whatsapp`. Behind Caddy they are public as `/ai-webhook/telegram` and `/ai-webhook/whatsapp` (Caddy rewrites the prefix), so register e.g. `https://<site>/ai-webhook/telegram` with Telegram's `setWebhook`.

## Pipeline overview

`app/pipeline/voice_to_invoice.py` implements blueprint §6's 10 steps as separate async functions, wired together by `orchestrate()`:

1. Webhook ingress (secret/signature verification) — `app/webhooks/telegram.py`, `app/webhooks/whatsapp.py`
2. Tenant resolution / account linking — `resolve_tenant()`
3. Media retrieval — `download_media()`
4-5. Transcoding + transcription (Whisper) — `transcribe_audio()`
6. Structured extraction (GPT-4o) — `extract_invoice_data()` / `ExtractedInvoiceDraft` schema
7. ARES enrichment — `enrich_with_ares()`
8. Draft creation (`pending_review`, never auto-finalize) — `create_draft_invoice()`
9. Human review/issue — happens entirely in the dashboard, out of scope for this service
10. Failed lookups / low confidence still produce a `needs_attention` draft — handled in `orchestrate()`

### Real logic vs. stubbed external calls

| Function | Status |
|---|---|
| `resolve_tenant()` | **Real** — httpx POST to backend's `/api/v1/internal/channel-links/verify` |
| `download_media()` | **Real** — Telegram `getFile` + download, WhatsApp Graph API media resolution + download, Whisper/Telegram size-limit enforcement |
| `transcribe_audio()` | **Real** — ffmpeg remux (subprocess) + OpenAI Whisper (`whisper-1`) via the `openai` SDK |
| `extract_invoice_data()` | **Real** — GPT-4o structured-output call (`response_format={"type": "json_schema", "strict": true}`), Pydantic-validated into `ExtractedInvoiceDraft`, one retry on schema-validation failure |
| `enrich_with_ares()` | **Real** — httpx POST to the backend's `/api/v1/contacts/ares-lookup` (built by a concurrent workstream); maps 200/404/409/error/network-failure into `AresEnrichment`, never asserting VAT-payer status outright |
| `create_draft_invoice()` | **Real** — httpx POST to backend's `/api/v1/invoices/drafts` with scoped service JWT |
| `orchestrate()` | **Real** — wires all steps together in §6 order, handles the unlinked-sender and needs-attention paths |
| Telegram secret-token verification | **Real** — constant-time comparison |
| Telegram webhook pipeline-error handling | **Real** — `PipelineError`s (oversized media, transcription/extraction/download failures) are caught and logged with a `user_message`; the webhook still 200s so Telegram doesn't retry-storm. Sending that message back to the chat via `sendMessage` is still TODO. |
| WhatsApp `X-Hub-Signature-256` verification | **Real** — actual HMAC-SHA256 over the raw request body |
| WhatsApp `GET` verification handshake | **Real** |
| WhatsApp inbound message parsing (`entry -> changes -> value -> messages[]`) | Stub — Phase 6, gated on Meta Business verification; `download_media()`'s WhatsApp branch is ready for it |

### Confidence: what's verified vs. what needs live credentials

No real Telegram bot token, WhatsApp access token, OpenAI API key, or live backend exist in this environment, so none of the above "Real" external-call implementations have been exercised end-to-end. What *is* verified:

- All four newly-implemented functions (`download_media`, `transcribe_audio`, `extract_invoice_data`, `enrich_with_ares`) are covered by `pytest` unit tests (`tests/`) with `httpx`/`openai`/`ffmpeg subprocess` fully mocked — request shapes, URL construction, size-limit math, retry-on-validation-failure logic, and every documented response-status mapping are asserted against.
- `orchestrate()`'s step-10 "never drop a message" behavior (ARES failures/exceptions still produce a `needs_attention` draft) and the Telegram webhook's error-to-200-ack behavior are also unit-tested.
- `python -m py_compile` / `python -m compileall app tests` and `ruff check` both pass.

What is NOT verified (matches this repo's existing GoPay/Google-Drive-OAuth confidence-caveat pattern — code is correct per each API's published documentation, but unconfirmed against the real service):

- Whether Telegram's/Meta's Graph API's real HTTP responses match the assumed shapes exactly.
- Whether OpenAI's `whisper-1` and `gpt-4o` `strict: true` json_schema structured-output mode behave exactly as documented in production (model/API behavior can differ subtly from docs).
- Whether the concurrently-developed backend `/api/v1/contacts/ares-lookup` endpoint's real response shape matches what `enrich_with_ares()` assumes (`legal_name`/`obchodni_jmeno`/`confidence`/`ico` keys) — worth a quick contract check once that endpoint lands.
- Whether the `ffmpeg` binary added to the Dockerfile actually remuxes real Telegram/WhatsApp voice notes correctly (no `ffmpeg` binary available in this dev environment to test against).

## Dependencies

See `pyproject.toml`: fastapi, uvicorn, httpx, pydantic v2, pydantic-settings, python-dotenv, `openai` (now actually used by `transcribe_audio()`/`extract_invoice_data()`), and `python-telegram-bot` (still unused — listed for future higher-level bot-reply helpers). The runtime container also needs the `ffmpeg` system binary (added to `Dockerfile`) for `transcribe_audio()`'s remux step — not a Python dependency, won't show up in `pyproject.toml`.

## Testing

```bash
# from apps/ai-service, with the [dev] extra installed
pip install -e ".[dev]"
pytest
```

Every test mocks its external boundary (`httpx.AsyncClient`, `openai.AsyncOpenAI`, `asyncio.create_subprocess_exec`) — no real network calls, no real `ffmpeg` process, no live credentials needed to run the suite.

