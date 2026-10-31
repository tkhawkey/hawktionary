import sqlite3
import urllib.request
import re
from html.parser import HTMLParser

class WikiListParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_li = False
        self.current_text = ""
        self.items = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == 'li':
            self.in_li = True
            self.current_text = ""

    def handle_endtag(self, tag):
        if tag.lower() == 'li' and self.in_li:
            self.in_li = False
            if self.current_text:
                self.items.append(self.current_text)

    def handle_data(self, data):
        if self.in_li:
            self.current_text += data

def clean_text(text):
    text = re.sub(r'\[.*?\]', '', text) # Remove citations like [1]
    return ' '.join(text.split()).strip()

def parse_wikipedia_line(item_text):
    """
    Attempts to parse lines formatted like: 'Beginner – L (for Learner)'
    Returns a list of (clue_term, abbreviation) tuples.
    """
    cleaned = clean_text(item_text)
    if not cleaned:
        return []

    # FIXED: Safely escaped hyphen and explicit unicode dashes/colons
    parts = re.split(r'\s+[\u2013\u2014\-:]\s+', cleaned, maxsplit=1)
    if len(parts) != 2:
        return []

    term_raw = parts[0]
    abbr_raw = parts[1]

    # Clean the term (e.g., remove trailing punctuation, notes)
    term = re.sub(r'\(.*?\)', '', term_raw).strip().lower()
    if not term or len(term) < 2:
        return []

    # Extract clean abbreviations from the second part
    abbr_matches = re.findall(r'\b([A-Z]{1,4})\b', abbr_raw)
    
    pairs = []
    for abbr in abbr_matches:
        abbr_upper = abbr.upper()
        if 1 <= len(abbr_upper) <= 4 and abbr_upper.isalpha():
            if abbr_upper not in ('OR', 'FOR', 'AND', 'THE', 'BY'):
                pairs.append((term, abbr_upper))

    return pairs

def scrape_wikipedia_abbreviations():
    url = "https://en.wikipedia.org/wiki/Crossword_abbreviations"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    
    print(f"Fetching Wikipedia page: {url}...")
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req) as response:
            html = response.read().decode('utf-8')
    except Exception as e:
        print(f"Failed to download page: {e}")
        return []

    parser = WikiListParser()
    parser.feed(html)
    
    parsed_pairs = []
    for item in parser.items:
        pairs = parse_wikipedia_line(item)
        parsed_pairs.extend(pairs)

    print(f"Extracted {len(parsed_pairs)} raw abbreviation mappings from Wikipedia lists.")
    return parsed_pairs

def populate_wikipedia_to_db():
    db_path = "dictionary.sqlite"
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Ensure unique index exists
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_abbr_clue 
        ON cryptic_abbreviations(clue_term, abbreviation);
    """)
    conn.commit()

    pairs = scrape_wikipedia_abbreviations()
    if not pairs:
        print("No valid pairs extracted.")
        conn.close()
        return

    added_count = 0
    updated_count = 0

    for clue_term, abbreviation in pairs:
        cursor.execute("SELECT tier FROM cryptic_abbreviations WHERE clue_term = ? AND abbreviation = ?", (clue_term, abbreviation))
        existing = cursor.fetchone()

        # Insert as Tier 2, protecting Tier 1 entries from being downgraded via MIN(tier, EXCLUDED.tier)
        cursor.execute("""
            INSERT INTO cryptic_abbreviations (clue_term, abbreviation, tier) 
            VALUES (?, ?, 2)
            ON CONFLICT(clue_term, abbreviation) 
            DO UPDATE SET tier = MIN(tier, EXCLUDED.tier);
        """, (clue_term, abbreviation))
        
        if not existing:
            added_count += 1
        else:
            updated_count += 1

    conn.commit()
    conn.close()
    print(f"Done! Inserted {added_count} new entries, protected existing entries, and synced with Wikipedia.")

if __name__ == "__main__":
    populate_wikipedia_to_db()