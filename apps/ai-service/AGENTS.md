# apps/ai-service — FastAPI voice-to-invoice

Python 3.11+, FastAPI, httpx, pydantic v2. Telegram and WhatsApp voice
messages are transcribed, extracted into an invoice draft, enriched from
ARES and posted to the backend. Pipeline: `app/pipeline/voice_to_invoice.py`
(`orchestrate()`). Webhooks: `app/webhooks/`. Settings: `app/config.py`.

```bash
cd apps/ai-service
pip install -e ".[dev]"
uvicorn app.main:app --reload
pytest
```

## Non-negotiable

- **Only ever call `POST /api/v1/invoices/drafts`.** Never issue, finalize,
  number or send an invoice. Drafts are `pending_review`, and when
  confidence is low or a lookup fails they become `needs_attention`. A human
  issues the invoice in the dashboard; that is the legal liability boundary.
- Authenticate to the backend with the service token (`ServiceTokenGuard`).
  The tenant comes from the linked channel, never from message content.
- Verify each webhook's secret or signature before doing any work.

## Conventions

- Each pipeline step is its own async function with a typed input and
  output (`app/pipeline/schemas.py`). Errors are the typed ones in
  `errors.py`.
- Tests mock every external boundary (`httpx.AsyncClient`, the OpenAI
  client, the `ffmpeg` subprocess). The suite needs no network and no
  credentials. Keep it that way.
- `ffmpeg` is a system dependency of the Docker image, not a Python
  package.
- Runs under the `ai` compose profile in production (`WITH_AI=1 deploy/deploy.sh`).
