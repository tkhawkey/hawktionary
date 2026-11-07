"""
build_extras.py - adds the extra layers to dictionary_v2.sqlite.

Run from the Dictionary folder, AFTER build_dictionary.py and BEFORE export_slim.py:
    python build_dictionary.py
    python build_extras.py
    python export_slim.py

What it adds (each step is skipped quietly if its source file is missing):
  1. Extra words: Ledger White's Greek mythology list and his 187 "missing from Chambers" words.
  2. Mythology and religion names from Wiktionary (Greek, Norse, Egyptian, Hindu, Biblical ...),
     plus subject tags on every entry that has them (Icarus -> Greek mythology).
  3. Abbreviation categories: several categories per abbreviation (rivers, doctors, military,
     royalty, books of the Bible ...) and "umbrella" words, so searching "state" shows every
     US state. Writes category_review.csv for checking. Corrections go in
     abbreviation_category_overrides.csv (see the end of this file's docstring).
  4. Crossword indicators   (needs cryptics_indicators.csv in this folder)
  5. Charades / clue pieces (needs cryptics_charades.csv in this folder)

To redo only steps 4 and 5 (e.g. after downloading those files):
    python build_extras.py --clue-data-only
    python export_slim.py

Indicators and charades come from George Ho's cryptic crossword dataset,
https://cryptics.georgeho.org (Open Database License). Download them in a browser:
  https://cryptics.georgeho.org/data/indicators.csv?_stream=on&_size=max  -> save as cryptics_indicators.csv
  https://cryptics.georgeho.org/data/charades.csv?_stream=on&_size=max    -> save as cryptics_charades.csv

extra_words.txt (optional) is your own list of words the sources miss, one per line:
  Polydectes - King of Seriphos, who sent Perseus to fetch the head of Medusa | Greek mythology
  word only
  word - short definition
The definition is used only if Wiktionary has none; the tag after " | " is optional.

abbreviation_category_overrides.csv (optional) has three columns:
  abbreviation,clue_term,categories
  DD,doctor,doctor; clergy
  AB,hand,
A row replaces the categories for that abbreviation + clue term; an empty categories
cell means "general".
"""
import csv
import glob
import json
import math
import os
import re
import sqlite3
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_dictionary as bd  # reuse its text helpers and category lists

DB = os.path.join(HERE, "dictionary_v2.sqlite")
GREEK_LIST = glob.glob(os.path.join(HERE, "LedgersWordz downloaded", "**", "GreekMythology", "*.txt"), recursive=True)
MISSING_LIST = glob.glob(os.path.join(HERE, "LedgersWordz downloaded", "**", "WordsInChambersNotInWordz", "*.txt"), recursive=True)
INDICATORS_CSV = os.path.join(HERE, "cryptics_indicators.csv")
CHARADES_CSV = os.path.join(HERE, "cryptics_charades.csv")
OVERRIDES_CSV = os.path.join(HERE, "abbreviation_category_overrides.csv")
EXTRA_WORDS = os.path.join(HERE, "extra_words.txt")
REVIEW_CSV = os.path.join(HERE, "category_review.csv")
REPORT = os.path.join(HERE, "build_extras_report.txt")

lines_out = []


def log(msg):
    print(msg, flush=True)
    lines_out.append(msg)


SCHEMA = """
CREATE TABLE IF NOT EXISTS entry_tags (
    entry_id INTEGER NOT NULL REFERENCES entries(id),
    tag      TEXT NOT NULL,
    PRIMARY KEY (entry_id, tag)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS entry_sources (
    entry_id INTEGER PRIMARY KEY REFERENCES entries(id),
    source   TEXT NOT NULL            -- where an entry outside UKACD came from
);
CREATE TABLE IF NOT EXISTS abbreviation_categories (
    abbreviation_id INTEGER NOT NULL REFERENCES abbreviations(id),
    category        TEXT NOT NULL,
    PRIMARY KEY (abbreviation_id, category)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS categories (
    name        TEXT PRIMARY KEY,
    label       TEXT NOT NULL,
    triggers    TEXT NOT NULL,        -- '; ' separated search words that show the whole category
    description TEXT
);
CREATE TABLE IF NOT EXISTS indicators (
    phrase TEXT NOT NULL,
    type   TEXT NOT NULL,             -- anagram, insertion, container, reversal, hidden, deletion, homophone, alternation
    count  INTEGER NOT NULL,          -- how many clues it was seen in
    tier   INTEGER NOT NULL,
    PRIMARY KEY (phrase, type)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS charades (
    clue_text TEXT NOT NULL,          -- word(s) in a clue, e.g. 'fairy'
    letters   TEXT NOT NULL,          -- what they gave in the answer, e.g. 'FAE'
    count     INTEGER NOT NULL,
    tier      INTEGER NOT NULL,
    PRIMARY KEY (clue_text, letters)
) WITHOUT ROWID;
"""


# ------------------------------------------------------------------ helpers

