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

const UUID_HEAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}$/;

/** Preview of the backend's `customSlugOf`: what a typed link name is saved as, or '' for none. */
export function customSlugPreview(value: string): string {
  const slug = slugify(value, 40);
  return UUID_HEAD.test(slug) ? '' : slug;
}

/**
 * The link with a different name in front of its key, for the live preview
 * while typing. A legacy UUID link has no key to keep, so it stays as is.
 */
export function withLinkName(link: string, name: string, fallback: string): string {
  if (!name) return fallback;
  if (UUID.test(link)) return link;
  return `${name}-${link.slice(link.lastIndexOf('-') + 1)}`;
}

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
