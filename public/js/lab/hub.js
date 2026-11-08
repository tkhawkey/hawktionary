// The hub: one search box, the main result in the middle, supporting cards around it.
// Each card always sits in the same place (abbreviations, thesaurus and anagrams on the
// left; hidden words, indicator and categories on the right) and appears only when it has
// something to show. On a phone the cards become a swipeable strip under the main card.
import { getEntry } from '../data.js';
import { words, indexOf, ask, abbreviationsOfTerm, umbrellaCategories } from '../lexicon.js';
import { fold, guessMode, parsePattern } from '../text.js';
import { h } from '../dom.js';
import { renderPage, thesaurusItems } from '../entry.js';
import { wordList } from '../wordlist.js';
import { searchField, remember, recentChips, plural } from '../ui.js';
import { grid } from '../squares.js';
import { thesaurusPanel } from '../modules/thesaurus.js';
import { card, transition, moreList } from './cards.js';
import { indicatorsFor, charadesFor, typeName, typeHint, hasIndicators } from './cluedata.js';

const CLASSIC = 'index.html';

export function createHub(root, ctx) {
  let seq = 0;
  let shown = null;
  let view = 'entry';      // 'entry' | 'thes': what the main card shows
  let mainWord = null;     // the entry shown in the main card

  const search = searchField({
    placeholder: 'A word, c?y?t?c, /letters or a few words',
    ariaLabel: 'Search',
    delay: 220,
    onInput: () => { view = 'entry'; sync(); run(); },
    onEnter: (v) => remember('lab-recent', v),
  });
  const cards = {
    abbr: card('abbr', 'Abbreviations', { tint: 'abbr' }),
    thes: card('thes', 'Thesaurus', { tint: 'thesaurus' }),
    anag: card('anag', 'Anagrams', { tint: 'solve' }),
    hidden: card('hidden', 'Hidden words', { tint: 'solve' }),
    ind: card('ind', 'Indicator', { tint: 'solve' }),
    cats: card('cats', 'Categories', { tint: 'abbr' }),
  };
  const main = h('section', { class: 'card card-main', 'aria-live': 'polite', style: { 'view-transition-name': 'main' } });
  const panel = thesaurusPanel({
    go: (m, p) => ctx.go('hub', { q: p.q || p.w }),
    onPick: (d) => { search.set(d); sync(); run(); },
  });

  root.append(h('div', { class: 'hub' },
    h('div', { class: 'hub-search' }, search.el),
    h('div', { class: 'hub-grid' },
      main,
      h('div', { class: 'hub-cards' },
        h('div', { class: 'hub-col hub-left' }, cards.abbr.el, cards.thes.el, cards.anag.el),
        h('div', { class: 'hub-col hub-right' }, cards.hidden.el, cards.ind.el, cards.cats.el)))));

  function key() { return search.value.trim() + '|' + view; }

  function sync() {
    ctx.setParams({ q: search.value.trim() || null, v: view === 'thes' ? 'thes' : null });
    shown = key();
  }

  /* ---------- main card ---------- */

  async function entryMain(text) {
    let display = indexOf(text) >= 0 ? words.display[indexOf(text)] : null;
    let suggestions = [];
    if (!display) {
      const found = await ask('lookup', { text, limit: 10 });
      if (found.exact.length) display = words.display[found.exact[0]];
      else suggestions = found.prefix.map(i => words.display[i]);
    }
    if (!display && !/\s/.test(text)) {
      mainWord = null;
      return [h('h2', { class: 'main-word' }, text),
        h('p', { class: 'note' }, 'Not in the word list.'),
        suggestions.length ? h('div', { class: 'chips' }, suggestions.map(d => h('button', { class: 'chip', onclick: () => pick(d) }, d))) : null];
    }
    mainWord = display || text;
    const page = await renderPage(mainWord, { onNeighbour: (d) => pick(d) });
    // the cards show these, so the page doesn't repeat them
    page.querySelectorAll('.page-thes, .page-abbr').forEach(el => el.remove());
    return [page];
  }

  function thesMain() {
    panel.show(mainWord || search.value.trim());
    return [h('div', { class: 'main-bar' },
      h('h2', { class: 'main-label' }, 'Thesaurus'),
      h('button', { class: 'sec-link', onclick: () => setView('entry') }, '‹ Back to the definition')),
    panel.controls, panel.el];
  }

  async function patternMain(text) {
    mainWord = null;
    const parsed = parsePattern(text);
    const res = await ask('pattern', { text, phrases: !parsed?.hasBreaks, limit: 400 });
    const items = res.results.map(i => ({ d: words.display[i], z: words.zipf[i], e: words.enumr[i] }));
    return [h('div', { class: 'main-bar' }, h('h2', { class: 'main-label' }, 'Pattern'), h('span', { class: 'count' }, plural(res.total, 'word'))),
      parsed ? grid(parsed.shape, { cls: 'grid-sm' }) : null,
      items.length ? wordList(items, { initial: 60, view: 'commonness' }) : h('p', { class: 'note' }, 'Nothing fits.')];
  }

  async function anagramMain(letters) {
    mainWord = null;
    const res = await ask('anagram', { fodder: letters, proper: true, limit: 400 });
    const items = res.results.map(i => ({ d: words.display[i], z: words.zipf[i], e: words.enumr[i] }));
    return [h('div', { class: 'main-bar' }, h('h2', { class: 'main-label' }, 'Anagrams of ', h('b', null, letters)), h('span', { class: 'count' }, plural(res.total, 'word'))),
      items.length ? wordList(items, { initial: 60, view: 'length' }) : h('p', { class: 'note' }, 'No anagrams.')];
  }

  function homeMain() {
    const recent = recentChips('lab-recent', (r) => pick(r));
    return [h('div', { class: 'home lab-home' },
      h('h2', { class: 'main-label' }, 'Search'),
      h('p', { class: 'note' }, 'Type a word for its definition. Cards appear around it when there is more to see: abbreviations, the thesaurus, anagrams, hidden words, crossword indicators and categories.'),
      h('div', { class: 'chips' }, ['state', 'about', 'lemon sideways', 'c?y?t?c', '/listen'].map(t => h('button', { class: 'chip', onclick: () => pick(t) }, t))),
      recent ? [h('h3', { class: 'caps' }, 'Recent'), recent] : null)];
  }

  /* ---------- supporting cards ---------- */

  async function abbrCard(text) {
    const rows = abbreviationsOfTerm(text).slice().sort((a, b) => a.tier - b.tier);
    const codes = new Set(rows.map(r => r.abbr.toUpperCase()));
    const pieces = charadesFor(text).filter(r => !codes.has(r.letters) && r.letters.length <= 6);
    if (!rows.length && !pieces.length) return null;
    const out = [];
    if (rows.length) {
      out.push(moreList(rows, 6, (r) => h('li', { class: 't' + r.tier },
        h('b', { class: 'code' }, r.abbr), r.note ? h('span', { class: 'card-note' }, ' ', r.note) : null), { cls: 'card-list codes' }));
    }
    if (pieces.length) {
      out.push(h('p', { class: 'card-line' }, h('span', { class: 'card-cap' }, 'Also in clues '),
        pieces.slice(0, 8).map((r, n) => [n ? h('span', { class: 'dot' }, ' · ') : null, h('b', { class: 'code' }, r.letters)])));
    }
    return { body: out, head: h('a', { class: 'sec-link', href: `${CLASSIC}#/abbr?q=${encodeURIComponent(text)}` }, 'Open ›') };
  }

  async function thesCard(text) {
    if (!mainWord || view === 'thes') return null;
    const record = await getEntry(mainWord);
    const items = thesaurusItems([...(record?.s || []), ...(record?.t || [])], mainWord);
    if (!items.length) return null;
    return { body: wordList(items.slice(0, 40), { initial: 12 }), head: h('button', { class: 'sec-link', onclick: () => setView('thes') }, `All ${items.length} ›`) };
  }

  async function anagCard(text, mode) {
    if (mode !== 'lookup') return null;
    const letters = fold(text);
    if (letters.length < 3 || letters.length > 15) return null;
    const res = await ask('anagram', { fodder: letters, proper: false, maxBand: 4, limit: 40 });
    const items = res.results.filter(i => words.display[i].toLowerCase() !== text.toLowerCase())
      .map(i => ({ d: words.display[i], z: words.zipf[i], e: words.enumr[i] }));
    if (!items.length) return null;
    return { body: wordList(items, { initial: 10 }), head: h('a', { class: 'sec-link', href: `#/?q=${encodeURIComponent('/' + letters)}` }, 'All ›') };
  }

  async function hiddenCard(text, mode) {
    if (mode !== 'lookup' || text.trim().split(/\s+/).length < 2) return null;
    const res = await ask('hidden', { text, limit: 60 });
    const crossing = res.results.filter(r => r.crosses);
    if (!crossing.length) return null;
    return { body: hiddenList(text, crossing) };
  }

  async function indCard(text, mode) {
    if (mode !== 'lookup' || !hasIndicators()) return null;
    const types = indicatorsFor(text);
    if (!types.length) return null;
    const top = types[0].count;
    return {
      body: [h('p', { class: 'card-line' }, h('b', null, `“${text.trim()}”`), ' can signal:'),
        h('ul', { class: 'card-list ind-list' }, types.slice(0, 5).map(t => h('li', { class: 'ind-type' },
          h('span', { class: 'ind-name' }, typeName(t.type)),
          h('span', { class: 'ind-bar', title: `Seen ${t.count} times`, style: { '--w': Math.max(.08, t.count / top).toFixed(3) } }),
          h('span', { class: 'card-note' }, typeHint(t.type)))))],
    };
  }

  async function catsCard(text, mode) {
    if (mode !== 'lookup') return null;
    const cats = umbrellaCategories(text);
    if (!cats.length) return null;
    return {
      body: cats.slice(0, 3).map(c => {
        const sample = c.rows.slice().sort((a, b) => a.tier - b.tier).filter((r, i, a) => a.findIndex(x => x.abbr === r.abbr) === i);
        return h('div', { class: 'cat-block' },
          h('p', { class: 'card-line' }, h('b', null, `“${text.trim()}”`), ' can stand for any of ', h('b', null, c.label), h('span', { class: 'count' }, ' · ', c.rows.length)),
          h('p', { class: 'card-line codes-line' }, sample.slice(0, 14).map((r, n) => [n ? h('span', { class: 'dot' }, ' · ') : null, h('b', { class: 'code', title: r.term }, r.abbr)])));
      }),
      head: h('a', { class: 'sec-link', href: `${CLASSIC}#/abbr?q=${encodeURIComponent(text)}` }, 'All ›'),
    };
  }

  /* ---------- running a search ---------- */

  async function run() {
    const my = ++seq;
    const text = search.value.trim();
    if (!text) {
      mainWord = null;
      transition(() => { main.replaceChildren(...homeMain()); for (const c of Object.values(cards)) c.clear(); });
      return;
    }
    const mode = guessMode(text);
    let content;
    if (mode === 'pattern') content = await patternMain(text);
    else if (mode === 'anagram') content = await anagramMain(text.slice(1).trim());
    else content = await entryMain(text);
    if (my !== seq) return;
    if (view === 'thes' && mainWord) content = thesMain();
    const found = await Promise.all([
      mode === 'lookup' ? abbrCard(text) : null,
      thesCard(text),
      anagCard(text, mode),
      hiddenCard(text, mode),
      indCard(text, mode),
      catsCard(text, mode),
    ]);
    if (my !== seq) return;
    transition(() => {
      main.replaceChildren(...content.filter(Boolean));
      ['abbr', 'thes', 'anag', 'hidden', 'ind', 'cats'].forEach((k, n) => {
        const r = found[n];
        r ? cards[k].fill(r.body, r.head) : cards[k].clear();
      });
    });
  }

  /** The thesaurus card grows into the main card (and back). */
  function setView(v) {
    if (v === view) return;
    view = v;
    sync();
    if (v === 'thes') {
      // the card morphs into the main card's place
      cards.thes.el.style.viewTransitionName = 'main';
      main.style.viewTransitionName = 'none';
    }
    const restore = () => {
      cards.thes.el.style.viewTransitionName = 'card-thes';
      main.style.viewTransitionName = 'main';
    };
    if (v === 'thes') {
      transition(() => { restore(); main.replaceChildren(...thesMain()); cards.thes.clear(); })
        .then(() => main.scrollIntoView?.({ block: 'nearest' }));
    } else {
      run();
    }
  }

  function pick(text) {
    remember('lab-recent', text);
    ctx.go('hub', { q: text });
  }

  return {
    show(params) {
      const q = params.q || '';
      const v = params.v === 'thes' ? 'thes' : 'entry';
      if (shown === q + '|' + v && search.value === q && main.childNodes.length) return;
      search.set(q);
      view = v;
      shown = key();
      run();
      window.scrollTo(0, 0);
    },
    focus() { search.input.focus(); search.input.select(); },
    // any word tapped anywhere becomes the main word
    paneHandler(display) { pick(display); return true; },
  };
}

