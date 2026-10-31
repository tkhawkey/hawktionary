// Hawktionary: start-up, the search box and the four tools.
import { loadCore, prefetchAll, storageStatus, getPref, setPref } from './data.js';
import { buildWords, startWorker, ask, buildAbbreviations, words, indexOf } from './lexicon.js';
import { guessMode, parsePattern, leftover, band, fold } from './text.js';
import { h, isWide } from './dom.js';
import { codeBlock, termBlock } from './abbr.js';
import { renderEntry, freqBar } from './entry.js';
import { squares, dropInto } from './squares.js';
import { showInPane, clearPane, closeSheet, sheetOpen, hidePopover, setOnOpen } from './viewer.js';

const $ = (id) => document.getElementById(id);
const q = $('q');
const toolEl = $('tool');
const resultsEl = $('results');
const modeLabel = $('mode-label');

const PAGE = 100;            // results shown per "show more"
const MODE_NAMES = { lookup: 'Lookup', pattern: 'Pattern', anagram: 'Anagram' };
const BANDS = [[1, 'Common'], [2, 'Familiar'], [3, 'Uncommon'], [4, 'Rare'], [5, 'All']];

const state = {
  ready: false,
  mode: 'auto',
  phrases: getPref('phrases', false),
  maxBand: getPref('maxBand', 5),
  proper: getPref('proper', true),
  seq: 0,
  tool: null,       // which tool's controls are showing
  toolRefs: {},
  firstAnswer: null,
};

/* ---------- start-up ---------- */

async function boot() {
  wireUi();
  try {
    const core = await loadCore();
    buildWords(core.wordsText);
    buildAbbreviations(core.abbreviations);
    await startWorker(core.wordsText);
    state.version = core.version;
    state.ready = true;
    $('about-version').textContent = `Data version ${core.version} · ${words.display.length.toLocaleString('en-GB')} entries`;
    run();
    startOfflineDownload();
  } catch (err) {
    console.error(err);
    resultsEl.replaceChildren(h('p', { class: 'note' },
      'The word list could not be loaded. Check the connection and reload. ', h('small', null, String(err.message || err))));
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered', err));
  }
}

async function startOfflineDownload() {
  const status = $('offline-status');
  const done = await prefetchAll((n, total) => {
    status.textContent = n < total ? `Offline dictionary ${Math.floor((n / total) * 100)}%` : '';
  });
  status.textContent = done === false ? 'Offline dictionary incomplete' : '';
  updateStorageStatus();
}

async function updateStorageStatus() {
  const s = await storageStatus();
  const parts = [];
  if (s.total) parts.push(s.cached === s.total ? 'Full dictionary available offline.' : `Definitions downloaded: ${s.cached} of ${s.total} files.`);
  if (s.usage !== null) parts.push(`${(s.usage / 1048576).toFixed(0)} MB used on this device.`);
  if (s.persisted !== null) parts.push(s.persisted ? 'Storage is kept by the browser.' : 'The browser may clear storage if space runs low; it will be re-downloaded.');
  $('menu-storage').textContent = parts.join(' ') || 'Not available in this browser.';
}

/* ---------- search box ---------- */

let debounce = null;
let recentTimer = null;

function wireUi() {
  q.addEventListener('input', () => {
    $('clear-btn').hidden = !q.value;
    updateModeLabel();
    clearTimeout(debounce);
    debounce = setTimeout(run, 120);
    clearTimeout(recentTimer);
    recentTimer = setTimeout(() => remember(q.value), 2500);
  });
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { remember(q.value); focusResult(0); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { focusResult(0); e.preventDefault(); }
    else if (e.key === 'Escape' && q.value) { setQuery(''); e.preventDefault(); e.stopPropagation(); }
  });
  $('clear-btn').addEventListener('click', () => { setQuery(''); q.focus(); });

  for (const b of document.querySelectorAll('.modes [data-mode]')) {
    b.addEventListener('click', () => {
      state.mode = b.dataset.mode;
      updateModeTabs();
      q.focus();
      run();
    });
  }
  updateModeTabs();

  // menu and theme
  const menu = $('menu');
  const menuBtn = $('menu-btn');
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) updateStorageStatus();
  });
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('#menu')) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); }
  });
  for (const b of document.querySelectorAll('[data-theme-choice]')) {
    b.addEventListener('click', () => setTheme(b.dataset.themeChoice));
  }
  setTheme(getPref('theme', 'system'));

  const about = $('about');
  $('about-btn').addEventListener('click', () => { menu.hidden = true; about.showModal(); });
  $('about-close').addEventListener('click', () => about.close());
  about.addEventListener('click', (e) => { if (e.target === about) about.close(); });

  document.addEventListener('keydown', globalKeys);
  setOnOpen((display) => remember(q.value));
  matchMedia('(min-width: 900px)').addEventListener('change', () => run());
}

