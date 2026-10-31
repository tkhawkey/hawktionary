// Thesaurus: synonyms, "type of" and "kinds", filterable by a crossword pattern or length.
// A word with several meanings shows them all together first, with a quiet row of
// meanings underneath to narrow the lists to one (doctor the physician / to doctor).
import { getEntry, getPref, setPref } from '../data.js';
import { words, indexOf, ask } from '../lexicon.js';
import { makeDisplayFilter } from '../text.js';
import { h } from '../dom.js';
import { thesaurusItems, firstGloss, linkify, POS } from '../entry.js';
import { wordList, viewSwitch } from '../wordlist.js';
import { searchField, smallField, remember, recentChips, plural } from '../ui.js';

const GROUPS = [['s', 'Synonyms'], ['t', 'Type of'], ['k', 'Kinds']];
const MEANINGS_SHOWN = 6;   // meaning chips before "more"

export function createThesaurus(root, ctx) {
  let view = getPref('thesView', 'commonness');
  let seq = 0;
  let shown = null;
  let current = null;   // { display, all: [[label, items]], meanings: [{ pos, gloss, groups }] }
  let meaning = -1;     // -1 = all meanings
  let meaningsOpen = false;

  const search = searchField({
    placeholder: 'A word for its synonyms',
    ariaLabel: 'Thesaurus word',
    delay: 220,
    onInput: () => { meaning = -1; syncParams(); load(); },
    onEnter: (v) => remember('recent-thes', v),
  });
  const filter = smallField({ caption: 'Fits', placeholder: '??? or g* or 3', ariaLabel: 'Only words that fit this pattern', onInput: () => { syncParams(); draw(); } });
  const switcher = viewSwitch(view, (v) => { view = v; setPref('thesView', v); draw(); });
  const head = h('div', { class: 'thes-head' });
  const chips = h('nav', { class: 'meanings', 'aria-label': 'Meanings' });
  const out = h('div', { class: 'thes-out' });
  root.append(h('div', { class: 'thes-mod narrow' },
    h('div', { class: 'search-wrap' }, search.el, h('div', { class: 'controls' }, filter.el, switcher)),
    head, chips, out));

  function syncParams() {
    ctx.setParams({
      w: search.value.trim() || null,
      f: filter.input.value.trim() || null,
      m: meaning >= 0 ? String(meaning + 1) : null,
    });
  }

  async function load() {
    const my = ++seq;
    const text = search.value.trim();
    shown = text + '|' + filter.input.value.trim() + '|' + meaning;
    if (!text) { current = null; return showHome(); }
    let display = indexOf(text) >= 0 ? words.display[indexOf(text)] : null;
    if (!display) {
      const found = await ask('lookup', { text, limit: 12 });
      if (my !== seq) return;
      if (found.exact.length) display = words.display[found.exact[0]];
      else {
        current = null;
        head.replaceChildren();
        chips.replaceChildren();
        out.replaceChildren(h('p', { class: 'note' }, `“${text}” is not in the word list.`),
          found.prefix.length ? h('div', { class: 'chips' }, found.prefix.map(i => pickChip(words.display[i]))) : '');
        return;
      }
    }
    let record = await getEntry(display);
    let via = null;
    // an inflection with no thesaurus of its own: use its base word
    if (!hasThesaurus(record) && record?.f?.length) {
      const base = record.f.map(f => f[1]).find(b => b && b !== display);
      if (base) {
        const r2 = await getEntry(base);
        if (hasThesaurus(r2)) { via = display; display = base; record = r2; }
      }
    }
    if (my !== seq) return;
    current = {
      display,
      all: GROUPS.map(([k, label]) => [label, thesaurusItems(record?.[k], display)]).filter(([, l]) => l.length),
      // keep only meanings that have some words to show
      meanings: (record?.m || []).map(([pos, gloss, s, t, k]) => ({
        pos, gloss,
        groups: [['Synonyms', thesaurusItems(s, display)], ['Type of', thesaurusItems(t, display)], ['Kinds', thesaurusItems(k, display)]]
          .filter(([, l]) => l.length),
      })).filter(m => m.groups.length),
    };
    if (meaning >= current.meanings.length) meaning = -1;
    const gloss = await firstGloss(display);
    if (my !== seq) return;
    head.replaceChildren(
      h('div', { class: 'thes-title' },
        h('h2', { class: 'thes-word' }, display),
        h('button', { class: 'sec-link', onclick: () => ctx.go('dictionary', { q: display }) }, 'Dictionary ›')),
      via ? h('p', { class: 'note' }, `“${via}” has no thesaurus entry of its own, so these are for “${display}”.`) : '',
      gloss && current.meanings.length < 2 ? h('p', { class: 'thes-gloss gloss', html: linkify(gloss) }) : '');
    meaningsOpen = meaning >= MEANINGS_SHOWN;
    drawMeanings();
    draw();
  }

  function hasThesaurus(r) {
    return !!(r && (r.s?.length || r.t?.length || r.k?.length));
  }

  function pickChip(d) {
    return h('button', { class: 'chip', onclick: () => { search.set(d); meaning = -1; syncParams(); load(); } }, d);
  }

  function shortGloss(g) {
    const s = g.replace(/^\([^)]*\)\s*/, '');
    return s.length > 42 ? s.slice(0, 40).replace(/\s+\S*$/, '') + '…' : s;
  }

  /** "All meanings" plus one quiet button per meaning; the chosen one's full gloss underneath. */
  function drawMeanings() {
    chips.replaceChildren();
    const list = current?.meanings || [];
    if (list.length < 2) return;
    const pick = (n) => {
      meaning = n;
      syncParams();
      shown = search.value.trim() + '|' + filter.input.value.trim() + '|' + meaning;
      drawMeanings();
      draw();
    };
    const row = h('div', { class: 'meaning-row' });
    row.append(h('button', { class: 'meaning', 'aria-pressed': String(meaning === -1), onclick: () => pick(-1) },
      h('span', { class: 'm-all' }, 'All meanings'), h('span', { class: 'm-n' }, list.length)));
    const visible = meaningsOpen ? list : list.slice(0, MEANINGS_SHOWN);
    visible.forEach((m, n) => {
      row.append(h('button', { class: 'meaning', 'aria-pressed': String(meaning === n), title: m.gloss, onclick: () => pick(n) },
        h('span', { class: 'm-pos' }, POS[m.pos] || m.pos), ' ', h('span', { class: 'm-gloss' }, shortGloss(m.gloss))));
    });
    if (!meaningsOpen && list.length > MEANINGS_SHOWN) {
      row.append(h('button', { class: 'meaning more', onclick: () => { meaningsOpen = true; drawMeanings(); } }, plural(list.length - MEANINGS_SHOWN, 'more meaning', 'more meanings')));
    }
    chips.append(row);
    if (meaning >= 0) {
      const m = list[meaning];
      chips.append(h('p', { class: 'meaning-gloss' }, h('span', { class: 'm-pos' }, POS[m.pos] || m.pos), ' ', h('span', { html: linkify(m.gloss) })));
    }
  }

  function draw() {
    if (!current) return;
    const groups = meaning >= 0 ? current.meanings[meaning].groups : current.all;
    const ftext = filter.input.value.trim();
    const fit = makeDisplayFilter(ftext);
    const sections = [];
    let total = 0;
    for (const [label, items] of groups) {
      const list = fit ? items.filter(it => fit(it.d, it.e)) : items;
      total += list.length;
      if (!list.length) continue;
      sections.push(h('section', { class: 'thes-group' },
        h('div', { class: 'sec-head' }, h('h3', null, label), h('span', { class: 'count' }, list.length)),
        wordList(list, { view, initial: fit ? 400 : 48 })));
    }
    if (!groups.length) sections.push(h('p', { class: 'note' }, `No thesaurus entry for “${current.display}”.`));
    else if (!total) sections.push(h('p', { class: 'note' }, meaning >= 0 ? `Nothing in this meaning fits “${ftext}”. Try “All meanings”.` : `Nothing fits “${ftext}”.`));
    else if (fit) sections.unshift(h('p', { class: 'fit-count' }, `${plural(total, 'word')} fit `, h('b', null, ftext)));
    if (meaning === -1 && current.meanings.length >= 2 && !fit) {
      sections.push(h('p', { class: 'note' }, 'Choose a meaning above to see only its words. Some synonyms can’t be matched to a meaning, so they appear only here.'));
    }
    out.replaceChildren(...sections);
  }

  function showHome() {
    head.replaceChildren();
    chips.replaceChildren();
    const recent = recentChips('recent-thes', (r) => { search.set(r); meaning = -1; syncParams(); load(); });
    out.replaceChildren(h('div', { class: 'home' },
      recent ? [h('h3', { class: 'caps' }, 'Recent'), recent] : '',
      h('p', { class: 'note' }, 'Type a word to see its synonyms, what it is a type of, and kinds of it. Add a pattern in “Fits” to keep only words that fit your crossword slot: ??? for three letters, ?a* for words with A second.')));
  }

  return {
    show(params) {
      const w = params.w || '';
      const f = params.f || '';
      const m = params.m ? parseInt(params.m, 10) - 1 : -1;
      if (shown === w + '|' + f + '|' + m && search.value === w) return;
      search.set(w);
      filter.input.value = f;
      meaning = Number.isFinite(m) ? m : -1;
      load();
    },
    focus() { search.input.focus(); search.input.select(); },
  };
}
