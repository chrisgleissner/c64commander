const CACHE_PREFIX = 'c64commander-static';
const STATIC_ASSETS = ['/manifest.webmanifest'];

const buildId = (() => {
  try {
    const url = new URL(self.location.href);
    return url.searchParams.get('v') || 'dev';
  } catch {
    return 'dev';
  }
})();

const CACHE_NAME = `${CACHE_PREFIX}-${buildId}`;

const isShellRequest = (request, url) => request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isSameOrigin = url.origin === self.location.origin;
  if (!isSameOrigin) return;

  const isApiRequest =
    url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/');
  if (isApiRequest) {
    event.respondWith(fetch(request));
    return;
  }

  if (isShellRequest(request, url)) {
    event.respondWith(fetch(request));
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200) return response;
        const copy = response.clone();
        void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    }),
  );
});
