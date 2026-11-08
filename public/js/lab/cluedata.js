// Crossword indicators ("holds" → container) and clue pieces ("fairy" → PERI), from
// cryptics.georgeho.org when the data has them. Indexed on first use.
import { clueData } from '../lexicon.js';

let indicatorIndex = null;   // phrase → [{ type, count, tier }]
let charadeIndex = null;     // clue text → [{ letters, count, tier }]
let longest = 1;             // words in the longest indicator phrase

export const TYPE_INFO = {
  anagram: ['anagram', 'rearrange the letters of nearby words'],
  container: ['container', 'one part goes around another'],
  insertion: ['insertion', 'one part goes inside another'],
  reversal: ['reversal', 'read a part backwards'],
  hidden: ['hidden word', 'the answer is spelt out inside the clue'],
  deletion: ['deletion', 'take letters away'],
  homophone: ['homophone', 'the answer sounds like another word'],
  alternation: ['alternate letters', 'take every other letter'],
};

export function typeName(type) { return TYPE_INFO[type]?.[0] || type; }
export function typeHint(type) { return TYPE_INFO[type]?.[1] || ''; }

export function norm(text) {
  return String(text || '').toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' -]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function buildIndicators() {
  indicatorIndex = new Map();
  for (const r of clueData.indicators || []) {
    const k = norm(r.text);
    if (!k) continue;
    (indicatorIndex.get(k) || indicatorIndex.set(k, []).get(k)).push(r);
    longest = Math.max(longest, k.split(' ').length);
  }
  for (const list of indicatorIndex.values()) list.sort((a, b) => b.count - a.count);
}

function buildCharades() {
  charadeIndex = new Map();
  for (const r of clueData.charades || []) {
    const k = norm(r.text);
    if (k) (charadeIndex.get(k) || charadeIndex.set(k, []).get(k)).push(r);
  }
  for (const list of charadeIndex.values()) list.sort((a, b) => a.tier - b.tier || b.count - a.count);
}

export function hasIndicators() { return !!clueData.indicators?.length; }
export function hasCharades() { return !!clueData.charades?.length; }

/** Indicator types for a whole phrase, most used first. */
export function indicatorsFor(text) {
  if (!indicatorIndex) buildIndicators();
  return indicatorIndex.get(norm(text)) || [];
}

/** Clue pieces for a word or phrase; tier 3 (seen once, often noisy) left out unless asked. */
export function charadesFor(text, maxTier = 2) {
  if (!charadeIndex) buildCharades();
  return (charadeIndex.get(norm(text)) || []).filter(r => r.tier <= maxTier);
}

/**
 * Indicators spotted in a list of clue words: every run of up to `longest` words that is a
 * known indicator. Single words need tier 1–2 (seen more than once); longer phrases any tier.
 * Returns [{ start, end, phrase, types: [{type, count, tier}] }], longest first at each place.
 */
export function findIndicators(tokens) {
  if (!indicatorIndex) buildIndicators();
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    for (let n = Math.min(longest, tokens.length - i); n >= 1; n--) {
      const phrase = norm(tokens.slice(i, i + n).join(' '));
      let types = indicatorIndex.get(phrase);
      if (!types) continue;
      if (n === 1) types = types.filter(t => t.tier <= 2);
      if (types.length) out.push({ start: i, end: i + n, phrase, types });
    }
  }
  return out;
}
