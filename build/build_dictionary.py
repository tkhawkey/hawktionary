"""
build_dictionary.py - rebuilds the crossword dictionary from the raw sources.

Creates a NEW file, dictionary_v2.sqlite. Your existing dictionary.sqlite is only
read (for the cleaned abbreviations table) and is never changed.

Run from the Dictionary folder:
    python build_dictionary.py

Sources it expects in the same folder:
    LedgersWordz downloaded/   UKACD word arrays (AllWordzArray*.js)
    WNdb-3.0/dict/             WordNet 3.0 data files
    kaikki.org-dictionary-English.jsonl   Wiktionary extract
    moby_thesaurus.txt         Moby Thesaurus (optional - skipped if missing)
    word_frequencies.tsv       wordfreq frequency list (optional - skipped if missing)
    dictionary.sqlite          current database (abbreviations are copied from it)

The Wiktionary step reads a 3.4 GB file and takes a while. Progress is printed.
A summary is written to build_report.txt at the end.
"""
import glob
import json
import math
import os
import re
import sqlite3
import sys
import time
import unicodedata
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "dictionary_v2.sqlite")
TMP = os.path.join(HERE, "dictionary_v2.building.sqlite")
OLD_DB = os.path.join(HERE, "dictionary.sqlite")
UKACD_DIR = os.path.join(HERE, "LedgersWordz downloaded")
WORDNET_DIR = os.path.join(HERE, "WNdb-3.0", "dict")
KAIKKI = os.path.join(HERE, "kaikki.org-dictionary-English.jsonl")
MOBY = os.path.join(HERE, "moby_thesaurus.txt")
FREQ = os.path.join(HERE, "word_frequencies.tsv")
REPORT = os.path.join(HERE, "build_report.txt")

report_lines = []


def log(msg):
    print(msg, flush=True)
    report_lines.append(msg)


# ---------------------------------------------------------------- text helpers

def fold(text):
    """Lower-case and strip accents: 'Röntgen' -> 'rontgen'."""
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return stripped.replace("æ", "ae").replace("Æ", "ae").replace("œ", "oe").replace("Œ", "oe").replace("ß", "ss").lower()


def make_key(text):
    """Lookup key: folded, single spaces, keeps spaces/hyphens/apostrophes."""
    return re.sub(r"\s+", " ", fold(text).replace("’", "'")).strip()


def letters_only(text):
    return re.sub(r"[^a-z]", "", fold(text))


def enumeration(text):
    """'Aaron's rod' -> '6,3'   'set-square' -> '3-6'."""
    parts = []
    for word in text.split():
        pieces = [str(len(letters_only(p))) for p in word.split("-") if letters_only(p)]
        if pieces:
            parts.append("-".join(pieces))
    return ",".join(parts)


# ---------------------------------------------------------------- schema

