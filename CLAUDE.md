# Hawktionary

A personal dictionary, thesaurus and cryptic-crossword helper for Tom. It is used mid-puzzle, mostly on an Android phone or tablet, sometimes on a PC. It must work fully offline once loaded.

Version 1 is an installable web app (PWA) hosted on GitHub Pages. Later it will be wrapped as an Android app with Capacitor, so keep the code ready for that (see "Architecture").

Tom will refine the look and feel by trying things and reacting, so build it in a way that is quick to restyle: all colours, fonts, spacing and motion timings as CSS custom properties in one file.

---

## 1. Data (already built, do not regenerate here)

The data lives in `public/data/` and is produced outside this repo by two Python scripts in Tom's Dictionary folder (`build_dictionary.py`, then `export_slim.py`). Treat `public/data/` as read-only input. If the data needs changing, say what should change in those scripts instead of editing the files.

`public/data/manifest.json` lists every file with its size and explains the record keys. Summary:

### `words.tsv` (≈4.5 MB, load at start-up)
One line per entry, 240,732 lines, after a `#` header line:

```
display <TAB> enumeration <TAB> zipf <TAB> flags
Aaron's rod    6,3    1.2    p
set-square     3-6    3.8
silent         6      4.5
```

- `display`: the entry as it should be shown (capitals, accents, apostrophes, spaces, hyphens kept).
- `enumeration`: crossword enumeration. Commas separate words, hyphens separate hyphenated parts.
- `zipf`: word frequency, 0–7.7 (7 ≈ "the", 4+ common, 3 familiar, 2 uncommon, 1 rare, 0 obscure/unknown). Scores for phrases and hyphenated entries are estimates.
- `flags`: `p` = proper noun.

Work out in the app (do not expect them in the file):
- `letters`: display folded to a–z only (strip accents with NFD + remove combining marks; æ→ae, œ→oe, ß→ss; drop spaces, hyphens, apostrophes, other punctuation).
- `length` = letters.length
- `alphagram` = letters sorted, for anagrams.
- `band` from zipf: ≥4 → 1 common, ≥3 → 2 familiar, ≥2 → 3 uncommon, ≥1 → 4 rare, else 5 obscure.

### `abbreviations.tsv` (5,189 rows, load at start-up)
```
abbreviation <TAB> clue_term <TAB> note <TAB> tier <TAB> category
LA             the          French    1    foreign word
S              son                    1    general
```
- `tier`: 1 = very common in crosswords, 2 = Chambers level / harder puzzles, 3 = rare.
- `note`: optional (language, "old word", or an expansion).
- `category`: chemical element, Roman numeral, NATO alphabet, country / vehicle code, US state, music, direction / bridge, calendar, Greek letter, number, foreign word, general.

### `entries/<xx>.json` (415 files, ≈65 MB total, fetched on demand and cached)
An object keyed by `display`. File name = first two characters of the entry's `letters` (`"a_"` for one-letter words). Record keys, all optional:

- `d`: definitions `[[pos, gloss, source]]`, already ordered best-first (Wiktionary first because its first senses are the everyday ones, then WordNet). `source` is `w` (Wiktionary) or `n` (WordNet).
- `f`: form-of pointers `[[gloss, baseWord]]`, e.g. `[["plural of ale", "ale"]]`.
- `s`: synonyms (display strings that all exist in `words.tsv`).
- `t`: "is a type of" (e.g. sailor → serviceman, person).
- `k`: "kinds of this" (e.g. tree → ash, elm, oak … in no useful order).

About 25,000 entries have no record at all. That is expected (obscure compounds, inflections).

---

## 2. Version 1 features

Four tools, one search box. Everything below must work offline.

### 2.1 Smart search box
One input at the top. It guesses the mode from what is typed, and shows the guess as a small label; tabs or a mode switch let Tom override it.
- Contains `?`, `.`, `#`, `*` or `@` → pattern.
- Starts with `/` → anagram of the rest.
- Otherwise → abbreviation lookup **and** word lookup together (abbreviation results first if there are any).

`/` focuses the box on PC. Typing searches as you type (debounced ~120 ms).

