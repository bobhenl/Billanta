import { ImageResponse } from 'next/og';
import { createTranslator } from 'next-intl';
import cs from '@/messages/cs.json';
import en from '@/messages/en.json';
import sk from '@/messages/sk.json';
import { resolveOgCard, type OgCard } from '@/lib/og-card';
import { getPublicProfile } from '@/lib/public-profiles';
import { SITE_NAME, SITE_URL } from '@/lib/site';

/**
 * The Open Graph card of a public page, 1200x630, one per page and locale:
 * `/og/cs/features/isdoc` draws the card of `/cs/features/isdoc`. As on
 * VoxelRank (services/ogcard.js), a shared link shows what it opens instead
 * of one generic picture. Text comes from `resolveOgCard`, never from the URL.
 *
 * `/og/<locale>/p/<slug>` draws a published company profile: name, logo and
 * the number of services it lists, all from the same public endpoint the
 * profile page reads, so the card shows nothing the page does not.
 *
 * DejaVu Sans (assets/og, Bitstream Vera licence) because the font bundled
 * with next/og has no Czech/Slovak diacritics. Edge runtime: the Node build
 * of next/og 14 cannot locate its own files on Windows, and the fonts are
 * bundled by URL import here, so nothing depends on the working directory.
 */
export const runtime = 'edge';

const BACKEND_URL = (process.env.BACKEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;
const MESSAGES = { cs, sk, en } as const;

// Literal URLs, so the bundler can see and include the files.
const fontFile = (url: URL) => fetch(url).then((r) => r.arrayBuffer());
let fonts: Promise<[ArrayBuffer, ArrayBuffer]> | undefined;
function loadFonts() {
  fonts ??= Promise.all([
    fontFile(new URL('../../../../assets/og/DejaVuSans.ttf', import.meta.url)),
    fontFile(new URL('../../../../assets/og/DejaVuSans-Bold.ttf', import.meta.url))
  ]);
  return fonts;
}

// The app icon (app/icon.svg), white-on-gradient so it reads on the card.
const LOGO =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#ffffff" fill-opacity="0.16"/><path d="M10.5 7.5h6.3a4.25 4.25 0 0 1 0 8.5H10.5zM10.5 16h7.4a4.5 4.5 0 0 1 0 9h-7.4z" fill="none" stroke="#fff" stroke-width="2.8" stroke-linejoin="round"/><circle cx="24.6" cy="8.4" r="2.6" fill="#4ade80"/></svg>'
  );

/** Cuts at a word boundary and adds an ellipsis; satori has no line clamp. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 12)).replace(/[\s,.;:–-]+$/, '') + '…';
}

/**
 * A tagline is the owner's own text: keep it only when it reads as prose.
 * No addresses or links on the card, and no ALL-CAPS shouting.
 */
function prose(text: string | null): string | undefined {
  const v = text?.replace(/\s+/g, ' ').trim();
  if (!v || !/\p{Ll}/u.test(v) || /https?:|www\.|@|\.(cz|sk|com|eu)\b/i.test(v)) return undefined;
  return v;
}

// Logos satori can draw. WebP is not among them; such a profile gets the initial.
const LOGO_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml']);

async function profileLogo(slug: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/public/profiles/${slug}/logo`, { next: { revalidate: 300 }, signal: AbortSignal.timeout(3000) });
    const type = res.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
    if (!res.ok || !LOGO_TYPES.has(type)) return undefined;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 1_000_000) return undefined;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:${type};base64,${btoa(bin)}`;
  } catch {
    return undefined;
  }
}

interface Card extends OgCard {
  /** A company profile's own logo, or its initial when it has none. */
  badge?: { logo?: string; initial: string };
  /** Bottom-right line; the ISDOC · ARES · QR strip when absent. */
  footnote?: string;
}

