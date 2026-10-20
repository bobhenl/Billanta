import { getTranslations } from 'next-intl/server';
import { badgeSvg, parseBadgeFile } from '@/lib/embeds';
import { SITE_NAME } from '@/lib/site';

/**
 * `/badges/customer-cs.svg`, `/badges/partner-en-dark.svg`, …: the badges
 * customers and partners hotlink from their sites (lib/embeds.ts). Outside
 * `[locale]`, and the middleware skips paths with an extension, so the URL
 * stays exactly what the snippet says.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const parsed = parseBadgeFile((await params).file);
  if (!parsed) return new Response('Not found', { status: 404 });
  const t = await getTranslations({ locale: parsed.lang, namespace: 'embeds.snippet' });
  return new Response(badgeSvg(t(`${parsed.lang}.${parsed.kind}`, { name: SITE_NAME }), parsed.theme), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // Every site that shows the badge asks for it: let the edge keep it.
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      // Opened on its own, an SVG is a document: nothing in it may run.
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'"
    }
  });
}
