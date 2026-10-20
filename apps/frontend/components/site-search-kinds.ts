import { BookA, BookOpenCheck, Calculator, CircleHelp, FileText, MapPin, Sparkles, type LucideIcon } from 'lucide-react';
import type { SearchHit, SearchKind } from '@/lib/site-search';

/** Display order and icons of public search hits, shared by the /search box and the header search. */
export const KIND_ORDER: SearchKind[] = ['calculator', 'guide', 'glossary', 'feature', 'faq', 'page', 'city'];
export const KIND_ICON: Record<SearchKind, LucideIcon> = {
  calculator: Calculator,
  guide: BookOpenCheck,
  glossary: BookA,
  feature: Sparkles,
  faq: CircleHelp,
  page: FileText,
  city: MapPin
};

/** Hits grouped by kind in KIND_ORDER; flattening the groups gives the keyboard order. */
export function groupHits(hits: SearchHit[]): { kind: SearchKind; items: SearchHit[] }[] {
  return KIND_ORDER.map((kind) => ({ kind, items: hits.filter((h) => h.kind === kind) })).filter((g) => g.items.length > 0);
}

/** Debounced fetch of the public autocomplete endpoint; returns a cleanup function. */
export function fetchSiteHits(locale: string, query: string, onHits: (hits: SearchHit[]) => void, onDone?: () => void): () => void {
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    fetch(`/api/public/site-search?locale=${encodeURIComponent(locale)}&q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { hits: [] }))
      .then((data: { hits?: SearchHit[] }) => onHits(data.hits ?? []))
      .catch(() => {})
      .finally(() => onDone?.());
  }, 150);
  return () => {
    clearTimeout(timer);
    ctrl.abort();
  };
}
