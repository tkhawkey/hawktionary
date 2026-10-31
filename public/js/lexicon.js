// In-memory word list for the page (zipf look-ups, "does this word exist?")
// plus the client for the search worker and the abbreviation index.
import { band } from './text.js';

export const words = { display: [], enumr: [], zipf: null, proper: null };
const byLower = new Map();   // lower-case display → index or [indices]
let worker = null;
let nextId = 1;
const pending = new Map();

export function buildWords(text) {
  const lines = text.split('\n');
  const zipf = new Float32Array(lines.length);
  const proper = new Uint8Array(lines.length);
  let count = 0;
  for (const raw of lines) {
    if (!raw || raw[0] === '#') continue;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const t1 = line.indexOf('\t');
    const t2 = line.indexOf('\t', t1 + 1);
    const t3 = line.indexOf('\t', t2 + 1);
    const d = line.slice(0, t1);
    const i = count++;
    words.display.push(d);
    words.enumr.push(line.slice(t1 + 1, t2));
    zipf[i] = parseFloat(line.slice(t2 + 1, t3 < 0 ? undefined : t3)) || 0;
    proper[i] = t3 >= 0 && line.slice(t3 + 1).includes('p') ? 1 : 0;
    const k = d.toLowerCase();
    const prev = byLower.get(k);
    if (prev === undefined) byLower.set(k, i);
    else if (Array.isArray(prev)) prev.push(i);
    else byLower.set(k, [prev, i]);
  }
  words.zipf = zipf.slice(0, count);
  words.proper = proper.slice(0, count);
  return count;
}

/** Index of an entry with exactly this display, else the best case-insensitive match, else -1. */
export function indexOf(display) {
  const v = byLower.get(display.toLowerCase());
  if (v === undefined) return -1;
  if (!Array.isArray(v)) return v;
  const exact = v.find(i => words.display[i] === display);
  if (exact !== undefined) return exact;
  // prefer lower-case common words over proper nouns
  return v.slice().sort((a, b) => words.zipf[b] - words.zipf[a])[0];
}

/** All entries sharing this spelling ignoring case. */
export function variantsOf(display) {
  const v = byLower.get(display.toLowerCase());
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

export function zipfOf(display) {
  const i = indexOf(display);
  return i < 0 ? 0 : words.zipf[i];
}

export function bandOf(display) {
  const i = indexOf(display);
  return i < 0 ? 5 : band(words.zipf[i]);
}

/* ---------- search worker ---------- */

export function startWorker(text) {
  worker = new Worker(new URL('./search-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (ev) => {
    const { id, result, error } = ev.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    error ? p.reject(new Error(error)) : p.resolve(result);
  };
  return ask('init', text);
}

export function ask(type, payload) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, type, payload });
  });
}

/* ---------- abbreviations ---------- */

const abbrByCode = new Map();   // upper-case abbreviation → rows
const abbrByTerm = new Map();   // lower-case clue term → rows

export function buildAbbreviations(rows) {
  for (const r of rows) {
    const a = r.abbr.toUpperCase();
    (abbrByCode.get(a) || abbrByCode.set(a, []).get(a)).push(r);
    const t = r.term.toLowerCase();
    (abbrByTerm.get(t) || abbrByTerm.set(t, []).get(t)).push(r);
  }
}

export function abbreviationsFor(code) {
  return abbrByCode.get(code.trim().toUpperCase()) || [];
}

export function abbreviationsOfTerm(term) {
  return abbrByTerm.get(term.trim().toLowerCase().replace(/\s+/g, ' ')) || [];
}

/** True when `item` is really an abbreviation (e.g. "Ab" listed as a synonym of sailor). */
export function isAbbreviationOf(item, headword) {
  // a lower-case word (tar) is a real synonym even if the same letters are an abbreviation (TAR)
  if (item === item.toLowerCase()) return false;
  const rows = abbrByCode.get(item.toUpperCase());
  if (!rows) return false;
  const h = headword.toLowerCase();
  if (rows.some(r => r.term.toLowerCase() === h)) return true;
  // all capitals and short (RN, OS): an abbreviation, not a synonym
  return item.length <= 5 && item === item.toUpperCase() && /[A-Z]/.test(item);
}

export function abbreviationCategories() {
  const cats = new Map();
  for (const rows of abbrByCode.values()) {
    for (const r of rows) {
      const c = cats.get(r.category) || { name: r.category, rows: [] };
      c.rows.push(r);
      cats.set(r.category, c);
    }
  }
  return [...cats.values()];
}
