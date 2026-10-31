// Rendering a dictionary + thesaurus entry, and turning words in text into definition links.
import { getEntry, getPref, setPref } from './data.js';
import { words, indexOf, zipfOf, bandOf } from './lexicon.js';
import { band, BAND_NAMES, makeDisplayFilter } from './text.js';
import { h, esc } from './dom.js';

const POS = {
  noun: 'noun', verb: 'verb', adj: 'adjective', adv: 'adverb', name: 'proper noun', intj: 'interjection',
  prep_phrase: 'prepositional phrase', prep: 'preposition', pron: 'pronoun', conj: 'conjunction',
  phrase: 'phrase', det: 'determiner', proverb: 'proverb', num: 'numeral', symbol: 'symbol',
  particle: 'particle', character: 'character', contraction: 'contraction', article: 'article',
  postp: 'postposition', prefix: 'prefix', suffix: 'suffix',
};
const SOURCE = { w: 'Wiktionary', n: 'WordNet' };
const LIST_LIMIT = 40;

/** A word that opens its definition. */
export function wordLink(display, cls = '') {
  return h('span', { class: ('w ' + cls).trim(), 'data-w': display, role: 'link', tabindex: '0' }, display);
}

const TOKEN = /[A-Za-zÀ-ÖØ-öø-ÿ]+(?:['’-][A-Za-zÀ-ÖØ-öø-ÿ]+)*/g;

/** Escape a gloss and wrap each word that is in the word list. */
export function linkify(text) {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(TOKEN)) {
    out += esc(text.slice(last, m.index));
    const tok = m[0];
    let i = indexOf(tok);
    if (i < 0 && tok.includes('’')) i = indexOf(tok.replace(/’/g, "'"));
    out += i < 0 ? esc(tok) : `<span class="w" data-w="${esc(words.display[i])}" role="link">${esc(tok)}</span>`;
    last = m.index + tok.length;
  }
  return out + esc(text.slice(last));
}

export function enumOf(display) {
  const i = indexOf(display);
  return i < 0 ? '' : words.enumr[i];
}

export function freqBar(zipf, i = 0) {
  const z = Math.max(0.04, Math.min(1, zipf / 7));
  return h('span', { class: 'freq', title: `Frequency ${zipf.toFixed(1)} (${BAND_NAMES[band(zipf)]})`, style: { '--i': i } },
    h('span', { style: { '--z': z.toFixed(3) } }));
}

/** Group [pos, gloss, source] rows by part of speech, keeping first-seen order. */
function groupDefs(d) {
  const groups = new Map();
  for (const [pos, gloss, src] of d) {
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos).push([gloss, src]);
  }
  return groups;
}

function defsBlock(d, limit = Infinity) {
  const frag = h('div', { class: 'defs' });
  let shown = 0;
  for (const [pos, list] of groupDefs(d)) {
    if (shown >= limit) break;
    frag.append(h('div', { class: 'pos' }, POS[pos] || pos.replace(/_/g, ' ')));
    const ol = h('ol');
    for (const [gloss, src] of list) {
      if (shown >= limit) break;
      ol.append(h('li', { class: 'gloss' + (src === 'n' ? ' wn' : ''), title: SOURCE[src] || '', html: linkify(gloss) }));
      shown++;
    }
    frag.append(ol);
  }
  return frag;
}

/** First definition as plain gloss, for compact places. */
export function firstGlosses(record, n = 3) {
  return (record?.d || []).slice(0, n);
}

export function isPinned(display) {
  return getPref('pins', []).includes(display);
}

function togglePin(display, btn) {
  let pins = getPref('pins', []);
  if (pins.includes(display)) pins = pins.filter(p => p !== display);
  else pins = [display, ...pins].slice(0, 200);
  setPref('pins', pins);
  btn.setAttribute('aria-pressed', String(pins.includes(display)));
  btn.setAttribute('aria-label', pins.includes(display) ? 'Unpin' : 'Pin');
}

const PIN_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4z" fill="currentColor" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';

function entryHead(display, headingLevel = 'h2') {
  const zipf = zipfOf(display);
  const e = enumOf(display);
  const pinned = isPinned(display);
  const pin = h('button', {
    class: 'icon-btn pin-btn', 'aria-pressed': String(pinned), 'aria-label': pinned ? 'Unpin' : 'Pin', html: PIN_ICON,
  });
  pin.addEventListener('click', () => togglePin(display, pin));
  return h('header', null,
    h('div', { class: 'entry-head' }, h(headingLevel, { class: 'headword' }, display), pin),
    h('div', { class: 'entry-meta' },
      e ? h('span', { class: 'enum' }, `(${e})`) : null,
      freqBar(zipf),
      h('span', null, BAND_NAMES[band(zipf)]),
      indexOf(display) >= 0 && words.proper[indexOf(display)] ? h('span', null, 'proper noun') : null));
}

/* ---------- thesaurus ---------- */

function sortByZipf(list, self) {
  const seen = new Set([self]);
  return list.filter(w => !seen.has(w) && seen.add(w))
    .map(w => [w, zipfOf(w)]).sort((a, b) => b[1] - a[1]);
}

