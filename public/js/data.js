// The data layer. The only module that touches fetch, the Cache API or device storage.
// For the Android build this module is swapped for one that reads bundled files;
// the rest of the app only uses the functions exported here.
import { fold } from './text.js';

const DATA_URL = new URL('../data/', import.meta.url);
const CACHE_PREFIX = 'hawk-data-';
const PREF_PREFIX = 'hawk:';
const SHARD_MEMORY = 24;   // parsed shards kept in memory

let manifest = null;
let cacheName = null;
const shardMemo = new Map(); // name → Promise<object>

const hasCaches = typeof caches !== 'undefined';

function url(file) { return new URL(file, DATA_URL).href; }

async function openCache() {
  return hasCaches && cacheName ? caches.open(cacheName) : null;
}

/** Cache-first fetch of a data file in the current version's cache. */
async function cachedFetch(file) {
  const u = url(file);
  const cache = await openCache();
  if (cache) {
    const hit = await cache.match(u);
    if (hit) return hit;
  }
  const res = await fetch(u);
  if (!res.ok) throw new Error(`Could not load ${file} (${res.status})`);
  if (cache) await cache.put(u, res.clone());
  return res;
}

async function fetchManifest() {
  const u = url('manifest.json');
  const res = await fetch(u, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load manifest.json (${res.status})`);
  const m = await res.clone().json();
  if (hasCaches) await (await caches.open(CACHE_PREFIX + m.version)).put(u, res);
  return m;
}

/** The newest cached version whose core files are all present, or null. */
async function cachedManifest() {
  if (!hasCaches) return null;
  const names = (await caches.keys()).filter(n => n.startsWith(CACHE_PREFIX)).sort().reverse();
  for (const n of names) {
    const c = await caches.open(n);
    const hit = await c.match(url('manifest.json'));
    if (!hit) continue;
    const m = await hit.json();
    const core = await Promise.all(m.core.map(f => c.match(url(f.file))));
    if (core.every(Boolean)) return m;
  }
  return null;
}

/** In the background: if the server has newer data, download its core files so the next start uses it. */
async function checkForNewData(current) {
  try {
    const m = await fetchManifest();
    if (m.version === current) return;
    const c = await caches.open(CACHE_PREFIX + m.version);
    for (const f of m.core) {
      const res = await fetch(url(f.file));
      if (res.ok) await c.put(url(f.file), res);
    }
  } catch { /* offline: try again next time */ }
}

function parseAbbreviations(text) {
  const rows = [];
  for (const raw of text.split('\n')) {
    if (!raw || raw[0] === '#') continue;
    const [abbr, term, note, tier, category] = raw.replace(/\r$/, '').split('\t');
    rows.push({ abbr, term, note: note || '', tier: parseInt(tier, 10) || 3, category: category || 'general' });
  }
  return rows;
}

/** Load the core files. Returns { version, wordsText, abbreviations }. */
export async function loadCore() {
  // start from the cache when we can, so start-up never waits for the network
  manifest = await cachedManifest();
  const fromCache = !!manifest;
  if (!manifest) manifest = await fetchManifest();
  cacheName = CACHE_PREFIX + manifest.version;
  const [wordsRes, abbrRes] = await Promise.all([cachedFetch('words.tsv'), cachedFetch('abbreviations.tsv')]);
  const [wordsText, abbrText] = await Promise.all([wordsRes.text(), abbrRes.text()]);
  if (hasCaches) {
    // versions older than the one in use can go (a newer one may be downloading)
    for (const n of await caches.keys()) {
      if (n.startsWith(CACHE_PREFIX) && n < cacheName) caches.delete(n);
    }
  }
  if (fromCache) checkForNewData(manifest.version);
  return { version: manifest.version, wordsText, abbreviations: parseAbbreviations(abbrText) };
}

export function shardName(display) {
  const l = fold(display);
  if (!l) return null;
  return l.length === 1 ? l + '_' : l.slice(0, 2);
}

function loadShard(name) {
  let p = shardMemo.get(name);
  if (p) {
    // refresh its place in the memory queue
    shardMemo.delete(name);
    shardMemo.set(name, p);
    return p;
  }
  p = cachedFetch(`entries/${name}.json`).then(r => r.json());
  p.catch(() => shardMemo.delete(name));
  shardMemo.set(name, p);
  while (shardMemo.size > SHARD_MEMORY) shardMemo.delete(shardMemo.keys().next().value);
  return p;
}

/** The record for one entry, or null. */
export async function getEntry(display) {
  const name = shardName(display);
  if (!name) return null;
  if (manifest && !manifest.shards.some(s => s.file === `entries/${name}.json`)) return null;
  try {
    const shard = await loadShard(name);
    return shard[display] || null;
  } catch {
    return null;
  }
}

/** Download and cache every shard that isn't cached yet. onProgress(done, total). */
export async function prefetchAll(onProgress = () => {}) {
  if (!manifest || !hasCaches) return;
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch {}
  const cache = await openCache();
  const have = new Set((await cache.keys()).map(r => r.url));
  const files = manifest.shards.map(s => s.file);
  const missing = files.filter(f => !have.has(url(f)));
  let done = files.length - missing.length;
  onProgress(done, files.length);
  let next = 0;
  async function worker() {
    while (next < missing.length) {
      const f = missing[next++];
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(url(f));
          if (res.ok) { await cache.put(url(f), res); break; }
        } catch {
          await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      onProgress(++done, files.length);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  const now = new Set((await cache.keys()).map(r => r.url));
  return files.every(f => now.has(url(f)));
}

/** What is cached, quota, persisted or not. */
export async function storageStatus() {
  const status = { version: manifest?.version || null, total: manifest?.shards.length || 0, cached: 0, usage: null, quota: null, persisted: null };
  if (hasCaches && cacheName) {
    const keys = (await (await caches.open(cacheName)).keys()).map(r => r.url);
    const set = new Set(keys);
    status.cached = (manifest?.shards || []).filter(s => set.has(url(s.file))).length;
  }
  try {
    const est = await navigator.storage?.estimate?.();
    if (est) { status.usage = est.usage; status.quota = est.quota; }
    status.persisted = await navigator.storage?.persisted?.() ?? null;
  } catch {}
  return status;
}

/* Device preferences: recent searches, pinned words, theme, filters. */
export function getPref(key, fallback) {
  try {
    const v = localStorage.getItem(PREF_PREFIX + key);
    return v === null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try { localStorage.setItem(PREF_PREFIX + key, JSON.stringify(value)); } catch {}
}
