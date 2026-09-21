/* BasicProfitStudio service worker.
   What it does: keeps a copy of the app files (the page, icons, manifest) so the app opens without internet.
   What it never does: it never stores or reads your bookkeeping data. That lives in the browser's own storage
   (localStorage and IndexedDB), which this file does not touch, so an update can never erase it.
   Updates: the page is loaded from the network first (with a short timeout), so you get the newest version
   whenever you are online. A new worker waits until you press "Update now" in the app; nothing changes behind your back. */
const VERSION = '1.1.1-ba51b4b7';
const CACHE = 'bps-app-' + VERSION;
const PAGE = 'index.html';
const CORE = ['./', PAGE, 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon.svg'];
const MARKER = 'data-bps-app';           /* only a genuine copy of the app is ever stored as the page */
const NAV_TIMEOUT = 3500;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    for (const url of CORE) {
      const res = await fetch(new Request(url, { cache: 'reload' }));
      if (!res.ok) throw new Error('Could not store ' + url);
      if (url === './' || url === PAGE) { const t = await res.clone().text(); if (!t.includes(MARKER)) throw new Error('Unexpected page content'); }
      await cache.put(url, res);
    }
    /* no skipWaiting here: the page asks for it when the person chooses "Update now" */
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('bps-app-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const d = event.data || {};
  if (d.type === 'SKIP_WAITING') self.skipWaiting();
  else if (d.type === 'GET_VERSION' && event.ports && event.ports[0]) event.ports[0].postMessage({ version: VERSION });
});

async function networkFirstPage(request) {
  const cache = await caches.open(CACHE);
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), NAV_TIMEOUT);
    const res = await fetch(request.url, { signal: ctl.signal, cache: 'no-cache' });
    const type = res.headers.get('content-type') || '';
    const text = res.ok && type.includes('text/html') ? await res.text() : '';
    clearTimeout(timer);
    if (text.includes(MARKER)) {
      const headers = { 'content-type': 'text/html; charset=utf-8' };
      await cache.put(PAGE, new Response(text, { headers }));
      await cache.put('./', new Response(text, { headers }));
      return new Response(text, { headers });      /* a clean response: also fine if the address was redirected */
    }
  } catch (e) { /* offline, slow or blocked: use the stored copy */ }
  return (await cache.match(PAGE)) || (await cache.match('./')) || new Response('BasicProfitStudio is offline and no stored copy is available yet. Open it once while online.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;              /* never touch other sites */
  if (req.mode === 'navigate') { event.respondWith(networkFirstPage(req)); return; }
  const rel = url.pathname.slice(self.registration.scope.length - self.location.origin.length);
  if (CORE.includes(rel) && rel !== PAGE) {                     /* static files: stored copy first */
    event.respondWith(caches.open(CACHE).then(c => c.match(rel)).then(hit => hit || fetch(req)));
  }
  /* everything else (including sw.js itself) goes straight to the network */
});
