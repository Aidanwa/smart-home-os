// Service worker for the installed app. It caches nothing the app uses: every
// request goes to the hub as usual, so a deploy shows up on the next launch.
// Its only job is a friendly page when the hub can't be reached at all
// (Tailscale off, Pi restarting) instead of the browser's error screen.
const CACHE = 'offline-v2';
const OFFLINE = ['/offline.html', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(OFFLINE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    // Off: a preload request uses the normal HTTP cache, which is how a stale page got served.
    if (self.registration.navigationPreload) await self.registration.navigationPreload.disable();
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  // The offline page's own icon.
  if (new URL(req.url).pathname === '/icon.svg') {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
  // Only page loads are handled; API calls, assets and sockets pass straight through.
  if (req.mode !== 'navigate') return;
  event.respondWith((async () => {
    try {
      // Always revalidate the page with the hub. A stale index.html points at the previous
      // build's /assets files, which are gone after a deploy (a blank white screen on iOS).
      return await fetch(new Request(req, { cache: 'no-cache' }));
    } catch {
      return (await caches.match('/offline.html')) || Response.error();
    }
  })());
});
