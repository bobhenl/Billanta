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

`GET /health` confirms the service is up. Webhook routes are `POST /webhook/telegram` and `GET|POST /webhook/whatsapp`.

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
| `resolve_tenant()` | **Real** — httpx POST to backend's `/api/v1/channel-links/verify` |
| `download_media()` | Stub (`NotImplementedError`) — needs live bot/WhatsApp tokens |
| `transcribe_audio()` | Stub (`NotImplementedError`) — needs OpenAI Whisper call + ffmpeg remux |
| `extract_invoice_data()` | Stub (`NotImplementedError`) — needs GPT-4o structured-output call; the `ExtractedInvoiceDraft` schema it returns is real |
| `enrich_with_ares()` | Stub (`NotImplementedError`) — targets an *implied*, not-yet-built backend endpoint `/api/v1/contacts/ares-lookup` |
| `create_draft_invoice()` | **Real** — httpx POST to backend's `/api/v1/invoices/drafts` with scoped service JWT |
| `orchestrate()` | **Real** — wires all steps together in §6 order, handles the unlinked-sender and needs-attention paths |
| Telegram secret-token verification | **Real** — constant-time comparison |
| WhatsApp `X-Hub-Signature-256` verification | **Real** — actual HMAC-SHA256 over the raw request body |
| WhatsApp `GET` verification handshake | **Real** |

## Dependencies

See `pyproject.toml`: fastapi, uvicorn, httpx, pydantic v2, pydantic-settings, python-dotenv, plus `openai` and `python-telegram-bot` (listed as required future dependencies for the stubbed transcription/extraction calls and richer bot replies — not yet imported by any stub).

