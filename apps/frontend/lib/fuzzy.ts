/**
 * Typo-tolerant matching for search boxes (field finder, command palette,
 * contact list). Mirrored in apps/backend/src/common/fuzzy.ts for the invoice
 * list search; keep the two in step.
 */

/** Lower-case, accents removed: "Účetní" → "ucetni". */
export const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** At most one edit (insert, delete, substitute) apart. */
export function withinOneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Swapped neighbours ("fkatura") count as one typo too. */
function isTransposition(a: string, b: string) {
  if (a.length !== b.length) return false;
  const diff: number[] = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) diff.push(i);
  if (diff.length !== 2) return false;
  const [x, y] = diff as [number, number];
  return y === x + 1 && a[x] === b[y] && a[y] === b[x];
}

const words = (s: string) => s.split(/[^a-z0-9]+/).filter(Boolean);

/** A token one typo away from a word, or from the start of a longer word ("fakutr" ~ "faktura"). */
function typoMatch(token: string, haystack: string) {
  if (token.length < 4) return false;
  return words(haystack).some((w) => {
    if (w.length < 3) return false;
    const head = w.slice(0, token.length);
    return withinOneEdit(w, token) || withinOneEdit(head, token) || isTransposition(head, token);
  });
}

/**
 * Scores `fields` against `query`: every whitespace-separated token must
 * match some field — exact prefix (3), substring (2) or within one typo (1,
 * tokens of 4+ letters only). Returns 0 when any token misses.
 */
export function fuzzyScore(query: string, fields: (string | null | undefined)[]): number {
  const tokens = fold(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const hay = fields.filter((f): f is string => Boolean(f)).map(fold);
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const h of hay) {
      if (h.startsWith(token) || words(h).some((w) => w.startsWith(token))) best = Math.max(best, 3);
      else if (h.includes(token)) best = Math.max(best, 2);
      else if (best === 0 && typoMatch(token, h)) best = 1;
      if (best === 3) break;
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}
