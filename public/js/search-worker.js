// Search worker: pattern, anagram and letter lookups run here so typing never stutters.
// It receives the words.tsv text from the data layer; it never fetches anything itself.
import { fold, alphagram, band, shapeOf, parsePattern, compileMatcher } from './text.js';

let display = [], enumr = [], zipf = null, proper = null, letters = [], shapes = [];
let byLength = [];          // length → array of indices
let byAlphagram = new Map(); // alphagram → array of indices
let byLetters = new Map();   // letters → array of indices
let sortedByLetters = null;  // indices sorted by letters, for prefix search

function build(text) {
  const lines = text.split('\n');
  const n = lines.length;
  zipf = new Float32Array(n);
  proper = new Uint8Array(n);
  let count = 0;
  for (const raw of lines) {
    if (!raw || raw[0] === '#') continue;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const [d, e, z, f] = line.split('\t');
    const i = count++;
    display.push(d);
    enumr.push(e || '');
    zipf[i] = parseFloat(z) || 0;
    proper[i] = f && f.includes('p') ? 1 : 0;
    const l = fold(d);
    letters.push(l);
    shapes.push(shapeOf(l, e || String(l.length)));
    (byLength[l.length] ||= []).push(i);
    const a = alphagram(l);
    const al = byAlphagram.get(a);
    if (al) al.push(i); else byAlphagram.set(a, [i]);
    const bl = byLetters.get(l);
    if (bl) bl.push(i); else byLetters.set(l, [i]);
  }
  zipf = zipf.slice(0, count);
  proper = proper.slice(0, count);
  return count;
}

function ensureSorted() {
  if (sortedByLetters) return;
  sortedByLetters = Uint32Array.from(display.keys());
  sortedByLetters.sort((a, b) => (letters[a] < letters[b] ? -1 : letters[a] > letters[b] ? 1 : zipf[b] - zipf[a]));
}

function passes(i, opts) {
  if (!opts.proper && proper[i]) return false;
  if (opts.maxBand && band(zipf[i]) > opts.maxBand) return false;
  return true;
}

function byZipf(a, b) { return zipf[b] - zipf[a]; }

function finish(hits, limit) {
  hits.sort(byZipf);
  return { total: hits.length, results: hits.slice(0, limit) };
}

function patternSearch({ text, phrases, proper: p, maxBand, limit = 400 }) {
  const parsed = parsePattern(text);
  if (!parsed) return { total: 0, results: [], parsed: null };
  const match = compileMatcher(parsed, phrases);
  const opts = { proper: p, maxBand };
  const hits = [];
  const pool = parsed.hasStar ? null : byLength[parsed.letterCount];
  if (pool) {
    for (const i of pool) if (match(letters[i], shapes[i]) && passes(i, opts)) hits.push(i);
  } else if (parsed.hasStar) {
    for (let i = 0; i < display.length; i++) if (match(letters[i], shapes[i]) && passes(i, opts)) hits.push(i);
  }
  return { ...finish(hits, limit), parsed };
}

const ABC = 'abcdefghijklmnopqrstuvwxyz';

function anagramSearch({ fodder, pattern, proper: p, maxBand, limit = 400 }) {
  const raw = fodder.toLowerCase();
  const blanks = Math.min(2, (raw.match(/[?.#]/g) || []).length);
  const base = fold(raw);
  if (!base && !blanks) return { total: 0, results: [] };
  const keys = new Set();
  if (blanks === 0) keys.add(alphagram(base));
  else if (blanks === 1) for (const a of ABC) keys.add(alphagram(base + a));
  else for (let x = 0; x < 26; x++) for (let y = x; y < 26; y++) keys.add(alphagram(base + ABC[x] + ABC[y]));
  let filter = null;
  if (pattern && pattern.trim()) {
    const parsed = parsePattern(pattern);
    if (parsed) filter = compileMatcher(parsed, !parsed.hasBreaks);
  }
  const opts = { proper: p, maxBand };
  const hits = [];
  for (const k of keys) {
    const list = byAlphagram.get(k);
    if (!list) continue;
    for (const i of list) {
      if (!passes(i, opts)) continue;
      if (filter && !filter(letters[i], shapes[i])) continue;
      hits.push(i);
    }
  }
  return finish(hits, limit);
}

/** Exact letter matches and prefix completions for the lookup box. */
function lookup({ text, limit = 12 }) {
  const l = fold(text);
  if (!l) return { exact: [], prefix: [] };
  const exact = (byLetters.get(l) || []).slice().sort(byZipf);
  ensureSorted();
  // binary search for the first entry whose letters start with l
  let lo = 0, hi = sortedByLetters.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (letters[sortedByLetters[mid]] < l) lo = mid + 1; else hi = mid;
  }
  const prefix = [];
  for (let k = lo; k < sortedByLetters.length && prefix.length < 2000; k++) {
    const i = sortedByLetters[k];
    if (!letters[i].startsWith(l)) break;
    if (letters[i] !== l) prefix.push(i);
  }
  prefix.sort(byZipf);
  return { exact, prefix: prefix.slice(0, limit) };
}

self.onmessage = (ev) => {
  const { id, type, payload } = ev.data;
  try {
    let result;
    if (type === 'init') result = { count: build(payload) };
    else if (type === 'pattern') result = patternSearch(payload);
    else if (type === 'anagram') result = anagramSearch(payload);
    else if (type === 'lookup') result = lookup(payload);
    else throw new Error('Unknown query ' + type);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
