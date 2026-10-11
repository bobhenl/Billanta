import { z } from "zod";

/**
 * Parts of the app a company can switch off when it doesn't use them (e.g. a
 * freelancer who doesn't track expenses). Purely about what the dashboard
 * shows — data and API access are unaffected. Missing key = enabled.
 */
export const APP_MODULES = ["expenses", "bank", "recurring", "quotes", "reports", "ai", "time"] as const;
export type AppModule = (typeof APP_MODULES)[number];

export const enabledModulesSchema = z
  .object(Object.fromEntries(APP_MODULES.map((m) => [m, z.boolean().optional()])) as Record<AppModule, z.ZodOptional<z.ZodBoolean>>)
  .strict();

export function resolveModules(stored: unknown): Record<AppModule, boolean> {
  const parsed = enabledModulesSchema.safeParse(stored ?? {});
  const value = parsed.success ? parsed.data : {};
  return Object.fromEntries(APP_MODULES.map((m) => [m, value[m] !== false])) as Record<AppModule, boolean>;
}
