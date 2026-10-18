/*
 * Service worker. Two jobs:
 *
 * 1. Installability: Chrome only fires `beforeinstallprompt` once an active
 *    worker controls the page.
 * 2. Offline drafts (docs/offline-drafts-plan.md): it keeps the app's static
 *    files and three dashboard pages (dashboard, new invoice, contacts) so a
 *    new invoice or contact can be written without a connection. The forms
 *    queue such drafts in IndexedDB; this worker never touches the queue.
 *
 * Pages are always fetched from the network first; the cached copy is only a
 * fallback when there is no connection. The page cache holds company data,
 * so the app deletes it on sign-out, on a company switch and on the login
 * page (lib/offline-outbox.ts).
 */
const STATIC_CACHE = 'billanta-static-v1';
const PAGES_CACHE = 'billanta-pages-v1';
const STATIC_LIMIT = 400;
const OFFLINE_PAGES = /^\/(cs|sk|en)\/(dashboard|invoices\/new|contacts)\/?$/;

const OFFLINE_HTML = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0b0c14;color:#e7e8f0;text-align:center;padding:16px}a,button{display:inline-block;margin:16px 4px 0;border:0;border-radius:999px;padding:10px 18px;font:inherit;font-weight:700;background:#6366f1;color:#fff;text-decoration:none}a{background:#272a3d}</style></head>
<body><div><h1>Jste offline · You are offline</h1><p>Připojte se k internetu a zkuste to znovu.<br>Reconnect and try again.</p>
<p>Koncept faktury nebo nový kontakt můžete napsat i offline.<br>You can still write an invoice draft or a new contact offline.</p>
<button onclick="location.reload()">Zkusit znovu · Retry</button><br><a href="/cs/invoices/new">Nová faktura · New invoice</a><a href="/cs/contacts">Kontakty · Contacts</a></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      const keep = new Set([STATIC_CACHE, PAGES_CACHE]);
      for (const name of await caches.keys()) if (name.startsWith('billanta-') && !keep.has(name)) await caches.delete(name);
      await self.clients.claim();
    })()
  )
);

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(event, url));
    return;
  }
  if (url.pathname.startsWith('/_next/static/') || url.pathname === '/icon.svg') {
    event.respondWith(staticFile(request));
  }
});

/** The app asks for the offline pages to be refreshed after it confirmed whose they are. */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data.type !== 'warm' || !Array.isArray(data.urls)) return;
  event.waitUntil(
    Promise.all(
      data.urls
        .filter((path) => typeof path === 'string' && OFFLINE_PAGES.test(path))
        .map((path) => fetch(path, { credentials: 'same-origin' }).then((res) => storePage(new URL(path, self.location.origin), res)).catch(() => {}))
    )
  );
});

async function navigate(event, url) {
  const keep = OFFLINE_PAGES.test(url.pathname);
  try {
    const res = await fetch(event.request);
    if (keep) event.waitUntil(storePage(url, res.clone()));
    return res;
  } catch {
    if (keep) {
      const cached = await caches.match(pageKey(url), { cacheName: PAGES_CACHE, ignoreVary: true });
      if (cached) return cached;
    }
    return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

const pageKey = (url) => url.origin + url.pathname.replace(/\/$/, '');

/** Only a real page of the signed-in app: not a redirect to the login, not an error. */
async function storePage(url, res) {
  if (!res.ok || res.redirected || res.status !== 200 || !(res.headers.get('content-type') || '').includes('text/html')) return;
  const html = await res.clone().text();
  const cache = await caches.open(PAGES_CACHE);
  await cache.put(pageKey(url), new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  // Chunks the page loads later (client components in the RSC payload) must be there offline too.
  const chunks = new Set();
  for (const match of html.matchAll(/(?:\/_next\/)?static\/(?:chunks|css|media)\/[^"'\\\s)]+/g)) {
    chunks.add('/_next/' + match[0].replace(/^\/_next\//, ''));
  }
  const files = await caches.open(STATIC_CACHE);
  await Promise.all(
    [...chunks].map(async (path) => {
      if (await files.match(path)) return;
      const file = await fetch(path).catch(() => null);
      if (file && file.ok) await files.put(path, file);
    })
  );
  await trim(files);
}

/*
 * Network first here too: in development the same URL changes with every
 * edit, and in production the browser's HTTP cache already answers the
 * hashed files instantly. The copy is for when the network is gone.
 */
async function staticFile(request) {
  const cache = await caches.open(STATIC_CACHE);
  try {
    const res = await fetch(request);
    if (res.ok && !request.url.includes('hot-update')) cache.put(request, res.clone()).catch(() => {});
    return res;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
    if (cached) return cached;
    throw new Error('offline');
  }
}

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - STATIC_LIMIT))) await cache.delete(key);
}
