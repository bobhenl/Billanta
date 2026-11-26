/**
 * ISR / fetch cache kept in memory only, with a hard size cap.
 *
 * Next's default cache writes every page rendered on demand to disk inside
 * the container and never deletes it. With ~9 000 municipality pages per
 * locale under /invoicing/[slug], crawlers filled the VPS disk in a few hours
 * (Nov 2026) and took the site down. Here the least recently used pages are
 * dropped instead; a dropped page is simply rendered again on the next visit.
 *
 * Wired up in next.config.mjs (`cacheHandler`, with the built-in memory
 * layer turned off). Size: ISR_CACHE_MB, default 64 – the container has 384 MB.
 */
const MAX_BYTES = (Number(process.env.ISR_CACHE_MB) || 64) * 1024 * 1024;
const TAGS_HEADER = 'x-next-cache-tags';

/** key -> { value, lastModified, tags, size }; Map order is the LRU order. */
const entries = new Map();
/** tag -> when revalidateTag/revalidatePath last hit it. */
const revalidatedAt = new Map();
let total = 0;

function bytes(x) {
  if (x == null) return 0;
  if (typeof x === 'string' || Buffer.isBuffer(x)) return x.length;
  try {
    return JSON.stringify(x)?.length ?? 0;
  } catch {
    return 0;
  }
}

function sizeOf(value) {
  switch (value?.kind) {
    case 'APP_PAGE': {
      let n = bytes(value.html) + bytes(value.rscData) + bytes(value.postponed);
      if (value.segmentData) for (const seg of value.segmentData.values()) n += bytes(seg);
      return n;
    }
    case 'APP_ROUTE':
      return bytes(value.body);
    case 'PAGES':
      return bytes(value.html) + bytes(value.pageData);
    case 'FETCH':
      return bytes(value.data);
    case 'IMAGE':
      return bytes(value.buffer);
    default:
      return bytes(value);
  }
}

function drop(key) {
  const e = entries.get(key);
  if (!e) return;
  entries.delete(key);
  total -= e.size;
}

class MemoryCacheHandler {
  async get(key, ctx) {
    const e = entries.get(key);
    if (!e) return null;
    const tags = [...e.tags, ...(ctx?.tags ?? []), ...(ctx?.softTags ?? [])];
    if (tags.some((t) => (revalidatedAt.get(t) ?? 0) >= e.lastModified)) {
      drop(key);
      return null;
    }
    entries.delete(key);
    entries.set(key, e);
    return { lastModified: e.lastModified, value: e.value };
  }

  async set(key, data, ctx) {
    drop(key);
    if (!data) return;
    const size = Math.max(1, sizeOf(data));
    // One huge entry must not flush everything else.
    if (size > MAX_BYTES / 8) return;
    const tags = [...(ctx?.tags ?? [])];
    const header = data.headers?.[TAGS_HEADER];
    if (typeof header === 'string') tags.push(...header.split(','));
    entries.set(key, { value: data, lastModified: Date.now(), tags, size });
    total += size;
    for (const oldest of entries.keys()) {
      if (total <= MAX_BYTES) break;
      drop(oldest);
    }
  }

  async revalidateTag(tags) {
    const now = Date.now();
    for (const t of typeof tags === 'string' ? [tags] : tags) revalidatedAt.set(t, now);
  }

  resetRequestCache() {}
}

module.exports = MemoryCacheHandler;
module.exports.stats = () => ({ entries: entries.size, bytes: total, maxBytes: MAX_BYTES });
