// Abbreviations: both directions, browsing by category, and the strip shown in the Dictionary.
import { getPref, setPref } from '../data.js';
import { abbreviationsFor, abbreviationsOfTerm, abbreviationCategories, umbrellaCategories, umbrellaWords, categoryLabel, indexOf } from '../lexicon.js';
import { h } from '../dom.js';
import { searchField, seg, remember, recentChips, plural } from '../ui.js';

const TIERS = { 1: 'Common', 2: 'Harder', 3: 'Rare' };
const CATEGORY_ORDER = ['Roman numeral', 'number', 'chemical element', 'NATO alphabet', 'Greek letter', 'direction / bridge',
  'music', 'calendar', 'US state', 'country / vehicle code', 'foreign word', 'general'];


/** A category label that reads well after other words: "Music: notes, keys" → "Music – notes, keys". */
function labelText(label) {
  return label.replace(/:\s*/, ' – ');
}

/** The best-known codes in a category, tier 1 first: a taste for the strip. */
function sampleCodes(rows, n) {
  const out = [];
  for (const tier of [1, 2, 3]) {
    for (const r of rows) if (r.tier === tier && !out.includes(r.abbr) && out.length < n) out.push(r.abbr);
    if (out.length >= Math.min(n, 4)) break;
  }
  return out;
}

/** Umbrella categories worth showing beside the rows whose clue term is literally the word:
 *  "state" (2 rows) gains all 55 US states; "river" (15 rows) gains almost nothing, so no block. */
function extraUmbrellas(q, termRows) {
  const have = new Set(termRows.map(r => r.abbr.toUpperCase()));
  return umbrellaCategories(q).filter(c => {
    const codes = new Set(c.rows.map(r => r.abbr.toUpperCase()));
    let extra = 0;
    for (const a of codes) if (!have.has(a)) extra++;
    return extra >= Math.max(3, codes.size * 0.25);
  });
}

function codeOf(q) {
  const c = q.replace(/\s+/g, '');
  return c.length && c.length <= 8 ? c : null;
}

/* ---------- the strip in the Dictionary ---------- */

/** A compact, clearly marked strip: "S stands for quarter · second …" and "sailor is abbreviated AB · OS · TAR". */
export function abbrStrip(text, onOpen) {
  const q = text.trim();
  if (!q) return null;
  const code = codeOf(q);
  const codeRows = code ? abbreviationsFor(code) : [];
  const termRows = abbreviationsOfTerm(q);
  const umbrellas = extraUmbrellas(q, termRows);
  if (!codeRows.length && !termRows.length && !umbrellas.length) return null;
  const strip = h('div', { class: 'abbr-strip tint-abbr', 'data-own-click': '' });
  const line = (lead, verb, items, total, target) => {
    const b = h('button', { class: 'strip-line', onclick: () => onOpen(target) },
      h('span', { class: 'strip-tag' }, 'Abbr.'),
      h('span', { class: 'strip-body' }, lead, h('span', { class: 'strip-verb' }, ` ${verb} `), items),
      total > 0 ? h('span', { class: 'strip-more' }, `+${total}`) : null,
      h('span', { class: 'strip-go', 'aria-hidden': 'true' }, '›'));
    strip.append(b);
  };
  if (codeRows.length) {
    const t1 = codeRows.filter(r => r.tier === 1);
    const shown = (t1.length ? t1 : codeRows.filter(r => r.tier === 2)).slice(0, 10);
    const pick = shown.length ? shown : codeRows.slice(0, 6);
    line(h('b', { class: 'code' }, codeRows[0].abbr), 'stands for',
      joinDots(pick.map(r => h('span', { class: 'strip-term' }, r.term))), codeRows.length - pick.length, code);
  }
  if (termRows.length) {
    const t1 = termRows.filter(r => r.tier === 1);
    const pick = (t1.length ? t1 : termRows).slice(0, 8);
    line(h('span', { class: 'strip-word' }, termRows[0].term), 'is abbreviated',
      joinDots(pick.map(r => h('b', { class: 'code' }, r.abbr))), termRows.length - pick.length, q);
  }
  for (const c of umbrellas) {
    // "state" can stand for any US state: show a taste of the whole category
    const all = new Set(c.rows.map(r => r.abbr));
    const pick = sampleCodes(c.rows, 8);
    line(h('span', { class: 'strip-word' }, q.toLowerCase()), 'covers the category',
      [h('span', { class: 'strip-cat' }, labelText(c.label)), h('span', { class: 'dot' }, ': '),
        joinDots(pick.map(a => h('b', { class: 'code' }, a)))], all.size - pick.length, q);
  }
  return strip;
}