class Freq:
    def __init__(self):
        self.z = {}
        if os.path.exists(bd.FREQ):
            with open(bd.FREQ, encoding="utf-8") as f:
                for line in f:
                    if not line.startswith("#"):
                        w, _, z = line.rstrip("\n").partition("\t")
                        if z:
                            self.z[w] = float(z)

    def one(self, token):
        token = token.lower()
        for form in (token, bd.fold(token), token.replace("'", ""), re.sub(r"'s$", "", token)):
            if form in self.z:
                return self.z[form]
        return None

    def score(self, display):
        tokens = [t for t in re.split(r"[\s-]+", display) if bd.letters_only(t)]
        if len(tokens) == 1:
            return self.one(display) or 0.0
        parts = [self.one(t) for t in tokens]
        if not tokens or any(p is None for p in parts):
            return 0.0
        inv = sum(1 / (10 ** (p - 9)) for p in parts)
        return max(0.0, math.log10(1 / inv) + 9 - (1.0 + 0.5 * (len(tokens) - 2)))


class Entries:
    def __init__(self, db, freq):
        self.db, self.freq = db, freq
        self.by_display, self.by_key = {}, defaultdict(list)
        for eid, d, k in db.execute("SELECT id, display, key FROM entries"):
            self.by_display[d] = eid
            self.by_key[k].append(eid)
        self.added = 0

    def ids(self, text):
        text = text.strip()
        if text in self.by_display:
            return [self.by_display[text]]
        return self.by_key.get(bd.make_key(text), [])

    def add(self, display, source):
        display = re.sub(r"\s+", " ", display).strip()
        if display in self.by_display:
            return self.by_display[display], False
        letters = bd.letters_only(display)
        if len(letters) < 2:
            return None, False
        z = round(self.freq.score(display), 2)
        cur = self.db.execute(
            "INSERT INTO entries (display, key, letters, length, enumeration, alphagram, word_count, is_proper, "
            "is_phrase, has_accent, zipf, freq_band, freq_estimated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (display, bd.make_key(display), letters, len(letters), bd.enumeration(display), "".join(sorted(letters)),
             len(display.split()), 1 if display[:1].isupper() else 0, 1 if " " in display else 0,
             1 if bd.fold(display) != display.lower() else 0, z, bd.band(z), 1 if len(display.split()) > 1 else 0))
        eid = cur.lastrowid
        self.by_display[display] = eid
        self.by_key[bd.make_key(display)].append(eid)
        self.db.execute("INSERT OR REPLACE INTO entry_sources VALUES (?,?)", (eid, source))
        self.added += 1
        return eid, True


# ------------------------------------------------------------------ 1. extra word lists

def extra_words(db, ents):
    log("\n== 1. Extra word lists ==")
    greek_ids, notes = [], {}
    for path in GREEK_LIST:
        with open(path, encoding="cp1252", errors="replace") as f:
            for line in f:
                name = re.split(r"\s*\(", line.strip())[0].strip()
                if "http" in line or "Retrieved" in line or len(name.split()) > 4:
                    continue
                if name and bd.letters_only(name):
                    eid, _ = ents.add(name, "Ledger's Wordz Greek mythology list")
                    if eid:
                        greek_ids.append(eid)
                        db.execute("INSERT OR IGNORE INTO entry_tags VALUES (?, 'Greek mythology')", (eid,))
    log(f"  Greek mythology list: {len(greek_ids)} names ({ents.added} new)")
    before = ents.added
    for path in MISSING_LIST:
        with open(path, encoding="cp1252", errors="replace") as f:
            for line in f:
                line = re.sub(r"\s+\d{1,2}/\d{1,2}/\d{2,4}\s*$", "", line.strip())
                if not line:
                    continue
                word, _, note = line.partition(" - ")
                eid, _ = ents.add(word.strip(), "Ledger's Wordz missing-from-Chambers list")
                if eid and note.strip():
                    notes[eid] = note.strip()
    log(f"  Missing-from-Chambers list: {ents.added - before} new words")
    before, tagged = ents.added, 0
    if os.path.exists(EXTRA_WORDS):
        with open(EXTRA_WORDS, encoding="utf-8-sig") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                body, _, tag = line.partition(" | ")
                word, _, note = body.partition(" - ")
                eid, _ = ents.add(word.strip(), "extra_words.txt")
                if not eid:
                    continue
                if note.strip():
                    notes[eid] = note.strip()
                if tag.strip():
                    db.execute("INSERT OR IGNORE INTO entry_tags VALUES (?,?)", (eid, tag.strip()))
                    tagged += 1
        log(f"  extra_words.txt: {ents.added - before} new words ({tagged} tagged)")
    db.commit()
    return set(greek_ids), notes


# ------------------------------------------------------------------ 2. Wiktionary names + tags

