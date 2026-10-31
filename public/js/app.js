// Hawktionary: start-up, the four modules and moving between them.
import { loadCore, prefetchAll, storageStatus, getPref, setPref } from './data.js';
import { buildWords, startWorker, ask, buildAbbreviations, words } from './lexicon.js';
import { h, isWide } from './dom.js';
import { setPaneHandler, setLinks, closeSheet, sheetOpen, hidePopover } from './viewer.js';
import { createDictionary } from './modules/dictionary.js';
import { createThesaurus } from './modules/thesaurus.js';
import { createAbbreviations } from './modules/abbreviations.js';
import { createSolve } from './modules/solve.js';

const $ = (id) => document.getElementById(id);

const MODULES = {
  dictionary: { el: 'mod-dictionary', title: 'The Dictionary', create: createDictionary },
  thesaurus: { el: 'mod-thesaurus', title: 'The Thesaurus', create: createThesaurus },
  abbr: { el: 'mod-abbr', title: 'Abbreviations', create: createAbbreviations },
  solve: { el: 'mod-solve', title: 'Solve', create: createSolve },
};
const instances = {};
const lastParams = {};   // each module's address, so switching tabs returns to it
let current = null;

/* ---------- routing: #/module?key=value ---------- */

function parseHash() {
  const m = /^#\/(\w*)(?:\?(.*))?$/.exec(location.hash);
  const module = m && MODULES[m[1]] ? m[1] : 'dictionary';
  const params = Object.fromEntries(new URLSearchParams(m?.[2] || ''));
  return { module, params };
}

function hashFor(module, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== null && v !== undefined && v !== '')).toString();
  return `#/${module}${qs ? '?' + qs : ''}`;
}

/** Go to a module (adds a history step, so Back returns). */
function go(module, params = {}) {
  // leaving from the sheet: take over its history step, so one Back returns to the page underneath
  const fromSheet = !!history.state?.sheet;
  closeSheet(true);
  const url = hashFor(module, params);
  if (fromSheet) history.replaceState({}, '', url);
  else if (url !== location.hash) history.pushState({}, '', url);
  route();
}

/** Update the current module's address without adding a history step (used while typing). */
function setParams(module, params) {
  if (current !== module) return;
  lastParams[module] = params;
  const url = hashFor(module, params);
  if (url !== location.hash) history.replaceState(history.state, '', url);
}

function route() {
  const { module, params } = parseHash();
  lastParams[module] = params;
  activate(module);
  instances[module].show(params);
}

function activate(module) {
  if (current === module) return;
  current = module;
  for (const [name, m] of Object.entries(MODULES)) $(m.el).hidden = name !== module;
  document.body.dataset.module = module;
  $('mast-section').textContent = MODULES[module].title;
  for (const t of document.querySelectorAll('.tab')) t.setAttribute('aria-selected', String(t.dataset.go === module));
  const inst = instances[module];
  setPaneHandler(inst.paneHandler ? (d, o) => inst.paneHandler(d, o) : null);
  hidePopover();
  window.scrollTo(0, 0);
}

/* ---------- start-up ---------- */

async function boot() {
  wireShell();
  try {
    const core = await loadCore();
    buildWords(core.wordsText);
    buildAbbreviations(core.abbreviations);
    startWorker(core.wordsText);   // queries wait for it in order; no need to block the page
    for (const [name, m] of Object.entries(MODULES)) {
      instances[name] = m.create($(m.el), {
        go,
        setParams: (params) => setParams(name, params),
      });
    }
    setLinks({
      dictionary: (d) => go('dictionary', { q: d }),
      thesaurus: (d) => go('thesaurus', { w: d }),
      abbr: (q) => go('abbr', { q }),
    });
    $('about-version').textContent = `Data version ${core.version} · ${words.display.length.toLocaleString('en-GB')} entries`;
    route();
    $('boot').classList.add('gone');
    setTimeout(() => $('boot').remove(), 600);
    // build the anagram index and alphabetical order once things are quiet
    setTimeout(() => ask('warm'), 1200);
    startOfflineDownload();
  } catch (err) {
    console.error(err);
    $('boot').replaceChildren(h('span', { class: 'boot-text' }, 'The word list could not be loaded. Check the connection and reload.'));
  }
  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // during local development the cache would hide edits; add ?sw to test offline locally
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && !location.search.includes('sw');
  if (local) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker not registered', err));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    const t = $('toast');
    t.replaceChildren(h('span', null, 'A new version is ready.'), h('button', { onclick: () => location.reload() }, 'Reload'));
    t.hidden = false;
  });
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
  if (s.total) parts.push(s.cached === s.total ? 'The full dictionary is available offline.' : `Definitions downloaded: ${s.cached} of ${s.total} files.`);
  if (s.usage !== null) parts.push(`${(s.usage / 1048576).toFixed(0)} MB used on this device.`);
  if (s.persisted !== null) parts.push(s.persisted ? 'The browser will keep it.' : 'If space runs low the browser may clear it; it will download again.');
  $('menu-storage').textContent = parts.join(' ') || 'Not available in this browser.';
}

