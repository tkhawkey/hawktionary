"""
export_slim.py - turns dictionary_v2.sqlite into the data files the Hawktionary app loads.

Run from the Dictionary folder, after build_dictionary.py:
    python export_slim.py
    python export_slim.py "C:\\path\\to\\Hawktionary\\public\\data"   (optional output folder)

Default output: Hawktionary/public/data/ next to this script. The folder is wiped and rebuilt.

What it writes (plain UTF-8 text; the web host compresses it in transit):
    manifest.json        version, counts, list of shard files with sizes
    words.tsv            every entry: display, enumeration, zipf, flags  (loaded at start-up)
    abbreviations.tsv    abbreviation, clue term, note, tier, category  (loaded at start-up)
    entries/<xx>.json    definitions + thesaurus, split by the first two letters
                         of each entry (downloaded in the background, cached for offline)
"""
import json
import os
import shutil
import sqlite3
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "dictionary_v2.sqlite")
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "Hawktionary", "public", "data")

MAX_SENSES = 20        # per entry, after duplicates are removed
MAX_SYNONYMS = 250
MAX_TYPE_OF = 40
MAX_KINDS = 250

# meanings (per WordNet meaning group), for entries with two or more
MEANING_SYNONYMS = 80
MEANING_TYPE_OF = 12
MEANING_KINDS = 100
USAGE_COUNT_MIN = 3    # WordNet usage counts below this are too few to rank meanings by
SISTER_LIMIT = 80      # a group's "sisters" count as near it only if the parent has this many kinds or fewer
WORDNET_DIR = os.path.join(HERE, "WNdb-3.0", "dict")
KAIKKI = os.path.join(HERE, "kaikki.org-dictionary-English.jsonl")   # optional: Wiktionary's synonyms by definition
WIKT_POS = {"noun", "verb", "adj", "adv"}
STOP_WORDS = set("""a an the of or and to in on for with by as at from that which who whom this these those is are be
been being it its into than such any some one ones not no used especially something someone person thing
having has have way state quality act also other often very more most usually etc make made""".split())


def log(msg):
    print(msg, flush=True)


def shard_key(letters):
    return (letters[:2] + "_")[:2]


def read_wordnet_ranks():
    """WordNet's index files list each word's meaning groups most-used first.
    Returns {(lemma, pos): {synset_id: rank}}; lemma is lower case with spaces."""
    ranks = {}
    for fname, pos, letter in (("index.noun", "noun", "n"), ("index.verb", "verb", "v"),
                               ("index.adj", "adj", "a"), ("index.adv", "adv", "r")):
        path = os.path.join(WORDNET_DIR, fname)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if line.startswith("  "):
                    continue
                tokens = line.split()
                count = int(tokens[2])
                offsets = tokens[-count:]
                ranks[(tokens[0].replace("_", " "), pos)] = {letter + off: i for i, off in enumerate(offsets)}
    return ranks


def read_wordnet_counts():
    """How often each meaning was seen in WordNet's tagged texts (index.sense).
    Returns {(lemma, synset_id): count}; lemma is lower case with spaces."""
    counts = {}
    path = os.path.join(WORDNET_DIR, "index.sense")
    if not os.path.exists(path):
        return counts
    letters = {"1": "n", "2": "v", "3": "a", "4": "r", "5": "a"}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            key, offset, _, count = line.split()
            lemma, rest = key.split("%", 1)
            sid = letters.get(rest[:1], "?") + offset
            counts[(lemma.replace("_", " "), sid)] = counts.get((lemma.replace("_", " "), sid), 0) + int(count)
    return counts