### 2.2 Pattern search
- Single unknown letter: `?`, `.` or `#`. Any run of letters: `*` or `@`.
- Word breaks: a space means a word break and `-` a hyphen, so `?a?e? ???` means (5,3). An enumeration can also be typed in brackets: `c?y?t?c (7)`.
- **Results must match the enumeration, not just the letters.** `?a?e??` must not return "have on" (4,2). With no breaks typed, only single words match. A toggle "include phrases" allows any word breaks with the same letter count.
- Sort by zipf, highest first. Filters: frequency band (slider or segmented control: Common → All), include proper nouns (on by default).
- Show the pattern as a row of crossword squares that fill in as Tom types.

### 2.3 Anagram solver
- Exact anagrams of the fodder (letters only, any case, spaces ignored). Phrase entries count, e.g. TINSEL gives listen, silent, lets in (4,2), enlist, tinsel, inlets.
- `?` in the fodder = an unknown extra letter (up to 2).
- Optional pattern filter from crossing letters (e.g. fodder `tinsel`, pattern `?i????`).
- **Leftover letters helper:** fodder plus a candidate word → shows which letters remain, or which letters the candidate needs that the fodder lacks.
- Sort by zipf. The fodder appears as letter squares; when results arrive, the letters animate into the first answer's squares.
- Not in v1: splitting fodder into any two arbitrary words (too slow on a phone).

### 2.4 Abbreviations (both directions)
**Group everything into one block per query**, never one card per row:
- **Abbreviation → meanings.** `S` shows one block headed "S", with all Tier 1 meanings (quarter, second, shilling, sierra, son, south, spade, succeeded, suit) prominent, then Tier 2 and Tier 3 underneath, each collapsed behind a "26 more" style control.
- **Word → abbreviations.** `sailor` shows one block: **AB · OS · TAR** (Tier 1), then HAND · JACK · RN · SALT (Tier 2). Tapping an abbreviation opens its own block.
- If the input is both an abbreviation and a clue term (e.g. "on"), show both blocks.
- Abbreviations are plain text, bold or small caps. **Do not put abbreviations in squares**; Tom did not like that in the mockup.
- Show `note` quietly after the meaning, e.g. "the · French". Category can be a filter, not a label on every item.
- Matching is case-insensitive.

### 2.5 Word lookup (dictionary + thesaurus)
- Definitions from `d`, grouped by part of speech, numbered.
- Fallbacks when there is no `d`:
  1. `f` exists → show "plural of ale" and the base word's definitions underneath (fetch its record).
  2. Phrase or hyphenated → "Built from: pearl + fisher" with each part's first definition.
  3. Otherwise → "Valid word, no definition yet."
- Thesaurus sections: Synonyms (`s`), Type of (`t`), Kinds (`k`). Sort each list by zipf from `words.tsv`, and dim band-5 words.
- **Thesaurus filtered by pattern or length** is a key feature: "synonyms of sailor matching `???`" → gob, tar. Provide a small pattern field on the thesaurus panel.

### 2.6 Definitions everywhere
- Any word shown anywhere in the app (results, meanings, glosses, thesaurus) that exists in `words.tsv` can show its definition.
- **PC:** hover for ~300 ms → small popover with the first 2–3 definitions and an "open" link.
- **Touch:** tap → bottom sheet that slides up, with the full entry.
- Words inside a definition are tappable too, so Tom can follow a chain. Keep a short back-trail at the top of the sheet.

### 2.7 Small things
- Recent searches and pinned words, stored on the device.
- Keyboard on PC: `/` focus search, arrow keys move through results, Enter opens, Esc closes.
- Light and dark modes (follow the system, with a manual override).

---

## 3. Design direction

Start from the **"Ink & Grid"** mockup Tom preferred, but treat it as a starting point, not a spec. He wants to iterate on the look.

