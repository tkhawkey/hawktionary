"""Apply abbreviation_audit_changes.csv to dictionary.sqlite.

Run from the Dictionary folder:
    python apply_audit.py            # preview only, changes nothing
    python apply_audit.py --apply    # backs up the database, then applies

Edit the CSV first: delete any row you disagree with, or change its action.
"""
import csv
import shutil
import sqlite3
import sys
from datetime import datetime

DB = "dictionary.sqlite"
CSV = "abbreviation_audit_changes.csv"
apply = "--apply" in sys.argv

if apply:
    backup = f"dictionary_backup_{datetime.now():%Y%m%d_%H%M%S}.sqlite"
    shutil.copy2(DB, backup)
    print(f"Backup saved as {backup}")

conn = sqlite3.connect(DB)
cur = conn.cursor()
counts = {"delete": 0, "move": 0, "fix": 0, "not found": 0}

with open(CSV, newline="", encoding="utf-8") as f:
    for row in csv.DictReader(f):
        abbr, clue, action, new = row["abbreviation"], row["clue_term"], row["action"], row["new_value"]
        key = (abbr, clue)
        found = cur.execute(
            "SELECT COUNT(*) FROM cryptic_abbreviations WHERE abbreviation=? AND clue_term=?", key
        ).fetchone()[0]
        if not found:
            counts["not found"] += 1
            print(f"  not found: [{abbr}] -> {clue}")
            continue

        if action == "delete":
            cur.execute("DELETE FROM cryptic_abbreviations WHERE abbreviation=? AND clue_term=?", key)
        elif action == "move":
            cur.execute(
                "UPDATE cryptic_abbreviations SET tier=? WHERE abbreviation=? AND clue_term=?",
                (int(new), abbr, clue),
            )
        elif action == "fix":
            clash = cur.execute(
                "SELECT COUNT(*) FROM cryptic_abbreviations WHERE abbreviation=? AND clue_term=?",
                (abbr, new),
            ).fetchone()[0]
            if clash:  # corrected term already exists, so the bad one is just a duplicate
                cur.execute("DELETE FROM cryptic_abbreviations WHERE abbreviation=? AND clue_term=?", key)
            else:
                cur.execute(
                    "UPDATE cryptic_abbreviations SET clue_term=? WHERE abbreviation=? AND clue_term=?",
                    (new, abbr, clue),
                )
        else:
            print(f"  unknown action '{action}' for [{abbr}] -> {clue}")
            continue
        counts[action] += 1

if apply:
    conn.commit()
    print("Applied:", counts)
else:
    conn.rollback()
    print("Preview only (nothing saved):", counts)
    print("Run again with --apply to make the changes.")
conn.close()
