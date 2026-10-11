"""Pydantic models shared across the voice-to-invoice pipeline.

These model the structured-extraction output (blueprint §6 step 6) and the
draft payload sent to the backend (§6 step 8 / §9). Kept separate from
`voice_to_invoice.py` so webhooks and tests can import the schemas without
pulling in the orchestration logic.
"""

from __future__ import annotations

from decimal import Decimal
from enum import Enum

from pydantic import BaseModel, Field


class Channel(str, Enum):
    """Inbound messaging channel a voice note arrived on."""

    TELEGRAM = "telegram"
    WHATSAPP = "whatsapp"


class LineItem(BaseModel):
    """A single invoice line item as extracted from the transcript.

    Mirrors the shape of `invoice_line_items` (blueprint §4) closely enough
    for the backend to map it 1:1, but this is the AI-service's own model —
    it does not import the backend's DB schema.
    """

    description: str = Field(..., min_length=1)
    quantity: Decimal = Field(default=Decimal("1"))
    unit_price: Decimal
    vat_rate: Decimal | None = Field(
        default=None,
        description=(
            "VAT rate as a percentage (e.g. 21 for 21%). None if the speaker "
            "did not mention it / it could not be inferred; the reviewer "
            "fills it in during human review."
        ),
    )


class ExtractedInvoiceDraft(BaseModel):
    """Structured output of GPT-4o extraction (blueprint §6 step 6).

    This is intentionally permissive on optional fields (counterparty_ico,
    due_date_hint, notes) because voice transcripts are frequently incomplete
    — the pipeline must still produce a `needs_attention` draft rather than
    fail outright (§6 step 10).
    """

    counterparty_name_raw: str = Field(
        ..., description="Counterparty name as spoken/transcribed, unverified."
    )
    counterparty_ico: str | None = Field(
        default=None,
        description="IČO (Czech/Slovak business ID) if mentioned or inferable; "
        "resolved/verified against ARES in enrich_with_ares().",
    )
    line_items: list[LineItem] = Field(default_factory=list)
    currency: str = Field(default="CZK", description="ISO 4217 currency code.")
    due_date_hint: str | None = Field(
        default=None,
        description="Free-text due-date hint from the transcript (e.g. "
        "'do 14 dnů', 'konec měsíce') — NOT a parsed date; the reviewer "
        "resolves this to an actual due_date in the dashboard.",
    )
    notes: str | None = Field(default=None)


class AresMatchStatus(str, Enum):
    """Outcome of enrich_with_ares() for a given draft."""

    MATCHED = "matched"
    NOT_FOUND = "not_found"
    AMBIGUOUS = "ambiguous"
    SKIPPED_NO_ICO = "skipped_no_ico"
    LOOKUP_FAILED = "lookup_failed"


class AresEnrichment(BaseModel):
    """Result of attempting to enrich a draft with ARES registry data.

    VAT-payer status is surfaced as "needs verification", never asserted
    outright, per the confirmed ARES/ADISREG gap (blueprint §1, §6 step 7).
    """

    status: AresMatchStatus
    matched_ico: str | None = None
    matched_legal_name: str | None = None
    is_vat_payer: bool | None = Field(
        default=None,
        description="None means unknown/unverified — must be surfaced as "
        "'needs verification' in the UI, never treated as a confirmed False.",
    )
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


class DraftInvoicePayload(BaseModel):
    """Body posted to the backend's `POST /api/v1/invoices/drafts` endpoint.

    Matches the liability-relevant shape from blueprint §6 step 8 / §9:
    status is always `pending_review`, the raw transcript and extracted JSON
    are stored verbatim for audit purposes, and no invoice number is
    allocated here (that only happens at human-triggered issuance).
    """

    tenant_id: str
    source: Channel
    status: str = Field(default="pending_review", frozen=True)
    raw_transcript: str
    extracted_data: ExtractedInvoiceDraft
    ares_enrichment: AresEnrichment | None = None
    ai_confidence_score: float = Field(default=0.0, ge=0.0, le=1.0)
    needs_attention: bool = Field(
        default=False,
        description="True if ARES lookup failed or extraction confidence was "
        "low (blueprint §6 step 10) — still produces a draft, never a silent "
        "failure.",
    )