function setTheme(choice) {
  setPref('theme', choice);
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  for (const b of document.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice));
}

function setQuery(text) {
  q.value = text;
  $('clear-btn').hidden = !text;
  updateModeLabel();
  run();
}

function currentMode() {
  return state.mode === 'auto' ? guessMode(q.value) : (q.value.trim() ? state.mode : null);
}

function updateModeLabel() {
  const m = currentMode();
  modeLabel.textContent = m ? MODE_NAMES[m] : '';
}

function updateModeTabs() {
  for (const b of document.querySelectorAll('.modes [data-mode]')) b.setAttribute('aria-selected', String(b.dataset.mode === state.mode));
  updateModeLabel();
}

function remember(text) {
  const t = text.trim();
  if (t.length < 2) return;
  let recent = getPref('recent', []).filter(r => r !== t);
  recent = [t, ...recent].slice(0, 15);
  setPref('recent', recent);
}

/* ---------- keyboard ---------- */

function navItems() {
  return [...resultsEl.querySelectorAll('[data-nav]')];
}

function focusResult(n) {
  const items = navItems();
  if (items[n]) items[n].focus();
}

function globalKeys(e) {
  const typing = e.target.matches('input, textarea') || e.target.isContentEditable;
  if (e.key === '/' && !typing && !$('about').open) {
    e.preventDefault();
    q.focus();
    q.select();
    return;
  }
  if (e.key === 'Escape') {
    hidePopover();
    if (sheetOpen()) { closeSheet(); return; }
    if (!$('menu').hidden) { $('menu').hidden = true; return; }
    if (!typing) q.focus();
    return;
  }
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && e.target.matches('[data-nav]')) {
    const items = navItems();
    const i = items.indexOf(e.target);
    const next = e.key === 'ArrowDown' ? i + 1 : i - 1;
    if (next < 0) q.focus();
    else if (items[next]) items[next].focus();
    e.preventDefault();
  }
}

/* ---------- running a search ---------- */

