// Abbreviation blocks: one block per query, never one card per row.
import { abbreviationsFor, abbreviationsOfTerm, indexOf } from './lexicon.js';
import { h } from './dom.js';

const TIER_LABEL = { 2: 'Harder', 3: 'Rare' };

function byTier(rows) {
  const t = { 1: [], 2: [], 3: [] };
  for (const r of rows) (t[r.tier] || t[3]).push(r);
  return t;
}

/** A meaning: the clue term (opens its definition if it is a word) and a quiet note. */
function meaning(r) {
  const term = indexOf(r.term) >= 0
    ? h('span', { class: 'w term-w', 'data-w': r.term, role: 'link', tabindex: '0' }, r.term)
    : h('span', null, r.term);
  return h('span', { class: 'abbr-item' }, term, r.note ? h('span', { class: 'abbr-note' }, ' · ' + r.note) : null);
}

function codeButton(r, onOpen) {
  const b = h('button', { class: 'abbr-code', 'data-abbr': r.abbr, 'aria-expanded': 'false', title: `Show all meanings of ${r.abbr}` }, r.abbr);
  b.addEventListener('click', () => onOpen(r.abbr, b));
  return h('span', { class: 'abbr-item' }, b, r.note ? h('span', { class: 'abbr-note' }, ` (${r.note})`) : null);
}

function joinItems(items) {
  const el = h('div', { class: 'abbr-items' });
  items.forEach((it, n) => {
    if (n) el.append(h('span', { class: 'sep', 'aria-hidden': 'true' }, '·'));
    el.append(it);
  });
  return el;
}

/** A tier that starts collapsed behind a "26 more" control. */
function collapsedTier(tier, items) {
  const wrap = h('div', { class: `abbr-tier tier${tier}` });
  const btn = h('button', { class: 'reveal', 'aria-expanded': 'false' }, `${TIER_LABEL[tier]}: ${items.length} more`);
  btn.addEventListener('click', () => {
    btn.replaceWith(h('div', { class: 'abbr-tier-label' }, TIER_LABEL[tier]), joinItems(items));
  });
  wrap.append(btn);
  return wrap;
}

function openTier(tier, items) {
  return h('div', { class: `abbr-tier tier${tier}` },
    tier > 1 ? h('div', { class: 'abbr-tier-label' }, TIER_LABEL[tier]) : null, joinItems(items));
}

/** Abbreviation → meanings, e.g. S → quarter · second · shilling … */
export function codeBlock(code, rows = abbreviationsFor(code)) {
  if (!rows.length) return null;
  const block = h('section', { class: 'abbr-block', 'data-block': 'code:' + code.toUpperCase() });
  const head = h('div', { class: 'abbr-head' },
    h('h2', { class: 'abbr-title' }, rows[0].abbr.toUpperCase() === code.toUpperCase() ? rows[0].abbr : code.toUpperCase()),
    h('span', { class: 'abbr-kind' }, `Abbreviation · ${rows.length} meaning${rows.length === 1 ? '' : 's'}`));
  block.append(head);
  const body = h('div');
  block.append(body);

  let category = null;
  function render() {
    const shown = category ? rows.filter(r => r.category === category) : rows;
    const t = byTier(shown);
    body.replaceChildren();
    if (t[1].length) body.append(openTier(1, t[1].map(meaning)));
    for (const tier of [2, 3]) {
      if (!t[tier].length) continue;
      // with no common meanings, show the harder ones straight away
      body.append(!t[1].length && tier === 2 ? openTier(2, t[2].map(meaning)) : collapsedTier(tier, t[tier].map(meaning)));
    }
  }
  const cats = [...new Set(rows.map(r => r.category))];
  if (cats.length > 1 && rows.length > 8) {
    const bar = h('div', { class: 'cat-filter', role: 'group', 'aria-label': 'Filter by category' });
    const mk = (label, value) => {
      const b = h('button', { 'aria-pressed': String(category === value) }, label);
      b.addEventListener('click', () => {
        category = value;
        bar.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        render();
      });
      return b;
    };
    bar.append(mk('All', null), ...cats.sort().map(c => mk(c, c)));
    block.insertBefore(bar, body);
  }
  render();
  return block;
}

/** Word → abbreviations, e.g. sailor → AB · OS · TAR */
export function termBlock(term, rows = abbreviationsOfTerm(term)) {
  if (!rows.length) return null;
  const block = h('section', { class: 'abbr-block', 'data-block': 'term:' + term.toLowerCase() });
  block.append(h('div', { class: 'abbr-head' },
    h('h2', { class: 'abbr-title term' }, rows[0].term),
    h('span', { class: 'abbr-kind' }, `Abbreviated as · ${rows.length}`)));
  const t = byTier(rows);
  const open = (code, btn) => toggleCode(block, code, btn);
  if (t[1].length) block.append(openTier(1, t[1].map(r => codeButton(r, open))));
  if (t[2].length) block.append(openTier(2, t[2].map(r => codeButton(r, open))));
  if (t[3].length) block.append(collapsedTier(3, t[3].map(r => codeButton(r, open))));
  return block;
}

/** Tapping an abbreviation opens its own block underneath (tap again to close). */
function toggleCode(parent, code, btn) {
  const key = 'code:' + code.toUpperCase();
  const existing = parent.querySelector(`:scope > [data-block="${CSS.escape(key)}"]`);
  parent.querySelectorAll('.abbr-code').forEach(b => {
    if (b.dataset.abbr.toUpperCase() === code.toUpperCase()) b.setAttribute('aria-expanded', String(!existing));
  });
  if (existing) { existing.remove(); return; }
  const blk = codeBlock(code);
  if (blk) {
    blk.classList.add('rise');
    parent.append(blk);
    blk.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}
