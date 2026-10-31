// The dictionary page for one entry (Reference Book style), plus helpers shared by other modules.
import { getEntry, getPref, setPref } from './data.js';
import { words, indexOf, zipfOf, ask, abbreviationsOfTerm, isAbbreviationOf } from './lexicon.js';
import { band, BAND_NAMES } from './text.js';
import { h, esc } from './dom.js';
import { wordList } from './wordlist.js';

export const POS = {
  noun: 'noun', verb: 'verb', adj: 'adjective', adv: 'adverb', name: 'proper noun', intj: 'interjection',
  prep_phrase: 'prepositional phrase', prep: 'preposition', pron: 'pronoun', conj: 'conjunction',
  phrase: 'phrase', det: 'determiner', proverb: 'proverb', num: 'numeral', symbol: 'symbol',
  particle: 'particle', character: 'character', contraction: 'contraction', article: 'article',
  postp: 'postposition', prefix: 'prefix', suffix: 'suffix',
};
const SOURCE = { w: 'Wiktionary', n: 'WordNet' };

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

/** Thesaurus items as word-list items: no duplicates, not the word itself, no abbreviations. */
export function thesaurusItems(list, headword) {
  const seen = new Set([headword.toLowerCase()]);
  const out = [];
  for (const w of list || []) {
    const k = w.toLowerCase();
    if (seen.has(k) || isAbbreviationOf(w, headword)) continue;
    seen.add(k);
    out.push({ d: w, z: zipfOf(w), e: enumOf(w) });
  }
  return out.sort((a, b) => b.z - a.z);
}

export function isPinned(display) {
  return getPref('pins', []).includes(display);
}

function pinButton(display) {
  const pinned = isPinned(display);
  const b = h('button', {
    class: 'icon-btn pin-btn', 'aria-pressed': String(pinned), 'aria-label': pinned ? 'Unpin' : 'Pin',
    html: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 4h10v16l-5-4-5 4z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>',
  });
  b.addEventListener('click', () => {
    let pins = getPref('pins', []);
    pins = pins.includes(display) ? pins.filter(p => p !== display) : [display, ...pins].slice(0, 200);
    setPref('pins', pins);
    const on = pins.includes(display);
    b.setAttribute('aria-pressed', String(on));
    b.setAttribute('aria-label', on ? 'Unpin' : 'Pin');
  });
  return b;
}

function groupDefs(d) {
  const groups = new Map();
  for (const [pos, gloss, src] of d) {
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos).push([gloss, src]);
  }
  return groups;
}

function defsBlock(d, { limit = Infinity, lead = true } = {}) {
  const frag = h('div', { class: 'defs' });
  let shown = 0;
  for (const [pos, list] of groupDefs(d)) {
    if (shown >= limit) break;
    frag.append(h('h4', { class: 'pos' }, POS[pos] || pos.replace(/_/g, ' ')));
    const ol = h('ol');
    for (const [gloss, src] of list) {
      if (shown >= limit) break;
      // a drop cap only when the definition starts with a letter, not "(chiefly British)…"
      const dropCap = lead && shown === 0 && /^\p{L}/u.test(gloss);
      const cls = ['gloss', src === 'n' ? 'wn' : '', dropCap ? 'lead' : ''].filter(Boolean).join(' ');
      ol.append(h('li', { class: cls, 'data-source': SOURCE[src] || '', html: linkify(gloss) }));
      shown++;
    }
    frag.append(ol);
  }
  return frag;
}

/** Running head: ‹ previous · HEADWORD · next › in alphabetical order. */
function runningHead(display, onGo) {
  const head = h('nav', { class: 'running-head', 'aria-label': 'Alphabetical neighbours' },
    h('span', { class: 'rh-side rh-prev' }), h('span', { class: 'rh-here' }, display), h('span', { class: 'rh-side rh-next' }));
  const i = indexOf(display);
  if (i >= 0) {
    ask('neighbours', { index: i }).then(({ before, after }) => {
      const mk = (idx, dir) => {
        const d = words.display[idx];
        const b = h('button', { class: 'rh-link', 'data-dir': dir, title: d }, dir === 'prev' ? '‹ ' : '', d, dir === 'next' ? ' ›' : '');
        b.addEventListener('click', () => onGo(d, dir));
        return b;
      };
      if (before[0] !== undefined) head.querySelector('.rh-prev').append(mk(before[0], 'prev'));
      if (after[0] !== undefined) head.querySelector('.rh-next').append(mk(after[0], 'next'));
    });
  }
  return head;
}

/**
 * The full page for an entry.
 * ctx: { onNeighbour(display, dir), onThesaurus(display), onAbbr(term), compact }
 */
