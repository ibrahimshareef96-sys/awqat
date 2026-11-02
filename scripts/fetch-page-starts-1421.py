"""Builds scripts/page-starts-1421.json: the ayah each of the 604 pages of the King Fahd Complex 1421 print (QPC V2)
starts with, from Quran.com's page endpoint (mushaf 1). Only verse keys are kept, never the Quran's words.

Usage: python3 -I scripts/fetch-page-starts-1421.py
The 1421 print ends some pages on other ayat than the 1405 print (Tanzil's page map): for example the last two ayat of
Abasa open page 586. make-quran-data.py reads this file for the page map the app draws and links by.
A page of the Madinah mushaf always starts at the start of an ayah; the script checks that on every page.
"""
import json
import subprocess
import time
from pathlib import Path

OUT = Path(__file__).resolve().parent / "page-starts-1421.json"
PAGES = 604
API = ("https://api.quran.com/api/qdc/verses/by_page/{}?words=true&per_page=all"
       "&word_fields=location,page_number&fields=verse_key&mushaf=1&filter_page_words=true")


def get_json(url: str) -> dict:
    # curl uses the system's certificates (this Python may have none).
    for attempt in range(4):
        done = subprocess.run(["curl", "-sSf", "--max-time", "30", url], capture_output=True)
        if done.returncode == 0:
            return json.loads(done.stdout)
        time.sleep(2 + 3 * attempt)
    raise RuntimeError(f"{url}: {done.stderr.decode()}")


def main() -> None:
    starts = []
    for page in range(1, PAGES + 1):
        words = [w for v in get_json(API.format(page))["verses"] for w in v["words"]]
        assert words and all(w["page_number"] == page for w in words), f"page {page}: words from another page"
        sura, aya, position = (int(x) for x in words[0]["location"].split(":"))
        assert position == 1, f"page {page}: starts inside an ayah ({words[0]['location']})"
        starts.append([sura, aya])
        time.sleep(0.12)
    assert starts == sorted(starts) and len({tuple(s) for s in starts}) == PAGES, "pages out of order"
    OUT.write_text(json.dumps({"source": "api.quran.com qdc verses/by_page, mushaf=1 (QPC V2, 1421 print)",
                               "pages": starts}) + "\n")
    print(f"wrote {len(starts)} page starts to {OUT}")


if __name__ == "__main__":
    main()