/* ---------- shell: tabs, menu, theme, keys ---------- */

function wireShell() {
  for (const t of document.querySelectorAll('.tab')) {
    t.addEventListener('click', () => {
      const name = t.dataset.go;
      if (name === current) { instances[name]?.focus(); return; }
      // return to where you were in that module
      go(name, lastParams[name] || {});
    });
  }
  window.addEventListener('popstate', () => { if (!history.state?.sheet && instances.dictionary) route(); });
  window.addEventListener('hashchange', () => { if (instances.dictionary) route(); });

  const menu = $('menu');
  const toggleMenu = (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    $('menu-btn').setAttribute('aria-expanded', String(!menu.hidden));
    if (!menu.hidden) updateStorageStatus();
  };
  $('menu-btn').addEventListener('click', toggleMenu);
  $('rail-menu-btn').addEventListener('click', toggleMenu);
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !e.target.closest('#menu')) { menu.hidden = true; $('menu-btn').setAttribute('aria-expanded', 'false'); }
  });
  for (const b of document.querySelectorAll('[data-theme-choice]')) b.addEventListener('click', () => setTheme(b.dataset.themeChoice));
  setTheme(getPref('theme', 'system'));

  const about = $('about');
  $('about-btn').addEventListener('click', () => { menu.hidden = true; about.showModal(); });
  $('about-close').addEventListener('click', () => about.close());
  about.addEventListener('click', (e) => { if (e.target === about) about.close(); });

  document.addEventListener('keydown', globalKeys);
  let wasWide = isWide();
  matchMedia('(min-width: 900px)').addEventListener('change', () => {
    if (isWide() !== wasWide) { wasWide = isWide(); instances[current]?.onResize?.(); }
  });
}

function setTheme(choice) {
  setPref('theme', choice);
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  for (const b of document.querySelectorAll('[data-theme-choice]')) b.setAttribute('aria-checked', String(b.dataset.themeChoice === choice));
}

function globalKeys(e) {
  const typing = e.target.matches('input, textarea') || e.target.isContentEditable;
  if (e.key === '/' && !typing && !$('about').open) {
    e.preventDefault();
    instances[current]?.focus();
    return;
  }
  if (e.key === 'Escape') {
    hidePopover();
    if (sheetOpen()) { closeSheet(); return; }
    if (!$('menu').hidden) { $('menu').hidden = true; return; }
    if (!typing) instances[current]?.focus();
    return;
  }
  const mod = $(MODULES[current]?.el);
  if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && mod) {
    const items = [...mod.querySelectorAll('[data-nav]')].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    if (typing && e.key === 'ArrowDown' && e.target.closest('.search')) { items[0].focus(); e.preventDefault(); return; }
    const i = items.indexOf(document.activeElement);
    if (i < 0) return;
    const next = items[i + (e.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus(); else if (e.key === 'ArrowUp') mod.querySelector('.search input')?.focus();
    e.preventDefault();
  }
  // turn the dictionary page with the arrow keys
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !typing && current === 'dictionary') {
    const link = document.querySelector(`#mod-dictionary .page .rh-link[data-dir="${e.key === 'ArrowLeft' ? 'prev' : 'next'}"]`);
    if (link) { link.click(); e.preventDefault(); }
  }
}

boot();
