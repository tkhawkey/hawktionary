# Build scripts

Backup copies of the scripts that make `public/data/`. The working copies live in the
Dictionary folder on Tom's PC (`Desktop\Dictionary`), next to the source downloads, and
that is where they are run. After changing a script there, copy it here and commit.

The large sources and databases are not in this repo (too big, and some are third-party
downloads); the list below says where each came from.

## Rebuilding the data

From the Dictionary folder:

    python build_dictionary.py     # sources -> dictionary_v2.sqlite (a few minutes)
    python export_slim.py          # dictionary_v2.sqlite -> Hawktionary/public/data/ (about 1.5 minutes)

Then commit `public/data/`. Installed copies of the app pick up the new data on their
second start after it is deployed.

## Sources expected in the Dictionary folder

| File or folder | What it is |
|---|---|
| `LedgersWordz downloaded/` | UKACD word arrays (`AllWordzArray*.js`), the word list |
| `WNdb-3.0/dict/` | WordNet 3.0 database files |
| `kaikki.org-dictionary-English.jsonl` | Wiktionary extract from kaikki.org (3.4 GB) |
| `moby_thesaurus.txt` | Moby Thesaurus (optional) |
| `word_frequencies.tsv` | word frequencies from wordfreq (optional) |
| `dictionary.sqlite` | the older database; its audited abbreviations table is copied in |

## If dictionary.sqlite is ever lost

The abbreviations came from the scripts in `history/` (Cryptipedia, Clue Clinic and
Wikipedia lists, then `populate_abbr.py`), followed by a hand audit applied with
`apply_audit.py` from `abbreviation_audit_changes.csv`. The final, audited result is also
in `public/data/abbreviations.tsv` (abbreviation, clue term, note, tier, category), which
is the quickest thing to rebuild the table from.

## What is in history/

The earlier, one-off scripts that built and cleaned `dictionary.sqlite`, kept for the
record. They are not part of the current rebuild.