def read_wiktionary_groups(entry_id):
    """Wiktionary lists many synonyms under one particular definition ("sharp - Stylish: chic,
    elegant, smart"). Returns {head id: [(pos, definition, {synonym ids}, tied_to_definition)]}.
    Synonyms listed for the whole entry, with no definition, come back with an empty definition."""
    groups = defaultdict(list)
    if not os.path.exists(KAIKKI):
        log("  kaikki file not found - skipping Wiktionary's per-definition synonyms")
        return groups

    def ids_of(words, head):
        return {entry_id(w) for w in words} - {None, head}

    with open(KAIKKI, encoding="utf-8") as f:
        for line in f:
            if '"synonyms"' not in line:
                continue
            d = json.loads(line)
            if d.get("lang_code", "en") != "en" or d.get("pos") not in WIKT_POS:
                continue
            head = entry_id(d.get("word") or "", exact=True)
            if head is None:
                continue
            pos = d["pos"]
            for s in d.get("senses") or []:
                ids = ids_of([x.get("word") for x in s.get("synonyms") or [] if isinstance(x, dict)], head)
                if ids:
                    gl = (s.get("glosses") or s.get("raw_glosses") or [""])[-1]   # the most specific gloss
                    groups[head].append((pos, gl, ids, True))
            by_note = defaultdict(list)
            for x in d.get("synonyms") or []:
                if isinstance(x, dict) and x.get("word"):
                    by_note[x.get("sense") or ""].append(x["word"])
            for note, words in by_note.items():
                ids = ids_of(words, head)
                if ids:
                    groups[head].append((pos, note, ids, bool(note)))
    return groups


def gloss_words(text):
    """Content words of a definition, roughly singular, for comparing two definitions."""
    out = set()
    for w in "".join(c if c.isalpha() else " " for c in text.lower()).split():
        if len(w) >= 3 and w not in STOP_WORDS:
            out.add(w[:-1] if w.endswith("s") and len(w) > 4 else w)
    return out


