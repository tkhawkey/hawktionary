// Dictionary: the smart search box (word, pattern or anagram), abbreviation strips, and the page.
import { getPref, setPref } from '../data.js';
import { words, indexOf, ask, tagsOf, allTags, indicesWithTags } from '../lexicon.js';
import { guessMode, parsePattern, leftover, fold } from '../text.js';
import { h, isWide } from '../dom.js';
import { renderPage } from '../entry.js';
import { wordList } from '../wordlist.js';
import { grid, blocks, dropInto } from '../squares.js';
import { searchField, smallField, toggle, seg, bandSeg, selectField, remember, recentChips, plural } from '../ui.js';
import { abbrStrip } from './abbreviations.js';
import { thesaurusPanel } from './thesaurus.js';

const MODE_NAMES = { lookup: 'Word', pattern: 'Pattern', anagram: 'Anagram', thesaurus: 'Thesaurus' };
const MODES = ['auto', 'lookup', 'pattern', 'anagram', 'thesaurus'];
const isMyth = (t) => /mythology|Arthurian/.test(t);

/** Subject tags shortened for a label beside a word: "Greek mythology" → "Greek myth". */
function tagLabel(tags) {
  return tags.map(t => t === 'Mythology (other)' ? 'myth' : t.replace(' mythology', ' myth')).join(' · ');
}

/** The subject filter's choices, and what each keeps or leaves out. */
function subjectChoices() {
  const tags = allTags();
  if (!tags.length) return null;
  return [
    ['any', 'Any subject'],
    ['myth', 'Mythology only'],
    ...tags.filter(isMyth).map(t => ['tag:' + t, t]),
    ...tags.filter(t => !isMyth(t)).map(t => ['tag:' + t, t + ' only']),
    ['not:Biblical', 'No Biblical names'],
    ['untagged', 'No mythology or religion'],
  ];
}

