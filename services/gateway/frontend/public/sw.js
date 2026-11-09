// Service worker for the installed app. It caches nothing the app uses: every
// request goes to the hub as usual, so a deploy shows up on the next launch.
// Its jobs: a friendly page when the hub can't be reached at all (Tailscale off,
// Pi restarting) instead of the browser's error screen, and showing push
// notifications (core/push.py on the gateway) and opening the app when one is tapped.
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

// A push from the hub: {title, body, url, tag}. iOS requires every push to show a notification.
self.addEventListener('push', event => {
  let msg = {};
  try { msg = event.data ? event.data.json() : {}; } catch { msg = { body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(msg.title || 'Home', {
    body: msg.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: msg.tag,
    data: { url: msg.url || '/' },
  }));
});

// Tapping one focuses the open app (or opens it) at the notification's page.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (new URL(w.url).origin !== self.location.origin) continue;
      await w.focus();
      if ('navigate' in w) return w.navigate(url);
      return;
    }
    return self.clients.openWindow(url);
  })());
});
