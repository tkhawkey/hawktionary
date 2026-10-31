// Letter squares: only for pattern entry, anagram fodder and anagram answers.
import { h, token, reducedMotion } from './dom.js';

/**
 * shape: letters a–z, '?' unknown, '*' any run, ' ' word break, '-' hyphen.
 */
export function squares(shape, cls = '') {
  const row = h('div', { class: ('squares ' + cls).trim(), 'aria-hidden': 'true' });
  let word = h('div', { class: 'sq-word' });
  const flush = () => { if (word.childNodes.length) row.append(word); word = h('div', { class: 'sq-word' }); };
  for (const ch of shape) {
    if (ch === ' ') { flush(); row.append(h('span', { class: 'sq-gap' })); }
    else if (ch === '-') { flush(); row.append(h('span', { class: 'sq-hyphen' })); }
    else if (ch === '?') word.append(h('span', { class: 'sq unknown' }));
    else if (ch === '*') word.append(h('span', { class: 'sq star' }, '…'));
    else if (ch === '_') word.append(h('span', { class: 'sq blank' }, '?'));
    else word.append(h('span', { class: 'sq', 'data-l': ch }, h('span', null, ch)));
  }
  flush();
  return row;
}

/** Animate letters from the fodder squares down into the answer's squares. */
export function dropInto(fromRow, toRow) {
  if (reducedMotion() || !fromRow || !toRow) return;
  const sources = [...fromRow.querySelectorAll('.sq')].map(el => ({ l: el.dataset.l, rect: el.getBoundingClientRect(), used: false }));
  const dur = token('--dur-slow') || 420;
  const stagger = token('--stagger') || 40;
  [...toRow.querySelectorAll('.sq[data-l] > span')].forEach((span, n) => {
    const target = span.parentElement.getBoundingClientRect();
    const src = sources.find(s => !s.used && s.l === span.parentElement.dataset.l) || sources.find(s => !s.used && !s.l);
    let from;
    if (src) {
      src.used = true;
      from = `translate(${src.rect.left - target.left}px, ${src.rect.top - target.top}px)`;
    } else {
      from = 'translateY(-24px)'; // a letter from a blank drops in from above
    }
    span.animate([
      { transform: from, opacity: 0.35 },
      { transform: 'none', opacity: 1 },
    ], { duration: dur, delay: n * stagger, easing: 'cubic-bezier(.3,.8,.3,1.15)', fill: 'backwards' });
  });
}