function joinDots(els) {
  const out = [];
  els.forEach((e, n) => { if (n) out.push(h('span', { class: 'dot' }, ' · ')); out.push(e); });
  return out;
}

/* ---------- blocks ---------- */

function byTier(rows, maxTier) {
  const t = { 1: [], 2: [], 3: [] };
  for (const r of rows) if (r.tier <= maxTier) (t[r.tier] || t[3]).push(r);
  return t;
}

function meaningItem(r) {
  const term = indexOf(r.term) >= 0
    ? h('span', { class: 'w ab-mean', 'data-w': r.term, role: 'link', tabindex: '0', 'data-nav': '' }, r.term)
    : h('span', { class: 'ab-mean' }, r.term);
  return h('li', { class: 'rise' }, term, r.note ? h('span', { class: 'ab-note' }, r.note) : null);
}

/** Abbreviation → meanings. */
function codeBlock(code, maxTier) {
  const rows = abbreviationsFor(code);
  if (!rows.length) return null;
  const block = h('section', { class: 'ab-block' });
  block.append(h('header', { class: 'ab-head' },
    h('h2', { class: 'ab-code' }, rows[0].abbr),
    h('span', { class: 'caps' }, `stands for · ${rows.length}`)));
  const body = h('div');
  let category = null;
  const render = () => {
    const shown = category ? rows.filter(r => r.cats.includes(category)) : rows;
    const t = byTier(shown, maxTier);
    body.replaceChildren();
    for (const tier of [1, 2, 3]) {
      if (!t[tier].length) continue;
      body.append(h('div', { class: `ab-tier t${tier}` },
        h('h4', { class: 'caps ab-tier-head' }, TIERS[tier], h('span', { class: 'count' }, t[tier].length)),
        h('ul', { class: 'ab-cols' }, t[tier].map(meaningItem))));
    }
    const hidden = shown.filter(r => r.tier > maxTier).length;
    if (hidden) body.append(h('p', { class: 'note' }, `${plural(hidden, 'rarer meaning')} hidden by the tier setting.`));
  };
  const cats = [...new Set(rows.flatMap(r => r.cats))];
  if (cats.length > 1 && rows.length > 8) {
    const chips = h('div', { class: 'cat-chips', role: 'group', 'aria-label': 'Category' });
    const mk = (label, value) => {
      const b = h('button', { 'aria-pressed': String(category === value) }, label);
      b.addEventListener('click', () => {
        category = value;
        chips.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        render();
      });
      return b;
    };
    chips.append(mk('All', null), ...sortCategories(cats).map(c => mk(categoryLabel(c), c)));
    block.append(chips);
  }
  block.append(body);
  render();
  return block;
}

