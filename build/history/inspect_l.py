import sqlite3

db_path = "dictionary.sqlite"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("""
    SELECT clue_term, abbreviation, tier 
    FROM cryptic_abbreviations 
    WHERE abbreviation = 'L' 
    ORDER BY tier ASC, clue_term ASC;
""")

results = cursor.fetchall()
print(f"\n--- All Mappings for Abbreviation 'L' ({len(results)} total) ---")
for clue, abbr, tier in results:
    print(f"  [Tier {tier}] {clue} -> {abbr}")

conn.close()