SCHEMA = """
CREATE TABLE entries (
    id           INTEGER PRIMARY KEY,
    display      TEXT NOT NULL UNIQUE,   -- as UKACD spells it: "Aaron's rod", "abbé"
    key          TEXT NOT NULL,          -- folded lookup form: "aaron's rod", "abbe"
    letters      TEXT NOT NULL,          -- grid letters only: "aaronsrod"
    length       INTEGER NOT NULL,       -- number of letters
    enumeration  TEXT NOT NULL,          -- "6,3", "3-6", "7"
    alphagram    TEXT NOT NULL,          -- letters sorted, for anagrams
    word_count   INTEGER NOT NULL,
    is_proper    INTEGER NOT NULL,       -- starts with a capital (place, person...)
    is_phrase    INTEGER NOT NULL,       -- more than one word
    has_accent   INTEGER NOT NULL,
    zipf         REAL,                   -- word frequency: 7 = 'the', 3 = uncommon, 0 = not found
    freq_band    INTEGER,                -- 1 common, 2 familiar, 3 uncommon, 4 rare, 5 obscure
    freq_estimated INTEGER               -- 1 = phrase/compound, worked out from its parts
);

CREATE TABLE senses (
    id              INTEGER PRIMARY KEY,
    entry_id        INTEGER NOT NULL REFERENCES entries(id),
    source          TEXT NOT NULL,       -- 'wordnet' or 'wiktionary'
    pos             TEXT,
    gloss           TEXT NOT NULL,
    rank            INTEGER,             -- order within entry+source
    is_form_of      INTEGER NOT NULL DEFAULT 0,  -- "plural of ale" style pointer
    lemma_text      TEXT,                -- the word it points to
    lemma_entry_id  INTEGER REFERENCES entries(id),
    is_name_only    INTEGER NOT NULL DEFAULT 0,  -- "A surname." style filler
    synset_id       TEXT,                -- WordNet meaning group
    tags            TEXT
);

CREATE TABLE synsets (
    id      TEXT PRIMARY KEY,            -- e.g. 'n00001740'
    pos     TEXT NOT NULL,
    gloss   TEXT NOT NULL,
    examples TEXT
);

CREATE TABLE synset_members (
    synset_id  TEXT NOT NULL REFERENCES synsets(id),
    entry_id   INTEGER NOT NULL REFERENCES entries(id),
    position   INTEGER NOT NULL,
    PRIMARY KEY (synset_id, entry_id)
);

CREATE TABLE synset_links (
    from_synset TEXT NOT NULL,
    to_synset   TEXT NOT NULL,
    type        TEXT NOT NULL,           -- 'type of', 'kind', 'similar to', ...
    PRIMARY KEY (from_synset, to_synset, type)
);

CREATE TABLE relations (
    entry_id         INTEGER NOT NULL REFERENCES entries(id),
    related_text     TEXT NOT NULL,
    related_entry_id INTEGER REFERENCES entries(id),
    type             TEXT NOT NULL,      -- 'synonym', 'type of', 'kind', 'antonym'
    source           TEXT NOT NULL,      -- 'moby', 'wiktionary'
    PRIMARY KEY (entry_id, related_text, type, source)
) WITHOUT ROWID;

CREATE TABLE abbreviations (
    id            INTEGER PRIMARY KEY,
    abbreviation  TEXT NOT NULL,
    clue_term     TEXT NOT NULL,
    note          TEXT,                  -- e.g. 'French', 'old word'
    tier          INTEGER NOT NULL,
    category      TEXT NOT NULL,
    source        TEXT NOT NULL,
    UNIQUE (abbreviation, clue_term, note)
);
"""

INDEXES = """
CREATE INDEX idx_entries_key ON entries(key);
CREATE INDEX idx_entries_letters ON entries(letters);
CREATE INDEX idx_entries_length ON entries(length);
CREATE INDEX idx_entries_alphagram ON entries(alphagram);
CREATE INDEX idx_entries_band ON entries(freq_band);
CREATE INDEX idx_senses_entry ON senses(entry_id);
CREATE INDEX idx_senses_synset ON senses(synset_id);
CREATE INDEX idx_members_entry ON synset_members(entry_id);
CREATE INDEX idx_links_to ON synset_links(to_synset);
CREATE INDEX idx_relations_related ON relations(related_entry_id);
CREATE INDEX idx_abbr_abbr ON abbreviations(abbreviation);
CREATE INDEX idx_abbr_clue ON abbreviations(clue_term);

-- Everything the thesaurus knows about a word, from all three sources.
CREATE VIEW thesaurus AS
    SELECT m1.entry_id AS entry_id, e2.display AS related, 'synonym' AS type, 'wordnet' AS source
    FROM synset_members m1
    JOIN synset_members m2 ON m2.synset_id = m1.synset_id AND m2.entry_id <> m1.entry_id
    JOIN entries e2 ON e2.id = m2.entry_id
    UNION
    SELECT m.entry_id, e2.display, l.type, 'wordnet'
    FROM synset_members m
    JOIN synset_links l ON l.from_synset = m.synset_id
    JOIN synset_members m2 ON m2.synset_id = l.to_synset
    JOIN entries e2 ON e2.id = m2.entry_id
    UNION
    SELECT entry_id, related_text, type, source FROM relations;
"""


# ---------------------------------------------------------------- step 1: words

