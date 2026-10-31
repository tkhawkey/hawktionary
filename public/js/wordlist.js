// Word lists: one word per line, in columns, every word the same size.
// How common a word is shows as weight and colour (band classes b1–b5), not size.
import { band, fold } from './text.js';
import { h } from './dom.js';

/**
 * items: [{ d: display, z: zipf, e: enumeration, note }]
 * opts.view: 'commonness' (one flow, most common first) or 'length' (grouped by letter count)
 * opts.initial: how many to show before "Show all"
 * opts.showEnum: 'phrases' (default: only for phrases/hyphenated) | 'always' | 'never'
 */
export function wordList(items, opts = {}) {
  const { view = 'commonness', initial = 36, showEnum = 'phrases', cls = '' } = opts;
  const root = h('div', { class: ('wl ' + cls).trim() });
  if (!items.length) return root;
  if (view === 'length') {
    const groups = new Map();
    for (const it of items) {
      const n = fold(it.d).length;
      if (!groups.has(n)) groups.set(n, []);
      groups.get(n).push(it);
    }
    for (const n of [...groups.keys()].sort((a, b) => a - b)) {
      const list = groups.get(n);
      root.append(h('section', { class: 'wl-group' },
        h('h5', { class: 'wl-len' }, h('span', { class: 'wl-n' }, n), n === 1 ? ' letter' : ' letters', h('span', { class: 'wl-count' }, list.length)),
        columns(list, Math.max(12, Math.round(initial / 2)), showEnum)));
    }
  } else {
    root.append(columns(items, initial, showEnum));
  }
  return root;
}

function columns(items, initial, showEnum) {
  const wrap = h('div', { class: 'wl-block' });
  const ul = h('ul', { class: 'wl-cols' });
  const first = items.length > initial + 6 ? items.slice(0, initial) : items;
  first.forEach((it, n) => ul.append(item(it, n, showEnum)));
  wrap.append(ul);
  if (first.length < items.length) {
    const rest = items.slice(first.length);
    const more = h('button', { class: 'wl-more' }, `Show all ${items.length}`, h('span', { class: 'wl-more-n' }, ` · ${rest.length} more`));
    more.addEventListener('click', () => {
      rest.forEach((it, n) => ul.append(item(it, n, showEnum)));
      more.remove();
    });
    wrap.append(more);
  }
  return wrap;
}

function item(it, n, showEnum) {
  const b = band(it.z ?? 0);
  const multi = it.e && /[,-]/.test(it.e);
  const showE = it.e && (showEnum === 'always' || (showEnum === 'phrases' && multi));
  return h('li', { class: 'rise', style: { '--i': Math.min(n, 40) } },
    h('span', { class: `w b${b}`, 'data-w': it.d, 'data-nav': '', role: 'link', tabindex: '0' }, it.d),
    showE ? h('span', { class: 'wl-enum' }, ` (${it.e})`) : null,
    it.note ? h('span', { class: 'wl-note' }, ' ', it.note) : null);
}

/** "Commonness | Length" switch. */
export function viewSwitch(value, onChange) {
  const seg = h('div', { class: 'seg seg-sm', role: 'radiogroup', 'aria-label': 'Order' });
  for (const [v, label] of [['commonness', 'Most common'], ['length', 'By length']]) {
    const b = h('button', { role: 'radio', 'aria-checked': String(v === value) }, label);
    b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      onChange(v);
    });
    seg.append(b);
  }
  return seg;
}
