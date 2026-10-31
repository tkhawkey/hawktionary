import json
import sqlite3
import os
import re
from html.parser import HTMLParser

class SectionAwareCryptipediaParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.current_section = 1  # 1 = Word -> Abbr, 2 = Abbr -> Word
        self.in_li = False
        self.parsing_b = False
        self.current_term = []
        self.current_desc = []
        self.mappings = []

    def handle_starttag(self, tag, attrs):
        if tag == 'span':
            for attr, val in attrs:
                if attr == 'id' and val == 'Abbreviation_to_indicating_word':
                    self.current_section = 2
        elif tag == 'li':
            self.in_li = True
            self.current_term = []
            self.current_desc = []
            self.parsing_b = True
        elif tag == 'b' and self.in_li:
            self.parsing_b = True

    def handle_endtag(self, tag):
        if tag == 'b' and self.in_li:
            self.parsing_b = False
        elif tag == 'li' and self.in_li:
            self.in_li = False
            term = "".join(self.current_term).strip().lower()
            # Clean up leading/trailing punctuation from the term
            term = re.sub(r'^[^\w]+|[^\w]+$', '', term)
            
            desc = "".join(self.current_desc).strip()
            
            # Remove brackets/parentheses content like [not actually an abbreviation...] or (chess abbreviation)
            desc = re.sub(r'\[.*?\]|\(.*?\)', '', desc)

            if term and desc:
                parts = desc.replace(';', ',').split(',')
                for part in parts:
                    # Clean punctuation around each candidate abbreviation
                    abbr_clean = re.sub(r'^[^\w]+|[^\w]+$', '', part.strip()).upper()
                    
                    # Ignore common non-abbreviation noise like 'ETC', empty strings, or overly long descriptions
                    if abbr_clean and abbr_clean not in ['ETC', 'AND', 'OR'] and len(abbr_clean) <= 10:
                        if self.current_section == 1:
                            self.mappings.append((term, abbr_clean))
                        else:
                            self.mappings.append((abbr_clean.lower(), term.upper()))

    def handle_data(self, data):
        if self.in_li:
            if self.parsing_b:
                self.current_term.append(data)
            else:
                self.current_desc.append(data)

def ingest_cryptipedia():
    json_path = "cryptipedia.json"
    db_path = "dictionary.sqlite"

    if not os.path.exists(json_path):
        print(f"Error: Could not find {json_path}")
        return

    print("Parsing cryptipedia.json with strict sanitization...")
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    html_raw = data.get("parse", {}).get("text", {}).get("*", "")
    
    parser = SectionAwareCryptipediaParser()
    parser.feed(html_raw)

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    cursor.execute("DELETE FROM cryptic_abbreviations;")

    inserted_count = 0
    seen = set()

    for clue_term, abbr in parser.mappings:
        # Deduplicate on insert
        key = (clue_term, abbr)
        if key not in seen and len(clue_term) < 50:
            seen.add(key)
            try:
                cursor.execute(
                    "INSERT INTO cryptic_abbreviations (clue_term, abbreviation) VALUES (?, ?)",
                    (clue_term, abbr)
                )
                inserted_count += 1
            except sqlite3.Error:
                continue

    conn.commit()
    conn.close()
    print(f"Successfully ingested {inserted_count} clean cryptic mappings!")

if __name__ == "__main__":
    ingest_cryptipedia()