def main():
    start = time.time()
    if not os.path.exists(DB):
        sys.exit("dictionary_v2.sqlite not found - run build_dictionary.py first")
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    q = db.execute

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(os.path.join(OUT, "entries"))

    # ---- entries
    log("Reading entries...")
    entries = q("SELECT id, display, letters, enumeration, zipf, is_proper FROM entries ORDER BY id").fetchall()
    display = {eid: d for eid, d, *_ in entries}
    letters = {eid: l for eid, _, l, *_ in entries}

    with open(os.path.join(OUT, "words.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write("# display\tenumeration\tzipf\tflags (p = proper noun)\n")
        for eid, d, l, enum, z, proper in entries:
            f.write(f"{d}\t{enum}\t{(z or 0):.1f}\t{'p' if proper else ''}\n")

    # ---- abbreviations
    log("Writing abbreviations...")
    with open(os.path.join(OUT, "abbreviations.tsv"), "w", encoding="utf-8", newline="\n") as f:
        f.write("# abbreviation\tclue_term\tnote\ttier\tcategory\n")
        for a, c, n, t, cat in q("SELECT abbreviation, clue_term, note, tier, category FROM abbreviations "
                                  "ORDER BY abbreviation, tier, clue_term"):
            f.write(f"{a}\t{c}\t{n or ''}\t{t}\t{cat}\n")

    # ---- definitions: Wiktionary first (its order puts everyday senses first), then WordNet
    log("Collecting definitions...")
    defs = defaultdict(list)
    seen = defaultdict(set)
    rows = q("SELECT entry_id, source, pos, gloss FROM senses WHERE is_form_of=0 AND is_name_only=0 "
             "ORDER BY entry_id, source='wordnet', rank, id")
    for eid, src, pos, gloss in rows:
        key = gloss.lower().rstrip(".")
        if key in seen[eid] or len(defs[eid]) >= MAX_SENSES:
            continue
        seen[eid].add(key)
        defs[eid].append([pos, gloss, "w" if src == "wiktionary" else "n"])
    del seen

    forms = defaultdict(list)
    for eid, gloss, lemma_id in q("SELECT entry_id, gloss, lemma_entry_id FROM senses WHERE is_form_of=1 ORDER BY entry_id, rank"):
        item = [gloss, display.get(lemma_id, "")]
        if item not in forms[eid] and len(forms[eid]) < 6:
            forms[eid].append(item)

    # ---- thesaurus
    log("Collecting thesaurus links...")
    members = defaultdict(list)
    for sid, eid in q("SELECT synset_id, entry_id FROM synset_members ORDER BY synset_id, position"):
        members[sid].append(eid)

    syn = defaultdict(dict)       # dict keeps insertion order and removes duplicates
    type_of = defaultdict(dict)
    kinds = defaultdict(dict)

    def add(store, eid, other, cap):
        if other != eid and len(store[eid]) < cap:
            store[eid][other] = None

    for sid, ids in members.items():                     # WordNet: same meaning group
        for a in ids:
            for b in ids:
                add(syn, a, b, MAX_SYNONYMS)
    for frm, to, typ in q("SELECT from_synset, to_synset, type FROM synset_links "
                          "WHERE type IN ('type of','instance of','kind','instance')"):
        store, cap = (type_of, MAX_TYPE_OF) if typ in ("type of", "instance of") else (kinds, MAX_KINDS)
        for a in members.get(frm, ()):
            for b in members.get(to, ()):
                add(store, a, b, cap)
    for eid, rid, typ in q("SELECT entry_id, related_entry_id, type FROM relations "
                           "WHERE source='wiktionary' AND related_entry_id IS NOT NULL"):
        if typ == "synonym":
            add(syn, eid, rid, MAX_SYNONYMS)
        elif typ == "type of":
            add(type_of, eid, rid, MAX_TYPE_OF)
    for eid, rid in q("SELECT entry_id, related_entry_id FROM relations "
                      "WHERE source='moby' AND related_entry_id IS NOT NULL"):
        add(syn, eid, rid, MAX_SYNONYMS)

    # ---- meanings: the same links kept apart by WordNet meaning group, so the app can show
    # one meaning at a time (doctor the physician / to doctor a document). Moby and Wiktionary
    # synonyms carry no WordNet meaning. Each is placed under one when Wiktionary lists it under
    # a definition that matches that meaning, or when WordNet links it closely to that group;
    # the rest stay in the combined lists above.
    log("Collecting meanings...")
    synset_info = {sid: (pos, gloss) for sid, pos, gloss in q("SELECT id, pos, gloss FROM synsets")}
    links_by = defaultdict(lambda: defaultdict(list))   # synset -> link type -> [synset]
    for frm, to, typ in q("SELECT from_synset, to_synset, type FROM synset_links WHERE type IN "
                          "('type of','instance of','kind','instance','similar to','verb group','see also')"):
        links_by[frm][typ].append(to)
    entry_synsets = defaultdict(list)
    for sid, ids in members.items():
        for e in ids:
            entry_synsets[e].append(sid)
    wn_rank = read_wordnet_ranks()
    near_cache = {}
    by_display = {d: eid for eid, d in display.items()}
    by_lower = {}
    for eid, d in display.items():
        by_lower.setdefault(d.lower(), eid)

    def entry_id(word, exact=False):
        return by_display.get(word) if exact else (by_display.get(word) or by_lower.get(word.lower()))

    log("Reading Wiktionary's synonyms by definition...")
    wikt_groups = read_wiktionary_groups(entry_id)
    log(f"  {len(wikt_groups):,} headwords")
    wikt_filed = 0

    def wikt_meaning(pos, gl, ids, tied, groups):
        """Which meaning a Wiktionary definition's synonym list belongs to, or None when unsure.
        Tested on 120 random matches: about 9 in 10 right. Anything unsure stays in All meanings."""
        shared = [len(ids & g[1].keys()) if synset_info[g[0]][0] == pos else 0 for g in groups]
        best = max(shared)
        rivals = sum(1 for n in shared if n)
        if best >= 2 and rivals == 1:                      # two or more words in common, with one meaning only
            return shared.index(best)
        if best == 1 and rivals == 1:                      # one word in common, and the definitions agree too
            if not tied:
                return None
            i = shared.index(1)
            common = gloss_words(" ".join(display[x] for x in ids & groups[i][1].keys()))
            mine = gloss_words(gl) - common
            score = [len(mine & (gloss_words(synset_info[g[0]][1]) - common)) if synset_info[g[0]][0] == pos else 0
                     for g in groups]
            return i if score[i] >= 1 and score.count(score[i]) == 1 and score[i] == max(score) else None
        if best == 0 and tied:                             # no words in common: the definitions must clearly agree
            mine = gloss_words(gl)
            score = []
            for g in groups:
                if synset_info[g[0]][0] != pos:
                    score.append(0)
                    continue
                theirs = gloss_words(synset_info[g[0]][1])
                for x in g[1]:
                    theirs |= gloss_words(display[x])
                score.append(len(mine & theirs))
            top = max(score)
            second = sorted(score)[-2] if len(score) > 1 else 0
            if top >= 2 and score.count(top) == 1 and (not second or top >= 2 * second):
                return score.index(top)
        return None

    def near(sid):
        """Groups close enough to sid that a synonym found in them belongs to this meaning."""
        if sid in near_cache:
            return near_cache[sid]
        out = {sid}
        lk = links_by.get(sid, {})
        for t in ("similar to", "verb group", "see also", "type of", "instance of", "kind", "instance"):
            out.update(lk.get(t, ()))
        for parent in lk.get("type of", ()):
            sisters = links_by.get(parent, {}).get("kind", ())
            if len(sisters) <= SISTER_LIMIT:
                out.update(sisters)
        near_cache[sid] = out
        return out

    def linked(sid, types):
        lk = links_by.get(sid, {})
        return [s2 for t in types for s2 in lk.get(t, ())]

    wn_count = read_wordnet_counts()
    wikt_senses = defaultdict(list)          # Wiktionary's definitions in its own order, for ordering meanings
    for eid, pos, gl in q("SELECT entry_id, pos, gloss FROM senses WHERE source='wiktionary' AND is_form_of=0 "
                          "AND is_name_only=0 ORDER BY entry_id, rank"):
        if len(entry_synsets.get(eid, ())) >= 2:
            wikt_senses[eid].append((pos, gl))

    meanings = {}
    for eid, sids in entry_synsets.items():
        if len(sids) < 2:
            continue
        lemma = display[eid].lower()
        own = gloss_words(lemma)
        wikt = [(p, gloss_words(g) - own) for p, g in wikt_senses.get(eid, ())]

        def wikt_place(sid):
            """Where this meaning first appears among Wiktionary's definitions, which put everyday
            senses first: the earliest definition sharing the most words with it."""
            pos, gl = synset_info[sid]
            mine = gloss_words(gl)
            for x in members[sid] + [x for s2 in linked(sid, ("type of", "instance of")) for x in members.get(s2, ())]:
                mine |= gloss_words(display[x])
            mine -= own
            score = [len(mine & w) if p == pos else 0 for p, w in wikt]
            best = max(score, default=0)
            return (score.index(best), -best) if best else (9999, 0)   # earliest definition, closer match first

        # most used first. Two rankings: WordNet's usage counts (only where it has a real count) and
        # Wiktionary's order. Each meaning takes its better place; ties go to Wiktionary's order.
        place = {sid: wikt_place(sid) for sid in sids}
        by_wikt = {sid: n for n, sid in enumerate(sorted(sids, key=lambda s: (place[s], -wn_count.get((lemma, s), 0))))}
        counted = sorted((s for s in sids if wn_count.get((lemma, s), 0) >= USAGE_COUNT_MIN),
                         key=lambda s: -wn_count[(lemma, s)])
        by_count = {sid: n for n, sid in enumerate(counted)}

        def order_key(sid):
            rank = wn_rank.get((lemma, synset_info[sid][0]), {}).get(sid, 999)
            return (min(by_wikt[sid], by_count.get(sid, 9999)), place[sid], -wn_count.get((lemma, sid), 0), rank, sid)

        sids = sorted(sids, key=order_key)
        groups = []
        for sid in sids:
            syn_ids = dict.fromkeys(x for x in members[sid] if x != eid)
            for s2 in linked(sid, ("similar to", "verb group")):
                syn_ids.update(dict.fromkeys(x for x in members.get(s2, ()) if x != eid))
            t_ids = dict.fromkeys(x for s2 in linked(sid, ("type of", "instance of")) for x in members.get(s2, ()) if x != eid)
            k_ids = dict.fromkeys(x for s2 in linked(sid, ("kind", "instance")) for x in members.get(s2, ()) if x != eid)
            groups.append([sid, syn_ids, t_ids, k_ids])
        placed = set().union(*(g[1] for g in groups))
        # first, Wiktionary's own synonym lists, which a person wrote under one definition
        filed = {}
        for pos, gl, ids, tied in wikt_groups.get(eid, ()):
            i = wikt_meaning(pos, gl, ids, tied, groups)
            if i is None:
                continue
            for other in ids:
                if other not in placed and other in syn.get(eid, ()):
                    filed.setdefault(other, set()).add(i)
        for other, where in filed.items():
            if len(where) == 1:                            # listed under two meanings: leave it in All meanings
                groups[where.pop()][1][other] = None
                placed.add(other)
                wikt_filed += 1
        # then the rest, when WordNet links them closely to one meaning
        for other in syn.get(eid, ()):
            if other in placed:
                continue
            theirs = entry_synsets.get(other)
            if not theirs:
                continue
            for g in groups:
                if near(g[0]).intersection(theirs):
                    g[1][other] = None
                    placed.add(other)
                    break
        meanings[eid] = [[synset_info[sid][0], synset_info[sid][1],
                          [display[x] for x in list(s_ids)[:MEANING_SYNONYMS]],
                          [display[x] for x in list(t_ids)[:MEANING_TYPE_OF]],
                          [display[x] for x in list(k_ids)[:MEANING_KINDS]]]
                         for sid, s_ids, t_ids, k_ids in groups]
    log(f"{len(meanings):,} entries with more than one meaning; {wikt_filed:,} synonyms filed from Wiktionary's lists")
    del members, links_by, near_cache, entry_synsets, wikt_groups

    # ---- shards
    log("Writing shards...")
    shards = defaultdict(dict)
    with_data = 0
    for eid, d, l, enum, z, proper in entries:
        rec = {}
        if defs.get(eid):
            rec["d"] = defs[eid]
        if forms.get(eid):
            rec["f"] = forms[eid]
        if syn.get(eid):
            rec["s"] = [display[x] for x in syn[eid]]
        if type_of.get(eid):
            rec["t"] = [display[x] for x in type_of[eid]]
        if kinds.get(eid):
            rec["k"] = [display[x] for x in kinds[eid]]
        if meanings.get(eid):
            rec["m"] = meanings[eid]
        if rec:
            with_data += 1
            shards[shard_key(l)][d] = rec

    files = []
    total = 0
    for key in sorted(shards):
        path = os.path.join(OUT, "entries", f"{key}.json")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(shards[key], f, ensure_ascii=False, separators=(",", ":"))
        size = os.path.getsize(path)
        total += size
        files.append({"file": f"entries/{key}.json", "bytes": size})

    core = [{"file": n, "bytes": os.path.getsize(os.path.join(OUT, n))} for n in ("words.tsv", "abbreviations.tsv")]
    manifest = {
        "version": time.strftime("%Y-%m-%d.%H%M"),
        "counts": {
            "words": len(entries),
            "entries_with_data": with_data,
            "abbreviations": q("SELECT count(*) FROM abbreviations").fetchone()[0],
        },
        "core": core,
        "shards": files,
        "shard_rule": "first two letters of the entry's letters-only form; one-letter words use '<letter>_'",
        "record_keys": {
            "d": "definitions: [part of speech, gloss, source w=Wiktionary n=WordNet]",
            "f": "form-of pointers: [gloss, base word]  e.g. ['plural of ale', 'ale']",
            "s": "synonyms (WordNet, then Wiktionary, then Moby)",
            "t": "is a type of",
            "k": "kinds of this",
            "m": "meanings, most used first (only when 2+): [part of speech, gloss, synonyms, type of, kinds]",
        },
    }
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=1)

    core_mb = sum(c["bytes"] for c in core) / 1e6
    log(f"\nwords.tsv + abbreviations.tsv: {core_mb:.1f} MB")
    log(f"{len(files)} shard files: {total / 1e6:.1f} MB, {with_data:,} entries with data")
    log(f"Done in {time.time() - start:.0f}s -> {OUT}")


if __name__ == "__main__":
    main()
