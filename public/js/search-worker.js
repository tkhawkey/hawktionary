// Search worker: pattern, anagram and letter look-ups run here so typing never stutters.
// It receives the words.tsv text from the data layer; it never fetches anything itself.
// Start-up builds only what lookup and pattern need; the anagram map, word shapes and the
// alphabetical order are built afterwards ('warm') or on first use.
import { fold, band, shapeOf, parsePattern, compileMatcher } from './text.js';

let display = [], enumr = [], zipf = null, proper = null, letters = [];
let byLength = [];            // length → array of indices
const byLetters = new Map();  // letters → array of indices
let shapes = null;            // letters with ' ' and '-' breaks
let byAlphagram = null;       // alphagram → array of indices
let sorted = null;            // indices in alphabetical (letters) order
let rank = null;              // index → position in sorted

function build(text) {
  const lines = text.split('\n');
  zipf = new Float32Array(lines.length);
  proper = new Uint8Array(lines.length);
  let count = 0;
  for (const raw of lines) {
    if (!raw || raw.charCodeAt(0) === 35) continue; // '#'
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const t1 = line.indexOf('\t');
    const t2 = line.indexOf('\t', t1 + 1);
    const t3 = line.indexOf('\t', t2 + 1);
    const d = line.slice(0, t1);
    const i = count++;
    display.push(d);
    enumr.push(line.slice(t1 + 1, t2));
    zipf[i] = parseFloat(line.slice(t2 + 1, t3 < 0 ? undefined : t3)) || 0;
    proper[i] = t3 >= 0 && line.indexOf('p', t3) > 0 ? 1 : 0;
    const l = fold(d);
    letters.push(l);
    (byLength[l.length] ||= []).push(i);
    const bl = byLetters.get(l);
    if (bl) bl.push(i); else byLetters.set(l, [i]);
  }
  zipf = zipf.slice(0, count);
  proper = proper.slice(0, count);
  return count;
}

function ensureShapes() {
  if (shapes) return;
  shapes = new Array(letters.length);
  for (let i = 0; i < letters.length; i++) {
    const e = enumr[i];
    shapes[i] = e.indexOf(',') < 0 && e.indexOf('-') < 0 ? letters[i] : shapeOf(letters[i], e);
  }
}

const buf = new Uint8Array(128);
function alphagram(l) {
  const n = l.length;
  if (n > 128) return l.split('').sort().join('');
  for (let i = 0; i < n; i++) buf[i] = l.charCodeAt(i);
  return String.fromCharCode.apply(null, buf.subarray(0, n).sort());
}

function ensureAlphagrams() {
  if (byAlphagram) return;
  byAlphagram = new Map();
  for (let i = 0; i < letters.length; i++) {
    const a = alphagram(letters[i]);
    const al = byAlphagram.get(a);
    if (al) al.push(i); else byAlphagram.set(a, [i]);
  }
}

function ensureSorted() {
  if (sorted) return;
  sorted = Uint32Array.from(letters.keys());
  sorted.sort((a, b) => (letters[a] < letters[b] ? -1 : letters[a] > letters[b] ? 1
    : display[a] < display[b] ? -1 : display[a] > display[b] ? 1 : 0));
  rank = new Uint32Array(sorted.length);
  for (let k = 0; k < sorted.length; k++) rank[sorted[k]] = k;
}

function passes(i, opts) {
  if (!opts.proper && proper[i]) return false;
  if (opts.only && !opts.only.has(i)) return false;
  if (opts.not && opts.not.has(i)) return false;
  if (opts.maxBand && band(zipf[i]) > opts.maxBand) return false;
  return true;
}

function byZipf(a, b) { return zipf[b] - zipf[a]; }

function finish(hits, limit) {
  hits.sort(byZipf);
  return { total: hits.length, results: hits.slice(0, limit) };
}

/** Subject filter from the page: word indices to keep only, or to leave out. */
function subjectOpts(subject) {
  return { only: subject?.only ? new Set(subject.only) : null, not: subject?.not ? new Set(subject.not) : null };
}

function patternSearch({ text, phrases, proper: p, maxBand, subject, limit = 400 }) {
  const parsed = parsePattern(text);
  if (!parsed) return { total: 0, results: [], parsed: null };
  if (!phrases) ensureShapes();
  const match = compileMatcher(parsed, phrases);
  const opts = { proper: p, maxBand, ...subjectOpts(subject) };
  const hits = [];
  if (parsed.hasStar) {
    for (let i = 0; i < letters.length; i++) if (match(letters[i], shapes?.[i]) && passes(i, opts)) hits.push(i);
  } else {
    for (const i of byLength[parsed.letterCount] || []) if (match(letters[i], shapes?.[i]) && passes(i, opts)) hits.push(i);
  }
  return { ...finish(hits, limit), parsed };
}

const ABC = 'abcdefghijklmnopqrstuvwxyz';

function anagramSearch({ fodder, pattern, proper: p, maxBand, subject, limit = 400 }) {
  ensureAlphagrams();
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
    if (parsed) {
      if (parsed.hasBreaks) ensureShapes();
      filter = compileMatcher(parsed, !parsed.hasBreaks);
    }
  }
  const opts = { proper: p, maxBand, ...subjectOpts(subject) };
  const hits = [];
  for (const k of keys) {
    for (const i of byAlphagram.get(k) || []) {
      if (!passes(i, opts)) continue;
      if (filter && !filter(letters[i], shapes?.[i])) continue;
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
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (letters[sorted[mid]] < l) lo = mid + 1; else hi = mid;
  }
  const prefix = [];
  for (let k = lo; k < sorted.length && prefix.length < 3000; k++) {
    const i = sorted[k];
    if (!letters[i].startsWith(l)) break;
    if (letters[i] !== l) prefix.push(i);
  }
  prefix.sort(byZipf);
  return { exact, prefix: prefix.slice(0, limit) };
}

/** Alphabetical neighbours of an entry, for the running head. */
function neighbours({ index, count = 1 }) {
  ensureSorted();
  const k = rank[index];
  const before = [], after = [];
  for (let j = k - 1; j >= 0 && before.length < count; j--) before.push(sorted[j]);
  for (let j = k + 1; j < sorted.length && after.length < count; j++) after.push(sorted[j]);
  return { before, after };
}

self.onmessage = (ev) => {
  const { id, type, payload } = ev.data;
  try {
    let result;
    if (type === 'init') result = { count: build(payload) };
    else if (type === 'warm') { ensureAlphagrams(); ensureShapes(); ensureSorted(); result = true; }
    else if (type === 'pattern') result = patternSearch(payload);
    else if (type === 'anagram') result = anagramSearch(payload);
    else if (type === 'lookup') result = lookup(payload);
    else if (type === 'neighbours') result = neighbours(payload);
    else throw new Error('Unknown query ' + type);
    self.postMessage({ id, result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
