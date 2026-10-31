// Service worker: keeps the app shell available offline.
// Data files (data/…) are cached by js/data.js in a versioned cache; here they only
// fall back to that cache when the network is unavailable.
// Bump SHELL_VERSION when shipping app changes so old shells are cleared.
const SHELL_VERSION = 'shell-2026-10-31d';
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
  'js/ui.js',
  'js/wordlist.js',
  'js/squares.js',
  'js/viewer.js',
  'js/search-worker.js',
  'js/modules/dictionary.js',
  'js/modules/thesaurus.js',
  'js/modules/abbreviations.js',
  'js/modules/solve.js',
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

  // app shell: answer from the cache at once (fast start, works offline) and refresh it
  // in the background. A new SHELL_VERSION installs a fresh shell and the page offers a reload.
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_VERSION);
    const key = req.mode === 'navigate' ? './' : req;
    const hit = await cache.match(key, { ignoreSearch: req.mode === 'navigate' });
    const network = fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    });
    if (hit) {
      event.waitUntil(network.catch(() => {}));
      return hit;
    }
    return withTimeout(network, NETWORK_TIMEOUT * 4);
  })());
});
