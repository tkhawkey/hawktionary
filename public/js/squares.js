// Crossword grid cells (pattern slots and answers) and letterpress type blocks (anagram letters).
import { h, token, reducedMotion } from './dom.js';

/**
 * A row of grid cells.
 * shape: letters a–z, '?' unknown, '*' any run, ' ' word break, '-' hyphen.
 * tried (optional): a candidate's letters (same length as the cells, no breaks) shown in the empty cells.
 */
export function grid(shape, { tried = null, cls = '' } = {}) {
  const row = h('div', { class: ('grid ' + cls).trim(), 'aria-hidden': 'true' });
  let word = h('div', { class: 'grid-word' });
  let n = 0;
  const flush = () => { if (word.childNodes.length) row.append(word); word = h('div', { class: 'grid-word' }); };
  for (const ch of shape) {
    if (ch === ' ') { flush(); row.append(h('span', { class: 'grid-gap' })); continue; }
    if (ch === '-') { flush(); row.append(h('span', { class: 'grid-hyphen' })); continue; }
    if (ch === '*') { word.append(h('span', { class: 'cell star' }, '…')); continue; }
    if (ch === '?') {
      const t = tried?.[n++];
      word.append(t ? h('span', { class: 'cell tried', 'data-l': t }, h('span', null, t)) : h('span', { class: 'cell' }));
    } else {
      word.append(h('span', { class: 'cell given', 'data-l': ch }, h('span', null, ch)));
    }
  }
  flush();
  return row;
}

/** A tray of type blocks; '_' is a blank block for an unknown letter. */
export function blocks(letters, cls = '') {
  const tray = h('div', { class: ('tray ' + cls).trim(), 'aria-hidden': 'true' });
  for (const ch of letters) {
    tray.append(ch === '_' ? h('span', { class: 'block blank' }, '?') : h('span', { class: 'block', 'data-l': ch }, ch));
  }
  return tray;
}

/** Animate letters from type blocks (or other cells) down into a row of cells. */
export function dropInto(fromEl, toRow, selector = '.cell[data-l] > span') {
  if (reducedMotion() || !fromEl || !toRow) return;
  const sources = [...fromEl.querySelectorAll('[data-l], .blank')].map(el => ({ l: el.dataset.l, rect: el.getBoundingClientRect(), used: false }));
  const dur = token('--dur-slow') || 440;
  const stagger = token('--stagger') || 28;
  [...toRow.querySelectorAll(selector)].forEach((span, n) => {
    const target = span.parentElement.getBoundingClientRect();
    const l = span.parentElement.dataset.l;
    const src = sources.find(s => !s.used && s.l === l) || sources.find(s => !s.used && !s.l);
    let from = 'translateY(-26px) scale(.9)';
    if (src) {
      src.used = true;
      from = `translate(${src.rect.left - target.left}px, ${src.rect.top - target.top}px)`;
    }
    span.animate([{ transform: from, opacity: .4 }, { transform: 'none', opacity: 1 }],
      { duration: dur, delay: n * stagger * 1.5, easing: 'cubic-bezier(.3,.8,.3,1.12)', fill: 'backwards' });
  });
}

/** Letters of a candidate placed into a pattern's unknown cells: returns the letters for the '?' cells. */
export function triedLetters(shape, candidateLetters) {
  const flat = shape.replace(/[ -]/g, '');
  if (flat.includes('*') || flat.length !== candidateLetters.length) return null;
  let out = '';
  for (let i = 0; i < flat.length; i++) out += flat[i] === '?' ? candidateLetters[i] : '';
  return out;
}
