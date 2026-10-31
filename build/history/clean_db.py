import sqlite3

conn = sqlite3.connect("dictionary.sqlite")
cursor = conn.cursor()

print("Cleaning up duplicates and stray punctuation in cryptic_abbreviations...")

# 1. Clean up leading colons or weird whitespace in clue_terms
cursor.execute("""
    UPDATE cryptic_abbreviations 
    SET clue_term = TRIM(REPLACE(clue_term, ':', ''))
""")

# 2. Remove exact duplicate rows
cursor.execute("""
    DELETE FROM cryptic_abbreviations
    WHERE id NOT IN (
        SELECT MIN(id)
        FROM cryptic_abbreviations
        GROUP BY abbreviation, clue_term
    )
""")

conn.commit()
conn.close()
print("Database cleaned successfully! All redundant abbreviation mappings removed.")