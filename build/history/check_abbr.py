import sqlite3

conn = sqlite3.connect("dictionary.sqlite")
cursor = conn.cursor()

# Check what terms map to abbreviation 'S'
cursor.execute("SELECT clue_term FROM cryptic_abbreviations WHERE abbreviation = 'S' ORDER BY clue_term;")
rows = cursor.fetchall()

print(f"Found {len(rows)} entries for abbreviation 'S':")
for r in rows:
    print(f" - {r[0]}")

conn.close()