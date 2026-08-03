const CACHE_NAME = 'atlas-offline-shell-v83';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.svg',
    './icon-192.png',
    './icon-512.png',
    '/css/tokens.css',
    '/css/layout.css',
    '/css/components.css',
    '/js/main.js',
    '/js/theme.js',
    '/js/config.js',
    '/js/auth.js',
    '/js/db.js',
    '/js/supabase-client.js',
    '/js/date-groups.js',
    '/js/date-utils.js',
    '/js/checklist-blocks.js',
    '/js/components/theme-switcher.js',
    '/js/components/login-form.js',
    '/js/push-client.js',
    '/js/components/undo-toast.js',
    '/js/components/confirm-dialog.js'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS_TO_CACHE);
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => Promise.all(
            keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
        )).then(() => self.clients.claim()) 
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request, { cache: 'no-store' }).catch(() => caches.match(event.request).then((r) => r || caches.match('/index.html')))
        );
        return;
    }

    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});

self.addEventListener('push', (event) => {
    let payload = {};
    if (event.data) {
        try {
            payload = event.data.json();
        } catch (e) {
            payload = { title: 'Atlas', body: event.data.text() };
        }
    } else {
        payload = { title: 'Atlas', body: 'New notification' };
    }

    const title = payload.title || 'Atlas';
    const options = {
        body: payload.body,
        icon: payload.icon || './icon-192.png',
        data: payload.data || { url: '/' },
        vibrate: [200, 100, 200],
        requireInteraction: true,
        actions: payload.actions || []
    };

    // Tell the clients we received a push (diagnostic)
    self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage({ type: 'PUSH_RECEIVED', payload }));
    });

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const action = event.action;
    const urlToOpen = event.notification.data.url || '/';
    const taskId = event.notification.data.taskId;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
            // Find an open Atlas tab
            for (let i = 0; i < windowClients.length; i++) {
                let client = windowClients[i];
                if (client.url.includes(urlToOpen) && 'focus' in client) {
                    client.focus();
                    if (action === 'complete' && taskId) {
                        client.postMessage({ type: 'ACTION_COMPLETE', taskId: taskId });
                    } else if (action === 'snooze' && taskId) {
                        client.postMessage({ type: 'ACTION_SNOOZE', taskId: taskId });
                    }
                    return;
                }
            }
            // If no window is open, open a new one with the action in URL
            if (self.clients.openWindow) {
                let finalUrl = urlToOpen;
                if (action === 'complete' && taskId) finalUrl += `?action=complete&taskId=${taskId}`;
                if (action === 'snooze' && taskId) finalUrl += `?action=snooze&taskId=${taskId}`;
                return self.clients.openWindow(finalUrl);
            }
        })
    );
});