TAG_RULES = [
    ("Greek mythology", r"Greek (mythology|deities)"),
    ("Roman mythology", r"Roman (mythology|deities)"),
    ("Norse mythology", r"Norse (mythology|deities)"),
    ("Egyptian mythology", r"Egyptian (mythology|deities)"),
    ("Hindu", r"Hinduism|Hindu deities|Hindu mythology"),
    ("Buddhist", r"Buddhism|Buddhas|Buddhist deities"),
    ("Celtic mythology", r"Celtic mythology|Irish mythology|Welsh mythology"),
    ("Arthurian", r"Arthurian"),
    ("Biblical", r"Biblical characters|Books of the Bible|^Bible$"),
    ("Japanese mythology", r"Shinto|Japanese deities|Japanese mythology"),
    ("Chinese mythology", r"Chinese mythology|Chinese deities"),
    ("Mesopotamian mythology", r"Mesopotamian (deities|mythology)|Sumerian"),
    ("Aztec mythology", r"Aztec (mythology|deities)|Mayan (mythology|deities)"),
    ("Slavic mythology", r"Slavic (deities|mythology)"),
    ("Mythology (other)", r"^(Mythology|Gods|Mythological figures|Mythological creatures|Mythological locations|"
                          r"Armenian mythology|Iranian mythology|Persian mythology|Hawaiian mythology|"
                          r"Australian Aboriginal mythology|Meitei deities|Tamil deities)$"),
]
TAG_RES = [(t, re.compile(r, re.I)) for t, r in TAG_RULES]


def tags_for(cat_names):
    found = set()
    for c in cat_names:
        if c.startswith("Terms with") or "script" in c:
            continue
        for tag, rx in TAG_RES:
            if rx.search(c):
                found.add(tag)
    return found


def wiktionary_names(db, ents, greek_ids, notes):
    log("\n== 2. Wiktionary: mythology/religion names, tags, definitions for new words ==")
    if not os.path.exists(bd.KAIKKI):
        log("  kaikki file not found - skipped")
        return

    new_ids = set(r[0] for r in db.execute("SELECT entry_id FROM entry_sources"))
    has_defs = set(r[0] for r in db.execute("SELECT DISTINCT entry_id FROM senses"))
    proper = set(r[0] for r in db.execute("SELECT id FROM entries WHERE is_proper"))
    seen = set()
    rank = defaultdict(int)
    senses, tags = [], set()
    stats = defaultdict(int)
    start = time.time()

    def cat_name(c):
        return c if isinstance(c, str) else (c.get("name", "") if isinstance(c, dict) else "")

    markers = (b"ytholog", b"deities", b"Biblical", b"Bible", b"Hinduism", b"Buddh", b"Shinto",
               b"Arthurian", b'"Gods"', b"Sumerian")
    wanted = {bd.make_key(d) for d, eid in ents.by_display.items() if eid in new_ids}

    def top_word(line):
        # The entry's own word sits just before "lang": "English" in each kaikki line.
        i = line.find(b'", "lang": "English"')
        if i < 0:
            return None
        j = line.rfind(b'"word": "', 0, i)
        if j < 0:
            return None
        try:
            return json.loads(line[j + 8:i + 1])
        except ValueError:
            return None
    with open(bd.KAIKKI, "rb") as f:
        for n, line in enumerate(f, 1):
            if n % 250_000 == 0:
                print(f"  {n:,} lines, {time.time() - start:.0f}s", flush=True)
            is_name = b'"pos": "name"' in line
            if not any(m in line for m in markers):
                w = top_word(line)
                if w is None or bd.make_key(w) not in wanted:
                    continue
            try:
                data = json.loads(line)
            except ValueError:
                continue
            word = (data.get("word") or "").strip()
            if not word:
                continue
            cats = [cat_name(c) for c in (data.get("categories") or [])]
            for s in data.get("senses", []):
                cats += [cat_name(c) for c in (s.get("categories") or [])]
            entry_tags = tags_for(cats) if cats else set()
            ids = ents.ids(word)
            if not ids and is_name and entry_tags and len(word) <= 40:
                eid, created = ents.add(word, "Wiktionary mythology/religion names")
                if eid:
                    ids = [eid]
                    new_ids.add(eid)
                    proper.add(eid)
                    stats["names added"] += created
            for eid in ids:
                for t in entry_tags:
                    tags.add((eid, t))
                if eid not in new_ids:
                    continue  # existing entries already have their Wiktionary senses
                pos = data.get("pos") or "unknown"
                if pos == "name" and eid not in proper:
                    continue
                for sense in data.get("senses", []):
                    glosses = sense.get("glosses") or []
                    if not glosses:
                        continue
                    gloss = bd.clean_gloss(glosses[-1])
                    if not gloss or (eid, gloss.lower()) in seen:
                        continue
                    seen.add((eid, gloss.lower()))
                    t = sense.get("tags") or []
                    target = (sense.get("form_of") or sense.get("alt_of") or [{}])[0].get("word")
                    is_form = 1 if (target or "form-of" in t or "alt-of" in t) else 0
                    lemma = ents.ids(target)[0] if target and ents.ids(target) else None
                    is_filler = 1 if (pos == "name" and bd.NAME_FILLER.search(gloss)) else 0
                    rank[eid] += 1
                    senses.append((eid, "wiktionary", pos, gloss, rank[eid], is_form, target, lemma, is_filler,
                                   ",".join(t) or None))
    db.executemany(
        "INSERT INTO senses (entry_id, source, pos, gloss, rank, is_form_of, lemma_text, lemma_entry_id, "
        "is_name_only, tags) VALUES (?,?,?,?,?,?,?,?,?,?)", senses)
    db.executemany("INSERT OR IGNORE INTO entry_tags VALUES (?,?)", sorted(tags))
    # Anything from the lists still without a definition gets a short placeholder line.
    has_defs = set(r[0] for r in db.execute("SELECT DISTINCT entry_id FROM senses"))
    fill = []
    for eid in new_ids:
        if eid in has_defs:
            continue
        if eid in notes:
            note = notes[eid].rstrip(".")
            fill.append((eid, "list", "note", note[:1].upper() + note[1:] + "."))
        elif eid in greek_ids:
            fill.append((eid, "list", "name", "A figure in Greek mythology."))
    db.executemany("INSERT INTO senses (entry_id, source, pos, gloss, rank) VALUES (?,?,?,?,1)", fill)
    db.commit()
    log(f"  mythology/religion names added: {stats['names added']:,}")
    log(f"  definitions added for new entries: {len(senses):,} (+{len(fill)} placeholder lines)")
    for tag, cnt in db.execute("SELECT tag, count(*) FROM entry_tags GROUP BY 1 ORDER BY 2 DESC"):
        log(f"  tag {tag}: {cnt:,}")
    log(f"  took {time.time() - start:.0f}s")


