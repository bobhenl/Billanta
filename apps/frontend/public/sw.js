/*
 * Minimal service worker. It exists so browsers treat the site as an
 * installable app (Chrome only fires `beforeinstallprompt` once an active
 * worker controls the page). Nothing is cached: invoices and session data must
 * always come fresh from the network. The only extra is a tiny offline notice
 * when a page navigation fails because there is no connection.
 */
const OFFLINE_HTML = `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,sans-serif;background:#0b0c14;color:#e7e8f0;text-align:center;padding:16px}button{margin-top:16px;border:0;border-radius:999px;padding:10px 18px;font-weight:700;background:#6366f1;color:#fff}</style></head>
<body><div><h1>Jste offline · You are offline</h1><p>Připojte se k internetu a zkuste to znovu.<br>Reconnect and try again.</p><button onclick="location.reload()">Zkusit znovu · Retry</button></div></body></html>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return;
  event.respondWith(
    fetch(event.request).catch(
      () => new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
    )
  );
});
