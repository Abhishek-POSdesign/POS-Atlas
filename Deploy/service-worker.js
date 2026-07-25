const CACHE_NAME = 'atlas-offline-shell-v10';
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/manifest.json',
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
    '/js/entities/project.js',
    '/js/entities/project-note.js',
    '/js/entities/task.js',
    '/js/entities/task-log.js',
    '/js/entities/notebook-entry.js',
    '/js/entities/checklist-item.js',
    '/js/entities/checklist-history.js',
    '/js/entities/target.js',
    '/js/entities/target-log.js'
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
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
