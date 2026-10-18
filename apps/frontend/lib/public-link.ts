/**
 * Shape check for the segment of a customer link (/i/, /c/, /d/): an old
 * UUID, or a readable prefix plus a 12-character key
 * (`2026-0012-k3Fq9Xa2Lm7P`). Same rules as the backend's
 * `public-links/public-link.ts`, which does the actual lookup by key; this
 * only saves a round trip for something that cannot be a link.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEYED = /^(?:[0-9A-Za-z-]*-)?[0-9A-Za-z]{12}$/;

export const isPublicLinkSegment = (segment: string) =>
  typeof segment === 'string' && segment.length <= 120 && (UUID.test(segment) || KEYED.test(segment));

/** Rough preview of the backend's slugify, for the example links in Settings. */
export function slugify(value: string, max = 40): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, max)
    .replace(/-+$/, '');
}
