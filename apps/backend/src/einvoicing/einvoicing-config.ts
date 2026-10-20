import type { EInvoiceProvider } from "./einvoice-provider";
import { FakeEInvoiceProvider } from "./fake-einvoice-provider";

/** Off unless EINVOICING_ENABLED=true: nothing is sent or received before a provider is contracted. */
export const einvoicingEnabled = (env: NodeJS.ProcessEnv = process.env) => env.EINVOICING_ENABLED === "true";

/**
 * The configured provider adapter. Only the fake exists so far; a real one
 * is added here once a provider is chosen (docs/sk-peppol-providers.md).
 */
export function createEInvoiceProvider(env: NodeJS.ProcessEnv = process.env): EInvoiceProvider {
  const key = env.EINVOICING_PROVIDER ?? "fake";
  switch (key) {
    case "fake":
      // In production the fake would report invoices as sent that never left the building.
      if (env.NODE_ENV === "production") throw new Error("einvoicing_fake_provider_in_production");
      return new FakeEInvoiceProvider(env.EINVOICE_FAKE_WEBHOOK_SECRET);
    default:
      throw new Error(`einvoicing_unknown_provider: ${key}`);
  }
}
