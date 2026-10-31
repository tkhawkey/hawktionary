import sqlite3

db_path = "dictionary.sqlite"
conn = sqlite3.connect(db_path)
cursor = conn.cursor()

# Query all meanings mapped to the abbreviation 'L'
abbr_to_find = 'L'
cursor.execute("""
    SELECT clue_term, abbreviation 
    FROM cryptic_abbreviations 
    WHERE abbreviation = ?
    ORDER BY clue_term
""", (abbr_to_find.upper(),))

results = cursor.fetchall()

print(f"\n--- Crossword Meanings for Abbreviation '{abbr_to_find.upper()}' ({len(results)} found) ---")
for row in results:
    print(f"  • {row[0]} -> {row[1]}")

conn.close()