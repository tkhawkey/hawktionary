import os
import sqlite3

def ingest_wordnet():
    db_path = "dictionary.sqlite"
    # Find the dict folder inside WNdb-3.0
    dict_folder = None
    for root, dirs, files in os.walk("WNdb-3.0"):
        if os.path.basename(root) == "dict":
            dict_folder = root
            break
            
    if not dict_folder:
        print("Error: Could not find the 'dict' folder inside WNdb-3.0. Make sure the folder is extracted properly.")
        return

    print(f"Found WordNet dict folder at: {dict_folder}")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    pos_files = {
        'noun': os.path.join(dict_folder, 'data.noun'),
        'verb': os.path.join(dict_folder, 'data.verb'),
        'adj': os.path.join(dict_folder, 'data.adj'),
        'adv': os.path.join(dict_folder, 'data.adv')
    }

    total_defs = 0

    for pos, filepath in pos_files.items():
        if not os.path.exists(filepath):
            print(f"Skipping {pos}: file not found.")
            continue
            
        print(f"Parsing {pos} definitions...")
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            for line in f:
                # Skip header lines in WordNet data files
                if line.startswith(' '):
                    continue
                try:
                    parts = line.split('|')
                    if len(parts) < 2:
                        continue
                        
                    synset_part = parts[0]
                    definition = parts[1].strip()
                    
                    tokens = synset_part.split()
                    if len(tokens) < 6:
                        continue
                        
                    w_cnt = int(tokens[3], 16)
                    word_offset = 4
                    
                    words_in_synset = []
                    for i in range(w_cnt):
                        word_lex = tokens[word_offset + (i * 2)]
                        # Convert WordNet underscore spacing to spaces
                        words_in_synset.append(word_lex.replace('_', ' '))

                    # Link these definitions to any words in our database matching the synset words
                    for word in words_in_synset:
                        word_lower = word.lower()
                        # Check if word exists in our words table
                        cursor.execute("SELECT id FROM words WHERE word = ?", (word_lower,))
                        row = cursor.fetchone()
                        
                        if row:
                            word_id = row[0]
                            cursor.execute(
                                "INSERT INTO definitions (word_id, source, part_of_speech, definition) VALUES (?, ?, ?, ?)",
                                (word_id, 'wordnet', pos, definition)
                            )
                            total_defs += 1
                except Exception:
                    continue

    conn.commit()
    conn.close()
    print(f"Successfully ingested {total_defs} WordNet definitions and linkages!")

if __name__ == "__main__":
    ingest_wordnet()