// Atlas Family Service Worker
// Scoped to /family/ — keeps the app installable and gives a basic offline shell.
const CACHE = 'atlas-family-v1';
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
