import os
import sqlite3
import re

def is_valid_ukacd_word(word):
    # Allow pure alphabetic words or words with internal hyphens (no leading/trailing hyphens)
    pattern = r"^[a-z]+(-[a-z]+)*$"
    return bool(re.match(pattern, word))

def ingest_ukacd():
    db_path = "dictionary.sqlite"
    folder = "LedgersWordz downloaded"
    
    if not os.path.exists(folder):
        print(f"Error: Could not find folder '{folder}'.")
        return

    js_files = []
    for root, dirs, files in os.walk(folder):
        for file in files:
            if file.startswith("AllWordzArray") and file.endswith(".js"):
                js_files.append(os.path.join(root, file))

    if not js_files:
        print("Error: Could not find any AllWordzArray*.js files.")
        return

    print(f"Found {len(js_files)} dictionary array files. Ingesting words (including hyphens)...")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    total_count = 0
    
    for file_path in js_files:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
            words = re.findall(r'"([^"]*)"', content)
            
            for word in words:
                word_clean = word.strip().lower()
                if is_valid_ukacd_word(word_clean):
                    try:
                        cursor.execute(
                            "INSERT OR IGNORE INTO words (word, length, is_ukacd) VALUES (?, ?, 1)",
                            (word_clean, len(word_clean))
                        )
                        total_count += 1
                    except sqlite3.Error:
                        continue

    conn.commit()
    conn.close()
    print(f"Successfully ingested {total_count} validated words (with hyphens) from Ledger's Wordz arrays!")

if __name__ == "__main__":
    ingest_ukacd()