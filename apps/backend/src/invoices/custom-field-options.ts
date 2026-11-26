import type { CustomField } from "./custom-fields";

/** At most this many distinct values and a field filters by a dropdown instead of free text. */
export const MAX_FIELD_OPTIONS = 12;

export interface CustomFieldOptions {
  label: string;
  values: string[];
}

/**
 * Custom text fields that behave like a fixed list ("Projekt: A / B / C"):
 * few distinct values, and at least one of them repeats. A field whose value
 * differs on every invoice (an order id, a note) stays free-text search.
 */
export function enumerableCustomFields(docs: (CustomField[] | null | undefined)[], max = MAX_FIELD_OPTIONS): CustomFieldOptions[] {
  const byLabel = new Map<string, { count: number; values: Set<string> }>();
  for (const fields of docs) {
    for (const f of fields ?? []) {
      if (f.kind && f.kind !== "text") continue;
      const label = f.label?.trim();
      const value = f.value?.trim();
      if (!label || !value) continue;
      const entry = byLabel.get(label) ?? { count: 0, values: new Set<string>() };
      entry.count++;
      entry.values.add(value);
      byLabel.set(label, entry);
    }
  }
  return [...byLabel]
    .filter(([, e]) => e.values.size <= max && e.count > e.values.size)
    .map(([label, e]) => ({ label, values: [...e.values].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** `["Projekt","A"]` from the `custom_value` query param; null when it is not that shape. */
export function parseCustomValue(raw: string | undefined): [string, string] | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === "string")) return [v[0].trim(), v[1].trim()];
  } catch {
    // not JSON
  }
  return null;
}

/** Whether a document has that exact field value (labels and values trimmed, case kept). */
export function hasCustomValue(fields: CustomField[] | null | undefined, [label, value]: [string, string]): boolean {
  return (fields ?? []).some((f) => f.label?.trim() === label && f.value?.trim() === value);
}
