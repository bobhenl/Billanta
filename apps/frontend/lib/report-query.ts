/** `from=…&to=…` plus the report filters that are set, for the stats API and the invoice CSV. */
export function reportQuery(from: string, to: string, filters: Partial<Record<string, string | undefined>> = {}, extra: Record<string, string> = {}): string {
  const qs = new URLSearchParams({ from, to, ...extra });
  for (const [key, value] of Object.entries(filters)) if (value) qs.set(key, value);
  return qs.toString();
}
