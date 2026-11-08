// The clue workspace. Tom pastes a clue (with its enumeration if known); its words become
// chips and cards appear around it with pieces he might use. He drags or taps pieces into
// the build tray, which counts the letters, shows leftover fodder, and checks whether the
// result is a word or fits the slot. It suggests pieces; it never tries to solve the clue.
import { getEntry, getPref, setPref } from '../data.js';
import { words, indexOf, ask, abbreviationsOfTerm, umbrellaCategories, zipfOf } from '../lexicon.js';
import { fold, parsePattern, makeDisplayFilter, leftover, band } from '../text.js';
import { h } from '../dom.js';
import { thesaurusItems } from '../entry.js';
import { plural } from '../ui.js';
import { card, transition, moreList } from './cards.js';
import { findIndicators, charadesFor, typeName, typeHint, hasIndicators } from './cluedata.js';
import { hiddenList } from './hub.js';

const STOP = new Set(['a', 'an', 'the', 'and', 'of', 'to', 'in', 'for', 'is', 'it', 'by', 'with', 'on', 'at', 'as', 'or', 'be', 'from', 'that', 'this', 'its', "it's", 'are', 'was', 'one']);
const SHORT_MAX = 5;   // "short synonyms" are up to this many letters
let nextId = 1;

export function createClue(root, ctx) {
  const saved = getPref('lab-clue', {});
  let seq = 0;
  let timer = null;
  let pieces = (saved.pieces || []).map(p => ({ ...p, id: nextId++ }));
  let locks = saved.locks || [];
  let fodder = saved.fodder || '';
  let shown = null;

  /* ---------- the clue ---------- */

  const clueBox = h('textarea', {
    class: 'clue-text', rows: '2', placeholder: 'Paste a clue, e.g. Lemon sideways, partly (6)',
    'aria-label': 'Clue', autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'false',
  });
  const enumBox = h('input', { class: 'clue-enum', type: 'text', inputmode: 'text', placeholder: '6 or 4,3', 'aria-label': 'Enumeration', autocomplete: 'off' });
  const newBtn = h('button', { class: 'btn quiet', onclick: () => { clueBox.value = ''; enumBox.value = ''; pieces = []; locks = []; fodder = ''; changed(true); drawTray(); clueBox.focus(); } }, 'New clue');
  const chipsRow = h('div', { class: 'clue-chips', 'data-own-click': '' });

  /* ---------- the tray ---------- */

  const cells = h('div', { class: 'slot-cells' });
  const trayZone = h('div', { class: 'tray-zone', 'data-own-click': '', 'aria-label': 'Pieces in the build tray' });
  const pieceInput = h('input', { type: 'text', class: 'piece-input', placeholder: 'Type a piece', 'aria-label': 'Type a piece to add', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false' });
  const status = h('div', { class: 'tray-status', 'aria-live': 'polite' });
  const fits = h('div', { class: 'tray-fits' });
  const trayCount = h('span', { class: 'tray-count' });
  const tray = h('section', { class: 'card tray-card', style: { 'view-transition-name': 'main' } },
    h('header', { class: 'card-head' }, h('h3', null, 'Build'), trayCount,
      h('div', { class: 'card-extra' },
        h('button', { class: 'sec-link', onclick: lockAll, title: 'Keep the letters you have built in the slot' }, 'Lock letters'),
        h('button', { class: 'sec-link', onclick: () => { pieces = []; drawTray(); save(); } }, 'Clear'))),
    cells, trayZone,
    h('form', { class: 'piece-form', onsubmit: (e) => { e.preventDefault(); addPiece(pieceInput.value, 'typed'); pieceInput.value = ''; } },
      pieceInput, h('button', { class: 'btn', type: 'submit' }, 'Add')),
    status, fits);

  const cards = {
    def: card('def', 'Definition', { tint: 'dictionary', sub: 'first or last words' }),
    abbr: card('abbr', 'Abbreviations', { tint: 'abbr' }),
    short: card('short', 'Short synonyms', { tint: 'thesaurus' }),
    ind: card('ind', 'Indicators', { tint: 'solve' }),
    anag: card('anag', 'Anagram fodder', { tint: 'solve' }),
    hidden: card('hidden', 'Hidden words', { tint: 'solve' }),
  };
  for (const c of Object.values(cards)) c.el.setAttribute('data-own-click', '');

  // on a phone the tray scrolls out of sight while Tom browses the cards: a small bar at the
  // bottom then shows what he has built, takes dropped pieces, and jumps back to the tray
  const dock = h('button', { class: 'tray-dock', hidden: true, 'aria-label': 'Go to the build tray', onclick: () => tray.scrollIntoView({ block: 'start', behavior: 'smooth' }) });
  let trayVisible = true;
  new IntersectionObserver(([en]) => { trayVisible = en.isIntersecting; dock.hidden = trayVisible || root.hidden; }, { threshold: 0.15 }).observe(tray);

  root.append(dock, h('div', { class: 'clue-ws' },
    h('div', { class: 'clue-top' },
      h('div', { class: 'clue-fields' }, clueBox,
        h('label', { class: 'enum-field' }, h('span', { class: 'sf-cap' }, 'Letters'), enumBox), newBtn),
      chipsRow),
    h('div', { class: 'hub-grid clue-grid' },
      tray,
      h('div', { class: 'hub-cards' },
        h('div', { class: 'hub-col hub-left' }, cards.def.el, cards.abbr.el, cards.short.el),
        h('div', { class: 'hub-col hub-right' }, cards.ind.el, cards.anag.el, cards.hidden.el)))));

  clueBox.addEventListener('input', () => changed());
  enumBox.addEventListener('input', () => changed());
  clueBox.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); clueBox.blur(); } });

  /* ---------- parsing ---------- */

  /** The clue's words and its enumeration ("(6)" at the end, or the Letters box). */
  function parse() {
    let text = clueBox.value.trim();
    let enumr = enumBox.value.trim();
    const m = /\(([\d\s,\-]+)\)\s*$/.exec(text);
    if (m) { text = text.slice(0, m.index).trim(); if (!enumr) enumr = m[1]; }
    const raw = text.split(/\s+/).filter(Boolean);
    const tokens = raw.map(w => w.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '')).filter(Boolean);
    const parsed = enumr ? parsePattern(`(${enumr})`) : null;
    return { text, raw, tokens, enumr: parsed ? parsed.enumeration : '', shape: parsed?.shape || '', total: parsed?.letterCount || 0 };
  }

  /** Lower-case look-up form: "sailor's" → "sailor". */
  function base(w) {
    return w.toLowerCase().replace(/[’']s$/, '').replace(/[’']/g, "'");
  }

  /** The pattern for the slot with locked letters filled in: "?a???". */
  function slotPattern(p) {
    if (!p.shape) return '';
    let n = 0;
    return p.shape.replace(/\?/g, () => (locks[n++] || '?'));
  }

  function changed(now = false) {
    clearTimeout(timer);
    timer = setTimeout(() => { save(); drawChips(); refresh(); drawTray(); }, now ? 0 : 280);
  }

  function save() {
    setPref('lab-clue', { clue: clueBox.value.trim(), pieces: pieces.map(({ text, kind }) => ({ text, kind })), locks, fodder });
    ctx.setParams({ c: clueBox.value.trim() || null, e: enumBox.value.trim() || null });
    shown = clueBox.value.trim() + '|' + enumBox.value.trim();
  }

  /* ---------- chips ---------- */

  function drawChips() {
    const p = parse();
    const marks = hasIndicators() ? findIndicators(p.tokens) : [];
    const typeAt = new Map();
    for (const mk of marks) for (let i = mk.start; i < mk.end; i++) if (!typeAt.has(i)) typeAt.set(i, mk.types[0].type);
    chipsRow.replaceChildren(...p.tokens.map((t, i) => {
      const type = typeAt.get(i);
      return h('button', { class: 'clue-chip piece' + (type ? ' is-ind' : ''), 'data-piece': t, 'data-kind': 'word', title: type ? `Can signal ${typeName(type)}` : 'Tap or drag into the tray' },
        t, type ? h('span', { class: 'chip-tag' }, typeName(type)) : null);
    }));
  }

  /* ---------- cards ---------- */

  function piece(text, kind = 'word', { display = null, note = null } = {}) {
    return h('button', { class: `piece piece-${kind}`, 'data-piece': text, 'data-kind': kind, 'data-w': display || null, title: note || null }, text);
  }

  function pieceRow(label, list) {
    return h('li', { class: 'piece-row' }, h('span', { class: 'row-label' }, label), h('span', { class: 'row-pieces' }, list));
  }

  async function lookUpWord(w) {
    const i = indexOf(w);
    if (i >= 0) return words.display[i];
    return null;
  }

  async function defCard(p) {
    const n = p.tokens.length;
    if (n < 2) return null;
    const fit = makeDisplayFilter(slotPattern(p) || '');
    const phrases = [];
    for (let k = 1; k <= Math.min(3, n - 1); k++) phrases.push(['start', p.tokens.slice(0, k).join(' ')], ['end', p.tokens.slice(n - k).join(' ')]);
    const groups = [];
    const seen = new Set();
    for (const [where, phrase] of phrases) {
      const b = base(phrase);
      if (seen.has(b) || STOP.has(b)) continue;
      seen.add(b);
      const display = await lookUpWord(b) || await lookUpWord(phrase);
      if (!display) continue;
      const r = await getEntry(display);
      let items = thesaurusItems([...(r?.s || []), ...(r?.t || []), ...(r?.k || [])], display);
      if (fit) items = items.filter(it => fit(it.d, it.e));
      else items = items.filter(it => band(it.z) <= 3);
      if (items.length) groups.push({ where, phrase, display, items });
    }
    if (!groups.length) return null;
    // the most specific (longest) phrase at each end first
    groups.sort((a, b) => b.phrase.split(' ').length - a.phrase.split(' ').length);
    return {
      body: groups.slice(0, 4).map(g => h('div', { class: 'def-group' },
        h('p', { class: 'card-line' }, h('b', null, `“${g.phrase}”`), h('span', { class: 'card-note' }, g.where === 'start' ? ' at the start' : ' at the end'), h('span', { class: 'count' }, ' · ', g.items.length)),
        moreList(g.items, 8, (it) => piece(it.d, 'word', { display: it.d }), { cls: 'row-pieces wrap', tag: 'div' }))),
    };
  }

  function abbrCard(p) {
    const rows = [];
    const seen = new Set();
    const terms = [];
    p.tokens.forEach((t, i) => {
      terms.push(t);
      if (i + 1 < p.tokens.length) terms.push(t + ' ' + p.tokens[i + 1]);
    });
    for (const t of terms) {
      const b = base(t);
      if (seen.has(b)) continue;
      seen.add(b);
      const list = abbreviationsOfTerm(b).slice().sort((x, y) => x.tier - y.tier);
      const codes = [...new Set(list.map(r => r.abbr.toUpperCase()))];
      const cats = umbrellaCategories(b);
      if (!codes.length && !cats.length) continue;
      const shownCodes = codes.slice(0, 8).map(c => piece(c, 'abbr', { note: list.find(r => r.abbr.toUpperCase() === c)?.note }));
      const extra = codes.length > 8 ? h('span', { class: 'card-note' }, ` +${codes.length - 8}`) : null;
      const catNote = cats.map(c => h('span', { class: 'card-note' }, ` any ${c.label} (${c.rows.length})`));
      rows.push(pieceRow(t, [shownCodes, extra, catNote]));
    }
    if (!rows.length) return null;
    return { body: moreList(rows, 6, (r) => r, { cls: 'card-list piece-rows' }) };
  }

  async function shortCard(p) {
    const rows = [];
    const seen = new Set();
    for (const t of p.tokens) {
      const b = base(t);
      if (seen.has(b)) continue;
      seen.add(b);
      const out = new Map();
      for (const r of charadesFor(b)) {
        if (p.total && r.letters.length > p.total) continue;
        out.set(r.letters, { text: r.letters, z: 9 - r.tier });
      }
      const display = await lookUpWord(b);
      if (display && !STOP.has(b)) {
        const r = await getEntry(display);
        for (const it of thesaurusItems(r?.s || [], display)) {
          const l = fold(it.d);
          if (l.length < 2 || l.length > SHORT_MAX || band(it.z) > 3 || /[\s-]/.test(it.d)) continue;
          if (p.total && l.length > p.total) continue;
          const k = l.toUpperCase();
          if (!out.has(k)) out.set(k, { text: k, z: it.z, display: it.d });
        }
      }
      // abbreviations have their own card
      for (const r of abbreviationsOfTerm(b)) out.delete(r.abbr.toUpperCase());
      const list = [...out.values()].sort((x, y) => y.z - x.z).slice(0, 10);
      if (list.length) rows.push(pieceRow(t, list.map(x => piece(x.text, 'short', { display: x.display || null }))));
    }
    if (!rows.length) return null;
    return { body: moreList(rows, 6, (r) => r, { cls: 'card-list piece-rows' }) };
  }

  function indCard(p) {
    if (!hasIndicators()) return null;
    const marks = findIndicators(p.tokens);
    if (!marks.length) return null;
    marks.sort((a, b) => (b.end - b.start) - (a.end - a.start) || b.types[0].count - a.types[0].count);
    return {
      body: moreList(marks, 5, (mk) => h('li', { class: 'ind-row' },
        h('b', null, mk.phrase),
        h('span', { class: 'ind-types' }, mk.types.slice(0, 3).map((t, n) => [n ? h('span', { class: 'dot' }, ' · ') : null,
          h('span', { class: 'ind-name', title: typeHint(t.type) }, typeName(t.type))]))), { cls: 'card-list ind-rows' }),
    };
  }

  async function anagCard(p) {
    if (!p.total || p.tokens.length < 1) return null;
    const lens = p.tokens.map(t => fold(t).length);
    const marks = hasIndicators() ? findIndicators(p.tokens).filter(m => m.types.some(t => t.type === 'anagram')) : [];
    const runs = [];
    for (let i = 0; i < p.tokens.length; i++) {
      let sum = 0;
      for (let j = i; j < p.tokens.length; j++) {
        sum += lens[j];
        if (sum === p.total) runs.push({ i, j: j + 1 });
        if (sum >= p.total) break;
      }
    }
    if (!runs.length) return null;
    const pattern = slotPattern(p);
    const out = [];
    for (const r of runs.slice(0, 12)) {
      const text = p.tokens.slice(r.i, r.j).join(' ');
      const res = await ask('anagram', { fodder: fold(text), pattern, proper: false, maxBand: 4, limit: 8 });
      const items = res.results.map(i => words.display[i]).filter(d => fold(d) !== fold(text));
      const nextToInd = marks.some(m => m.end === r.i || m.start === r.j);
      if (items.length || nextToInd) out.push({ text, items, total: res.total, nextToInd });
    }
    if (!out.length) return null;
    out.sort((a, b) => b.nextToInd - a.nextToInd || b.items.length - a.items.length);
    return {
      body: moreList(out, 3, (f) => h('li', { class: 'fodder-row' + (fodder === f.text ? ' on' : '') },
        h('div', { class: 'fodder-head' },
          h('b', null, f.text), f.nextToInd ? h('span', { class: 'chip-tag' }, 'next to an indicator') : null,
          h('button', { class: 'sec-link', onclick: () => { fodder = fodder === f.text ? '' : f.text; save(); drawTray(); refresh(); } }, fodder === f.text ? 'Stop using' : 'Use as fodder')),
        f.items.length ? h('div', { class: 'row-pieces wrap' }, f.items.map(d => piece(d, 'word', { display: d }))) : h('p', { class: 'card-note' }, 'No single word fits these letters.')), { cls: 'card-list fodder-rows' }),
    };
  }

  async function hiddenCard(p) {
    if (p.tokens.length < 2) return null;
    const res = await ask('hidden', { text: p.tokens.join(' '), pattern: slotPattern(p) || null, limit: 30 });
    const crossing = res.results.filter(r => r.crosses);
    if (!crossing.length) return null;
    return { body: hiddenList(p.tokens.join(' '), crossing, { onPiece: true, limit: 5 }) };
  }

  async function refresh() {
    const my = ++seq;
    const p = parse();
    if (!p.tokens.length) {
      transition(() => { for (const c of Object.values(cards)) c.clear(); });
      return;
    }
    const found = await Promise.all([defCard(p), abbrCard(p), shortCard(p), indCard(p), anagCard(p), hiddenCard(p)]);
    if (my !== seq) return;
    transition(() => {
      ['def', 'abbr', 'short', 'ind', 'anag', 'hidden'].forEach((k, n) => {
        const r = found[n];
        r ? cards[k].fill(r.body, r.head) : cards[k].clear();
      });
    });
  }

  /* ---------- tray ---------- */

  function addPiece(text, kind = 'word', at = pieces.length) {
    const t = String(text || '').trim();
    if (!fold(t)) return;
    pieces.splice(at, 0, { id: nextId++, text: t, kind });
    drawTray(pieces[at].id);
    save();
  }

  function movePiece(id, to) {
    const from = pieces.findIndex(x => x.id === id);
    if (from < 0) return;
    const [x] = pieces.splice(from, 1);
    pieces.splice(to > from ? to - 1 : to, 0, x);
    drawTray();
    save();
  }

  function removePiece(id) {
    pieces = pieces.filter(x => x.id !== id);
    drawTray();
    save();
  }

  function lockAll() {
    const p = parse();
    const letters = pieces.map(x => fold(x.text)).join('');
    const n = p.total || letters.length;
    locks = Array.from({ length: n }, (_, i) => locks[i] || letters[i] || '');
    drawTray();
    save();
    refresh();
  }

  function drawTray(flashId = null) {
    const p = parse();
    const letters = pieces.map(x => fold(x.text)).join('');
    const total = p.total;

    // pieces
    trayZone.replaceChildren(...pieces.map((x, n) => h('span', { class: `tray-piece piece-${x.kind}` + (x.id === flashId ? ' flash' : ''), 'data-id': x.id },
      h('button', { class: 'tp-move', 'aria-label': `Move ${x.text} left`, disabled: n === 0 ? true : null, onclick: () => movePiece(x.id, n - 1) }, '‹'),
      h('span', { class: 'tp-text', 'data-tray-piece': x.id }, x.text),
      h('button', { class: 'tp-move', 'aria-label': `Move ${x.text} right`, disabled: n === pieces.length - 1 ? true : null, onclick: () => movePiece(x.id, n + 2) }, '›'),
      h('button', { class: 'tp-remove', 'aria-label': `Remove ${x.text}`, onclick: () => removePiece(x.id) }, '×'))));
    if (!pieces.length) trayZone.append(h('p', { class: 'tray-empty' }, 'Drag pieces here, or tap them.'));

    // count
    trayCount.textContent = total ? `${letters.length} of ${total}` : (letters.length ? plural(letters.length, 'letter') : '');
    trayCount.className = 'tray-count' + (total && letters.length === total ? ' full' : total && letters.length > total ? ' over' : '');
    dock.replaceChildren(h('span', { class: 'card-cap' }, 'Build '),
      h('span', { class: 'dock-pieces' }, pieces.length ? pieces.map(x => x.text).join(' + ') : 'empty'),
      h('span', { class: trayCount.className }, trayCount.textContent));
    if (flashId && !trayVisible) { dock.classList.remove('bump'); void dock.offsetWidth; dock.classList.add('bump'); }

    // slot cells: locked letters as values, built letters shown faintly underneath
    cells.replaceChildren();
    const shape = p.shape || (letters ? '?'.repeat(letters.length) : '');
    let k = 0;
    let word = h('div', { class: 'grid-word' });
    const flush = () => { if (word.childNodes.length) cells.append(word); word = h('div', { class: 'grid-word' }); };
    for (const ch of shape) {
      if (ch === ' ' || ch === '-') { flush(); cells.append(h('span', { class: ch === ' ' ? 'grid-gap' : 'grid-hyphen' })); continue; }
      const i = k++;
      const built = letters[i] || '';
      const lock = locks[i] || '';
      const input = h('input', {
        class: 'slot-cell' + (lock ? ' locked' : '') + (lock && built && lock !== built ? ' clash' : ''),
        maxlength: '1', value: lock.toUpperCase(), placeholder: built.toUpperCase(),
        'aria-label': `Letter ${i + 1}${lock ? ', locked ' + lock : built ? ', built ' + built : ''}`,
        autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', inputmode: 'text',
      });
      input.addEventListener('input', () => {
        const v = fold(input.value).slice(-1);
        locks[i] = v;
        input.value = v.toUpperCase();
        if (v) input.closest('.slot-cells').querySelectorAll('.slot-cell')[i + 1]?.focus();
        save();
        clearTimeout(timer);
        timer = setTimeout(() => { drawTray(); refresh(); }, 500);
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !input.value) { input.closest('.slot-cells').querySelectorAll('.slot-cell')[i - 1]?.focus(); }
      });
      word.append(input);
    }
    flush();
    cells.style.setProperty('--n', String(Math.max(8, k + (shape.match(/[ -]/g) || []).length * 0.4)));

    // status lines
    const lines = [];
    if (total && letters.length > total) lines.push(h('p', { class: 'st-bad' }, `${plural(letters.length - total, 'letter')} too many.`));
    if (fodder) {
      const { left, needs } = leftover(fodder, letters);
      lines.push(h('p', null, h('span', { class: 'card-cap' }, 'Fodder '), h('b', null, fodder), ' · ',
        left.length ? ['left over: ', h('b', { class: 'mono' }, left.join(' ').toUpperCase())] : 'all used',
        needs.length ? [' · not from the fodder: ', h('b', { class: 'mono' }, needs.join(' ').toUpperCase())] : null));
    }
    const clash = locks.some((l, i) => l && letters[i] && l !== letters[i]);
    if (clash) lines.push(h('p', { class: 'st-bad' }, 'Some built letters clash with letters you locked.'));
    status.replaceChildren(...lines);
    checkWord(letters, p);
  }

  let checkSeq = 0;
  async function checkWord(letters, p) {
    const my = ++checkSeq;
    const out = [];
    const total = p.total;
    if (letters.length >= 3 && (!total || letters.length === total)) {
      const r = await ask('lookup', { text: letters, limit: 1 });
      if (my !== checkSeq) return;
      if (r.exact.length) {
        const d = words.display[r.exact[0]];
        out.push(h('p', { class: 'st-good' }, h('span', { class: 'w b1', 'data-w': d, role: 'link', tabindex: '0' }, d), ' is in the word list.'));
      } else out.push(h('p', { class: 'st-bad' }, `${letters.toUpperCase()} is not in the word list.`));
    }
    // words that fit the slot with what is known so far (locked letters, then built ones)
    if (p.shape) {
      let n = 0;
      const pattern = p.shape.replace(/\?/g, () => { const i = n++; return locks[i] || letters[i] || '?'; });
      const known = pattern.replace(/[^a-z]/g, '').length;
      if (known && known < p.total) {
        const res = await ask('pattern', { text: pattern, phrases: true, limit: 12 });
        if (my !== checkSeq) return;
        out.push(h('p', { class: 'fits-line' }, h('span', { class: 'card-cap' }, res.total ? `${plural(res.total, 'word fits', 'words fit')} ` : 'Nothing fits '), h('span', { class: 'mono' }, pattern.toUpperCase()), res.total ? ': ' : '',
          res.results.map((i, k) => [k ? ', ' : '', h('span', { class: 'w b' + band(words.zipf[i]), 'data-w': words.display[i], role: 'link', tabindex: '0' }, words.display[i])]),
          res.total > 12 ? ' …' : ''));
      }
    }
    if (my === checkSeq) fits.replaceChildren(...out);
  }

  /* ---------- tap and drag ---------- */

  let drag = null;   // { el, text, kind, fromId, startX, startY, ghost, active, timer, pointerId }
  let suppressClick = false;

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    const src = e.target.closest('[data-piece], [data-tray-piece]');
    if (!src || e.target.closest('.tp-move, .tp-remove')) return;
    const fromId = src.dataset.trayPiece ? Number(src.dataset.trayPiece) : null;
    const pc = fromId ? pieces.find(x => x.id === fromId) : null;
    drag = {
      el: src, text: pc ? pc.text : src.dataset.piece, kind: pc ? pc.kind : (src.dataset.kind || 'word'), fromId,
      startX: e.clientX, startY: e.clientY, active: false, pointerId: e.pointerId, touch: e.pointerType !== 'mouse',
    };
    // on touch, hold briefly to pick a piece up, so swiping still scrolls the page
    if (drag.touch) drag.timer = setTimeout(() => startDrag(e.clientX, e.clientY), 260);
  });

  function startDrag(x, y) {
    if (!drag || drag.active) return;
    drag.active = true;
    const r = drag.el.getBoundingClientRect();
    drag.dx = x - r.left; drag.dy = y - r.top;
    drag.ghost = h('div', { class: `drag-ghost piece-${drag.kind}` }, drag.text);
    document.body.append(drag.ghost);
    drag.el.classList.add('dragging');
    document.body.classList.add('is-dragging');
    navigator.vibrate?.(10);
    moveGhost(x, y);
  }

  function moveGhost(x, y) {
    drag.ghost.style.transform = `translate(${x - drag.dx}px, ${y - drag.dy}px)`;
    const over = overTray(x, y);
    trayZone.classList.toggle('drop-here', over);
    dock.classList.toggle('drop-here', overDock(x, y));
    placeCaret(over ? dropIndex(x, y) : -1);
  }

  function overDock(x, y) {
    if (dock.hidden) return false;
    const r = dock.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  function overTray(x, y) {
    const r = tray.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  }

  /** Where in the tray a piece dropped at (x, y) would go. */
  function dropIndex(x, y) {
    const els = [...trayZone.querySelectorAll('.tray-piece')];
    let best = els.length, bestD = Infinity;
    els.forEach((el, n) => {
      const r = el.getBoundingClientRect();
      const cy = r.top + r.height / 2;
      for (const [edge, idx] of [[r.left, n], [r.right, n + 1]]) {
        const d = Math.hypot(edge - x, (cy - y) * 2);
        if (d < bestD) { bestD = d; best = idx; }
      }
    });
    return best;
  }

  let caret = null;
  function placeCaret(idx) {
    caret?.remove();
    caret = null;
    if (idx < 0) return;
    caret = h('span', { class: 'tray-caret', 'aria-hidden': 'true' });
    const els = trayZone.querySelectorAll('.tray-piece');
    if (idx < els.length) trayZone.insertBefore(caret, els[idx]); else trayZone.append(caret);
  }

  document.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const moved = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (!drag.active) {
      if (drag.touch) { if (moved > 10) { clearTimeout(drag.timer); drag = null; } return; }   // a swipe: let it scroll
      if (moved > 5) startDrag(e.clientX, e.clientY); else return;
    }
    moveGhost(e.clientX, e.clientY);
  });

  // once a piece is picked up on touch, stop the page from scrolling under it
  document.addEventListener('touchmove', (e) => { if (drag?.active) e.preventDefault(); }, { passive: false });
  root.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-piece], [data-tray-piece]')) e.preventDefault(); });

  const endDrag = (e, cancelled = false) => {
    if (!drag || (e && e.pointerId !== drag.pointerId)) return;
    clearTimeout(drag.timer);
    const d = drag;
    drag = null;
    if (!d.active) return;   // a tap: the click handler adds it
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    d.ghost.remove();
    d.el.classList.remove('dragging');
    document.body.classList.remove('is-dragging');
    trayZone.classList.remove('drop-here');
    dock.classList.remove('drop-here');
    const onDock = !cancelled && e && overDock(e.clientX, e.clientY);
    const inTray = !cancelled && e && !onDock && overTray(e.clientX, e.clientY);
    const idx = onDock ? pieces.length : inTray ? dropIndex(e.clientX, e.clientY) : -1;
    placeCaret(-1);
    if (!inTray && !onDock) return;
    if (d.fromId) movePiece(d.fromId, idx);
    else addPiece(d.text, d.kind, idx);
  };
  document.addEventListener('pointerup', (e) => endDrag(e));
  document.addEventListener('pointercancel', (e) => endDrag(e, true));

  // a tap on a piece adds it to the end of the tray
  root.addEventListener('click', (e) => {
    const src = e.target.closest('[data-piece]');
    if (!src) return;
    e.preventDefault();
    if (suppressClick) return;
    addPiece(src.dataset.piece, src.dataset.kind || 'word');
  });

  return {
    show(params) {
      const c = params.c || '';
      const en = params.e || '';
      if (shown === c + '|' + en && (clueBox.value.trim() === c)) return;
      // a different clue starts with an empty tray; the same one (a reload) keeps its work
      if (c !== (getPref('lab-clue', {}).clue || '') && c) { pieces = []; locks = []; fodder = ''; }
      clueBox.value = c;
      enumBox.value = en;
      save();
      shown = c + '|' + en;
      drawChips();
      drawTray();
      refresh();
    },
    focus() { clueBox.focus(); },
  };
}
