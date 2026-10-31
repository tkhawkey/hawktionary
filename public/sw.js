// Service worker: keeps the app shell available offline.
// Data files (data/…) are cached by js/data.js in a versioned cache; here they only
// fall back to that cache when the network is unavailable.
// Bump SHELL_VERSION when shipping app changes so old shells are cleared.
const SHELL_VERSION = 'shell-2026-10-31a';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/fonts.css',
  'css/tokens.css',
  'css/app.css',
  'js/app.js',
  'js/data.js',
  'js/lexicon.js',
  'js/text.js',
  'js/dom.js',
  'js/entry.js',
  'js/abbr.js',
  'js/squares.js',
  'js/viewer.js',
  'js/search-worker.js',
  'fonts/fraunces-normal-latin.woff2',
  'fonts/fraunces-normal-latin-ext.woff2',
  'fonts/fraunces-italic-latin.woff2',
  'fonts/fraunces-italic-latin-ext.woff2',
  'fonts/inter-normal-latin.woff2',
  'fonts/inter-normal-latin-ext.woff2',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'licenses/UKACD%20README.TXT',
  'licenses/WORDZ%20READ%20ME.txt',
  'licenses/WordNet%20LICENSE.txt',
  'licenses/CREDITS.md',
];
const NETWORK_TIMEOUT = 2500;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('shell-') && name !== SHELL_VERSION) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(r => { clearTimeout(t); resolve(r); }, e => { clearTimeout(t); reject(e); });
  });
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  const scope = new URL(self.registration.scope);
  const path = url.pathname.slice(scope.pathname.length);

  if (path.startsWith('data/')) {
    // data.js does its own caching; this is only the offline fallback
    event.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || Response.error())));
    return;
  }

  // app shell: network first so updates show straight away, cache when offline or slow
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_VERSION);
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(req.mode === 'navigate' ? './' : req, res.clone());
      return res;
    });
    try {
      return await withTimeout(network, NETWORK_TIMEOUT);
    } catch {
      const hit = await cache.match(req.mode === 'navigate' ? './' : req, { ignoreSearch: req.mode === 'navigate' });
      if (hit) return hit;
      return network;
    }
  })());
});