/** Word → abbreviations. Tapping a code opens its meanings underneath. */
function termBlock(term, maxTier) {
  const rows = abbreviationsOfTerm(term);
  if (!rows.length) return null;
  const block = h('section', { class: 'ab-block' });
  block.append(h('header', { class: 'ab-head' },
    h('h2', { class: 'ab-term' }, rows[0].term),
    h('span', { class: 'caps' }, `abbreviated as · ${rows.length}`)));
  const t = byTier(rows, maxTier);
  const opened = h('div', { class: 'ab-opened' });
  for (const tier of [1, 2, 3]) {
    if (!t[tier].length) continue;
    block.append(h('div', { class: `ab-tier t${tier}` },
      h('h4', { class: 'caps ab-tier-head' }, TIERS[tier], h('span', { class: 'count' }, t[tier].length)),
      h('ul', { class: 'ab-cols codes' }, t[tier].map(r => {
        const b = h('button', { class: 'code-btn', 'data-nav': '', 'aria-expanded': 'false', title: `What else ${r.abbr} stands for` }, r.abbr);
        b.addEventListener('click', () => toggleCode(opened, r.abbr, b, maxTier));
        return h('li', { class: 'rise' }, b, r.note ? h('span', { class: 'ab-note' }, r.note) : null);
      }))));
  }
  const hidden = rows.filter(r => r.tier > maxTier).length;
  if (hidden) block.append(h('p', { class: 'note' }, `${plural(hidden, 'rarer abbreviation')} hidden by the tier setting.`));
  block.append(opened);
  return block;
}

function toggleCode(holder, code, btn, maxTier) {
  const key = code.toUpperCase();
  const existing = holder.querySelector(`[data-code="${CSS.escape(key)}"]`);
  btn.setAttribute('aria-expanded', String(!existing));
  if (existing) { existing.remove(); return; }
  const blk = codeBlock(code, maxTier);
  if (!blk) return;
  blk.dataset.code = key;
  blk.classList.add('nested', 'rise');
  holder.prepend(blk);
  blk.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/** One line per abbreviation with its meanings in tier order: "AL  Alabama · aluminium". */
function pairsList(rows, onCode, limit = 250) {
  const codes = new Map();
  for (const r of rows.slice().sort((a, b) => a.abbr.localeCompare(b.abbr, 'en', { numeric: true }) || a.tier - b.tier)) {
    if (!codes.has(r.abbr)) codes.set(r.abbr, []);
    codes.get(r.abbr).push(r);
  }
  const groups = [...codes.entries()];
  const ul = h('ul', { class: 'pairs' });
  const add = (list) => list.forEach(([abbr, rs]) => ul.append(h('li', null,
    h('button', { class: 'code-btn', 'data-nav': '', onclick: () => onCode(abbr) }, abbr),
    h('span', { class: 'pair-terms' }, joinDots(rs.map(r =>
      h('span', { class: `pair-term t${r.tier}` }, r.term, r.note ? h('span', { class: 'ab-note' }, r.note) : null)))))));
  add(groups.slice(0, limit));
  const parts = [ul];
  if (groups.length > limit) {
    const more = h('button', { class: 'wl-more' }, `Show all ${groups.length.toLocaleString('en-GB')}`);
    more.addEventListener('click', () => { add(groups.slice(limit)); more.remove(); });
    parts.push(more);
  }
  return { parts, count: groups.length };
}

/** An umbrella word: "state" can be any US state, so the whole category as one block. */
function umbrellaBlock(word, cat, maxTier, onCode) {
  const rows = cat.rows.filter(r => r.tier <= maxTier);
  if (!rows.length) return null;
  const { parts, count } = pairsList(rows, onCode, 120);
  return h('section', { class: 'ab-block umbrella' },
    h('header', { class: 'ab-head' },
      h('h2', { class: 'ab-term' }, word.toLowerCase()),
      h('span', { class: 'caps' }, `covers ${labelText(cat.label)} · ${count}`)),
    ...parts);
}

/** “state”, “american state” or “us state”: the words that stand for a whole category. */
function categoryUmbrella(name) {
  const w = umbrellaWords(name).slice(0, 4).map(u => `“${u}”`);
  return w.length > 1 ? w.slice(0, -1).join(', ') + ' or ' + w[w.length - 1] : w[0] || '';
}

function sortCategories(cats) {
  return cats.slice().sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a), ib = CATEGORY_ORDER.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });
}

/* ---------- the module ---------- */

