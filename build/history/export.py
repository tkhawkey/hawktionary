import sqlite3
from collections import defaultdict

db_path = "dictionary.sqlite"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Fetch all abbreviations, sorted by abbreviation name, then tier, then clue term
cursor.execute("""
    SELECT abbreviation, clue_term, tier 
    FROM cryptic_abbreviations 
    ORDER BY abbreviation ASC, tier ASC, clue_term ASC;
""")
rows = cursor.fetchall()
conn.close()

# Group entries by the first letter of the abbreviation
grouped = defaultdict(list)
for abbr, clue, tier in rows:
    first_char = abbr[0].upper() if abbr else '#'
    grouped[first_char].append((abbr, clue, tier))

output_filename = "export_for_audit.txt"

with open(output_filename, "w", encoding="utf-8") as f:
    for letter in sorted(grouped.keys()):
        f.write(f"\n{'='*40}\n")
        f.write(f"=== GROUP: {letter} (Total items: {len(grouped[letter])}) ===\n")
        f.write(f"{'='*40}\n")
        for abbr, clue, tier in grouped[letter]:
            f.write(f"[{abbr}] -> {clue} (Tier {tier})\n")

print(f"Successfully exported all entries to '{output_filename}'!")