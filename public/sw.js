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
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(async keys => {
      const previous = keys.filter(key => key.startsWith(PREFIX) && key !== CACHE);
      let keep;
      for (const key of previous.slice().reverse()) {
        if (await (await caches.open(key)).match(INDEX)) { keep = key; break; }
      }
      return Promise.all(previous.filter(key => key !== keep).map(key => caches.delete(key)));
    }).then(() => self.clients.claim()),
  );
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
  } else if (url.pathname.startsWith(new URL('assets/', SCOPE).pathname)) {
    // An older open tab may still request its own hashed assets after takeover.
    event.respondWith(caches.keys().then(async keys => {
      const previous = keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).at(-1);
      return (previous && await (await caches.open(previous)).match(request, { ignoreVary: true })) || fetch(request);
    }));
  }
  // Unknown files, API calls and external requests retain normal network behavior.
});