- **Feel:** sleek, modern, quietly literary. Like a broadsheet crossword page turned into a fast app. No emoji, no chunky rounded "kids' app" buttons, no gradient washes.
- **Colours (light):** paper `#F6F3EC`, card `#FFFDF8`, ink `#1B1A17`, muted text `#5E5A52`, rule lines `#DDD6C8` / `#ECE6DA`, one accent, crossword red `#B8322A`. Dark mode: charcoal background with cream text, same accent family.
- **Type:** Fraunces (serif) for headings and headwords; Inter for UI and body. Both are free on Google Fonts. Self-host them so the app works offline.
- **Letter squares** (1.5 px ink borders, collapsed edges like a real grid) only for pattern entry, anagram fodder and anagram answers. Nowhere else.
- **Wordmark:** the "H" in a filled black crossword square, followed by "awktionary" in Fraunces. The name comes from Tom's surname, not the bird, so no bird imagery.
- **Motion** (short, purposeful, ~150–500 ms, with `prefers-reduced-motion` respected):
  - results rise and fade in, staggered 30–60 ms;
  - anagram letters drop into their squares;
  - definition sheet slides up; popovers grow from the word;
  - frequency bars grow from the left.
- **Layout:** phone first (360–430 px). On tablet and PC, use the width: e.g. results on the left, the entry on the right.
- Touch targets at least 44 px; text contrast at least 4.5:1.

---

## 4. Architecture

- **Plain HTML, CSS and JavaScript (ES modules)**, no framework needed. If a build step helps, use Vite; keep the output static. The site is deployed from `public/` (or the build output) to GitHub Pages by a GitHub Actions workflow.
- **One data layer** (`data.js` or similar) that the UI talks to. Nothing else touches fetch, Cache or storage. Interface along the lines of:
  - `loadCore()` → words + abbreviations
  - `getEntry(display)` → record or null
  - `prefetchAll(onProgress)` → download and cache all shards
  - `storageStatus()` → what is cached, quota, persisted or not

  For the Android version, this module gets swapped for one that reads bundled files or native SQLite; the UI must not change.
- **Search work in a Web Worker.** Build length buckets and an alphagram map once at start-up; pattern and anagram queries run there so typing never stutters.
- **Offline:**
  - A service worker caches the app shell and the core files on first visit.
  - It then downloads all shards in the background, showing quiet progress ("Offline dictionary 64%").
  - Ask for persistent storage (`navigator.storage.persist()`).
  - On start-up, check the shards are still cached and re-fetch any that are missing. Mobile browsers can clear site data.
- **Versioning:** use `manifest.json`'s `version` to invalidate old caches when the data is regenerated.
- Total on-device size is about 70 MB of data plus the app. That's comparable to Tom's Chambers app and is fine.

---

## 5. Licences and the About screen (required)

Put an About screen in the app, linked from a menu. It must:

- **Prominently show these copyright notices:**
  - "UK Advanced Cryptics Dictionary: Copyright (c) J Ross Beresford 1993-2000. All Rights Reserved."
  - "Ledger's Wordz: Copyright (c) W L White 2020. All rights reserved."
- **Include, verbatim and unchanged,** the two README texts in `LICENSES/`: `UKACD README.TXT` and `WORDZ READ ME.txt`. Both licences require this. Ship them with the app, and link to them from the About screen.
- **Credit the other sources** listed in `LICENSES/CREDITS.md`:
  - Wiktionary, via kaikki.org (CC BY-SA)
  - WordNet 3.0 (Princeton WordNet licence)
  - Moby Thesaurus (public domain)
  - wordfreq (CC BY-SA)

The app code itself can use any licence. The data under `public/data/` stays under CC BY-SA because of Wiktionary and wordfreq.

---

## 6. Known data quirks

- Phrase frequency scores are estimates from their words. Short combinations of common words ("to-be", "all-in") score too high.
- WordNet synonym order is not by importance. That's why the UI sorts thesaurus lists by zipf.
- `k` (kinds) lists can be long and unordered, which is another reason to sort and filter them.
- Proper-noun entries can have place-name filler definitions. The worst are already removed, but some remain.

---

## 7. Not in version 1

These are planned later:

- hidden-word finder, reversal and letter-removal helpers
- two-word anagram splitting
- reverse dictionary (search inside definitions)
- homophones (CMU Pronouncing Dictionary)
- indicator lists
- clue scratchpad
- the Capacitor Android build

---

## 8. Working with Tom

- He iterates by trying things. Get a working skeleton of all four tools up early, then polish.
- Keep design tokens in one place so "make it darker", "try a different accent" or "less animation" are small edits.
- Write UI text in plain British English. No marketing slogans.
