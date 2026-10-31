import sqlite3
import re
from html.parser import HTMLParser

class ClueClinicTableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_row = False
        self.in_cell = False
        self.current_row = []
        self.rows = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "tr":
            self.in_row = True
            self.current_row = []
        elif self.in_row and tag.lower() in ("td", "th"):
            self.in_cell = True

    def handle_endtag(self, tag):
        if tag.lower() == "tr" and self.in_row:
            self.in_row = False
            if self.current_row:
                self.rows.append(self.current_row)
        elif tag.lower() in ("td", "th") and self.in_cell:
            self.in_cell = False

    def handle_data(self, data):
        if self.in_cell:
            text = data.strip()
            if text:
                self.current_row.append(text)

def parse_and_ingest():
    html_path = "clue_clinic.html"
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            html_content = f.read()
    except FileNotFoundError:
        print(f"Error: Could not find '{html_path}'.")
        return

    parser = ClueClinicTableParser()
    parser.feed(html_content)

    db_path = "dictionary.sqlite"
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Ensure unique index exists
    cursor.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_abbr_clue 
        ON cryptic_abbreviations(clue_term, abbreviation);
    """)
    conn.commit()

    added_count = 0
    skipped_count = 0

    for row in parser.rows:
        if len(row) < 3:
            continue
        
        clue_term = row[0].strip().lower()
        raw_abbr_cell = row[1].strip()
        tag = row[2].strip().lower()

        # Skip header rows
        if clue_term == "text in clue" or raw_abbr_cell.lower() == "possible abbreviations":
            continue

        # Map Clue Clinic tags to your tier system: Standard -> Tier 2, Advanced -> Tier 3
        if "standard" in tag:
            tier = 2
        elif "advanced" in tag or "obscure" in tag:
            tier = 3
        else:
            tier = 2 # default fallback

        # Basic clue term cleaning
        clue_term = re.sub(r'\[.*?\]', '', clue_term).strip()

        # Split multiple abbreviations separated by spaces, commas, slashes, or semicolons
        abbr_list = [a.strip().upper() for a in re.split(r'[,/\s;]+', raw_abbr_cell) if a.strip()]

        for abbr in abbr_list:
            # Clean non-alphabetic noise if any
            abbr_clean = re.sub(r'[^A-Z]', '', abbr)

            if len(clue_term) > 0 and 1 <= len(abbr_clean) <= 4:
                # Insert or safely merge (protecting Tier 1 entries)
                cursor.execute("""
                    INSERT INTO cryptic_abbreviations (clue_term, abbreviation, tier) 
                    VALUES (?, ?, ?)
                    ON CONFLICT(clue_term, abbreviation) 
                    DO UPDATE SET tier = MIN(tier, EXCLUDED.tier);
                """, (clue_term, abbr_clean, tier))
                added_count += 1
            else:
                skipped_count += 1

    conn.commit()
    conn.close()
    print(f"Done! Successfully processed and merged {added_count} abbreviation mappings from Clue Clinic.")

if __name__ == "__main__":
    parse_and_ingest()