// Cards for the new layout: each has a fixed place, and pops in only when it has something
// to show. Changes are applied inside a View Transition (when the browser has one and
// reduced motion is off), so cards spring in, fold away and slide into their new places.
import { h, reducedMotion } from '../dom.js';

/** A card with a fixed id; fill(content) shows it, clear() folds it away. */
export function card(id, title, { tint = '', sub = '' } = {}) {
  const extra = h('div', { class: 'card-extra' });
  const body = h('div', { class: 'card-body' });
  const heading = h('h3', null, title, sub ? h('span', { class: 'sub' }, ' ', sub) : null);
  const el = h('section', {
    class: `card card-${id}` + (tint ? ` tint-${tint}` : ''),
    'aria-label': title, hidden: true,
    style: { 'view-transition-name': `card-${id}` },
  }, h('header', { class: 'card-head' }, heading, extra), body);
  return {
    id, el, body, extra, heading,
    /** content: nodes for the body (null/empty = fold away); head: nodes for the header's right side. */
    fill(content, head = null) {
      const empty = content === null || content === undefined || (Array.isArray(content) && !content.length);
      if (empty) return this.clear();
      const wasHidden = el.hidden;
      body.replaceChildren(...[].concat(content).filter(Boolean));
      extra.replaceChildren(...[].concat(head || []).filter(Boolean));
      el.hidden = false;
      // without View Transitions, a CSS pop still marks a card arriving
      if (wasHidden && !canTransition()) { el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop'); }
    },
    clear() {
      el.hidden = true;
      body.replaceChildren();
      extra.replaceChildren();
    },
  };
}

export function canTransition() {
  return typeof document.startViewTransition === 'function' && !reducedMotion();
}

/** Run a DOM update, animated when possible. Returns a promise for when it has finished. */
export function transition(update) {
  if (!canTransition()) { update(); return Promise.resolve(); }
  try {
    const t = document.startViewTransition(update);
    // a skipped or timed-out transition (e.g. the tab is in the background) still applies the update
    t.ready.catch(() => {});
    t.updateCallbackDone.catch(() => {});
    return t.finished.catch(() => {});
  } catch {
    update();
    return Promise.resolve();
  }
}

/** A list that shows the first n items and a "more" button for the rest. */
export function moreList(items, n, render, { cls = 'card-list', tag = 'ul', label = 'more' } = {}) {
  const list = h(tag, { class: cls });
  const first = items.length > n + 2 ? items.slice(0, n) : items;
  first.forEach((it, i) => list.append(render(it, i)));
  if (first.length === items.length) return list;
  const rest = items.slice(first.length);
  const more = h('button', { class: 'card-more' }, `${rest.length} ${label}`);
  more.addEventListener('click', () => {
    rest.forEach((it, i) => list.append(render(it, first.length + i)));
    more.remove();
  });
  return h('div', null, list, more);
}