function thesaurusSection(record, display) {
  const groups = [
    ['Synonyms', record.s],
    ['Type of', record.t],
    ['Kinds', record.k],
  ].filter(([, l]) => l && l.length).map(([label, l]) => [label, sortByZipf(l, display)]).filter(([, l]) => l.length);
  if (!groups.length) return null;

  const input = h('input', { type: 'text', placeholder: 'Filter by pattern: ??? or g* or 3', 'aria-label': 'Filter thesaurus by pattern', autocapitalize: 'off', autocomplete: 'off', spellcheck: 'false' });
  const count = h('span');
  const body = h('div');

  function render() {
    const filter = makeDisplayFilter(input.value.trim());
    body.replaceChildren();
    let total = 0;
    for (const [label, list] of groups) {
      const items = filter ? list.filter(([w]) => filter(w, enumOf(w))) : list;
      if (!items.length) continue;
      total += items.length;
      const wordsEl = h('div', { class: 'thes-words' });
      const showAll = !!filter || items.length <= LIST_LIMIT;
      const visible = showAll ? items : items.slice(0, LIST_LIMIT);
      fillWords(wordsEl, visible);
      const group = h('div', { class: 'thes-group' }, h('h4', null, label, h('small', null, items.length)), wordsEl);
      if (!showAll) {
        const more = h('button', { class: 'show-all' }, `Show all ${items.length}`);
        more.addEventListener('click', () => { wordsEl.replaceChildren(); fillWords(wordsEl, items); more.remove(); });
        group.append(more);
      }
      body.append(group);
    }
    count.textContent = filter ? `${total} match${total === 1 ? '' : 'es'}` : '';
    if (filter && !total) body.append(h('p', { class: 'note' }, 'Nothing matches that pattern.'));
  }
  input.addEventListener('input', render);
  render();
  return h('section', { class: 'thesaurus' }, h('h3', null, 'Thesaurus'),
    h('div', { class: 'thes-filter' }, input, count), body);
}

function fillWords(el, items) {
  items.forEach(([w, z], n) => {
    if (n) el.append(h('span', { class: 'sep' }, '·'));
    const b = band(z);
    el.append(wordLink(w, b === 5 ? 'dim' : b === 1 ? 'common' : ''));
  });
}

/* ---------- the entry ---------- */

/** Build the full entry element for a display string. */
export async function renderEntry(display) {
  const record = await getEntry(display);
  const art = h('article', { class: 'entry' }, entryHead(display));
  const defs = h('section');

  if (record?.d?.length) {
    defs.append(defsBlock(record.d));
    if (record.f?.length) {
      defs.append(h('ul', { class: 'also' }, record.f.map(([g, base]) =>
        h('li', null, h('span', { html: linkify(g) }), base && base !== display ? [' → ', wordLink(base)] : null))));
    }
  } else if (record?.f?.length) {
    // form-of: "plural of ale" and the base word's definitions underneath
    for (const [g, base] of record.f) {
      defs.append(h('p', { class: 'formof gloss', html: linkify(g) }));
    }
    const base = record.f.map(f => f[1]).find(b => b && b !== display);
    if (base) {
      const baseRec = await getEntry(base);
      const box = h('div', { class: 'base-entry' }, h('div', { class: 'entry-head' }, h('h3', { class: 'headword' }, wordLink(base))));
      if (baseRec?.d?.length) box.append(defsBlock(baseRec.d, 8));
      else box.append(h('p', { class: 'empty-def' }, 'No definition yet.'));
      defs.append(box);
    }
  } else if (/[\s-]/.test(display.trim())) {
    // phrase or hyphenated: built from its parts
    const parts = display.split(/[\s-]+/).filter(Boolean);
    const dl = h('dl', { class: 'built-from' });
    for (const p of parts) {
      const rec = await getEntry(p) || await getEntry(p.toLowerCase());
      const first = rec?.d?.[0];
      dl.append(h('dt', null, wordLink(indexOf(p) >= 0 ? words.display[indexOf(p)] : p)),
        h('dd', { class: 'gloss', html: first ? `<i>${esc(POS[first[0]] || first[0])}</i> ${linkify(first[1])}` : '<span class="empty-def">No definition yet.</span>' }));
    }
    defs.append(h('p', { class: 'note' }, 'Built from: ' + parts.join(' + ')), dl);
  } else {
    defs.append(h('p', { class: 'empty-def' }, indexOf(display) >= 0 ? 'Valid word, no definition yet.' : 'Not in the word list.'));
  }
  art.append(defs);
  if (record) {
    const thes = thesaurusSection(record, display);
    if (thes) art.append(thes);
  }
  return art;
}

/** Short content for the hover popover. */
export async function renderPreview(display) {
  const record = await getEntry(display);
  const e = enumOf(display);
  const box = h('div', null, h('span', { class: 'pw' }, display), e ? h('span', { class: 'pe' }, `(${e})`) : null);
  const d = record?.d?.slice(0, 3);
  if (d?.length) {
    box.append(h('ol', null, d.map(([pos, g]) => h('li', { html: `<span class="pp">${esc(POS[pos] || pos)}</span> ${esc(g)}` }))));
  } else if (record?.f?.length) {
    box.append(h('p', null, record.f[0][0]));
  } else {
    box.append(h('p', { class: 'empty-def' }, 'No definition yet.'));
  }
  return box;
}
