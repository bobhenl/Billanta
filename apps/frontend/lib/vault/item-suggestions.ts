import { fold } from '@/lib/fuzzy';

export interface LocalItemSuggestion {
  description: string;
  unitPrice: number;
  vatRate: number | null;
  lastUsed?: string;
}

/**
 * Item suggestions for a document being encrypted, matched here instead of
 * on the server so the typed text never leaves the browser. Same rule as
 * the backend's `item-suggestions` (substring, accents ignored), newest use
 * first, one entry per description.
 */
export function matchItemSuggestions(candidates: LocalItemSuggestion[], query: string, limit = 8): LocalItemSuggestion[] {
  const needle = fold(query.trim());
  if (needle.length < 2) return [];
  const seen = new Set<string>();
  return candidates
    .filter((c) => fold(c.description).includes(needle))
    .sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? ''))
    .filter((c) => !seen.has(c.description) && Boolean(seen.add(c.description)))
    .slice(0, limit);
}