async function resolveProfileCard(locale: string, rawSlug: string): Promise<Card | null> {
  const slug = rawSlug.toLowerCase();
  if (!(locale in MESSAGES) || !SLUG.test(slug)) return null;
  const profile = await getPublicProfile(slug).catch(() => null);
  if (!profile) return null;
  const t = createTranslator({ locale: locale as keyof typeof MESSAGES, messages: MESSAGES[locale as keyof typeof MESSAGES], namespace: 'og' });
  const logo = profile.hasLogo ? await profileLogo(slug) : undefined;
  return {
    title: profile.companyName,
    subtitle: prose(profile.tagline),
    section: t('sections.profile'),
    badge: { logo, initial: profile.companyName.trim().charAt(0).toUpperCase() },
    footnote: profile.services.length ? t('services', { n: profile.services.length }) : undefined
  };
}

export async function GET(
  _req: Request,
  props: { params: Promise<{ locale: string; path?: string[] }> }
) {
  const params = await props.params;
  const path = params.path ?? [];
  const card: Card | null =
    path[0] === 'p' && path.length === 2 ? await resolveProfileCard(params.locale, path[1]!) : resolveOgCard(params.locale, path);
  if (!card) return new Response('Not found', { status: 404 });
  const [regular, bold] = await loadFonts();
  const title = clip(card.title, 90);
  const titleSize = title.length > 60 ? 56 : title.length > 36 ? 64 : 76;
  const host = SITE_URL.replace(/^https?:\/\//, '');

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '64px 72px',
          color: '#fff',
          fontFamily: 'DejaVu',
          backgroundImage: 'linear-gradient(135deg, #4338ca 0%, #6366f1 55%, #7c3aed 100%)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO} width={64} height={64} alt="" />
          <div style={{ fontSize: 36, fontWeight: 700 }}>{SITE_NAME}</div>
          {card.section ? (
            <div
              style={{
                marginLeft: 'auto',
                fontSize: 24,
                padding: '8px 20px',
                borderRadius: 999,
                backgroundColor: 'rgba(255,255,255,0.16)'
              }}
            >
              {card.section}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40 }}>
          {card.badge ? (
            <div
              style={{
                width: 168,
                height: 168,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 32,
                backgroundColor: '#fff',
                color: '#4f46e5',
                fontSize: 88,
                fontWeight: 700
              }}
            >
              {card.badge.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={card.badge.logo} width={136} height={136} style={{ objectFit: 'contain' }} alt="" />
              ) : (
                card.badge.initial
              )}
            </div>
          ) : null}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24, flex: 1 }}>
            <div style={{ fontSize: titleSize, fontWeight: 700, lineHeight: 1.12, letterSpacing: -1 }}>{title}</div>
            {card.subtitle ? (
              <div style={{ fontSize: 30, lineHeight: 1.35, color: 'rgba(255,255,255,0.85)' }}>{clip(card.subtitle, card.badge ? 110 : 150)}</div>
            ) : null}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', fontSize: 24, color: 'rgba(255,255,255,0.75)' }}>
          <div style={{ display: 'flex' }}>{host}</div>
          {card.footnote ? (
            <div style={{ marginLeft: 'auto', display: 'flex', fontWeight: 700, color: '#fff' }}>{card.footnote}</div>
          ) : (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 12 }}>
              <div style={{ display: 'flex' }}>ISDOC</div>
              <div style={{ display: 'flex' }}>·</div>
              <div style={{ display: 'flex' }}>ARES</div>
              <div style={{ display: 'flex' }}>·</div>
              <div style={{ display: 'flex' }}>QR</div>
            </div>
          )}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'DejaVu', data: regular, weight: 400, style: 'normal' },
        { name: 'DejaVu', data: bold, weight: 700, style: 'normal' }
      ],
      // A profile changes when its owner edits it, so it is not cached for a week.
      headers: {
        'cache-control': card.badge
          ? 'public, max-age=600, s-maxage=3600, stale-while-revalidate=600'
          : 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400'
      }
    }
  );
}
