from html.parser import HTMLParser

class DiagnosticParser(HTMLParser):
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

parser = DiagnosticParser()
with open("clue_clinic.html", "r", encoding="utf-8") as f:
    parser.feed(f.read())

print(f"Total rows found: {len(parser.rows)}")
print("First 5 rows content:")
for i, r in enumerate(parser.rows[:5]):
    print(f"  Row {i}: {r}")