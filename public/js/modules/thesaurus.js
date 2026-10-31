// Thesaurus: synonyms, "type of" and "kinds", filterable by a crossword pattern or length.
import { getEntry, getPref, setPref } from '../data.js';
import { words, indexOf, ask } from '../lexicon.js';
import { makeDisplayFilter } from '../text.js';
import { h } from '../dom.js';
import { thesaurusItems, firstGloss, linkify } from '../entry.js';
import { wordList, viewSwitch } from '../wordlist.js';
import { searchField, smallField, remember, recentChips, plural } from '../ui.js';

const GROUPS = [['s', 'Synonyms'], ['t', 'Type of'], ['k', 'Kinds']];

export function createThesaurus(root, ctx) {
  let view = getPref('thesView', 'commonness');
  let seq = 0;
  let shown = null;
  let current = null;   // { display, groups: [[label, items]] }

  const search = searchField({
    placeholder: 'A word for its synonyms',
    ariaLabel: 'Thesaurus word',
    delay: 220,
    onInput: () => { syncParams(); load(); },
    onEnter: (v) => remember('recent-thes', v),
  });
  const filter = smallField({ caption: 'Fits', placeholder: '??? or g* or 3', ariaLabel: 'Only words that fit this pattern', onInput: () => { syncParams(); draw(); } });
  const switcher = viewSwitch(view, (v) => { view = v; setPref('thesView', v); draw(); });
  const head = h('div', { class: 'thes-head' });
  const out = h('div', { class: 'thes-out' });
  root.append(h('div', { class: 'thes-mod narrow' },
    h('div', { class: 'search-wrap' }, search.el, h('div', { class: 'controls' }, filter.el, switcher)),
    head, out));

  function syncParams() {
    ctx.setParams({ w: search.value.trim() || null, f: filter.input.value.trim() || null });
  }

  async function load() {
    const my = ++seq;
    const text = search.value.trim();
    shown = text + '|' + filter.input.value.trim();
    if (!text) { current = null; return showHome(); }
    let display = indexOf(text) >= 0 ? words.display[indexOf(text)] : null;
    if (!display) {
      const found = await ask('lookup', { text, limit: 12 });
      if (my !== seq) return;
      if (found.exact.length) display = words.display[found.exact[0]];
      else {
        current = null;
        head.replaceChildren();
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
      groups: GROUPS.map(([k, label]) => [label, thesaurusItems(record?.[k], display)]).filter(([, l]) => l.length),
    };
    const gloss = await firstGloss(display);
    if (my !== seq) return;
    head.replaceChildren(
      h('div', { class: 'thes-title' },
        h('h2', { class: 'thes-word' }, display),
        h('button', { class: 'sec-link', onclick: () => ctx.go('dictionary', { q: display }) }, 'Dictionary ›')),
      via ? h('p', { class: 'note' }, `“${via}” has no thesaurus entry of its own, so these are for “${display}”.`) : '',
      gloss ? h('p', { class: 'thes-gloss gloss', html: linkify(gloss) }) : '');
    draw();
  }

  function hasThesaurus(r) {
    return !!(r && (r.s?.length || r.t?.length || r.k?.length));
  }

  function pickChip(d) {
    return h('button', { class: 'chip', onclick: () => { search.set(d); syncParams(); load(); } }, d);
  }

  function draw() {
    if (!current) return;
    const ftext = filter.input.value.trim();
    const fit = makeDisplayFilter(ftext);
    const sections = [];
    let total = 0;
    for (const [label, items] of current.groups) {
      const list = fit ? items.filter(it => fit(it.d, it.e)) : items;
      total += list.length;
      if (!list.length) continue;
      sections.push(h('section', { class: 'thes-group' },
        h('div', { class: 'sec-head' }, h('h3', null, label), h('span', { class: 'count' }, list.length)),
        wordList(list, { view, initial: fit ? 400 : 48 })));
    }
    if (!current.groups.length) sections.push(h('p', { class: 'note' }, `No thesaurus entry for “${current.display}”.`));
    else if (!total) sections.push(h('p', { class: 'note' }, `Nothing fits “${ftext}”.`));
    else if (fit) sections.unshift(h('p', { class: 'fit-count' }, `${plural(total, 'word')} fit `, h('b', null, ftext)));
    out.replaceChildren(...sections);
  }

  function showHome() {
    head.replaceChildren();
    const recent = recentChips('recent-thes', (r) => { search.set(r); syncParams(); load(); });
    out.replaceChildren(h('div', { class: 'home' },
      recent ? [h('h3', { class: 'caps' }, 'Recent'), recent] : '',
      h('p', { class: 'note' }, 'Type a word to see its synonyms, what it is a type of, and kinds of it. Add a pattern in “Fits” to keep only words that fit your crossword slot: ??? for three letters, ?a* for words with A second.')));
  }

  return {
    show(params) {
      const w = params.w || '';
      const f = params.f || '';
      if (shown === w + '|' + f && search.value === w) return;
      search.set(w);
      filter.input.value = f;
      load();
    },
    focus() { search.input.focus(); search.input.select(); },
  };
}
