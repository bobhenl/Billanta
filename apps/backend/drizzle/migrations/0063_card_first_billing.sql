-- Card subscription first, bank transfer as the dearer alternative.
--
--   * stripe_subscription_id, subscription_currency, subscription_period_end,
--     subscription_cancel_at: what the billing panel needs to cancel at the
--     end of the period, undo that, and switch monthly/yearly without asking
--     Stripe on every page load. Written by the Stripe webhook and right after
--     the company's own change, so the panel is current before the webhook.
--   * prepaid_reminder_until, prepaid_reminded_days: the "your prepaid period
--     ends in 14 / 3 days" e-mail (PrepaidRemindersCron). The stage belongs to
--     one prepaid_until, so paying for the next period (which moves
--     prepaid_until) starts the reminders afresh without a reset step.
--
-- Renumber freely if another 0063 lands first; nothing else refers to the idx.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "stripe_subscription_id" text;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subscription_currency" varchar(3);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subscription_period_end" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subscription_cancel_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "prepaid_reminder_until" date;
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "prepaid_reminded_days" integer;
