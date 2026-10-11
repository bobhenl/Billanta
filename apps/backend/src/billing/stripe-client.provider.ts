import type { ConfigService } from "@nestjs/config";
import Stripe from "stripe";

/**
 * DI token for the shared `Stripe` SDK client (blueprint §5). Using a
 * factory + custom token — instead of `new Stripe(...)` inline inside
 * `BillingService` — is what makes `BillingService`'s signature-
 * verification failure path unit-testable without real network access:
 * tests construct `BillingService` directly with a hand-mocked
 * `{ webhooks: { constructEvent: vi.fn() } }` object in place of this
 * token's value (see `billing.service.spec.ts`).
 */
export const STRIPE_CLIENT = Symbol("STRIPE_CLIENT");

/**
 * Deliberately does NOT pin `apiVersion` in the `Stripe.StripeConfig`
 * passed here — the installed `stripe` npm package version constrains
 * that field to a literal union of version strings valid for the
 * package version actually installed, and this file is written before
 * `pnpm install` has run against the newly-added `stripe` dependency
 * (see package.json). Pinning a guessed version string risks a
 * typecheck failure once the package is actually installed. Omitting it
 * uses the account's configured API version; revisit once Stripe is
 * installed and a specific version has been deliberately chosen and
 * tested.
 */
export function stripeClientFactory(config: ConfigService): Stripe {
  const secretKey = config.get<string>("STRIPE_SECRET_KEY");
  if (!secretKey) {
    // Do not throw here: constructing the client at module-init time must
    // not crash app boot in environments where billing isn't configured
    // yet (e.g. early local dev). `BillingService.verifyStripeSignature`
    // fails loudly and specifically the moment a real webhook actually
    // needs `STRIPE_WEBHOOK_SECRET` (a separate, also-required env var).
    return new Stripe("sk_test_not_configured");
  }
  return new Stripe(secretKey);
}
