// Showing a word's entry from anywhere: the Dictionary's page pane on wide screens,
// otherwise a bottom sheet; a hover popover on PC.
import { renderPage, renderPreview } from './entry.js';
import { h, canHover, token } from './dom.js';

const sheet = document.getElementById('sheet');
const sheetBody = document.getElementById('sheet-body');
const sheetTrail = document.getElementById('sheet-trail');
const scrim = document.getElementById('scrim');
const popover = document.getElementById('popover');

let trail = [];
let renderSeq = 0;
let paneHandler = null;   // (display, {fromViewer}) → true if the current module shows it itself
let links = {};           // { dictionary(display), thesaurus(display), abbr(term) }
let onOpen = () => {};

export function setPaneHandler(fn) { paneHandler = fn; }
export function setLinks(l) { links = l; }
export function setOnOpen(fn) { onOpen = fn; }

/** Open a word's entry. From inside the sheet it extends the back-trail. */
export async function openEntry(display, { fromViewer = false } = {}) {
  hidePopover();
  onOpen(display);
  if (!fromViewer || sheet.hidden) {
    if (paneHandler && paneHandler(display, { fromViewer })) return;
  }
  if (fromViewer && trail.length && !sheet.hidden) {
    const at = trail.indexOf(display);
    trail = at >= 0 ? trail.slice(0, at + 1) : [...trail, display].slice(-12);
  } else {
    trail = [display];
  }
  await show();
}

function goTo(n) {
  trail = trail.slice(0, n + 1);
  show();
}

function trailNav(el) {
  el.replaceChildren();
  trail.forEach((w, n) => {
    if (n) el.append(h('span', { class: 'sep', 'aria-hidden': 'true' }, '›'));
    if (n === trail.length - 1) el.append(h('span', { class: 'here', 'aria-current': 'page' }, w));
    else el.append(h('button', { onclick: () => goTo(n) }, w));
  });
}

async function show() {
  const seq = ++renderSeq;
  const display = trail[trail.length - 1];
  const page = await renderPage(display, {
    compact: true,
    onThesaurus: links.thesaurus ? (d) => { closeSheet(true); links.thesaurus(d); } : null,
    onAbbr: links.abbr ? (d) => { closeSheet(true); links.abbr(d); } : null,
  });
  if (seq !== renderSeq) return;
  const actions = h('div', { class: 'sheet-actions' });
  if (links.dictionary) actions.append(h('button', { class: 'btn', onclick: () => { closeSheet(true); links.dictionary(display); } }, 'Open in Dictionary'));
  trailNav(sheetTrail);
  sheetBody.replaceChildren(page, actions);
  sheetBody.scrollTop = 0;
  openSheet();
}

/* ---------- bottom sheet ---------- */

function openSheet() {
  if (!sheet.hidden) return;
  sheet.classList.remove('closing');
  sheet.hidden = false;
  scrim.hidden = false;
  document.body.classList.add('sheet-open');
  history.pushState({ ...(history.state || {}), sheet: true }, '');
  document.getElementById('sheet-close').focus({ preventScroll: true });
}

export function sheetOpen() { return !sheet.hidden; }

export function closeSheet(instant = false, fromPop = false) {
  if (sheet.hidden) return;
  if (instant) {
    // used when moving on to another view: drop the sheet's history step in place
    if (history.state?.sheet) history.replaceState({ ...history.state, sheet: false }, '');
    return finishClose();
  }
  if (!fromPop && history.state?.sheet) {
    // let the back step close it, so Android's back button and ours agree
    history.back();
    return;
  }
  sheet.classList.add('closing');
  setTimeout(finishClose, token('--dur-med') || 260);
}

function finishClose() {
  sheet.hidden = true;
  scrim.hidden = true;
  sheet.classList.remove('closing');
  sheet.style.transform = '';
  document.body.classList.remove('sheet-open');
}

window.addEventListener('popstate', () => { if (!history.state?.sheet) closeSheet(false, true); });
scrim.addEventListener('click', () => closeSheet());
document.getElementById('sheet-close').addEventListener('click', () => closeSheet());

// drag the handle down to close
{
  const handle = document.getElementById('sheet-handle');
  let startY = null;
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    sheet.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
  });
  const end = (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (dy > 80) closeSheet(); else sheet.style.transform = '';
  };
  handle.addEventListener('pointerup', end);
  handle.addEventListener('pointercancel', end);
}

/* ---------- hover popover (PC) ---------- */

let hoverTimer = null;
let hideTimer = null;
let hoverEl = null;

export function hidePopover() {
  clearTimeout(hoverTimer);
  clearTimeout(hideTimer);
  hoverEl = null;
  popover.hidden = true;
}

async function showPopover(el) {
  const display = el.dataset.w;
  const content = await renderPreview(display);
  if (hoverEl !== el) return;
  const open = h('button', { class: 'open' }, 'Open entry ›');
  open.addEventListener('click', () => openEntry(display, { fromViewer: !!el.closest('#sheet') }));
  popover.replaceChildren(content, open);
  popover.hidden = false;
  const r = el.getBoundingClientRect();
  const pw = popover.offsetWidth, ph = popover.offsetHeight;
  const left = Math.min(Math.max(8, r.left), innerWidth - pw - 8);
  let top = r.bottom + 6;
  let origin = 'top left';
  if (top + ph > innerHeight - 8) { top = r.top - ph - 6; origin = 'bottom left'; }
  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
  popover.style.transformOrigin = origin;
}

document.addEventListener('pointerover', (e) => {
  if (e.pointerType !== 'mouse' || !canHover()) return;
  if (e.target.closest('#popover')) { clearTimeout(hideTimer); return; }
  const el = e.target.closest('[data-w]');
  if (!el || el === hoverEl || el.closest('[data-no-preview]')) return;
  clearTimeout(hoverTimer);
  hoverEl = el;
  const delay = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hover-delay')) || 300;
  hoverTimer = setTimeout(() => showPopover(el), delay);
});

document.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse') return;
  if (!e.target.closest('[data-w], #popover')) return;
  const to = e.relatedTarget;
  if (to && (to.closest?.('#popover') || to.closest?.('[data-w]') === hoverEl)) return;
  clearTimeout(hoverTimer);
  hideTimer = setTimeout(hidePopover, 150);
});

/* ---------- any word anywhere opens its entry ---------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-w]');
  if (!el || el.closest('#popover') || el.closest('[data-own-click]')) return;
  e.preventDefault();
  openEntry(el.dataset.w, { fromViewer: !!el.closest('#sheet, .page-pane') });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('span[data-w]')) {
    e.preventDefault();
    e.target.click();
  }
});
