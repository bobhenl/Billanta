import type { Municipality } from '@/lib/municipalities';

/**
 * Accountants who chose to be listed (Settings → Veřejný profil), from the
 * backend's unauthenticated `GET /api/v1/public/accountants`. Server-side
 * only. Fails soft: the town pages render without the list.
 */
const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export interface PublicAccountant {
  slug: string;
  companyName: string;
  city: string;
  country: string;
  tagline: string | null;
  hasLogo: boolean;
}

export async function fetchPublicAccountants(): Promise<PublicAccountant[]> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/accountants`, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000)
    });
    if (!res.ok) return [];
    const data = (await res.json()) as unknown;
    return Array.isArray(data) ? (data as PublicAccountant[]) : [];
  } catch {
    return [];
  }
}

const fold = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/**
 * Town names an address city could mean: "Praha 4 - Nusle" → praha,
 * "Brno-Žabovřesky" → brno-zabovresky and brno. Hyphenated towns
 * (Frýdek-Místek) keep their full name as the first candidate.
 */
function cityKeys(city: string): string[] {
  const base = fold(city.split(/,|\s\d|\s[-–]\s/)[0] ?? '');
  const head = base.split('-')[0]!.trim();
  return head && head !== base ? [base, head] : [base];
}

/**
 * Listed accountants in `m` itself first, then in the places around it
 * (`around`, e.g. the nearest towns and the district seat). Matched on the
 * name only, so a name shared by two towns lists the firm in both.
 */
export function accountantsNear(all: PublicAccountant[], m: Municipality, around: Municipality[], limit = 8) {
  const own = fold(m.name);
  const near = new Set(around.map((o) => fold(o.name)));
  const here: PublicAccountant[] = [];
  const nearby: PublicAccountant[] = [];
  for (const a of all) {
    if (a.country !== m.country) continue;
    const keys = cityKeys(a.city);
    if (keys.includes(own)) here.push(a);
    else if (keys.some((k) => near.has(k))) nearby.push(a);
  }
  return [...here, ...nearby].slice(0, limit);
}