def build_entries(db):
    log("\n== Step 1: words from UKACD ==")
    files = sorted(glob.glob(os.path.join(UKACD_DIR, "**", "AllWordzArray*.js"), recursive=True))
    if not files:
        sys.exit(f"Could not find AllWordzArray*.js files under {UKACD_DIR}")
    seen = set()
    rows = []
    skipped = 0
    for path in files:
        # These files are Latin-1 (Windows-1252), not UTF-8.
        with open(path, encoding="cp1252", errors="replace") as f:
            for raw in re.findall(r'=\s*"((?:[^"\\]|\\.)*)"\s*;', f.read()):
                display = re.sub(r"\s+", " ", raw.replace('\\"', '"').replace("\\'", "'")).strip()
                letters = letters_only(display)
                if not letters or display in seen:
                    skipped += 1
                    continue
                seen.add(display)
                rows.append((
                    display,
                    make_key(display),
                    letters,
                    len(letters),
                    enumeration(display),
                    "".join(sorted(letters)),
                    len(display.split()),
                    1 if display[:1].isupper() else 0,
                    1 if " " in display else 0,
                    1 if fold(display) != display.lower() else 0,
                ))
    db.executemany(
        "INSERT INTO entries (display, key, letters, length, enumeration, alphagram, word_count, "
        "is_proper, is_phrase, has_accent) VALUES (?,?,?,?,?,?,?,?,?,?)", rows)
    db.commit()
    q = lambda s: db.execute(s).fetchone()[0]
    log(f"{len(rows):,} entries ({skipped:,} blanks/duplicates skipped)")
    log(f"  phrases: {q('select count(*) from entries where is_phrase'):,}")
    log(f"  proper nouns: {q('select count(*) from entries where is_proper'):,}")
    log(f"  with accents: {q('select count(*) from entries where has_accent'):,}")


# ---------------------------------------------------------------- step 1b: frequency

# Zipf points taken off a phrase/compound: 1.0 for the second word, 0.5 for each one after.
PHRASE_PENALTY_FIRST = 1.0
PHRASE_PENALTY_EACH = 0.5


def band(z):
    if z >= 4.0:
        return 1   # common:   silent, listen
    if z >= 3.0:
        return 2   # familiar: enlist, tinsel
    if z >= 2.0:
        return 3   # uncommon: inlets, cerise
    if z >= 1.0:
        return 4   # rare
    return 5       # obscure or not found: tirrivees, gawsy