/** Hidden words with the letters marked where they sit in the clue words. */
export function hiddenList(text, hits, { onPiece = null, limit = 6 } = {}) {
  const tokens = text.split(/[\s\/]+/).filter(t => fold(t));
  const joined = tokens.map(fold).join('');
  return moreList(hits, limit, (r) => {
    const d = words.display[r.i];
    const word = onPiece
      ? h('button', { class: 'piece', 'data-piece': d, 'data-kind': 'word', 'data-w': d }, d)
      : h('span', { class: 'w b1', 'data-w': d, role: 'link', tabindex: '0' }, d);
    return h('li', { class: 'hidden-hit' }, word,
      r.backwards ? h('span', { class: 'card-note' }, ' reversed') : null,
      h('span', { class: 'hidden-src', 'aria-hidden': 'true' }, markSource(tokens, joined, r.a, r.b)));
  }, { cls: 'card-list hidden-list' });
}

/** "lem[ON SIDE]ways": the clue words with the hidden letters highlighted. */
function markSource(tokens, joined, a, b) {
  const out = [];
  let pos = 0;
  tokens.forEach((t, n) => {
    if (n) out.push(' ');
    const f = fold(t);
    const s = pos, e = pos + f.length;
    pos = e;
    if (b <= s || a >= e) { out.push(h('span', { class: 'hs-dim' }, f)); return; }
    const x = Math.max(a, s) - s, y = Math.min(b, e) - s;
    if (x) out.push(h('span', { class: 'hs-dim' }, f.slice(0, x)));
    out.push(h('mark', null, f.slice(x, y)));
    if (y < f.length) out.push(h('span', { class: 'hs-dim' }, f.slice(y)));
  });
  return out;
}
