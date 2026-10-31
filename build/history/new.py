import sqlite3
import urllib.request
import re

def ingest_github_archive():
    url = "https://raw.githubusercontent.com/mhl/cryptic-crossword-indicators-and-abbreviations/refs/heads/master/indicators.yml"
    headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
    
    print(f"Fetching GitHub archive: {url}...")
    req = urllib.request.Request(url, headers=headers)
    
    try:
        with urllib.request.urlopen(req) as response:
            content = response.read().decode('utf-8')
    except Exception as e:
        print(f"Failed to download GitHub file: {e}")
        return

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

    # Parse YAML/Text lines structured like "  l: Labour" or "- abbr: meaning"
    lines = content.splitlines()
    for line in lines:
        # Match lines like:   l: Labour  or  abbr: meaning
        match = re.match(r'^\s*([a-zA-Z]{1,4})\s*:\s*(.+)$', line)
        if match:
            abbr = match.group(1).strip().upper()
            clue_term = match.group(2).strip().lower()

            # Basic cleaning: remove quotes, trailing comments, or list artifacts
            clue_term = re.sub(r'[\'"]', '', clue_term).split('#')[0].strip()

            if 1 <= len(abbr) <= 4 and abbr.isalpha() and len(clue_term) > 1:
                # Filter out obvious non-abbreviation indicator words if needed, 
                # but keep valid terms. Insert as Tier 3.
                cursor.execute("""
                    INSERT INTO cryptic_abbreviations (clue_term, abbreviation, tier) 
                    VALUES (?, ?, 3)
                    ON CONFLICT(clue_term, abbreviation) 
                    DO UPDATE SET tier = MIN(tier, EXCLUDED.tier);
                """, (clue_term, abbr))
                added_count += 1
            else:
                skipped_count += 1

    conn.commit()
    conn.close()
    print(f"Done! Processed GitHub archive: {added_count} entries evaluated/merged as Tier 3 (Protected existing Tier 1 & 2).")

if __name__ == "__main__":
    ingest_github_archive()