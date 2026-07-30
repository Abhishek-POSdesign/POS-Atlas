const CACHE_NAME = 'atlas-offline-shell-v73';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
    '/favicon.svg',
    '/icon-192.png',
    '/icon-512.png',
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
    '/js/components/undo-toast.js',
    '/js/components/confirm-dialog.js',
    '/js/components/note-prompt.js',
    '/js/components/project-card.js',
    '/js/pages/today.js',
    '/js/pages/projects-list.js',
    '/js/pages/project-workspace.js',
    '/js/pages/notebook.js',
    '/js/pages/restore.js',
    '/js/pages/checklist.js',
    '/js/pages/calendar.js',
    '/js/ui/aiPanel.js',
    '/js/features/aiConfig.js',
    '/js/features/aiContext.js',
    '/js/features/pendingNav.js',
    '/js/entities/project.js',
    '/js/entities/project-note.js',
    '/js/entities/task.js',
    '/js/entities/task-log.js',
    '/js/entities/notebook-entry.js',
    '/js/entities/checklist-item.js',
    '/js/entities/checklist-history.js',
    '/js/entities/target.js',
    '/js/entities/target-log.js',
    '/js/entities/sleep-log.js',
    '/js/entities/workout-log.js'
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
    // Navigation requests (the page load/reload itself) are network-first
    // (2026-07-28 fix). The old pure cache-first strategy meant a normal
    // reload never checked the network at all once anything was cached
    // under the current CACHE_NAME -- combined with the browser's own HTTP
    // cache sometimes serving a stale copy of this very file (see the
    // updateViaCache:'none' fix in main.js), a repeated Ctrl+R could keep
    // landing back on an old shell. Static assets (JS/CSS/images) stay
    // cache-first -- that's what makes offline support and instant loads
    // work at all, and CACHE_NAME already refreshes them on every
    // deploy-worthy bump (old cache deleted in 'activate' above).
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