function run() {
  if (!state.ready) return;
  const seq = ++state.seq;
  const text = q.value;
  const mode = currentMode();
  updateModeLabel();
  if (!mode) return showHome();
  if (mode === 'pattern') return runPattern(text, seq);
  if (mode === 'anagram') return runAnagram(text.trim().replace(/^\//, ''), seq);
  return runLookup(text.trim().replace(/^\//, ''), seq);
}

function setTool(name, build) {
  if (state.tool === name) return state.toolRefs;
  state.tool = name;
  state.firstAnswer = null;
  state.toolRefs = {};
  toolEl.replaceChildren();
  if (build) build(toolEl, state.toolRefs);
  return state.toolRefs;
}

/** Shared filters: frequency band and proper nouns. */
function filterControls(extra) {
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Frequency' });
  for (const [b, label] of BANDS) {
    const btn = h('button', { 'aria-pressed': String(state.maxBand === b), title: b === 5 ? 'All words' : `${label} words and more common` }, label);
    btn.addEventListener('click', () => {
      state.maxBand = b;
      setPref('maxBand', b);
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === btn)));
      run();
    });
    seg.append(btn);
  }
  const properToggle = toggle('Proper nouns', state.proper, (v) => { state.proper = v; setPref('proper', v); run(); });
  return h('div', { class: 'controls' }, extra, seg, properToggle);
}

function toggle(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle' }, input, label);
}

/** A list of result rows, with "show more". */
function resultList(indices, { startIndex = 0, current = null } = {}) {
  const ul = h('ul', { class: 'result-list' });
  indices.forEach((i, n) => ul.append(resultRow(i, startIndex + n, current)));
  return ul;
}

function resultRow(i, n, current) {
  const d = words.display[i];
  const z = words.zipf[i];
  const b = band(z);
  const cls = ['result', 'rise', b === 5 ? 'obscure' : '', words.proper[i] ? 'proper' : '', d === current ? 'current' : ''].filter(Boolean).join(' ');
  const delay = n % PAGE;
  return h('li', null, h('button', { class: cls, 'data-w': d, 'data-nav': '', style: { '--i': delay } },
    h('span', { class: 'rw' }, d),
    h('span', { class: 're' }, `(${words.enumr[i]})`),
    freqBar(z, delay)));
}

function resultsBlock(label, res, { current = null } = {}) {
  const frag = h('div');
  const shownCount = Math.min(res.results.length, PAGE);
  const head = h('div', { class: 'results-head' },
    h('span', null, label),
    h('span', null, res.total > res.results.length ? `top ${res.results.length.toLocaleString('en-GB')} of ${res.total.toLocaleString('en-GB')}` : ''));
  const list = resultList(res.results.slice(0, shownCount), { current });
  frag.append(head, list);
  let shown = shownCount;
  if (res.results.length > shown) {
    const more = h('button', { class: 'more-btn' });
    const label2 = () => { more.textContent = `Show ${Math.min(PAGE, res.results.length - shown)} more`; };
    label2();
    more.addEventListener('click', () => {
      const next = res.results.slice(shown, shown + PAGE);
      next.forEach((i, n) => list.append(resultRow(i, n, current)));
      shown += next.length;
      if (shown >= res.results.length) more.remove(); else label2();
    });
    frag.append(more);
  }
  return frag;
}

function noMatchHint(suggestPhrases) {
  const tips = [];
  if (suggestPhrases) tips.push('turn on “Include phrases”');
  if (state.maxBand < 5) tips.push('choose “All” frequencies');
  if (!state.proper) tips.push('include proper nouns');
  return tips.length ? `Try: ${tips.join(', ')}.` : 'Nothing in the word list fits.';
}

function plural(n, word) {
  return `${n.toLocaleString('en-GB')} ${word}${n === 1 ? '' : (word.endsWith('h') ? 'es' : 's')}`;
}

/* ---------- home (empty box) ---------- */

function showHome() {
  setTool(null);
  clearPane();
  const home = h('div', { class: 'home' });
  const pins = getPref('pins', []);
  const recent = getPref('recent', []);
  if (pins.length) {
    home.append(h('h3', null, 'Pinned'), h('div', { class: 'chips' }, pins.map(p => h('button', { class: 'chip', 'data-w': p }, p))));
  }
  if (recent.length) {
    const chips = h('div', { class: 'chips' });
    for (const r of recent) {
      const c = h('button', { class: 'chip' }, r);
      c.addEventListener('click', () => { setQuery(r); q.focus(); });
      chips.append(c);
    }
    home.append(h('h3', null, 'Recent searches'), chips);
  }
  home.append(h('h3', null, 'How to search'), h('ul', { class: 'hints' },
    hint('sailor', 'definitions, thesaurus and abbreviations'),
    hint('S', 'what an abbreviation can stand for'),
    hint('?a?e? ???', 'pattern; space = word break, - = hyphen'),
    hint('c?y?t?c (7)', 'pattern with an enumeration'),
    hint('ab*', '* or @ = any run of letters'),
    hint('/tinsel', 'anagram; add ? for an unknown letter')));
  resultsEl.replaceChildren(home);
}

function hint(example, text) {
  const b = h('code', null, example);
  const li = h('li', null, b, h('span', null, text));
  li.style.cursor = 'pointer';
  li.addEventListener('click', () => { setQuery(example); q.focus(); });
  return li;
}

/* ---------- pattern ---------- */

async function runPattern(text, seq) {
  const refs = setTool('pattern', (el, r) => {
    r.squares = h('div');
    const phrases = toggle('Include phrases', state.phrases, (v) => { state.phrases = v; setPref('phrases', v); run(); });
    el.append(r.squares, filterControls(phrases));
  });
  const parsed = parsePattern(text);
  refs.squares.replaceChildren(parsed ? squares(parsed.shape) : '');
  clearPane();
  if (!parsed) { resultsEl.replaceChildren(h('p', { class: 'note' }, 'Type a pattern: ? for a missing letter, * for any run.')); return; }
  const res = await ask('pattern', { text, phrases: state.phrases, proper: state.proper, maxBand: state.maxBand, limit: 1000 });
  if (seq !== state.seq) return;
  const label = plural(res.total, 'match') + (parsed.enumeration ? ` · (${state.phrases ? parsed.letterCount : parsed.enumeration})` : '');
  if (!res.total) {
    resultsEl.replaceChildren(h('div', { class: 'results-head' }, h('span', null, 'No matches')),
      h('p', { class: 'note' }, noMatchHint(!parsed.hasBreaks && !state.phrases)));
    return;
  }
  resultsEl.replaceChildren(resultsBlock(label, res));
}

/* ---------- anagram ---------- */

async function runAnagram(fodder, seq) {
  const refs = setTool('anagram', (el, r) => {
    r.fodder = h('div');
    r.answer = h('div');
    r.pattern = h('input', { type: 'text', placeholder: '?i????', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Crossing letters pattern' });
    r.pattern.addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(run, 120); });
    r.try = h('input', { type: 'text', placeholder: 'a word to test', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Leftover letters: try a word' });
    r.left = h('div', { class: 'leftover', 'aria-live': 'polite' });
    r.try.addEventListener('input', () => updateLeftover(r));
    el.append(r.fodder,
      filterControls(null),
      h('div', { class: 'controls' },
        h('div', { class: 'field' }, h('label', null, 'Crossing'), r.pattern),
        h('div', { class: 'field' }, h('label', null, 'Try'), r.try)),
      r.left,
      r.answer);
  });
  const letters = fold(fodder);
  const blanks = Math.min(2, (fodder.match(/[?.#]/g) || []).length);
  refs.fodderRow = squares(letters + '_'.repeat(blanks));
  refs.fodder.replaceChildren(h('div', { class: 'squares-label' }, `Fodder · ${letters.length + blanks} letters`), refs.fodderRow);
  refs.fodderText = fodder;
  updateLeftover(refs);
  clearPane();
  if (!letters && !blanks) {
    refs.answer.replaceChildren();
    resultsEl.replaceChildren(h('p', { class: 'note' }, 'Type the letters to rearrange.'));
    return;
  }
  const res = await ask('anagram', { fodder, pattern: refs.pattern.value, proper: state.proper, maxBand: state.maxBand, limit: 1000 });
  if (seq !== state.seq) return;
  if (!res.total) {
    refs.answer.replaceChildren();
    state.firstAnswer = null;
    resultsEl.replaceChildren(h('div', { class: 'results-head' }, h('span', null, 'No anagrams')),
      h('p', { class: 'note' }, blanks ? noMatchHint(false) : 'Try adding ? for an unknown letter. ' + (state.maxBand < 5 || !state.proper ? noMatchHint(false) : '')));
    return;
  }
  const first = res.results[0];
  if (state.firstAnswer !== first) {
    state.firstAnswer = first;
    const shape = shapeFor(first);
    const row = squares(shape, 'answer');
    refs.answer.replaceChildren(h('div', { class: 'squares-label' }, 'Top answer'), row);
    dropInto(refs.fodderRow, row);
  }
  resultsEl.replaceChildren(resultsBlock(plural(res.total, 'anagram'), res));
}

function shapeFor(i) {
  const l = fold(words.display[i]);
  const e = words.enumr[i];
  let out = '', pos = 0;
  for (const p of e.split(/([,-])/)) {
    if (p === ',') out += ' ';
    else if (p === '-') out += '-';
    else { const n = parseInt(p, 10) || 0; out += l.slice(pos, pos + n); pos += n; }
  }
  return out || l;
}

function updateLeftover(r) {
  const cand = r.try.value.trim();
  if (!cand || !r.fodderText) { r.left.replaceChildren(); return; }
  const { left, needs } = leftover(r.fodderText, cand);
  r.left.replaceChildren(
    h('span', null, 'Leftover: ', h('b', null, left.length ? left.join('').toUpperCase() : 'none')),
    needs.length ? h('span', { class: 'needs' }, ' · Needs: ', h('b', null, needs.join('').toUpperCase())) : null);
}

/* ---------- lookup: abbreviations + dictionary ---------- */

async function runLookup(text, seq) {
  setTool(null);
  if (!text) return showHome();
  const blocks = [];
  const code = text.replace(/\s+/g, '');
  if (code.length <= 8) { const b = codeBlock(code); if (b) blocks.push(b); }
  const tb = termBlock(text);
  if (tb) blocks.push(tb);

  const found = await ask('lookup', { text, limit: 12 });
  if (seq !== state.seq) return;
  const exactIdx = indexOf(text);
  const main = exactIdx >= 0 ? exactIdx : found.exact[0];
  const mainDisplay = main !== undefined ? words.display[main] : null;
  const others = found.exact.filter(i => i !== main);

  const out = h('div');
  blocks.forEach((b, n) => { b.classList.add('rise'); b.style.setProperty('--i', n); out.append(b); });

  if (mainDisplay) {
    if (isWide()) {
      out.append(resultsBlock('Entry', { total: 1 + others.length, results: [main, ...others] }, { current: mainDisplay }));
      showInPane(mainDisplay);
    } else {
      const entryHolder = h('div', { class: 'inline-entry' });
      out.append(entryHolder);
      renderEntry(mainDisplay).then(el => { if (seq === state.seq) entryHolder.replaceChildren(el); });
      if (others.length) out.append(resultsBlock('Same letters', { total: others.length, results: others }));
    }
  } else {
    clearPane();
    if (!blocks.length) out.append(h('p', { class: 'note' }, `“${text}” is not in the word list.`));
  }
  if (found.prefix.length) out.append(resultsBlock('Starts with', { total: found.prefix.length, results: found.prefix }));
  resultsEl.replaceChildren(out);
}

boot();
