-- Voice notes recorded in the dashboard (often without a connection, sent
-- from the offline queue later) become pending_review drafts. A source of
-- their own, so the invoice list's AI filter and the "AI draft reviewed"
-- stamp at issue time cover them like Telegram and WhatsApp drafts.
ALTER TYPE "invoice_source" ADD VALUE IF NOT EXISTS 'ai_voice';