# ------------------------------------------------------------------ 3. categories

# name: (label, umbrella trigger words, clue terms that belong to it)
FAMILIES = {
    "river": ("Rivers", "river; flower; banker; runner", {
        "river", "russian river", "old river"}),
    "bible": ("Books of the Bible", "book; books; bible; scripture", {
        "genesis", "exodus", "leviticus", "numbers", "deuteronomy", "joshua", "judges", "ruth", "samuel", "kings",
        "chronicles", "ezra", "nehemiah", "esther", "job", "psalm", "psalms", "proverbs", "ecclesiastes",
        "isaiah", "jeremiah", "lamentations", "ezekiel", "daniel", "hosea", "joel", "amos", "obadiah", "jonah",
        "micah", "nahum", "habakkuk", "zephaniah", "haggai", "zechariah", "malachi", "matthew", "mark", "luke",
        "john", "acts", "romans", "corinthians", "galatians", "ephesians", "philippians", "colossians",
        "thessalonians", "timothy", "titus", "philemon", "hebrews", "james", "peter", "jude", "revelation",
        "revelations", "judith", "tobit", "maccabees", "bible", "good book", "holy writ", "scriptures",
        "new testament", "old testament", "books", "authorized version", "revised version", "part of bible"}),
    "doctor": ("Doctors and medicine", "doctor; medic; physician", {
        "doctor", "medic", "physician", "surgeon", "healer", "general practitioner", "medical officer",
        "nurse", "registered nurse", "enrolled nurse", "vet", "veterinary surgeon", "bachelor of medicine",
        "doctor of medicine", "house officer", "consultant", "medicine", "medical", "hospital",
        "hospital department", "apothecary", "chemist", "mo"}),
    "military": ("Armed forces and ranks", "soldier; soldiers; sailor; men; troops; officer; serviceman", {
        "soldier", "soldiers", "sailor", "sailors", "seaman", "able seaman", "ordinary seaman", "tar", "jack",
        "rating", "airman", "airmen", "fliers", "marine", "marines", "royal marines", "officer", "commander",
        "commanding officer", "general", "colonel", "major", "captain", "lieutenant", "sergeant",
        "sergeant major", "sergeant-major", "corporal", "private", "gunner", "gunners", "sapper", "sappers",
        "royal engineers", "royal engineer", "engineers", "army", "navy", "royal navy", "fleet",
        "senior service", "troops", "troop", "regiment", "men", "other ranks", "territorials",
        "territorial army", "volunteers", "reserves", "paratrooper", "paratroopers", "serviceman", "fighter",
        "admiral", "rear admiral", "vice-admiral", "field marshal", "brigadier", "brigade", "battalion",
        "warrant officer", "non-commissioned officer", "pilot officer", "flying officer", "petty officer",
        "aircraftsman", "american soldier", "us soldier", "gi", "grunt", "infantry", "artillery",
        "royal artillery", "big guns", "service", "forces", "army corps", "military police", "military"}),
    "police": ("Police and detectives", "police; policeman; detective; copper", {
        "police", "policeman", "policemen", "policewoman", "police officer", "police constable", "constable",
        "copper", "cop", "detective", "detectives", "detective inspector", "detective sergeant", "inspector",
        "lawman", "london police", "irish police", "american detective", "american policeman",
        "metropolitan police", "military police", "mounted police", "mountie", "mounties", "fed", "tec"}),
    "clergy": ("Clergy and church", "priest; clergyman; minister; church", {
        "priest", "minister", "vicar", "reverend", "right reverend", "cleric", "chaplain", "bishop",
        "archbishop", "archdeacon", "rabbi", "father", "friar", "monk", "nun", "deacon", "dean", "rector",
        "curate", "pastor", "parson", "theologian", "divine", "doctor of divinity", "church", "anglican",
        "church of england", "established church", "roman catholic", "catholic", "methodist",
        "high priest", "priest (french)", "pope", "the pope", "his holiness", "saint", "saints", "good man",
        "holy man", "st"}),
    "royalty": ("Monarchs and royalty", "king; queen; monarch; ruler; sovereign", {
        "king", "queen", "monarch", "prince", "princess", "emperor", "empress", "rex", "regina", "royal",
        "the king", "the queen", "ruler", "sovereign", "her majesty", "his majesty", "king charles",
        "king edward", "king george", "queen elizabeth", "queen victoria", "the old queen", "royal highness",
        "her highness", "his highness", "king emperor", "king and emperor", "queen and empress",
        "edward king and emperor", "old king", "french king", "french queen", "king (french)", "crown",
        "royal badge"}),
    "measure": ("Units and measures", "measure; unit; weight; length", {
        "measure", "unit", "weight", "small weight", "length", "volume", "foot", "feet", "inch", "inches",
        "mile", "miles", "yard", "yards", "metre", "metres", "meter", "centimetre", "centimetres",
        "millimetre", "millimetres", "kilometre", "kilometres", "gram", "grams", "gramme", "kilogram",
        "kilograms", "kilo", "ton", "tons", "tonne", "ounce", "carat", "grain", "grains", "pint", "pints",
        "quart", "gallon", "gallons", "litre", "centilitre", "millilitre", "acre", "acres", "hectare",
        "furlong", "furlongs", "fathom", "fathoms", "ell", "em", "en", "printers measure", "small measure",
        "hundredweight", "stone", "dram", "barrel", "barrels", "bushel", "bushels", "pennyweight",
        "angstrom", "ampere", "volt", "watt", "ohm", "hertz", "joule", "newton", "kelvin", "calorie",
        "kilocalorie", "decibel", "lumen", "lux", "farad", "tesla", "gauss", "pascal", "siemens", "coulomb",
        "weber", "henry", "candela", "byte", "kilobyte", "megabyte", "gigabyte", "terabytes", "four feet",
        "twenty feet", "small quantity", "small volume", "cubic centimetre", "nautical mile", "knot",
        "megawatt", "kilowatts", "megahertz", "horsepower", "metric carat", "maxwell", "bel"}),
    "money": ("Money and coins", "money; coin; currency; cash", {
        "money", "coin", "cash", "currency", "penny", "pence", "cent", "cents", "dollar", "pound", "pounds",
        "one pound", "shilling", "old shilling", "schilling", "franc", "francs", "french franc", "mark",
        "deutschmark", "euro", "rand", "lira", "lire", "yen", "peseta", "dinar", "drachma", "escudo",
        "rupee", "rupees", "rouble", "rubles", "krona", "krone", "florin", "guinea", "guineas", "sovereign",
        "farthing", "old penny", "copper", "small change", "tanner", "sixpence", "bob", "old bob", "quid",
        "pony", "monkey", "grand", "thousand pounds", "centime", "centimes", "cedi", "kwacha", "naira",
        "quetzal", "gourde", "pula", "peso", "real", "dime", "nickel", "sterling", "money order",
        "postal order", "kuwaiti dinar", "mauritian rupee", "pfennig"}),
    "honour": ("Honours, medals and awards", "honour; award; decoration; medal; order", {
        "honour", "award", "decoration", "medal", "order", "order of merit", "military cross",
        "military medal", "victoria cross", "george cross", "george medal", "companion of honour",
        "air force cross", "cross of valour", "distinguished service order", "knight", "knighthood",
        "baronet", "dame", "territorial decoration", "reserve decoration", "french decoration"}),
    "degree": ("Degrees and qualifications", "degree; graduate; qualification; scholar", {
        "degree", "graduate", "bachelor", "bachelor of arts", "master of arts", "bachelor of science",
        "master of science", "doctor of philosophy", "bachelor of law", "bachelor of letters",
        "bachelor of divinity", "bachelor of engineering", "bachelor of education", "master of education",
        "doctor of education", "doctor of science", "doctor of theology", "doctor of surgery",
        "master of surgery", "bachelor of surgery", "scholar", "student", "students", "academic",
        "educated man", "master's", "honours", "licentiate", "diploma in anaesthetics", "diploma of art"}),
    "politics": ("Politics and parties", "party; politician", {
        "party", "politician", "politicians", "conservative", "tory", "labour", "liberal", "democrat",
        "democratic", "republican", "republicans", "communist", "socialist", "leftist", "red",
        "nationalist", "nationalists", "member", "member of parliament", "representative", "minister",
        "prime minister", "labour party", "communist party", "liberal democrat", "green"}),
    "chess": ("Chess", "piece; chessman; chess piece", {
        "king", "queen", "bishop", "knight", "rook", "castle", "pawn", "piece", "chess piece", "chessman"}),
    "cards": ("Cards and bridge", "suit; card; bridge", {
        "club", "clubs", "diamond", "diamonds", "heart", "hearts", "spade", "spades", "suit", "card", "ace",
        "king", "queen", "jack", "knave", "honour", "trump", "no trumps", "bridge player", "bridge players",
        "bridge partners", "bridge opponents", "partnership", "hand", "trick"}),
    "sport": ("Sport (cricket, rugby ...)", "cricket; side; team; sport; game", {
        "cricket side", "side", "team", "eleven", "on", "off", "leg", "run", "runs", "wicket", "bowled",
        "caught", "caught by", "stumped", "over", "maiden", "maiden over", "duck", "extra", "bye", "leg bye",
        "wide", "no ball", "no-ball", "run out", "not out", "batting", "in", "out", "rugby", "rugby union",
        "rugby league", "football", "football club", "football association", "sport", "game", "games",
        "race", "races", "tourist trophy", "grand prix", "motor racing", "golf", "tee", "love", "set",
        "knock out", "knockout", "kick off", "kick-off", "own goal", "goal", "test", "match", "ref",
        "referee", "umpire", "fifteen", "football team", "cricket club", "pe", "gym", "exercise"}),
    "drugs": ("Drugs", "drug; drugs", {
        "drug", "drugs", "ecstasy", "heroin", "cocaine", "pot", "acid", "speed", "grass", "dope", "horse",
        "hash", "crack", "e", "lsd", "controlled drug"}),
    "newspaper": ("Newspapers and media", "paper; newspaper; journal", {
        "newspaper", "paper", "papers", "journal", "rag", "tabloid", "broadcaster", "news", "news channel",
        "financial times", "times", "organ", "editor", "journalist", "newspaperman", "newspaperwoman",
        "auntie", "press association", "associated press", "united press"}),
    "place": ("Islands, counties, cities and ports", "island; isle; county; city; port; town", {
        "island", "isle", "islands", "county", "city", "port", "town", "capital", "village", "london district",
        "home counties", "london area", "isle of man", "isle of wight", "durham area", "tyneside",
        "humberside", "merseyside", "cornwall", "devon", "essex", "middlesex", "somerset", "durham",
        "warwickshire", "monmouthshire", "alderney", "guernsey", "jersey", "channel islands", "west indies",
        "east indies", "north island", "south island", "long island", "westminster", "mayfair",
        "gotham", "new york", "los angeles", "washington", "new orleans", "kuala lumpur", "hong kong"}),
    "era": ("Ages, eras and time", "age; era; period; time", {
        "age", "era", "period", "time", "long time", "short time", "century", "modern times", "nowadays",
        "today", "present day", "our time", "our era", "this era", "christian era", "common era",
        "in the year", "in the year of our lord", "ancient times", "before christ", "eon", "generation",
        "years", "year", "now", "contemporary", "in the modern age", "before present", "old age"}),
    "transport": ("Roads, railways and transport", "road; way; street; railway; line; transport", {
        "road", "roads", "street", "way", "avenue", "drive", "railway", "railways", "rail", "line", "lines",
        "landline", "tracks", "motorway", "main road", "ring road", "route", "transport", "car", "cars",
        "vehicle", "trains", "old railway", "american railway", "elevated railway", "overhead railway",
        "little way", "thoroughfare", "lane", "terrace", "boulevard", "high-speed train", "bus", "cab",
        "tram", "ship", "boat", "liner", "steamer", "steamship", "vessel"}),
    "family": ("Family and people", "relation; relative; family; person", {
        "son", "sons", "daughter", "mother", "mum", "mom", "father", "dad", "old man", "old woman", "brother",
        "sister", "sisters", "child", "children", "baby", "wife", "husband", "uncle", "aunt", "relation",
        "relative", "kin", "family", "boy", "girl", "man", "woman", "fellow", "gentleman", "lady", "sib",
        "issue", "dutch uncle", "cousin", "grandmother", "grandfather", "nephew", "niece"}),
    "animal": ("Animals", "animal; horse; bird; fish", {
        "horse", "little horse", "gee-gee", "colt", "filly", "mare", "nag", "cob", "donkey", "ass", "cat",
        "dog", "snake", "fish", "swimmer", "bird", "ox", "cattle", "neat", "bull", "cow", "sheep", "pig",
        "worker", "soldier", "bee", "ant", "insect", "sloth", "whales", "young sheep", "fox", "bear"}),
}

