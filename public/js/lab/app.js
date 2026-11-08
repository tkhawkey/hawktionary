// Hawktionary, new layout (lab.html): one search in the middle with cards around it,
// and a clue workspace. Shares the data, search worker and entry pages with the classic
// layout (index.html), which stays as it is.
//   #/?q=word          Search (the hub)
//   #/clue?c=…&e=…     Clue workspace
import { loadCore, prefetchAll } from '../data.js';
import { buildWords, startWorker, ask, buildAbbreviations, buildCategories, buildTags, clueData } from '../lexicon.js';
import { h } from '../dom.js';
import { setPaneHandler, setLinks, closeSheet, sheetOpen, hidePopover } from '../viewer.js';
import { createHub } from './hub.js';
import { createClue } from './clue.js';

const $ = (id) => document.getElementById(id);
const MODES = { hub: 'mode-hub', clue: 'mode-clue' };
const instances = {};
const lastParams = { hub: {}, clue: {} };
let current = null;

function parseHash() {
  const m = /^#\/(\w*)(?:\?(.*))?$/.exec(location.hash);
  const mode = m?.[1] === 'clue' ? 'clue' : 'hub';
  return { mode, params: Object.fromEntries(new URLSearchParams(m?.[2] || '')) };
}

function hashFor(mode, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')).toString();
  return `#/${mode === 'clue' ? 'clue' : ''}${qs ? '?' + qs : ''}`;
}

function go(mode, params = {}) {
  const fromSheet = !!history.state?.sheet;
  closeSheet(true);
  const url = hashFor(mode, params);
  if (fromSheet) history.replaceState({}, '', url);
  else if (url !== location.hash) history.pushState({}, '', url);
  route();
}

function setParams(mode, params) {
  if (current !== mode) return;
  lastParams[mode] = params;
  const url = hashFor(mode, params);
  if (url !== location.hash) history.replaceState(history.state, '', url);
}

function route() {
  const { mode, params } = parseHash();
  lastParams[mode] = params;
  activate(mode);
  instances[mode].show(params);
}

function activate(mode) {
  if (current === mode) return;
  current = mode;
  for (const [name, id] of Object.entries(MODES)) $(id).hidden = name !== mode;
  document.body.dataset.mode = mode;
  document.body.dataset.module = mode === 'clue' ? 'solve' : 'dictionary';
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === mode));
  const inst = instances[mode];
  setPaneHandler(inst.paneHandler ? (d, o) => inst.paneHandler(d, o) : null);
  hidePopover();
}

async function boot() {
  for (const b of document.querySelectorAll('[data-mode]')) {
    b.addEventListener('click', () => {
      if (b.dataset.mode === current) { instances[current]?.focus(); return; }
      go(b.dataset.mode, lastParams[b.dataset.mode] || {});
    });
  }
  window.addEventListener('popstate', () => { if (!history.state?.sheet && instances.hub) route(); });
  window.addEventListener('hashchange', () => { if (instances.hub) route(); });
  document.addEventListener('keydown', (e) => {
    const typing = e.target.matches('input, textarea') || e.target.isContentEditable;
    if (e.key === '/' && !typing) { e.preventDefault(); instances[current]?.focus(); }
    if (e.key === 'Escape') { hidePopover(); if (sheetOpen()) closeSheet(); }
  });
  try {
    const core = await loadCore();
    buildWords(core.wordsText);
    buildAbbreviations(core.abbreviations);
    buildCategories(core.categories);
    buildTags(core.tags);
    clueData.indicators = core.indicators;
    clueData.charades = core.charades;
    startWorker(core.wordsText);
    const ctx = (name) => ({ go, setParams: (p) => setParams(name, p) });
    instances.hub = createHub($('mode-hub'), ctx('hub'));
    instances.clue = createClue($('mode-clue'), ctx('clue'));
    setLinks({
      dictionary: (d) => go('hub', { q: d }),
      thesaurus: (d) => go('hub', { q: d, v: 'thes' }),
      abbr: (q) => { location.href = 'index.html#/abbr?q=' + encodeURIComponent(q); },
    });
    route();
    $('boot').classList.add('gone');
    setTimeout(() => $('boot').remove(), 600);
    setTimeout(() => ask('warm'), 800);
    const status = $('offline-status');
    prefetchAll((n, total) => { status.textContent = n < total ? `Offline dictionary ${Math.floor((n / total) * 100)}%` : ''; })
      .then(done => { status.textContent = done === false ? 'Offline dictionary incomplete' : ''; });
  } catch (err) {
    console.error(err);
    $('boot').replaceChildren(h('span', { class: 'boot-text' }, 'The word list could not be loaded. Check the connection and reload.'));
  }
  // the classic page registers the service worker; it covers this page too
  if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

boot();
