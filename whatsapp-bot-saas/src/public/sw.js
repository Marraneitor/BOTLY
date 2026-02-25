/* ============================================================
   Botly — Service Worker (PWA)
   Cache-first for static assets, network-first for API
   ============================================================ */
const CACHE_NAME = 'botly-v1';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/auth.html',
    '/landing.html',
    '/styles.css',
    '/landing.css',
    '/admin.css',
    '/client.js',
    '/landing.js',
    '/auth.js',
    '/admin.js',
    '/manifest.json',
    '/images/logo.png'
];

// Install: cache static assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => cache.addAll(STATIC_ASSETS))
            .then(() => self.skipWaiting())
    );
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

// Fetch: network-first for API, cache-first for static
self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Skip non-GET requests
    if (e.request.method !== 'GET') return;

    // Network-first for API calls & socket.io
    if (url.pathname.startsWith('/api') || url.pathname.startsWith('/socket.io')) {
        return;
    }

    // Cache-first for static assets
    e.respondWith(
        caches.match(e.request).then((cached) => {
            if (cached) return cached;
            return fetch(e.request).then((response) => {
                if (response.ok && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(e.request, clone));
                }
                return response;
            });
        }).catch(() => {
            // Offline fallback
            if (e.request.destination === 'document') {
                return caches.match('/index.html');
            }
        })
    );
});