# Existing categories also get umbrella words.
EXISTING = {
    "US state": ("US states", "state; american state; us state"),
    "chemical element": ("Chemical elements", "element; metal; gas; chemical; elements"),
    "NATO alphabet": ("NATO alphabet", "nato; phonetic alphabet; call sign"),
    "Greek letter": ("Greek letters", "greek letter; greek character; letter"),
    "Roman numeral": ("Roman numerals", "number; numeral; roman numeral"),
    "number": ("Numbers", "number; numeral"),
    "music": ("Music: notes, keys and dynamics", "note; key; music; musical"),
    "direction / bridge": ("Directions and compass points", "direction; point; quarter; bearing; compass point"),
    "calendar": ("Days and months", "month; day; date"),
    "country / vehicle code": ("Countries and vehicle codes", "country; nation; land"),
    "foreign word": ("Foreign words", "french; german; italian; spanish; latin"),
    "general": ("General", ""),
}


def categories(db):
    log("\n== 3. Abbreviation categories ==")
    rows = db.execute("SELECT id, abbreviation, clue_term, note, tier, category FROM abbreviations").fetchall()
    cats = defaultdict(set)
    for aid, abbr, clue, note, tier, cat in rows:
        c = clue.lower()
        if cat and cat != "general":
            cats[aid].add(cat)
        for fam, (_, _, terms) in FAMILIES.items():
            if c in terms:
                cats[aid].add(fam)
    # chess/cards: only for the letter forms actually used for pieces/suits
    chess_ok = {("K", "king"), ("Q", "queen"), ("B", "bishop"), ("N", "knight"), ("KT", "knight"),
                ("R", "rook"), ("R", "castle"), ("P", "pawn")}
    for aid, abbr, clue, *_ in rows:
        c = clue.lower()
        if "chess" in cats[aid] and (abbr, c) not in chess_ok:
            cats[aid].discard("chess")
        if "cards" in cats[aid] and len(abbr) > 1 and abbr not in ("EW", "NS", "NE", "NW", "SE", "SW"):
            cats[aid].discard("cards")
        if "chemical element" in cats[aid]:          # CU = copper is the metal, not a policeman or a coin
            cats[aid] -= {"police", "money", "drugs"}
        if c == "father" and abbr != "FR":
            cats[aid].discard("clergy")
        if c in ("soldier", "worker", "social worker") and abbr not in ("ANT", "BEE"):
            cats[aid].discard("animal")
        if c == "speed":
            cats[aid].discard("drugs")
        if c == "horse" and abbr != "H":
            cats[aid].discard("drugs")
        if c == "copper" and abbr not in ("D", "P", "PC"):
            cats[aid] -= {"money", "police"}
        if c == "copper" and abbr in ("D", "P"):
            cats[aid].discard("police")
        if c == "copper" and abbr == "PC":
            cats[aid].discard("money")
    # overrides
    applied = 0
    if os.path.exists(OVERRIDES_CSV):
        index = {(a, c.lower()): aid for aid, a, c, *_ in rows}
        with open(OVERRIDES_CSV, encoding="utf-8-sig", newline="") as f:
            for r in csv.DictReader(f):
                aid = index.get(((r.get("abbreviation") or "").strip().upper(), (r.get("clue_term") or "").strip().lower()))
                if aid:
                    cats[aid] = {x.strip() for x in (r.get("categories") or "").split(";") if x.strip()}
                    applied += 1
    db.execute("DELETE FROM abbreviation_categories")
    out = []
    for aid, *_ in rows:
        for c in sorted(cats[aid]):
            out.append((aid, c))
    db.executemany("INSERT INTO abbreviation_categories VALUES (?,?)", out)
    db.execute("DELETE FROM categories")
    for name, (label, trig) in EXISTING.items():
        db.execute("INSERT INTO categories VALUES (?,?,?,?)", (name, label, trig, None))
    for name, (label, trig, _) in FAMILIES.items():
        db.execute("INSERT INTO categories VALUES (?,?,?,?)", (name, label, trig, None))
    db.commit()
    general = sum(1 for aid, *_ in rows if not cats[aid])
    log(f"  {len(rows):,} abbreviations; {len(rows) - general:,} now in at least one category ({general:,} general)")
    if applied:
        log(f"  overrides applied: {applied}")
    counts = defaultdict(int)
    for _, c in out:
        counts[c] += 1
    for c, n in sorted(counts.items(), key=lambda x: -x[1]):
        log(f"  {c}: {n}")
    with open(REVIEW_CSV, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(["abbreviation", "clue_term", "note", "tier", "categories"])
        for aid, abbr, clue, note, tier, _ in sorted(rows, key=lambda r: (r[1], r[4], r[2])):
            w.writerow([abbr, clue, note or "", tier, "; ".join(sorted(cats[aid]))])
    log(f"  review sheet written: {os.path.basename(REVIEW_CSV)}")


# ------------------------------------------------------------------ 4/5. indicators and charades

def clue_count(cell):
    return max(1, (cell or "").count("]("))


def clean_phrase(text):
    text = re.sub(r"\s+", " ", (text or "").strip().lower())
    return text.strip(" \"'.,;:!?()[]-")


def csv_rows(path):
    """Rows of a cryptics.georgeho.org CSV as dicts. Copes with a file where every line has been
    wrapped in quotes as one field (what some save routes produce): each line is then unwrapped
    and read again."""
    with open(path, encoding="utf-8-sig", newline="") as f:
        lines = list(csv.reader(f))
    if lines and len(lines[0]) == 1 and "," in lines[0][0]:
        lines = [next(csv.reader([row[0]])) if row else [] for row in lines]
    if not lines:
        return
    header = [h.strip() for h in lines[0]]
    for row in lines[1:]:
        yield dict(zip(header, row))


def tier(n, hi, mid):
    return 1 if n >= hi else 2 if n >= mid else 3


def indicators(db):
    log("\n== 4. Crossword indicators ==")
    if not os.path.exists(INDICATORS_CSV):
        log(f"  {os.path.basename(INDICATORS_CSV)} not found - skipped")
        return
    agg = defaultdict(int)
    for r in csv_rows(INDICATORS_CSV):
        phrase, typ = clean_phrase(r.get("indicator")), (r.get("wordplay") or "").strip().lower()
        if not phrase or not typ or len(phrase) > 40 or len(phrase.split()) > 5 or re.search(r"\d", phrase):
            continue
        agg[(phrase, typ)] += clue_count(r.get("clue_rowids"))
    db.execute("DELETE FROM indicators")
    db.executemany("INSERT INTO indicators VALUES (?,?,?,?)",
                   [(p, t, n, tier(n, 10, 3)) for (p, t), n in agg.items()])
    db.commit()
    for t, n, t1 in db.execute("SELECT type, count(*), sum(tier=1) FROM indicators GROUP BY 1 ORDER BY 2 DESC"):
        log(f"  {t}: {n:,} ({t1:,} tier 1)")


def charades(db):
    log("\n== 5. Charades (clue pieces) ==")
    if not os.path.exists(CHARADES_CSV):
        log(f"  {os.path.basename(CHARADES_CSV)} not found - skipped")
        return
    agg = defaultdict(int)
    for r in csv_rows(CHARADES_CSV):
        clue = clean_phrase(r.get("charade"))
        letters = re.sub(r"[^A-Z]", "", (r.get("answer") or "").upper())
        if not clue or not letters or len(letters) > 10 or len(clue.split()) > 4:
            continue
        agg[(clue, letters)] += clue_count(r.get("clue_rowids"))
    db.execute("DELETE FROM charades")
    db.executemany("INSERT INTO charades VALUES (?,?,?,?)",
                   [(c, l, n, tier(n, 5, 2)) for (c, l), n in agg.items()])
    db.commit()
    n, t1 = db.execute("SELECT count(*), sum(tier=1) FROM charades").fetchone()
    log(f"  {n:,} clue pieces ({t1 or 0:,} seen 5+ times)")


# ------------------------------------------------------------------ main

def main():
    if not os.path.exists(DB):
        sys.exit("dictionary_v2.sqlite not found - run build_dictionary.py first")
    start = time.time()
    db = sqlite3.connect(DB)
    db.execute("PRAGMA journal_mode = MEMORY")
    db.execute("PRAGMA synchronous = OFF")
    db.executescript(SCHEMA)
    log(f"build_extras - {time.strftime('%Y-%m-%d %H:%M')}")
    if "--clue-data-only" in sys.argv:       # just steps 4 and 5; safe to repeat on a finished database
        indicators(db)
        charades(db)
        log(f"\nDone in {time.time() - start:.0f}s")
        return
    if db.execute("SELECT count(*) FROM entry_sources").fetchone()[0]:
        log("Extras were already added to this database. Run build_dictionary.py again first for a clean result.")
        sys.exit(1)
    ents = Entries(db, Freq())
    greek_ids, notes = extra_words(db, ents)
    if "--skip-wiktionary" not in sys.argv:
        wiktionary_names(db, ents, greek_ids, notes)
    categories(db)
    indicators(db)
    charades(db)
    db.executescript("""
        CREATE INDEX IF NOT EXISTS idx_tags_tag ON entry_tags(tag);
        CREATE INDEX IF NOT EXISTS idx_charades_letters ON charades(letters);
        CREATE INDEX IF NOT EXISTS idx_abbrcat_cat ON abbreviation_categories(category);
    """)
    try:
        db.execute("INSERT INTO senses_fts(senses_fts) VALUES ('rebuild')")
    except sqlite3.OperationalError:
        pass
    db.commit()
    log(f"\nNew entries in total: {ents.added:,}")
    for w in ("Polydectes", "Acrisius", "Nephthys", "Amaterasu", "Lugh", "Icarus"):
        r = db.execute("SELECT e.display, group_concat(DISTINCT t.tag), "
                       "(SELECT gloss FROM senses s WHERE s.entry_id=e.id AND is_name_only=0 ORDER BY source<>'wiktionary', rank LIMIT 1) "
                       "FROM entries e LEFT JOIN entry_tags t ON t.entry_id=e.id WHERE e.display=?", (w,)).fetchone()
        log(f"  {w}: {r}")
    db.close()
    log(f"Done in {time.time() - start:.0f}s")
    with open(REPORT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines_out) + "\n")


if __name__ == "__main__":
    main()
