import type { ReactNode } from 'react';
import { Link } from '@/i18n/navigation';
import { glossaryTexts } from '@/lib/glossary-content';

/**
 * Links glossary terms in running text (guides, calculator leads). Each term
 * is linked once per linker, at its first occurrence, so a page does not
 * turn into a sea of underlines. Patterns come from `match` in
 * lib/glossary-content; longer patterns win, so "zálohová faktura" links to
 * its own page and not to "faktura".
 */
type Pattern = { slug: string; re: RegExp };

const PATTERNS = new Map<string, Pattern[]>();

function patternsFor(locale: string): Pattern[] {
  const cached = PATTERNS.get(locale);
  if (cached) return cached;
  const list: { slug: string; source: string }[] = [];
  for (const [slug, text] of Object.entries(glossaryTexts(locale))) {
    // `\b` is ASCII-only in JS ("DIČ" would never end on one); the
    // look-arounds below give Unicode word boundaries instead.
    for (const source of text.match ?? []) list.push({ slug, source: source.replace(/\\b/g, '') });
  }
  list.sort((a, b) => b.source.length - a.source.length);
  const patterns = list.map(({ slug, source }) => ({ slug, re: new RegExp(`(?<![\\p{L}\\d])(?:${source})(?![\\p{L}\\d])`, 'iu') }));
  PATTERNS.set(locale, patterns);
  return patterns;
}

/** A function that returns `text` with the not-yet-linked terms linked; `current` is never linked (the term's own page). */
export function glossaryLinker(locale: string, current?: string): (text: string) => ReactNode {
  const done = new Set<string>(current ? [current] : []);
  const patterns = patternsFor(locale);

  return (text) => {
    const parts: ReactNode[] = [];
    let rest = text;
    let key = 0;
    for (;;) {
      let best: { slug: string; index: number; length: number } | null = null;
      for (const p of patterns) {
        if (done.has(p.slug)) continue;
        const m = p.re.exec(rest);
        if (m && (best === null || m.index < best.index)) best = { slug: p.slug, index: m.index, length: m[0].length };
      }
      if (!best) break;
      done.add(best.slug);
      if (best.index > 0) parts.push(rest.slice(0, best.index));
      parts.push(
        <Link key={key++} href={`/glossary/${best.slug}`} className="underline decoration-primary/40 underline-offset-2 hover:text-primary hover:decoration-primary">
          {rest.slice(best.index, best.index + best.length)}
        </Link>
      );
      rest = rest.slice(best.index + best.length);
    }
    if (parts.length === 0) return text;
    if (rest) parts.push(rest);
    return <>{parts}</>;
  };
}