export function createAbbreviations(root, ctx) {
  let maxTier = getPref('abbrTier', 3);
  let shown = null;
  let category = null;

  const search = searchField({
    placeholder: 'Abbreviation or word: S, sailor…',
    ariaLabel: 'Search abbreviations',
    onInput: (v) => { category = null; ctx.setParams({ q: v.trim() || null }); render(); },
    onEnter: (v) => remember('recent-abbr', v),
  });
  const tiers = seg([[1, 'Common'], [2, '+ Harder'], [3, 'All tiers']], maxTier, (v) => {
    maxTier = v;
    setPref('abbrTier', v);
    render();
  }, { ariaLabel: 'Tiers', cls: 'seg-sm' });
  const out = h('div', { class: 'ab-out' });
  root.append(h('div', { class: 'ab-mod narrow' }, h('div', { class: 'search-wrap' }, search.el, h('div', { class: 'controls' }, tiers)), out));

  function render() {
    const q = search.value.trim();
    shown = q + '|' + (category || '');
    if (!q) return category ? showCategory(category) : showIndex();
    const blocks = [];
    const code = codeOf(q);
    const cb = code ? codeBlock(code, maxTier) : null;
    const tb = termBlock(q, maxTier);
    if (cb) blocks.push(cb);
    if (tb) blocks.push(tb);
    for (const c of extraUmbrellas(q, abbreviationsOfTerm(q))) {
      const ub = umbrellaBlock(q, c, maxTier, openCode);
      if (ub) blocks.push(ub);
    }
    if (!blocks.length) blocks.push(h('p', { class: 'note' }, `No abbreviations for “${q}”.`));
    out.replaceChildren(...blocks);
  }

  function openCode(abbr) {
    search.set(abbr);
    category = null;
    ctx.setParams({ q: abbr });
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showIndex() {
    const cats = abbreviationCategories();
    const order = sortCategories(cats.map(c => c.name));
    const recent = recentChips('recent-abbr', (r) => { search.set(r); ctx.setParams({ q: r }); render(); });
    out.replaceChildren(
      recent ? h('div', { class: 'home' }, h('h3', { class: 'caps' }, 'Recent'), recent) : '',
      h('h3', { class: 'caps list-head' }, 'Browse by category'),
      h('div', { class: 'cat-grid' }, order.map((name, n) => {
        const c = cats.find(x => x.name === name);
        const sample = [...new Set(c.rows.filter(r => r.tier === 1).map(r => r.abbr))].slice(0, 7);
        return h('button', { class: 'cat-card rise', style: { '--i': n }, onclick: () => { category = name; ctx.setParams({ cat: name }); render(); } },
          h('span', { class: 'cat-name' }, c.label),
          h('span', { class: 'cat-count' }, c.rows.length.toLocaleString('en-GB')),
          h('span', { class: 'cat-sample' }, sample.join(' · ')));
      })));
  }

  function showCategory(name) {
    const c = abbreviationCategories().find(x => x.name === name);
    if (!c) return showIndex();
    const rows = c.rows.filter(r => r.tier <= maxTier);
    const back = h('button', { class: 'back-link', onclick: () => { category = null; ctx.setParams({}); render(); } }, '‹ All categories');
    const { parts: list, count } = pairsList(rows, openCode);
    const umbrella = categoryUmbrella(name);
    const parts = [back, h('header', { class: 'ab-head' }, h('h2', { class: 'ab-term' }, c.label),
      h('span', { class: 'caps' }, `${plural(count, 'abbreviation')} · ${plural(rows.length, 'meaning')}`)),
      umbrella ? h('p', { class: 'note' }, `In clues, ${umbrella} can stand for any of these.`) : null, ...list];
    out.replaceChildren(h('section', { class: 'ab-block' }, ...parts));
  }

  return {
    show(params) {
      const q = params.q || '';
      const cat = params.cat || null;
      if (shown === q + '|' + (cat || '') && search.value === q) return;
      search.set(q);
      category = q ? null : cat;
      render();
    },
    focus() { search.input.focus(); search.input.select(); },
  };
}
