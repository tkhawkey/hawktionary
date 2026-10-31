import sqlite3
import os

db_path = "dictionary.sqlite"

if not os.path.exists(db_path):
    print(f"Error: {db_path} not found!")
    exit(1)

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

try:
    cursor.execute("ALTER TABLE cryptic_abbreviations ADD COLUMN tier INTEGER DEFAULT 1;")
    conn.commit()
    print("Successfully added 'tier' column (defaulting existing entries to Tier 1 - Core).")
except sqlite3.OperationalError as e:
    if "duplicate column name" in str(e).lower():
        print("Column 'tier' already exists!")
    else:
        print(f"Error: {e}")

conn.close()