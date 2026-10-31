import sqlite3
import os

DB_NAME = "dictionary.sqlite"

def initialize_database():
    if os.path.exists(DB_NAME):
        os.remove(DB_NAME)  # Reset for a fresh build
        
    conn = sqlite3.connect(DB_NAME)
    cursor = conn.cursor()
    
    # Enable foreign keys for data integrity
    cursor.execute("PRAGMA foreign_keys = ON;")

    # 1. Core Words Table (UKACD validated)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS words (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word TEXT UNIQUE NOT NULL,
            length INTEGER NOT NULL,
            is_ukacd BOOLEAN DEFAULT 0
        );
    """)

    # 2. Definitions & Synonyms Table (Wiktionary / WordNet)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS definitions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            word_id INTEGER,
            source TEXT, -- 'wiktionary' or 'wordnet'
            part_of_speech TEXT,
            definition TEXT,
            synonyms TEXT, -- Stored as comma-separated or JSON
            FOREIGN KEY(word_id) REFERENCES words(id)
        );
    """)

    # 3. Cryptic Abbreviations Table (Cryptipedia)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS cryptic_abbreviations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            clue_term TEXT NOT NULL,
            abbreviation TEXT NOT NULL
        );
    """)

    # Create high-performance indexes for lightning-fast app lookups
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_word ON words(word);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_length ON words(length);")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_abbr ON cryptic_abbreviations(abbreviation);")

    conn.commit()
    conn.close()
    print("Database schema successfully created!")

if __name__ == "__main__":
    initialize_database()