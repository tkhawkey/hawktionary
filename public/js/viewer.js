// Showing entries: side pane on wide screens, bottom sheet on phones, hover popover on PC.
import { renderEntry, renderPreview } from './entry.js';
import { h, isWide, canHover, token } from './dom.js';

const detail = document.getElementById('detail');
const sheet = document.getElementById('sheet');
const sheetBody = document.getElementById('sheet-body');
const sheetTrail = document.getElementById('sheet-trail');
const scrim = document.getElementById('scrim');
const popover = document.getElementById('popover');

let trail = [];          // displays visited, last = current
let onOpen = () => {};   // app hook: remember recent words
let renderSeq = 0;

export function setOnOpen(fn) { onOpen = fn; }

/**
 * Open an entry. If it was opened from inside the sheet or pane, it extends the back-trail;
 * otherwise it starts a new one. target: 'auto' | 'pane'
 */
export async function openEntry(display, { fromViewer = false, target = 'auto' } = {}) {
  hidePopover();
  if (fromViewer && trail.length) {
    const at = trail.indexOf(display);
    trail = at >= 0 ? trail.slice(0, at + 1) : [...trail, display].slice(-12);
  } else {
    trail = [display];
  }
  onOpen(display);
  await show();
  return true;
}

function goTo(n) {
  trail = trail.slice(0, n + 1);
  show();
}

function trailNav(el) {
  el.replaceChildren();
  if (trail.length < 2) return;
  trail.forEach((w, n) => {
    if (n) el.append(h('span', { class: 'sep', 'aria-hidden': 'true' }, '›'));
    if (n === trail.length - 1) el.append(h('span', { class: 'here', 'aria-current': 'page' }, w));
    else el.append(h('button', { onclick: () => goTo(n) }, w));
  });
}

async function show() {
  const seq = ++renderSeq;
  const display = trail[trail.length - 1];
  const entry = await renderEntry(display);
  if (seq !== renderSeq) return;
  if (isWide()) {
    closeSheet(true);
    const bar = h('div', { class: 'detail-bar' }, h('nav', { class: 'trail', 'aria-label': 'Words visited' }));
    trailNav(bar.firstChild);
    detail.replaceChildren(trail.length > 1 ? bar : '', entry);
    detail.scrollTop = 0;
  } else {
    trailNav(sheetTrail);
    sheetBody.replaceChildren(entry);
    sheetBody.scrollTop = 0;
    openSheet();
  }
}

/** Put an entry straight in the side pane (lookup results on wide screens). */
export async function showInPane(display) {
  trail = [display];
  const seq = ++renderSeq;
  const entry = await renderEntry(display);
  if (seq !== renderSeq) return;
  detail.replaceChildren(entry);
  detail.scrollTop = 0;
}

export function clearPane() {
  renderSeq++;
  detail.replaceChildren();
}

export function currentDisplay() {
  return trail[trail.length - 1] || null;
}

/* ---------- bottom sheet ---------- */

function openSheet() {
  if (!sheet.hidden) return;
  sheet.classList.remove('closing');
  sheet.hidden = false;
  scrim.hidden = false;
  document.body.style.overflow = 'hidden';
  history.pushState({ sheet: true }, '');
  document.getElementById('sheet-close').focus({ preventScroll: true });
}

export function sheetOpen() { return !sheet.hidden; }

export function closeSheet(instant = false, fromPop = false) {
  if (sheet.hidden) return;
  if (!fromPop && history.state?.sheet) {
    history.back();      // popstate will close it
    return;
  }
  const done = () => {
    sheet.hidden = true;
    scrim.hidden = true;
    sheet.classList.remove('closing');
    sheet.style.transform = '';
    document.body.style.overflow = '';
  };
  if (instant) return done();
  sheet.classList.add('closing');
  setTimeout(done, token('--dur-med') || 260);
}

window.addEventListener('popstate', () => closeSheet(false, true));
scrim.addEventListener('click', () => closeSheet());
document.getElementById('sheet-close').addEventListener('click', () => closeSheet());

// drag the handle down to close
{
  const handle = document.getElementById('sheet-handle');
  let startY = null;
  handle.addEventListener('pointerdown', (e) => { startY = e.clientY; handle.setPointerCapture(e.pointerId); });
  handle.addEventListener('pointermove', (e) => {
    if (startY === null) return;
    const dy = Math.max(0, e.clientY - startY);
    sheet.style.transform = `translateY(${dy}px)`;
  });
  const end = (e) => {
    if (startY === null) return;
    const dy = e.clientY - startY;
    startY = null;
    if (dy > 80) closeSheet();
    else sheet.style.transform = '';
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
  const open = h('button', { class: 'open' }, 'Open entry →');
  open.addEventListener('click', () => openEntry(display, { fromViewer: !!el.closest('#sheet, #detail') }));
  popover.replaceChildren(content, open);
  popover.hidden = false;
  const r = el.getBoundingClientRect();
  const pw = popover.offsetWidth, ph = popover.offsetHeight;
  let left = Math.min(Math.max(8, r.left), innerWidth - pw - 8);
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
  if (!el || el === hoverEl) return;
  clearTimeout(hoverTimer);
  hoverEl = el;
  hoverTimer = setTimeout(() => showPopover(el), parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hover-delay')) || 300);
});

document.addEventListener('pointerout', (e) => {
  if (e.pointerType !== 'mouse') return;
  const leaving = e.target.closest('[data-w], #popover');
  if (!leaving) return;
  const to = e.relatedTarget;
  if (to && (to.closest?.('#popover') || to.closest?.('[data-w]') === hoverEl)) return;
  clearTimeout(hoverTimer);
  hideTimer = setTimeout(hidePopover, 150);
});

/* ---------- any word anywhere opens its entry ---------- */

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-w]');
  if (!el || el.closest('#popover')) return;
  e.preventDefault();
  openEntry(el.dataset.w, { fromViewer: !!el.closest('#sheet, #detail') });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches?.('span[data-w]')) {
    e.preventDefault();
    e.target.click();
  }
});