export async function renderPage(display, ctx = {}) {
  const record = await getEntry(display);
  const i = indexOf(display);
  const zipf = zipfOf(display);
  const e = enumOf(display);
  const page = h('article', { class: 'page' + (ctx.compact ? ' compact' : '') });
  if (ctx.onNeighbour) page.append(runningHead(display, ctx.onNeighbour));
  page.append(
    h('header', { class: 'page-head' }, h('h2', { class: 'headword' }, display), pinButton(display)),
    h('div', { class: 'page-meta' },
      e ? h('span', { class: 'meta-enum' }, `(${e})`) : null,
      h('span', { class: `meta-band b${band(zipf)}` }, BAND_NAMES[band(zipf)]),
      h('span', { class: 'meta-bar', title: `Frequency ${zipf.toFixed(1)}` }, h('span', { style: { '--z': Math.max(.04, Math.min(1, zipf / 7)).toFixed(3) } })),
      i >= 0 && words.proper[i] ? h('span', null, 'proper noun') : null),
    h('div', { class: 'ornament', 'aria-hidden': 'true' }));

  const body = h('section', { class: 'page-body' });
  if (record?.d?.length) {
    body.append(defsBlock(record.d));
    if (record.f?.length) {
      body.append(h('ul', { class: 'also' }, record.f.map(([g, base]) =>
        h('li', null, h('span', { html: linkify(g) }), base && base !== display ? [' → ', wordLink(base)] : null))));
    }
  } else if (record?.f?.length) {
    for (const [g] of record.f) body.append(h('p', { class: 'formof gloss', html: linkify(g) }));
    const base = record.f.map(f => f[1]).find(b => b && b !== display);
    if (base) {
      const baseRec = await getEntry(base);
      const box = h('div', { class: 'base-entry' }, h('h3', { class: 'base-word' }, wordLink(base)));
      box.append(baseRec?.d?.length ? defsBlock(baseRec.d, { limit: 8, lead: false }) : h('p', { class: 'empty-def' }, 'No definition yet.'));
      body.append(box);
    }
  } else if (/[\s-]/.test(display.trim())) {
    const parts = display.split(/[\s-]+/).filter(Boolean);
    const dl = h('dl', { class: 'built-from' });
    for (const p of parts) {
      const rec = await getEntry(p) || await getEntry(p.toLowerCase());
      const first = rec?.d?.[0];
      dl.append(h('dt', null, wordLink(indexOf(p) >= 0 ? words.display[indexOf(p)] : p)),
        h('dd', { class: 'gloss', html: first ? `<i class="pos-inline">${esc(POS[first[0]] || first[0])}</i> ${linkify(first[1])}` : '<span class="empty-def">No definition yet.</span>' }));
    }
    body.append(h('p', { class: 'built-label' }, 'Built from ', parts.join(' + ')), dl);
  } else {
    body.append(h('p', { class: 'empty-def' }, i >= 0 ? 'Valid word, no definition yet.' : 'Not in the word list.'));
  }
  page.append(body);

  // a taste of the thesaurus, with a way into the full Thesaurus module
  const syn = thesaurusItems([...(record?.s || []), ...(record?.t || [])], display);
  if (syn.length) {
    const sec = h('section', { class: 'page-thes tint-thesaurus' },
      h('div', { class: 'sec-head' }, h('h3', null, 'Thesaurus'),
        ctx.onThesaurus ? h('button', { class: 'sec-link', onclick: () => ctx.onThesaurus(display) }, `All ${countThesaurus(record, display)} ›`) : null),
      wordList(syn.slice(0, 18), { initial: 18 }));
    page.append(sec);
  }

  // abbreviations for this word, kept apart and clearly marked
  const abbr = abbreviationsOfTerm(display);
  if (abbr.length) {
    const t1 = abbr.filter(r => r.tier === 1);
    const shown = (t1.length ? t1 : abbr).slice(0, 8);
    page.append(h('section', { class: 'page-abbr tint-abbr' },
      h('div', { class: 'sec-head' }, h('h3', null, 'Abbreviated as'),
        ctx.onAbbr ? h('button', { class: 'sec-link', onclick: () => ctx.onAbbr(display) }, abbr.length > shown.length ? `All ${abbr.length} ›` : 'Open ›') : null),
      h('p', { class: 'abbr-line' }, shown.map((r, n) => [n ? h('span', { class: 'dot' }, '·') : null, h('b', { class: 'code' }, r.abbr)]))));
  }
  return page;
}

function countThesaurus(record, display) {
  return thesaurusItems([...(record.s || []), ...(record.t || []), ...(record.k || [])], display).length;
}

/** Short content for the hover popover. */
export async function renderPreview(display) {
  const record = await getEntry(display);
  const e = enumOf(display);
  const box = h('div', null, h('span', { class: 'pw' }, display), e ? h('span', { class: 'pe' }, ` (${e})`) : null);
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

/** The first definition of a word as plain text, or ''. */
export async function firstGloss(display) {
  const r = await getEntry(display);
  if (r?.d?.length) return r.d[0][1];
  if (r?.f?.length) return r.f[0][0];
  return '';
}
