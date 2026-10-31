import os
import sqlite3
import json

def ingest_wiktionary():
    db_path = "dictionary.sqlite"
    jsonl_path = "kaikki.org-dictionary-English.jsonl"

    if not os.path.exists(jsonl_path):
        print(f"Error: Could not find {jsonl_path}. Make sure it is in your folder.")
        return

    print(f"Found Wiktionary file: {jsonl_path}")
    print("Streaming and ingesting Wiktionary definitions (this may take a few minutes)...")

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    total_defs = 0
    line_count = 0

    with open(jsonl_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            line_count += 1
            if line_count % 100000 == 0:
                print(f"Processed {line_count} lines... (Inserted {total_defs} definitions so far)")

            try:
                data = json.loads(line)
                word = data.get("word", "").strip().lower()
                
                if not word:
                    continue

                # Check if this word exists in our core dictionary words table
                cursor.execute("SELECT id FROM words WHERE word = ?", (word,))
                row = cursor.fetchone()
                
                if not row:
                    continue
                    
                word_id = row[0]
                pos = data.get("pos", "unknown")
                senses = data.get("senses", [])

                for sense in senses:
                    # Kaikki typically puts definitions in 'glosses'
                    glosses = sense.get("glosses", [])
                    synonyms_list = sense.get("synonyms", [])
                    
                    # Flatten synonyms into a comma-separated string if any exist
                    synonyms_str = ", ".join([s.get("word", "") for s in synonyms_list if isinstance(s, dict) and "word" in s])

                    for gloss in glosses:
                        if gloss:
                            cursor.execute(
                                """INSERT INTO definitions (word_id, source, part_of_speech, definition, synonyms) 
                                   VALUES (?, ?, ?, ?, ?)""",
                                (word_id, 'wiktionary', pos, gloss, synonyms_str)
                            )
                            total_defs += 1

            except Exception:
                continue

    conn.commit()
    conn.close()
    print(f"Successfully ingested {total_defs} definitions from Wiktionary!")

if __name__ == "__main__":
    ingest_wiktionary()