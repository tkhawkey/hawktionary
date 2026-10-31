// Small shared controls: search fields, switches, segmented choices, recent lists.
import { h } from './dom.js';
import { getPref, setPref } from './data.js';
import { BAND_NAMES } from './text.js';

const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M15 15l5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
const CLEAR_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** A large search field. onInput(value) is called after a short pause; label is the small mode label. */
export function searchField({ placeholder, ariaLabel, onInput, onEnter, delay = 120, big = true }) {
  const input = h('input', {
    type: 'text', autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
    enterkeyhint: 'search', placeholder, 'aria-label': ariaLabel || placeholder,
  });
  const label = h('span', { class: 'field-label', 'aria-live': 'polite' });
  const clear = h('button', { class: 'icon-btn field-clear', 'aria-label': 'Clear', html: CLEAR_ICON, hidden: true });
  const wrap = h('div', { class: 'search' + (big ? ' big' : '') }, h('span', { class: 'search-icon', html: SEARCH_ICON }), input, label, clear);
  let timer = null;
  const fire = () => { clearTimeout(timer); onInput(input.value); };
  input.addEventListener('input', () => {
    clear.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(fire, delay);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); fire(); onEnter?.(input.value); }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); e.stopPropagation(); set(''); fire(); }
  });
  clear.addEventListener('click', () => { set(''); fire(); input.focus(); });
  function set(v) { input.value = v; clear.hidden = !v; }
  return { el: wrap, input, label, set, get value() { return input.value; } };
}

/** A small text field with a caption, e.g. "Crossing ?i????". */
export function smallField({ caption, placeholder, ariaLabel, onInput, delay = 120 }) {
  const input = h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder, 'aria-label': ariaLabel || caption });
  let timer = null;
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => onInput(input.value), delay); });
  return { el: h('label', { class: 'small-field' }, h('span', { class: 'sf-cap' }, caption), input), input };
}

export function toggle(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = checked;
  input.addEventListener('change', () => onChange(input.checked));
  return h('label', { class: 'toggle' }, input, h('span', null, label));
}

/** Segmented choice. options: [[value, label]] */
export function seg(options, value, onChange, { ariaLabel = '', cls = '' } = {}) {
  const el = h('div', { class: ('seg ' + cls).trim(), role: 'radiogroup', 'aria-label': ariaLabel });
  for (const [v, label] of options) {
    const b = h('button', { role: 'radio', 'aria-checked': String(v === value) }, label);
    b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      onChange(v);
    });
    el.append(b);
  }
  return el;
}

/** Frequency filter: show words up to this band. Stored on the device. */
export function bandSeg(onChange) {
  const options = [[1, 'Common'], [2, 'Familiar'], [3, 'Uncommon'], [4, 'Rare'], [5, 'All']];
  return seg(options, getPref('maxBand', 5), (v) => { setPref('maxBand', v); onChange(v); }, { ariaLabel: 'Frequency', cls: 'seg-band' });
}

export function remember(key, text, max = 15) {
  const t = text.trim();
  if (t.length < 1) return;
  setPref(key, [t, ...getPref(key, []).filter(r => r !== t)].slice(0, max));
}

/** Chips for recent searches. */
export function recentChips(key, onPick) {
  const list = getPref(key, []);
  if (!list.length) return null;
  return h('div', { class: 'chips' }, list.map(r => h('button', { class: 'chip', onclick: () => onPick(r) }, r)));
}

export function sectionHead(title, extra) {
  return h('div', { class: 'sec-head' }, h('h3', null, title), extra || null);
}

export function plural(n, word, pluralWord = word + 's') {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? word : pluralWord}`;
}

export { BAND_NAMES };