export function createDictionary(root, ctx) {
  const state = {
    mode: 'auto',
    phrases: getPref('phrases', false),
    maxBand: getPref('maxBand', 5),
    proper: getPref('proper', true),
    subject: getPref('subject', 'any'),
    seq: 0,
    tool: null,
    refs: {},
    paneTrail: [],
    paneSeq: 0,
    shown: null,     // query currently rendered
    thes: { filter: '', meaning: -1 },   // the Thesaurus mode's "Fits" filter and chosen meaning
  };

  // the same thesaurus panel as the Thesaurus tab, shown when the Thesaurus mode is chosen
  const thes = thesaurusPanel({
    go: ctx.go,
    onChange: ({ filter, meaning }) => { state.thes = { filter: filter || '', meaning: meaning ?? -1 }; syncParams(); },
    onPick: (d) => { search.set(d); state.thes.meaning = -1; syncParams(); run(); },
    onShown: (d) => { if (isWide()) showInPane(d); },
  });

  function syncParams() {
    const thesaurus = state.mode === 'thesaurus';
    ctx.setParams({
      q: search.value.trim() || null,
      m: state.mode === 'auto' ? null : state.mode,
      f: thesaurus && state.thes.filter ? state.thes.filter : null,
      s: thesaurus && state.thes.meaning >= 0 ? String(state.thes.meaning + 1) : null,
    });
    state.shown = key();
  }

  function key() {
    return [search.value, state.mode, state.thes.filter, state.thes.meaning].join('|');
  }

  const search = searchField({
    placeholder: 'Word, ?a?e? pattern, or /anagram',
    ariaLabel: 'Search the dictionary',
    onInput: () => { state.thes = { filter: state.thes.filter, meaning: -1 }; syncParams(); run(); },
    onEnter: (v) => { remember('recent', v); focusFirst(); },
  });
  search.input.addEventListener('input', updateLabel);

  const modes = seg(MODES.map(m => [m, m === 'auto' ? 'Auto' : MODE_NAMES[m]]), 'auto', (m) => {
    state.mode = m;
    syncParams();
    updateLabel();
    run();
    search.input.focus();
  }, { ariaLabel: 'Search mode', cls: 'seg-modes' });

  const tool = h('div', { class: 'tool' });
  const results = h('div', { class: 'results', 'aria-live': 'polite' });
  const pane = h('aside', { class: 'page-pane', 'aria-label': 'Entry' });
  root.append(h('div', { class: 'dict' },
    h('div', { class: 'dict-left' }, h('div', { class: 'search-wrap' }, search.el, modes), tool, results),
    pane));

  function currentMode() {
    const v = search.value;
    if (!v.trim()) return null;
    return state.mode === 'auto' ? guessMode(v) : state.mode;
  }

  function updateLabel() {
    const m = currentMode();
    search.label.textContent = m && state.mode === 'auto' ? MODE_NAMES[m] : '';
  }

  function focusFirst() {
    root.querySelector('.results [data-nav]')?.focus();
  }

  function run() {
    const seq = ++state.seq;
    const text = search.value;
    state.shown = key();
    const mode = currentMode();
    updateLabel();
    if (!mode) return showHome();
    if (mode === 'pattern') return runPattern(text, seq);
    if (mode === 'anagram') return runAnagram(text.trim().replace(/^\//, ''), seq);
    if (mode === 'thesaurus') return runThesaurus(text.trim().replace(/^\//, ''));
    return runLookup(text.trim().replace(/^\//, ''), seq);
  }

  function setTool(name, build) {
    if (state.tool === name) return state.refs;
    state.tool = name;
    state.refs = {};
    tool.replaceChildren();
    if (build) build(tool, state.refs);
    return state.refs;
  }

  function filterControls(extra) {
    const choices = subjectChoices();
    return h('div', { class: 'controls' },
      extra,
      bandSeg((v) => { state.maxBand = v; run(); }),
      toggle('Names', state.proper, (v) => { state.proper = v; setPref('proper', v); run(); }),
      choices ? selectField('Subject', choices, state.subject, (v) => { state.subject = v; setPref('subject', v); run(); }) : null);
  }

  /** The subject filter as word indices for the worker: { only } or { not }, or null for any. */
  function subjectFilter() {
    const v = state.subject;
    if (v === 'myth') return { only: indicesWithTags(t => t.some(isMyth)) };
    if (v.startsWith('tag:')) return { only: indicesWithTags(t => t.includes(v.slice(4))) };
    if (v.startsWith('not:')) return { not: indicesWithTags(t => t.includes(v.slice(4))) };
    if (v === 'untagged') return { not: indicesWithTags(t => t.length > 0) };
    return null;
  }

  function itemsFor(indices) {
    return indices.map(i => {
      const tags = tagsOf(words.display[i]);
      return { d: words.display[i], z: words.zipf[i], e: words.enumr[i], note: tags.length ? tagLabel(tags) : null };
    });
  }

  function noMatch(suggestPhrases) {
    const tips = [];
    if (suggestPhrases) tips.push('turn on “Phrases”');
    if (state.maxBand < 5) tips.push('choose “All”');
    if (!state.proper) tips.push('include names');
    if (state.subject !== 'any') tips.push('choose “Any subject”');
    return h('p', { class: 'note' }, tips.length ? `Nothing found. Try: ${tips.join(', ')}.` : 'Nothing in the word list fits.');
  }

  /* ---------- page pane ---------- */

  function pageCtx() {
    return {
      onNeighbour: (d) => { search.set(d); state.mode = 'auto'; ctx.setParams({ q: d }); run(); },
      onThesaurus: (d) => ctx.go('thesaurus', { w: d }),
      onAbbr: (d) => ctx.go('abbr', { q: d }),
    };
  }

  async function showInPane(display, { fromViewer = false } = {}) {
    if (fromViewer && state.paneTrail.length) {
      const at = state.paneTrail.indexOf(display);
      state.paneTrail = at >= 0 ? state.paneTrail.slice(0, at + 1) : [...state.paneTrail, display].slice(-12);
    } else {
      state.paneTrail = [display];
    }
    const seq = ++state.paneSeq;
    const page = await renderPage(display, pageCtx());
    if (seq !== state.paneSeq) return;
    addSwipe(page);
    const trail = h('nav', { class: 'trail', 'aria-label': 'Words visited' });
    if (state.paneTrail.length > 1) {
      state.paneTrail.forEach((w, n) => {
        if (n) trail.append(h('span', { class: 'sep' }, '›'));
        if (n === state.paneTrail.length - 1) trail.append(h('span', { class: 'here' }, w));
        else trail.append(h('button', { onclick: () => { state.paneTrail = state.paneTrail.slice(0, n); showInPane(w, { fromViewer: true }); } }, w));
      });
    }
    pane.replaceChildren(trail, page);
    pane.scrollTop = 0;
    root.querySelectorAll('.results .w.current').forEach(el => el.classList.remove('current'));
    root.querySelectorAll(`.results .w[data-w="${CSS.escape(display)}"]`).forEach(el => el.classList.add('current'));
  }

  function clearPane() {
    state.paneSeq++;
    pane.replaceChildren();
  }

  /** Swipe a page left or right to turn to the next or previous word. */
  function addSwipe(page) {
    let x0 = null, y0 = null;
    page.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') { x0 = e.clientX; y0 = e.clientY; } });
    page.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) {
        page.querySelector(`.rh-link[data-dir="${dx < 0 ? 'next' : 'prev'}"]`)?.click();
      }
    });
    page.addEventListener('pointercancel', () => { x0 = null; });
  }

  /* ---------- home ---------- */

  function showHome() {
    setTool(null);
    clearPane();
    const home = h('div', { class: 'home' });
    const pins = getPref('pins', []);
    if (pins.length) home.append(h('h3', { class: 'caps' }, 'Pinned'), h('div', { class: 'chips' }, pins.map(p => h('button', { class: 'chip', 'data-w': p }, p))));
    const recent = recentChips('recent', (r) => { search.set(r); syncParams(); run(); });
    if (recent) home.append(h('h3', { class: 'caps' }, 'Recent'), recent);
    home.append(h('h3', { class: 'caps' }, 'Ways to search'), h('dl', { class: 'hints' },
      hint('sailor', 'the word, its thesaurus and abbreviations'),
      hint('?a?e? ???', 'a pattern; space for a word break, - for a hyphen'),
      hint('c?y?t?c (7)', 'a pattern with an enumeration'),
      hint('ab*', '* or @ for any run of letters'),
      hint('/tinsel', 'an anagram; add ? for each unknown letter')));
    results.replaceChildren(home);
  }

  function hint(example, text) {
    const b = h('button', { class: 'hint-ex', onclick: () => { search.set(example); syncParams(); run(); search.input.focus(); } }, example);
    return [h('dt', null, b), h('dd', null, text)];
  }

  /* ---------- word lookup ---------- */

  async function runLookup(text, seq) {
    setTool(null);
    if (!text) return showHome();
    const found = await ask('lookup', { text, limit: 24 });
    if (seq !== state.seq) return;
    const exactIdx = indexOf(text);
    const main = exactIdx >= 0 ? exactIdx : found.exact[0];
    const mainDisplay = main !== undefined ? words.display[main] : null;
    const others = found.exact.filter(i => i !== main);

    const out = h('div', { class: 'lookup' });
    const strip = abbrStrip(text, (q) => ctx.go('abbr', { q }));
    if (strip) out.append(strip);

    if (mainDisplay) {
      if (isWide()) {
        showInPane(mainDisplay);
      } else {
        clearPane();
        const holder = h('div', { class: 'inline-page' });
        out.append(holder);
        renderPage(mainDisplay, pageCtx()).then(page => {
          if (seq !== state.seq) return;
          addSwipe(page);
          holder.replaceChildren(page);
        });
      }
      if (others.length) out.append(h('h3', { class: 'caps list-head' }, 'Same letters'), wordList(itemsFor(others), { showEnum: 'always' }));
    } else {
      clearPane();
      if (!strip) out.append(h('p', { class: 'note' }, `“${text}” is not in the word list.`));
    }
    if (found.prefix.length) out.append(h('h3', { class: 'caps list-head' }, 'Starting with ', h('i', null, text)), wordList(itemsFor(found.prefix), { initial: 24 }));
    results.replaceChildren(out);
    if (mainDisplay && isWide()) root.querySelectorAll(`.results .w[data-w="${CSS.escape(mainDisplay)}"]`).forEach(el => el.classList.add('current'));
  }

  /* ---------- thesaurus ---------- */

  function runThesaurus(text) {
    setTool('thesaurus', (el) => el.append(thes.controls));
    if (!results.contains(thes.el)) results.replaceChildren(thes.el);
    if (!isWide()) clearPane();
    thes.show(text, { filter: state.thes.filter, meaning: state.thes.meaning });
  }

  /* ---------- pattern ---------- */

  async function runPattern(text, seq) {
    const refs = setTool('pattern', (el, r) => {
      r.grid = h('div', { class: 'grid-holder' });
      el.append(r.grid, filterControls(toggle('Phrases', state.phrases, (v) => { state.phrases = v; setPref('phrases', v); run(); })));
    });
    const parsed = parsePattern(text);
    refs.grid.replaceChildren(parsed ? grid(parsed.shape) : '');
    if (!parsed) { results.replaceChildren(h('p', { class: 'note' }, 'Type a pattern: ? for a missing letter, * for any run.')); return; }
    const res = await ask('pattern', { text, phrases: state.phrases, proper: state.proper, maxBand: state.maxBand, subject: subjectFilter(), limit: 2000 });
    if (seq !== state.seq) return;
    if (!isWide() || !pane.childNodes.length) clearPane();
    const label = parsed.enumeration ? ` · (${state.phrases ? parsed.letterCount : parsed.enumeration})` : '';
    results.replaceChildren(
      h('div', { class: 'results-head' }, h('span', null, plural(res.total, 'word') + label),
        res.total > res.results.length ? h('span', null, `top ${res.results.length.toLocaleString('en-GB')}`) : null),
      res.total ? wordList(itemsFor(res.results), { initial: 90, showEnum: 'phrases' }) : noMatch(!parsed.hasBreaks && !state.phrases));
  }

  /* ---------- anagram ---------- */

  async function runAnagram(fodder, seq) {
    const refs = setTool('anagram', (el, r) => {
      r.tray = h('div', { class: 'tray-holder' });
      r.answer = h('div', { class: 'answer-holder' });
      r.cross = smallField({ caption: 'Crossing', placeholder: '?i????', onInput: () => run() });
      r.try = smallField({ caption: 'Try', placeholder: 'a word to test', onInput: () => updateLeftover(r) });
      r.left = h('div', { class: 'leftover', 'aria-live': 'polite' });
      el.append(r.tray, h('div', { class: 'fields' }, r.cross.el, r.try.el), r.left, filterControls(null), r.answer);
    });
    const letters = fold(fodder);
    const blanks = Math.min(2, (fodder.match(/[?.#]/g) || []).length);
    refs.trayEl = blocks(letters + '_'.repeat(blanks));
    refs.tray.replaceChildren(h('div', { class: 'caps tray-cap' }, `Fodder · ${letters.length + blanks}`), refs.trayEl);
    refs.fodder = fodder;
    updateLeftover(refs);
    if (!letters && !blanks) {
      refs.answer.replaceChildren();
      results.replaceChildren(h('p', { class: 'note' }, 'Type the letters to rearrange.'));
      return;
    }
    const res = await ask('anagram', { fodder, pattern: refs.cross.input.value, proper: state.proper, maxBand: state.maxBand, subject: subjectFilter(), limit: 2000 });
    if (seq !== state.seq) return;
    if (!res.total) {
      refs.answer.replaceChildren();
      refs.first = null;
      results.replaceChildren(h('div', { class: 'results-head' }, h('span', null, 'No anagrams')), noMatch(false));
      return;
    }
    const first = res.results[0];
    if (refs.first !== first) {
      refs.first = first;
      const shape = shapeFor(first);
      const row = grid(shape.replace(/[a-z]/g, '?'), { tried: shape.replace(/[ -]/g, ''), cls: 'answer' });
      refs.answer.replaceChildren(h('div', { class: 'caps tray-cap' }, 'Top answer'), row);
      dropInto(refs.trayEl, row);
    }
    results.replaceChildren(h('div', { class: 'results-head' }, h('span', null, plural(res.total, 'anagram'))),
      wordList(itemsFor(res.results), { initial: 90, showEnum: 'phrases' }));
  }

  function shapeFor(i) {
    const l = fold(words.display[i]);
    let out = '', pos = 0;
    for (const p of words.enumr[i].split(/([,-])/)) {
      if (p === ',') out += ' ';
      else if (p === '-') out += '-';
      else { const n = parseInt(p, 10) || 0; out += l.slice(pos, pos + n); pos += n; }
    }
    return out || l;
  }

  function updateLeftover(r) {
    const cand = r.try.input.value.trim();
    if (!cand || !r.fodder) { r.left.replaceChildren(); return; }
    const { left, needs } = leftover(r.fodder, cand);
    r.left.replaceChildren(
      h('span', null, 'Leftover ', h('b', null, left.length ? left.join('').toUpperCase() : '—')),
      needs.length ? h('span', { class: 'needs' }, '  Needs ', h('b', null, needs.join('').toUpperCase())) : null);
  }

  return {
    show(params) {
      const q = params.q || '';
      const m = MODES.includes(params.m) ? params.m : 'auto';
      const thesState = { filter: params.f || '', meaning: params.s ? (parseInt(params.s, 10) || 0) - 1 : -1 };
      if (state.shown === [q, m, thesState.filter, thesState.meaning].join('|') && search.value === q) return;
      if (m !== state.mode) {
        state.mode = m;
        modes.querySelectorAll('button').forEach((b, n) => b.setAttribute('aria-checked', String(MODES[n] === m)));
      }
      state.thes = thesState;
      search.set(q);
      run();
    },
    focus() { search.input.focus(); search.input.select(); },
    paneHandler(display, opts) {
      if (!isWide()) return false;
      showInPane(display, opts);
      return true;
    },
    onResize() { run(); },
  };
}
