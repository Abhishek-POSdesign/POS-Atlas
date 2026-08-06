// Atlas Family Service Worker
// Scoped to /family/ — keeps the app installable and gives a basic offline shell.
const CACHE = 'atlas-family-v2';
const SHELL = ['/family/', '/family/index.html', '/family/app.js', '/family/manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', e => {
    // For navigation requests, always try network first, fall back to shell
    if (e.request.mode === 'navigate') {
        e.respondWith(
            fetch(e.request, { cache: 'no-store' })
                .catch(() => caches.match('/family/index.html'))
        );
        return;
    }
    // For everything else: network first, cache as fallback
    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});

// Real push support, added 2026-08-07 -- previously this service worker had
// no push/notificationclick handling at all, so a note from Abhishek could
// only ever appear while Ritu already had a tab open (see app.js's
// checkFamilyPushStatus/toggleFamilyPush for the subscribe side).
self.addEventListener('push', (event) => {
    let payload = {};
    if (event.data) {
        try { payload = event.data.json(); }
        catch (e) { payload = { title: 'Atlas', body: event.data.text() }; }
    } else {
        payload = { title: 'Atlas', body: 'New notification' };
    }
    const title = payload.title || 'Atlas';
    const options = {
        body: payload.body,
        icon: payload.icon || '/icon-192.png',
        data: payload.data || { url: '/family/' },
        vibrate: [200, 100, 200]
    };
    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const urlToOpen = event.notification.data?.url || '/family/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            for (const client of windowClients) {
                if (client.url.includes(urlToOpen) && 'focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow(urlToOpen);
        })
    );
});