def build_frequency(db):
    log("\n== Step 1b: word frequency ==")
    if not os.path.exists(FREQ):
        log(f"{os.path.basename(FREQ)} not found - skipped")
        return
    zipf = {}
    with open(FREQ, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            word, _, z = line.rstrip("\n").partition("\t")
            if z:
                zipf[word] = float(z)

    def single(token):
        token = token.lower().replace("’", "'")
        for form in (token, fold(token), token.replace("'", ""), re.sub(r"'s$", "", token)):
            if form in zipf:
                return zipf[form]
        return None

    updates = []
    for eid, display in db.execute("SELECT id, display FROM entries").fetchall():
        tokens = [t for t in re.split(r"[\s-]+", display) if letters_only(t)]
        whole = single(display) if len(tokens) == 1 else None
        if len(tokens) == 1:
            z, est = (whole or 0.0), 0
        else:
            # Same method wordfreq uses for multi-word text (1/f = sum of 1/f_i),
            # then a penalty, because "a bad egg" is far rarer than "egg".
            parts = [single(t) for t in tokens]
            if any(p is None for p in parts):
                z = 0.0
            else:
                inv = sum(1 / (10 ** (p - 9)) for p in parts)
                penalty = PHRASE_PENALTY_FIRST + PHRASE_PENALTY_EACH * (len(tokens) - 2)
                z = max(0.0, math.log10(1 / inv) + 9 - penalty)
            est = 1
        z = round(z, 2)
        updates.append((z, band(z), est, eid))
    db.executemany("UPDATE entries SET zipf=?, freq_band=?, freq_estimated=? WHERE id=?", updates)
    db.commit()
    names = {1: "common", 2: "familiar", 3: "uncommon", 4: "rare", 5: "obscure / not found"}
    for b, n in db.execute("SELECT freq_band, count(*) FROM entries GROUP BY 1 ORDER BY 1"):
        log(f"  {b} {names[b]}: {n:,}")


class Lookup:
    """Find entry ids for a word as written in another source."""

    def __init__(self, db):
        self.by_display = {}
        self.by_key = defaultdict(list)
        for eid, display, key in db.execute("SELECT id, display, key FROM entries"):
            self.by_display[display] = eid
            self.by_key[key].append(eid)

    def ids(self, text):
        text = text.strip()
        if text in self.by_display:
            return [self.by_display[text]]
        return self.by_key.get(make_key(text), [])

    def one(self, text):
        found = self.ids(text)
        return found[0] if found else None


# ---------------------------------------------------------------- step 2: WordNet

POINTER_NAMES = {
    "@": "type of", "@i": "instance of", "~": "kind", "~i": "instance",
    "&": "similar to", "!": "antonym", "^": "see also", "$": "verb group",
    "=": "attribute", "*": "entails", ">": "causes",
    "#m": "member of", "#s": "substance of", "#p": "part of",
    "%m": "has member", "%s": "has substance", "%p": "has part",
}


def build_wordnet(db, look):
    log("\n== Step 2a: WordNet meaning groups ==")
    if not os.path.isdir(WORDNET_DIR):
        log(f"WordNet folder not found at {WORDNET_DIR} - skipped")
        return
    synsets, members, links, senses = [], [], set(), []
    unmatched = 0
    for fname, pos_name in (("data.noun", "noun"), ("data.verb", "verb"),
                            ("data.adj", "adj"), ("data.adv", "adv")):
        file_letter = {"noun": "n", "verb": "v", "adj": "a", "adv": "r"}[pos_name]
        with open(os.path.join(WORDNET_DIR, fname), encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("  ") or "|" not in line:
                    continue
                head, gloss_part = line.split("|", 1)
                tokens = head.split()
                sid = file_letter + tokens[0]
                w_cnt = int(tokens[3], 16)
                lemmas = []
                for i in range(w_cnt):
                    lemma = tokens[4 + 2 * i]
                    lemma = re.sub(r"\([a-z]+\)$", "", lemma).replace("_", " ")
                    lemmas.append(lemma)
                p_at = 4 + 2 * w_cnt
                p_cnt = int(tokens[p_at])
                for j in range(p_cnt):
                    sym, off, ppos = tokens[p_at + 1 + 4 * j: p_at + 4 + 4 * j]
                    target_letter = "a" if ppos == "s" else ppos
                    if sym in POINTER_NAMES:
                        links.add((sid, target_letter + off, POINTER_NAMES[sym]))
                gloss_part = gloss_part.strip()
                m = re.match(r'(.*?)(;\s*".*)?$', gloss_part)
                definition = m.group(1).strip().rstrip(";").strip()
                examples = (m.group(2) or "").lstrip("; ").strip() or None
                synsets.append((sid, pos_name, definition, examples))
                for pos_i, lemma in enumerate(lemmas):
                    ids = look.ids(lemma)
                    if not ids:
                        unmatched += 1
                    for eid in ids:
                        members.append((sid, eid, pos_i))
                        senses.append((eid, "wordnet", pos_name, definition, sid))
    db.executemany("INSERT INTO synsets VALUES (?,?,?,?)", synsets)
    db.executemany("INSERT OR IGNORE INTO synset_members VALUES (?,?,?)", members)
    db.executemany("INSERT OR IGNORE INTO synset_links VALUES (?,?,?)", sorted(links))
    db.executemany("INSERT INTO senses (entry_id, source, pos, gloss, synset_id) VALUES (?,?,?,?,?)", senses)
    db.commit()
    log(f"{len(synsets):,} meaning groups, {len(members):,} word links, {len(links):,} type-of/similar links")
    log(f"  WordNet words not in UKACD (ignored): {unmatched:,}")


# ---------------------------------------------------------------- step 2b: Moby

def build_moby(db, look):
    log("\n== Step 2b: Moby Thesaurus ==")
    if not os.path.exists(MOBY):
        log(f"{os.path.basename(MOBY)} not found - skipped")
        return
    rows = []
    heads = 0
    with open(MOBY, encoding="utf-8", errors="replace") as f:
        for line in f:
            parts = [p.strip() for p in line.strip().split(",") if p.strip()]
            if len(parts) < 2:
                continue
            head_ids = look.ids(parts[0])
            if not head_ids:
                continue
            heads += 1
            for syn in dict.fromkeys(parts[1:]):
                rid = look.one(syn)
                for hid in head_ids:
                    if rid != hid:
                        rows.append((hid, syn, rid, "synonym", "moby"))
            if len(rows) > 500_000:
                db.executemany("INSERT OR IGNORE INTO relations VALUES (?,?,?,?,?)", rows)
                rows = []
    db.executemany("INSERT OR IGNORE INTO relations VALUES (?,?,?,?,?)", rows)
    db.commit()
    total = db.execute("SELECT count(*) FROM relations WHERE source='moby'").fetchone()[0]
    log(f"{heads:,} headwords matched, {total:,} synonym links")


# ---------------------------------------------------------------- step 3: Wiktionary

NAME_FILLER = re.compile(
    r"^(an? |the )?([a-z-]+ ){0,4}(surname|given name|forename|male name|female name|"
    r"patronymic surname|placename|place name)\b"
    r"|unincorporated community|census-designated place"
    r"|^an? ([a-z-]+ ){0,3}(village|hamlet|town|township|city|community|suburb|neighbou?rhood|"
    r"locality|parish|place|ghost town)\b.{0,80}\b(county|parish|township)\b", re.I)


def clean_gloss(text):
    text = re.sub(r"\{\{|\}\}|\[\[|\]\]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def build_wiktionary(db, look):
    log("\n== Step 3: Wiktionary definitions (slow - large file) ==")
    if not os.path.exists(KAIKKI):
        log(f"{os.path.basename(KAIKKI)} not found - skipped")
        return
    proper = {eid for (eid,) in db.execute("SELECT id FROM entries WHERE is_proper")}
    seen = set()
    rank = defaultdict(int)
    senses, rels = [], []
    stats = defaultdict(int)
    size = os.path.getsize(KAIKKI)
    start = time.time()
    bytes_read = 0
    with open(KAIKKI, "rb") as f:
        for n, line in enumerate(f, 1):
            bytes_read += len(line)
            if n % 100_000 == 0:
                done = bytes_read / size
                print(f"  {done:5.1%} read, {stats['kept']:,} definitions kept, "
                      f"{time.time() - start:,.0f}s", flush=True)
                flush_wiktionary(db, senses, rels)
                senses, rels = [], []
            try:
                data = json.loads(line)
            except ValueError:
                continue
            word = data.get("word") or ""
            ids = look.ids(word)
            if not ids:
                continue
            pos = data.get("pos") or "unknown"
            for eid in ids:
                # Name senses ("A surname.") only belong on capitalised entries.
                if pos == "name" and eid not in proper:
                    stats["name on common word"] += 1
                    continue
                for sense in data.get("senses", []):
                    glosses = sense.get("glosses") or []
                    if not glosses:
                        continue
                    gloss = clean_gloss(glosses[-1])
                    if not gloss:
                        continue
                    dedupe = (eid, gloss.lower())
                    if dedupe in seen:
                        stats["duplicates removed"] += 1
                        continue
                    seen.add(dedupe)
                    tags = sense.get("tags") or []
                    target = (sense.get("form_of") or sense.get("alt_of") or [{}])[0].get("word")
                    is_form = 1 if (target or "form-of" in tags or "alt-of" in tags) else 0
                    lemma_id = look.one(target) if target else None
                    is_name = 1 if (pos == "name" and NAME_FILLER.search(gloss)) else 0
                    rank[eid] += 1
                    senses.append((eid, "wiktionary", pos, gloss, rank[eid], is_form,
                                   target, lemma_id, is_name, ",".join(tags) or None))
                    stats["kept"] += 1
                    stats["form-of pointers"] += is_form
                    stats["name fillers flagged"] += is_name
                    for rel_key, rel_type in (("synonyms", "synonym"), ("hypernyms", "type of"),
                                              ("antonyms", "antonym")):
                        for item in sense.get(rel_key) or []:
                            other = (item.get("word") or "").strip() if isinstance(item, dict) else ""
                            if other and other.lower() != word.lower():
                                rels.append((eid, other, look.one(other), rel_type, "wiktionary"))
    flush_wiktionary(db, senses, rels)
    for k in ("kept", "form-of pointers", "name fillers flagged", "duplicates removed", "name on common word"):
        log(f"  {k}: {stats[k]:,}")
    log(f"  took {time.time() - start:,.0f}s")


def flush_wiktionary(db, senses, rels):
    db.executemany(
        "INSERT INTO senses (entry_id, source, pos, gloss, rank, is_form_of, lemma_text, "
        "lemma_entry_id, is_name_only, tags) VALUES (?,?,?,?,?,?,?,?,?,?)", senses)
    db.executemany("INSERT OR IGNORE INTO relations VALUES (?,?,?,?,?)", rels)
    db.commit()


# ---------------------------------------------------------------- step 4: abbreviations

ELEMENTS = {
    "H": "hydrogen", "He": "helium", "Li": "lithium", "Be": "beryllium", "B": "boron", "C": "carbon",
    "N": "nitrogen", "O": "oxygen", "F": "fluorine", "Ne": "neon", "Na": "sodium", "Mg": "magnesium",
    "Al": "aluminium", "Si": "silicon", "P": "phosphorus", "S": "sulphur", "Cl": "chlorine", "Ar": "argon",
    "K": "potassium", "Ca": "calcium", "Sc": "scandium", "Ti": "titanium", "V": "vanadium", "Cr": "chromium",
    "Mn": "manganese", "Fe": "iron", "Co": "cobalt", "Ni": "nickel", "Cu": "copper", "Zn": "zinc",
    "Ga": "gallium", "Ge": "germanium", "As": "arsenic", "Se": "selenium", "Br": "bromine", "Kr": "krypton",
    "Rb": "rubidium", "Sr": "strontium", "Y": "yttrium", "Zr": "zirconium", "Nb": "niobium",
    "Mo": "molybdenum", "Tc": "technetium", "Ru": "ruthenium", "Rh": "rhodium", "Pd": "palladium",
    "Ag": "silver", "Cd": "cadmium", "In": "indium", "Sn": "tin", "Sb": "antimony", "Te": "tellurium",
    "I": "iodine", "Xe": "xenon", "Cs": "caesium", "Ba": "barium", "La": "lanthanum", "Ce": "cerium",
    "Pr": "praseodymium", "Nd": "neodymium", "Pm": "promethium", "Sm": "samarium", "Eu": "europium",
    "Gd": "gadolinium", "Tb": "terbium", "Dy": "dysprosium", "Ho": "holmium", "Er": "erbium",
    "Tm": "thulium", "Yb": "ytterbium", "Lu": "lutetium", "Hf": "hafnium", "Ta": "tantalum",
    "W": "tungsten", "Re": "rhenium", "Os": "osmium", "Ir": "iridium", "Pt": "platinum", "Au": "gold",
    "Hg": "mercury", "Tl": "thallium", "Pb": "lead", "Bi": "bismuth", "Po": "polonium", "At": "astatine",
    "Rn": "radon", "Fr": "francium", "Ra": "radium", "Ac": "actinium", "Th": "thorium",
    "Pa": "protactinium", "U": "uranium", "Np": "neptunium", "Pu": "plutonium", "Am": "americium",
    "Cm": "curium", "Bk": "berkelium", "Cf": "californium", "Es": "einsteinium", "Fm": "fermium",
    "Md": "mendelevium", "No": "nobelium", "Lr": "lawrencium", "Rf": "rutherfordium", "Db": "dubnium",
    "Sg": "seaborgium", "Bh": "bohrium", "Hs": "hassium", "Mt": "meitnerium",
}
OLD_ELEMENT_NAMES = {"columbium", "nielsbohrium", "hahnium", "kurchatovium", "sulfur", "aluminum",
                     "cesium", "phosphorous", "argon", "wolfram"}
ELEMENT_NAMES = set(ELEMENTS.values()) | OLD_ELEMENT_NAMES

NATO = {"alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet",
        "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango",
        "uniform", "victor", "whiskey", "x-ray", "yankee", "zulu"}
GREEK = {"alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta", "iota", "kappa",
         "lambda", "mu", "nu", "xi", "omicron", "pi", "rho", "sigma", "tau", "upsilon", "phi", "chi",
         "psi", "omega", "greek letter", "greek character"}
DIRECTIONS = {"north", "south", "east", "west", "northern", "southern", "eastern", "western",
              "north-east", "north-west", "south-east", "south-west", "north-eastern", "north-western",
              "south-eastern", "south-western", "bearing", "direction", "point", "compass point",
              "cardinal", "quarter", "corner", "bridge player", "bridge players", "hand",
              "bridge opponents", "bridge partners", "partnership", "pole"}
NOTE_NAMES = {"A", "B", "C", "D", "E", "F", "G", "DO", "DOH", "RE", "MI", "ME", "FA", "FAH", "SO",
              "SOH", "SOL", "LA", "LAH", "TE", "TI", "UT", "SI"}
MUSIC = {"key", "string", "strings", "violin string", "violin strings", "quiet", "quietly",
         "soft", "softly", "loud", "loudly", "very loud", "very quiet", "quite loud", "quite quiet",
         "forte", "fortissimo", "piano", "pianissimo", "mezzo-forte", "mezzo-piano", "soprano",
         "alto", "tenor", "bass", "contralto", "clef"}
CALENDAR = {"january", "february", "march", "april", "may", "june", "july", "august", "september",
            "october", "november", "december", "monday", "tuesday", "wednesday", "thursday", "friday",
            "saturday", "sunday", "month", "week", "year", "day", "date"}
US_STATES = {"alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut",
             "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa",
             "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan",
             "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new hampshire",
             "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio",
             "oklahoma", "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota",
             "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west virginia",
             "wisconsin", "wyoming"}
COUNTRIES = {
    "afghanistan", "albania", "algeria", "andorra", "angola", "argentina", "armenia", "australia",
    "austria", "azerbaijan", "bahamas", "bahrain", "bangladesh", "barbados", "belarus", "belgium",
    "belize", "benin", "bhutan", "bolivia", "bosnia", "botswana", "brazil", "brunei", "bulgaria",
    "burkina faso", "burundi", "cambodia", "cameroon", "canada", "central african republic", "chad",
    "chile", "china", "colombia", "congo", "costa rica", "croatia", "cuba", "cyprus", "czech republic",
    "czechoslovakia", "democratic republic of congo", "denmark", "dominica", "ecuador", "egypt",
    "el salvador", "estonia", "ethiopia", "faroe islands", "fiji", "finland", "france", "gabon",
    "gambia", "germany", "east germany", "ghana", "gibraltar", "greece", "grenada", "guatemala",
    "guinea", "guyana", "haiti", "honduras", "hong kong", "hungary", "iceland", "india", "indonesia",
    "iran", "iraq", "ireland", "israel", "italy", "ivory coast", "jamaica", "japan", "jordan",
    "kazakhstan", "kenya", "kuwait", "laos", "latvia", "lebanon", "lesotho", "liberia", "libya",
    "liechtenstein", "lithuania", "luxembourg", "macedonia", "madagascar", "malawi", "malaysia",
    "mali", "malta", "mauritania", "mauritius", "mexico", "moldova", "monaco", "mongolia", "morocco",
    "mozambique", "myanmar", "namibia", "nepal", "netherlands", "netherlands antilles",
    "new zealand", "nicaragua", "niger", "nigeria", "norway", "oman", "pakistan", "panama",
    "papua new guinea", "paraguay", "peru", "philippines", "poland", "portugal", "qatar", "romania",
    "russia", "rwanda", "san marino", "sao tome and principe", "saudi arabia", "senegal",
    "seychelles", "sierra leone", "singapore", "slovakia", "slovenia", "somalia", "south africa",
    "spain", "sri lanka", "st kitts and nevis", "st lucia", "sudan", "suriname", "swaziland",
    "sweden", "switzerland", "syria", "taiwan", "tanzania", "thailand", "togo", "trinidad and tobago",
    "tunisia", "turkey", "turkmenistan", "uganda", "ukraine", "united arab emirates",
    "united kingdom", "united states", "america", "britain", "great britain", "uruguay",
    "vatican city", "venezuela", "vietnam", "yemen", "yugoslavia", "zaire", "zambia", "zimbabwe",
    "england", "scotland", "wales", "europe", "africa", "asia"}
NUMBER_WORDS = {"zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
                "ten", "eleven", "twelve", "fifteen", "twenty", "forty", "fifty", "ninety", "hundred",
                "thousand", "million", "billion", "half", "dozen", "and", "a", "large", "number",
                "sixty", "eighty", "seventy", "thirty", "one hundred", "half century",
                "half dozen", "quartet", "nine", "dime"}
LANGUAGES = {"french", "german", "italian", "spanish", "latin", "russian", "scottish", "dutch",
             "greek", "japanese", "american", "irish", "welsh"}


def is_number_phrase(text):
    words = re.split(r"[\s-]+", text)
    return bool(words) and (all(w in NUMBER_WORDS for w in words) or re.fullmatch(r"\$?[\d.,]+", text))


def categorise(abbr, clue, note):
    if note and note.lower() in LANGUAGES:
        return "foreign word"
    if clue in ELEMENT_NAMES or (ELEMENTS.get(abbr.capitalize()) == clue):
        return "chemical element"
    if clue in GREEK and len(abbr) <= 3:
        return "Greek letter"
    if clue in NATO and len(abbr) == 1:
        return "NATO alphabet"
    if is_number_phrase(clue):
        return "Roman numeral" if re.fullmatch(r"[IVXLCDM]+", abbr) else "number"
    if clue in DIRECTIONS and re.fullmatch(r"[NSEW]{1,2}", abbr):
        return "direction / bridge"
    if clue in CALENDAR:
        return "calendar"
    if clue in US_STATES and len(abbr) <= 3:
        return "US state"
    if clue in COUNTRIES:
        return "country / vehicle code"
    if clue in MUSIC or (clue == "note" and abbr in NOTE_NAMES):
        return "music"
    return "general"


def build_abbreviations(db):
    log("\n== Step 4: abbreviations ==")
    if not os.path.exists(OLD_DB):
        log(f"{os.path.basename(OLD_DB)} not found - skipped")
        return
    old = sqlite3.connect(f"file:{OLD_DB}?mode=ro", uri=True)
    rows = old.execute("SELECT abbreviation, clue_term, tier FROM cryptic_abbreviations").fetchall()
    old.close()
    out = {}
    split_notes = 0
    for abbr, clue, tier in rows:
        clue = clue.strip()
        note = None
        m = re.match(r"^(.*?)\s*\(([^)]*)\)\s*$", clue)
        if m and m.group(1):
            clue, note = m.group(1).strip(), m.group(2).strip()
            note = note.capitalize() if note.lower() in LANGUAGES else note
            split_notes += 1
        key = (abbr, clue, note)
        if key in out:
            out[key][3] = min(out[key][3], tier)  # keep the higher tier if two rows merge
            continue
        out[key] = [abbr, clue, note, tier, categorise(abbr, clue, note), "legacy import (audited Oct 2026)"]
    db.executemany(
        "INSERT INTO abbreviations (abbreviation, clue_term, note, tier, category, source) "
        "VALUES (?,?,?,?,?,?)", list(out.values()))
    db.commit()
    log(f"{len(out):,} abbreviations copied ({len(rows) - len(out)} merged), {split_notes} notes split out")
    for cat, n in db.execute("SELECT category, count(*) FROM abbreviations GROUP BY 1 ORDER BY 2 DESC"):
        log(f"  {cat}: {n:,}")


# ---------------------------------------------------------------- finishing

def finish(db):
    log("\n== Indexes and search ==")
    db.executescript(INDEXES)
    try:
        db.executescript("""
            CREATE VIRTUAL TABLE senses_fts USING fts5(gloss, content='senses', content_rowid='id');
            INSERT INTO senses_fts(senses_fts) VALUES ('rebuild');
        """)
        log("Full-text search over definitions: on (table senses_fts)")
    except sqlite3.OperationalError as e:
        log(f"Full-text search not available in this Python's SQLite ({e}) - skipped")
    db.commit()
    q = lambda s: db.execute(s).fetchone()[0]
    log("\n== Summary ==")
    log(f"entries:                 {q('select count(*) from entries'):,}")
    log(f"entries with a definition: {q('select count(distinct entry_id) from senses where is_form_of=0 and is_name_only=0'):,}")
    log(f"senses (all):            {q('select count(*) from senses'):,}")
    log(f"thesaurus links (moby + wiktionary): {q('select count(*) from relations'):,}")
    log(f"WordNet meaning groups:  {q('select count(*) from synsets'):,}")
    log(f"abbreviations:           {q('select count(*) from abbreviations'):,}")
    log("\nSpot checks:")
    for word in ("abbé", "Aaron's rod", "set-square", "röntgenology"):
        row = db.execute("SELECT display, enumeration, alphagram FROM entries WHERE display=?", (word,)).fetchone()
        log(f"  {word!r}: {row}")
    anag = [f"{r[0]} ({r[1]})" for r in db.execute(
        "SELECT display, zipf FROM entries WHERE alphagram=(SELECT alphagram FROM entries "
        "WHERE display='listen') ORDER BY zipf DESC")]
    log(f"  anagrams of 'listen', most common first: {', '.join(anag)}")


def main():
    for path in (TMP, TMP + "-journal"):
        if os.path.exists(path):
            os.remove(path)
    db = sqlite3.connect(TMP)
    db.execute("PRAGMA journal_mode = OFF")
    db.execute("PRAGMA synchronous = OFF")
    db.executescript(SCHEMA)
    start = time.time()
    log(f"Building {os.path.basename(OUT)} - {time.strftime('%Y-%m-%d %H:%M')}")

    build_entries(db)
    build_frequency(db)
    look = Lookup(db)
    build_wordnet(db, look)
    build_moby(db, look)
    if "--skip-wiktionary" in sys.argv:
        log("\n== Step 3: Wiktionary skipped (--skip-wiktionary) ==")
    else:
        build_wiktionary(db, look)
    build_abbreviations(db)
    finish(db)
    db.execute("VACUUM")
    db.close()
    os.replace(TMP, OUT)
    log(f"\nDone in {(time.time() - start) / 60:.1f} minutes -> {os.path.basename(OUT)}")
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(report_lines) + "\n")


if __name__ == "__main__":
    main()
