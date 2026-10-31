/* Replaced by the Vite build plugin. Do not serve this source worker in dev. */
const VERSION = '__BUILD_VERSION__';
const FILES = /* __PRECACHE__ */ [];
const SCOPE = self.registration.scope;
const PREFIX = `sushi-loop:${new URL(SCOPE).pathname}:`;
const CACHE = `${PREFIX}${VERSION}`;
const URLS = FILES.map(path => new URL(path, SCOPE).href);
const STATIC = new Set(URLS);
const INDEX = new URL('index.html', SCOPE).href;

self.addEventListener('install', event => {
  // Cache.addAll rejects errors so incomplete releases never activate.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    URLS.map(url => new Request(url, { cache: 'reload' })),
  )));
  // Intentionally wait for existing tabs to close before replacing their worker.
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)),
    )),
    self.clients.claim(),
  ]));
});

self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') void self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin ||
      !url.href.startsWith(SCOPE)) return;
  if (request.mode === 'navigate') {
    // The cached shell and its hashed assets always come from the same release.
    event.respondWith(caches.open(CACHE).then(async cache =>
      (await cache.match(INDEX)) || fetch(request)));
  } else if (STATIC.has(url.href)) {
    event.respondWith(caches.open(CACHE).then(async cache =>
      // Known build assets are identical for every Origin header. Vite preview
      // sends Vary: Origin; module requests differ from precache requests.
      (await cache.match(request, { ignoreVary: true })) || fetch(request)));
  }
  // Unknown files, API calls and external requests retain normal network behavior.
});
