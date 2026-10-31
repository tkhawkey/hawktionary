// Solve: a workbench for one clue. Set the slot once; synonyms, anagrams and pattern
// matches are all filtered to fit it. Tap a candidate to try it in the grid.
import { getEntry, getPref, setPref } from '../data.js';
import { words, indexOf, ask, abbreviationsOfTerm } from '../lexicon.js';
import { parsePattern, compileMatcher, shapeOf, fold } from '../text.js';
import { h } from '../dom.js';
import { thesaurusItems, enumOf, firstGloss, linkify } from '../entry.js';
import { wordList } from '../wordlist.js';
import { grid, blocks, dropInto, triedLetters } from '../squares.js';
import { smallField, plural } from '../ui.js';
import { openEntry } from '../viewer.js';

export function createSolve(root, ctx) {
  let seq = 0;
  let tried = null;
  let selected = new Set(getPref('solve-def', []));   // clue words marked as the definition
  let shown = null;

  const clue = smallField({ caption: 'Clue', placeholder: 'Sailor’s hat, initially (5)', ariaLabel: 'The clue (optional)', onInput: () => { save(); refresh(); }, delay: 250 });
  const slot = smallField({ caption: 'Slot', placeholder: '?a?e? or (5,3)', ariaLabel: 'Pattern for the answer', onInput: () => { save(); refresh(); } });
  const fodder = smallField({ caption: 'Fodder', placeholder: 'letters to rearrange', ariaLabel: 'Anagram fodder', onInput: () => { save(); refresh(); } });
  clue.el.classList.add('wide-field');

  const chips = h('div', { class: 'clue-chips' });
  const gridHolder = h('div', { class: 'slot-grid' });
  const triedInfo = h('div', { class: 'tried-info', 'aria-live': 'polite' });
  const tray = h('div', { class: 'tray-holder' });
  const shortlistEl = h('div', { class: 'shortlist' });
  const panels = h('div', { class: 'solve-panels', 'data-own-click': '' });
  const clearBtn = h('button', { class: 'btn quiet', onclick: newClue }, 'New clue');

  root.append(h('div', { class: 'solve' },
    h('section', { class: 'bench' },
      h('div', { class: 'bench-top' }, h('h2', { class: 'bench-title' }, 'The slot'), clearBtn),
      clue.el, chips,
      h('div', { class: 'fields' }, slot.el, fodder.el),
      gridHolder, triedInfo, tray),
    shortlistEl,
    panels));

  panels.addEventListener('click', (e) => {
    const el = e.target.closest('[data-w]');
    if (!el) return;
    e.preventDefault();
    tryWord(el.dataset.w, el);
  });

  function save() {
    const p = { c: clue.input.value.trim() || null, p: slot.input.value.trim() || null, a: fodder.input.value.trim() || null };
    setPref('solve', p);
    ctx.setParams(p);
  }

  function newClue() {
    clue.input.value = slot.input.value = fodder.input.value = '';
    selected = new Set();
    setPref('solve-def', []);
    tried = null;
    save();
    refresh();
    clue.input.focus();
  }

  /** The slot pattern: typed in Slot, or the enumeration at the end of the clue. */
  function slotText() {
    const s = slot.input.value.trim();
    if (s) return s;
    const m = /\(([\d\s,\-]+)\)\s*$/.exec(clue.input.value);
    return m ? `(${m[1]})` : '';
  }

  function clueWords() {
    const text = clue.input.value.replace(/\(([\d\s,\-]+)\)\s*$/, '');
    return [...text.matchAll(/[A-Za-zÀ-ÿ]+(?:['’][A-Za-z]+)?/g)].map(m => m[0]);
  }

  function fitter(parsed) {
    if (!parsed) return () => true;
    const match = compileMatcher(parsed, !parsed.hasBreaks);
    return (d, e) => {
      const l = fold(d);
      return match(l, shapeOf(l, e || String(l.length)));
    };
  }

  async function refresh() {
    const my = ++seq;
    const parsed = parsePattern(slotText());
    shown = JSON.stringify([clue.input.value, slot.input.value, fodder.input.value]);
    drawChips();
    drawGrid(parsed);
    drawShortlist(parsed);

    const f = fodder.input.value.trim();
    tray.replaceChildren(f ? blocks(fold(f) + '_'.repeat(Math.min(2, (f.match(/[?.#]/g) || []).length))) : '');

    const fits = fitter(parsed);
    const out = [];

    // synonyms of the definition words that fit the slot
    const defWords = clueWords().filter(w => selected.has(w.toLowerCase()));
    if (defWords.length) {
      const items = await synonymsFor(defWords);
      if (my !== seq) return;
      const list = items.filter(it => fits(it.d, it.e));
      out.push(panel('Synonyms that fit', `of ${defWords.join(' ')}`, list.length,
        list.length ? wordList(list, { initial: 60 }) : h('p', { class: 'note' }, 'None of the synonyms fit the slot.')));
    } else if (clueWords().length) {
      out.push(panel('Synonyms that fit', '', 0, h('p', { class: 'note' }, 'Tap the word or words in the clue that might be the definition.')));
    }

    // anagrams of the fodder that fit
    if (f) {
      const res = await ask('anagram', { fodder: f, pattern: slotText(), proper: true, maxBand: 5, limit: 300 });
      if (my !== seq) return;
      out.push(panel('Anagrams that fit', `of ${f.toUpperCase()}`, res.total,
        res.total ? wordList(items(res.results), { initial: 40, showEnum: 'phrases' }) : h('p', { class: 'note' }, 'No anagrams of these letters fit.')));
    }

    // abbreviations for words in the clue (reference only)
    const abbr = clueAbbreviations();
    if (abbr.length) {
      out.push(panel('Abbreviations in the clue', '', abbr.length, h('dl', { class: 'clue-abbr tint-abbr' }, abbr.map(([w, rows]) => [
        h('dt', null, w),
        h('dd', null, rows.map((r, n) => [n ? h('span', { class: 'dot' }, ' · ') : null, h('b', { class: `code t${r.tier}` }, r.abbr)])),
      ]))));
    }

    // everything in the word list that fits
    if (parsed && /[a-z]/.test(parsed.shape) || parsed && !f && !defWords.length) {
      const res = await ask('pattern', { text: slotText(), phrases: false, proper: true, maxBand: 5, limit: 400 });
      if (my !== seq) return;
      out.push(panel('Words that fit', '', res.total,
        res.total ? wordList(items(res.results), { initial: 60, showEnum: 'phrases' }) : h('p', { class: 'note' }, 'Nothing in the word list fits.')));
    }

    if (!out.length) out.push(h('div', { class: 'home' }, h('p', { class: 'note' },
      'Paste or type the clue, with its enumeration in brackets. Tap the words that might be the definition, add crossing letters in Slot (like ?a?e?), and put any anagram letters in Fodder. Everything below is then filtered to fit.')));
    panels.replaceChildren(...out);
  }

  function items(indices) {
    return indices.map(i => ({ d: words.display[i], z: words.zipf[i], e: words.enumr[i] }));
  }

  function panel(title, sub, count, body) {
    return h('section', { class: 'panel rise' },
      h('div', { class: 'sec-head' }, h('h3', null, title, sub ? h('span', { class: 'sub' }, ' ', sub) : null), count ? h('span', { class: 'count' }, count) : null),
      body);
  }

  async function synonymsFor(defWords) {
    const terms = [defWords.join(' '), ...defWords];
    const seen = new Map();
    for (const t of terms) {
      const i = indexOf(t);
      if (i < 0) continue;
      const display = words.display[i];
      let r = await getEntry(display);
      let head = display;
      if (!(r?.s?.length || r?.t?.length) && r?.f?.length) {
        const base = r.f.map(f => f[1]).find(Boolean);
        if (base) { r = await getEntry(base); head = base; }
      }
      for (const it of thesaurusItems([...(r?.s || []), ...(r?.t || []), ...(r?.k || [])], head)) {
        if (!seen.has(it.d)) seen.set(it.d, it);
      }
    }
    return [...seen.values()].sort((a, b) => b.z - a.z);
  }

  function clueAbbreviations() {
    const ws = clueWords().map(w => w.toLowerCase().replace(/['’]s$/, ''));
    const out = [];
    const seen = new Set();
    const add = (term) => {
      if (seen.has(term)) return;
      const rows = abbreviationsOfTerm(term).filter(r => r.tier <= 2).sort((a, b) => a.tier - b.tier);
      if (rows.length) { seen.add(term); out.push([term, rows.slice(0, 12)]); }
    };
    for (let n = 0; n < ws.length; n++) {
      if (n + 1 < ws.length) add(ws[n] + ' ' + ws[n + 1]);
      add(ws[n]);
    }
    return out;
  }

  function drawChips() {
    const ws = clueWords();
    chips.replaceChildren(...ws.map(w => {
      const key = w.toLowerCase();
      const b = h('button', { class: 'clue-chip', 'aria-pressed': String(selected.has(key)), title: 'Mark as the definition' }, w);
      b.addEventListener('click', () => {
        if (selected.has(key)) selected.delete(key); else selected.add(key);
        setPref('solve-def', [...selected]);
        refresh();
      });
      return b;
    }));
    if (ws.length) chips.prepend(h('span', { class: 'chips-cap' }, 'Definition:'));
  }

  function drawGrid(parsed) {
    if (!parsed) {
      gridHolder.replaceChildren(h('p', { class: 'note' }, 'Type a slot such as ?a?e? ??? or an enumeration like (5,3).'));
      triedInfo.replaceChildren();
      return;
    }
    const t = tried ? triedLetters(parsed.shape, fold(tried)) : null;
    if (tried && !t) tried = null;
    const row = grid(parsed.shape, { tried: t });
    gridHolder.replaceChildren(row);
    return row;
  }

  async function tryWord(display, fromEl) {
    const parsed = parsePattern(slotText());
    if (!parsed) return;
    if (!triedLetters(parsed.shape, fold(display))) return;
    tried = display;
    const row = drawGrid(parsed);
    dropInto(tray.querySelector('.tray') || fromEl, row, '.cell.tried > span');
    const gloss = await firstGloss(display);
    if (tried !== display) return;
    const inList = getPref('shortlist', []).includes(display);
    const star = h('button', { class: 'btn', 'aria-pressed': String(inList) }, inList ? 'On shortlist' : 'Add to shortlist');
    star.addEventListener('click', () => {
      const list = getPref('shortlist', []);
      const on = list.includes(display);
      setPref('shortlist', on ? list.filter(x => x !== display) : [display, ...list].slice(0, 30));
      star.textContent = on ? 'Add to shortlist' : 'On shortlist';
      star.setAttribute('aria-pressed', String(!on));
      drawShortlist(parsePattern(slotText()));
    });
    triedInfo.replaceChildren(
      h('div', { class: 'tried-word' }, h('span', { class: 'tw' }, display), enumOf(display) ? h('span', { class: 'te' }, ` (${enumOf(display)})`) : ''),
      gloss ? h('p', { class: 'gloss', html: linkify(gloss) }) : '',
      h('div', { class: 'tried-actions' }, star, h('button', { class: 'btn quiet', onclick: () => openEntry(display) }, 'Full entry')));
  }

  function drawShortlist(parsed) {
    const list = getPref('shortlist', []);
    if (!list.length) { shortlistEl.replaceChildren(); return; }
    shortlistEl.replaceChildren(
      h('div', { class: 'sec-head' }, h('h3', null, 'Shortlist'),
        h('button', { class: 'sec-link', onclick: () => { setPref('shortlist', []); drawShortlist(parsed); } }, 'Clear')),
      h('div', { class: 'chips' }, list.map(d => {
        const fitsNow = parsed && triedLetters(parsed.shape, fold(d));
        return h('button', { class: 'chip' + (fitsNow ? '' : ' unfit'), onclick: (e) => fitsNow ? tryWord(d, e.currentTarget) : openEntry(d) }, d);
      })));
  }

  return {
    show(params) {
      const p = Object.keys(params).length ? params : getPref('solve', {}) || {};
      const key = JSON.stringify([p.c || '', p.p || '', p.a || '']);
      if (shown === key) return;
      clue.input.value = p.c || '';
      slot.input.value = p.p || '';
      fodder.input.value = p.a || '';
      refresh();
    },
    focus() { (slot.input.value ? slot.input : clue.input).focus(); },
  };
}
