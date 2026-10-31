// Text helpers shared by the page and the search worker. No DOM, no fetch.

const SPECIAL = { 'æ': 'ae', 'œ': 'oe', 'ß': 'ss', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i' };
const PLAIN = /^[a-z]*$/;

/** Fold any text to a–z only. */
export function fold(text) {
  let s = text.toLowerCase();
  if (PLAIN.test(s)) return s;
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.replace(/[æœßøłđðþı]/g, c => SPECIAL[c]);
  return s.replace(/[^a-z]/g, '');
}

export function alphagram(letters) {
  return letters.split('').sort().join('');
}

/** zipf → band 1 (common) … 5 (obscure) */
export function band(zipf) {
  if (zipf >= 4) return 1;
  if (zipf >= 3) return 2;
  if (zipf >= 2) return 3;
  if (zipf >= 1) return 4;
  return 5;
}

export const BAND_NAMES = ['', 'common', 'familiar', 'uncommon', 'rare', 'obscure'];

/** The shape of an entry: its letters with ' ' for word breaks and '-' for hyphens.
    Uses the enumeration to place the breaks: "6,3" + "Aaronsrod" → "aarons rod". */
export function shapeOf(letters, enumeration) {
  if (/^\d+$/.test(enumeration)) return letters;
  let out = '';
  let pos = 0;
  const parts = enumeration.split(/([,-])/);
  for (const p of parts) {
    if (p === ',') out += ' ';
    else if (p === '-') out += '-';
    else {
      const n = parseInt(p, 10) || 0;
      out += letters.slice(pos, pos + n);
      pos += n;
    }
  }
  return out;
}

/** Turn an enumeration "5,3" or "3-6" into a blank shape "????? ???". */
function enumToShape(e) {
  return e.replace(/\d+/g, n => '?'.repeat(parseInt(n, 10))).replace(/,/g, ' ');
}

/** Normalise typed enumeration "(5, 3)" / "5 3" → "5,3" */
function normEnum(e) {
  return e.replace(/\s*,\s*|\s+/g, ',').replace(/\s*-\s*/g, '-').replace(/^,|,$/g, '');
}

const UNKNOWN = /[?.#]/;
const ANY = /[*@]/;

/**
 * Parse a typed pattern such as "?a?e? ???", "c?y?t?c (7)" or "ab*".
 * Returns { shape, letterCount, hasStar, hasBreaks, enumeration, squares } or null.
 *   shape: the pattern with '?' for unknowns, '*' for any run, ' ' and '-' for breaks.
 */
export function parsePattern(input) {
  let text = input.trim().toLowerCase();
  let bracketEnum = null;
  const m = /\(([\d\s,\-]+)\)\s*$/.exec(text);
  if (m) {
    bracketEnum = normEnum(m[1].trim());
    text = text.slice(0, m.index).trim();
  }
  // collapse runs of spaces; turn unknown markers into '?', any-runs into '*'
  let shape = '';
  for (const ch of text.replace(/\s+/g, ' ')) {
    if (UNKNOWN.test(ch)) shape += '?';
    else if (ANY.test(ch)) shape += '*';
    else if (ch === ' ' || ch === '-') shape += ch;
    else {
      const f = fold(ch);
      if (f) shape += f;
    }
  }
  shape = shape.replace(/\*+/g, '*').replace(/^[ -]+|[ -]+$/g, '');

  if (bracketEnum) {
    const blank = enumToShape(bracketEnum);
    const flat = shape.replace(/[ -]/g, '');
    const total = blank.replace(/[ -]/g, '').length;
    if (!flat) shape = blank;
    else if (!flat.includes('*') && flat.length === total) {
      // pour the typed letters into the enumeration's shape
      let i = 0;
      shape = blank.replace(/\?/g, () => flat[i++]);
    } else if (!flat.includes('*')) {
      // letters typed don't fill the enumeration: pad with unknowns
      let i = 0;
      shape = blank.replace(/\?/g, () => (i < flat.length ? flat[i++] : '?'));
    }
  }
  if (!shape) return null;
  const hasStar = shape.includes('*');
  const hasBreaks = /[ -]/.test(shape);
  const letterCount = hasStar ? null : shape.replace(/[ -]/g, '').length;
  const enumeration = hasStar ? null : shape.split(/([ -])/).map(p =>
    p === ' ' ? ',' : p === '-' ? '-' : String(p.length)).join('');
  return { shape, letterCount, hasStar, hasBreaks, enumeration };
}

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a matcher from a parsed pattern.
 * phrases = false: the word breaks must match exactly (no breaks typed = single words only).
 * phrases = true: breaks are ignored, only the letters must match.
 * Returns fn(letters, shape) → boolean.
 */
export function compileMatcher(parsed, phrases) {
  if (phrases) {
    const flat = parsed.shape.replace(/[ -]/g, '');
    const rx = new RegExp('^' + flat.split('').map(c =>
      c === '?' ? '[a-z]' : c === '*' ? '[a-z]*' : escapeRx(c)).join('') + '$');
    return (letters) => rx.test(letters);
  }
  const rx = new RegExp('^' + parsed.shape.split('').map(c =>
    c === '?' ? '[a-z]' : c === '*' ? '[a-z]*' : escapeRx(c)).join('') + '$');
  return (letters, shape) => rx.test(shape);
}

/** Quick test for thesaurus filtering: pattern text against a display string. */
export function makeDisplayFilter(patternText) {
  const p = parsePattern(patternText || '');
  if (!p) return null;
  // a bare number means a length: "3" → ???
  if (/^\s*\d+\s*$/.test(patternText)) {
    const n = parseInt(patternText, 10);
    return (display) => fold(display).length === n;
  }
  const phrases = !p.hasBreaks;
  const match = compileMatcher(p, phrases);
  return (display, enumeration) => {
    const letters = fold(display);
    return match(letters, enumeration ? shapeOf(letters, enumeration) : letters);
  };
}

/** What kind of query is this? */
export function guessMode(text) {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('/')) return 'anagram';
  if (/[?.#*@]/.test(t) || /\(\s*\d[\d\s,\-]*\)\s*$/.test(t)) return 'pattern';
  return 'lookup';
}

/** Leftover letters: fodder minus candidate. */
export function leftover(fodder, candidate) {
  const counts = {};
  for (const c of fold(fodder)) counts[c] = (counts[c] || 0) + 1;
  const needs = [];
  for (const c of fold(candidate)) {
    if (counts[c]) counts[c]--;
    else needs.push(c);
  }
  const left = [];
  for (const c of Object.keys(counts).sort()) for (let i = 0; i < counts[c]; i++) left.push(c);
  return { left, needs };
}
